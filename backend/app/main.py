from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import suppress
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse

from app.config import get_settings
from app.schemas import (
    ConflictResolutionRequest,
    ProjectCreateRequest,
    ProjectRunRequest,
    ProjectRunResponse,
    ProjectSummary,
    StageActionRequest,
    StagedProjectResponse,
)
from app.services.exporter import project_zip_bytes
from app.services.memory_store import MemoryStore
from app.services.qwen_client import QwenClient
from app.workflows.devteam_workflow import DevTeamWorkflow
from app.workflows.staged_project_service import StagedProjectService

settings = get_settings()
memory_store = MemoryStore(settings.database_path)
qwen_client = QwenClient(settings)
workflow = DevTeamWorkflow(qwen_client=qwen_client, memory_store=memory_store)
staged_projects = StagedProjectService(qwen_client=qwen_client, memory_store=memory_store)

app = FastAPI(
    title="DevTeam AI API",
    description="Qwen-powered multi-agent software delivery team",
    version="0.1.0",
    root_path="/api",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "model": settings.qwen_model, "env": settings.app_env}


def _progress_event(
    event_type: str,
    agent: str,
    message: str,
    stage: str | None = None,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": event_type,
        "agent": agent,
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if stage is not None:
        event["stage"] = stage
    if payload is not None:
        event["payload"] = payload
    return event


def _sse_event(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"


async def _project_event_stream(request: ProjectRunRequest) -> AsyncIterator[str]:
    queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()

    async def emit(
        event_type: str,
        agent: str,
        message: str,
        payload: dict[str, Any] | None = None,
    ) -> None:
        await queue.put(_progress_event(event_type, agent, message, None, payload))

    async def run_workflow() -> None:
        try:
            await workflow.run(request, progress=emit)
        except Exception as exc:
            await queue.put(
                _progress_event(
                    "agent_failed",
                    "System",
                    f"Workflow failed: {exc}",
                    None,
                    {"error": str(exc)},
                )
            )
        finally:
            await queue.put(None)

    task = asyncio.create_task(run_workflow())
    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            yield _sse_event(event)
    finally:
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task


async def _stage_event_stream(project_id: str, stage_name: str, request: StageActionRequest | None) -> AsyncIterator[str]:
    started_type = "task_decomposition_started" if stage_name == "decomposition" else "stage_started"
    completed_type = "task_decomposition_completed" if stage_name == "decomposition" else "stage_completed"
    agent = "System"
    with suppress(HTTPException):
        project = staged_projects.get_project(project_id)
        stage = next((item for item in project["stages"] if item["name"] == stage_name), None)
        if stage:
            agent = stage["assigned_agent"]

    yield _sse_event(
        _progress_event(
            started_type,
            agent,
            f"Running {stage_name.replace('_', ' ')}",
            stage_name,
        )
    )
    try:
        result = await staged_projects.run_stage(project_id, stage_name, request.feedback if request else None)
    except Exception as exc:
        yield _sse_event(
            _progress_event(
                "workflow_failed",
                agent,
                f"Stage failed: {exc}",
                stage_name,
                {"error": str(exc)},
            )
        )
        return

    yield _sse_event(
        _progress_event(
            "agent_message",
            agent,
            f"{agent} produced stage output",
            stage_name,
            {"stage": stage_name},
        )
    )
    if result.get("conflicts"):
        latest_conflict = result["conflicts"][-1]
        if latest_conflict.get("status") == "open":
            yield _sse_event(
                _progress_event(
                    "conflict_detected",
                    "CTO Agent",
                    latest_conflict.get("description", "Conflict detected"),
                    "cto_review",
                    latest_conflict,
                )
            )
    yield _sse_event(
        _progress_event(
            completed_type,
            agent,
            f"{stage_name.replace('_', ' ')} completed",
            stage_name,
            result,
        )
    )
    yield _sse_event(
        _progress_event(
            "stage_awaiting_approval",
            agent,
            f"{stage_name.replace('_', ' ')} is awaiting approval",
            stage_name,
            {"project_id": project_id, "stage": stage_name},
        )
    )


@app.post("/projects/run", response_model=ProjectRunResponse)
async def run_project(request: ProjectRunRequest) -> dict:
    try:
        return await workflow.run(request)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/projects", response_model=StagedProjectResponse)
def create_project(request: ProjectCreateRequest) -> dict:
    try:
        return staged_projects.create_project(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not create project: {exc}") from exc


@app.get("/projects/{project_id}/state", response_model=StagedProjectResponse)
def get_staged_project(project_id: str) -> dict:
    return staged_projects.get_project(project_id)


@app.post("/projects/{project_id}/stages/{stage_name}/run", response_model=StagedProjectResponse)
async def run_project_stage(project_id: str, stage_name: str, request: StageActionRequest | None = None) -> dict:
    return await staged_projects.run_stage(project_id, stage_name, request.feedback if request else None)


@app.post("/projects/{project_id}/stages/{stage_name}/run-stream")
async def run_project_stage_stream(project_id: str, stage_name: str, request: StageActionRequest | None = None) -> StreamingResponse:
    return StreamingResponse(
        _stage_event_stream(project_id, stage_name, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/projects/{project_id}/stages/{stage_name}/approve", response_model=StagedProjectResponse)
def approve_project_stage(project_id: str, stage_name: str) -> dict:
    return staged_projects.approve_stage(project_id, stage_name)


@app.post("/projects/{project_id}/stages/{stage_name}/revise", response_model=StagedProjectResponse)
async def revise_project_stage(project_id: str, stage_name: str, request: StageActionRequest) -> dict:
    return await staged_projects.revise_stage(project_id, stage_name, request.feedback)


@app.post("/projects/{project_id}/stages/{stage_name}/regenerate", response_model=StagedProjectResponse)
async def regenerate_project_stage(project_id: str, stage_name: str) -> dict:
    return await staged_projects.regenerate_stage(project_id, stage_name)


@app.get("/projects/{project_id}/dialogue")
def get_project_dialogue(project_id: str) -> list[dict[str, Any]]:
    return staged_projects.list_dialogue(project_id)


@app.get("/projects/{project_id}/conflicts")
def get_project_conflicts(project_id: str) -> list[dict[str, Any]]:
    return staged_projects.list_conflicts(project_id)


@app.post("/projects/{project_id}/conflicts/{conflict_id}/resolve", response_model=StagedProjectResponse)
async def resolve_project_conflict(
    project_id: str,
    conflict_id: str,
    request: ConflictResolutionRequest | None = None,
) -> dict:
    action = request.action if request else "resolve"
    feedback = request.feedback if request else None
    return await staged_projects.resolve_conflict(project_id, conflict_id, action == "accept_risk", feedback)


@app.post("/projects/{project_id}/baseline/run", response_model=StagedProjectResponse)
async def run_project_baseline(project_id: str) -> dict:
    return await staged_projects.run_baseline(project_id)


@app.get("/projects/{project_id}/comparison")
def get_project_comparison(project_id: str) -> dict[str, Any]:
    return staged_projects.get_comparison(project_id)


@app.post("/projects/{project_id}/generate-code", response_model=StagedProjectResponse)
async def generate_project_code(project_id: str) -> dict:
    return await staged_projects.generate_code(project_id)


@app.post("/projects/{project_id}/review-code", response_model=StagedProjectResponse)
async def review_project_code(project_id: str) -> dict:
    return await staged_projects.review_code(project_id)


@app.post("/projects/run-stream")
async def run_project_stream(request: ProjectRunRequest) -> StreamingResponse:
    return StreamingResponse(
        _project_event_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/projects", response_model=list[ProjectSummary])
def list_projects() -> list[dict]:
    try:
        staged = memory_store.list_staged_projects()
        staged_ids = {project["id"] for project in staged}
        quick_runs = [
            {**project, "updated_at": project["created_at"], "current_stage": None, "type": "quick_run"}
            for project in memory_store.list_projects()
            if project["id"] not in staged_ids
        ]
        return [*staged, *quick_runs][:50]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load project history: {exc}") from exc


@app.get("/projects/{project_id}")
def get_project(project_id: str) -> dict:
    with suppress(HTTPException):
        return staged_projects.get_project(project_id)
    project = memory_store.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@app.get("/projects/{project_id}/export.zip")
def export_project(project_id: str) -> Response:
    project = None
    with suppress(HTTPException):
        project = staged_projects.get_project(project_id)
    if project is None:
        project = memory_store.get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    content = project_zip_bytes(project)
    return Response(
        content=content,
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename=devteam-ai-{project_id}.zip"},
    )


@app.get("/projects/{project_id}/export")
def export_project_alias(project_id: str) -> Response:
    return export_project(project_id)


@app.get("/memory/search")
def search_memory(q: str) -> list[dict]:
    return memory_store.search_memory(q)
