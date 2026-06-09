from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from app.agents.base import Agent
from app.prompts import (
    ARCHITECT_SYSTEM_PROMPT,
    BACKEND_SYSTEM_PROMPT,
    BASELINE_SYSTEM_PROMPT,
    CTO_SYSTEM_PROMPT,
    FRONTEND_SYSTEM_PROMPT,
    PM_SYSTEM_PROMPT,
    QA_SYSTEM_PROMPT,
    REVISION_SYSTEM_PROMPT,
)
from app.schemas import ProjectRunRequest
from app.services.memory_store import MemoryStore
from app.services.qwen_client import QwenClient
from app.services.scoring import score_baseline, score_devteam

ProgressCallback = Callable[[str, str, str, dict[str, Any] | None], Awaitable[None]]


class DevTeamWorkflow:
    def __init__(self, qwen_client: QwenClient, memory_store: MemoryStore):
        self.qwen_client = qwen_client
        self.memory_store = memory_store
        self.pm_agent = Agent("PM Agent", PM_SYSTEM_PROMPT, qwen_client)
        self.architect_agent = Agent("Architect Agent", ARCHITECT_SYSTEM_PROMPT, qwen_client)
        self.backend_agent = Agent("Backend Agent", BACKEND_SYSTEM_PROMPT, qwen_client)
        self.frontend_agent = Agent("Frontend Agent", FRONTEND_SYSTEM_PROMPT, qwen_client)
        self.qa_agent = Agent("QA Agent", QA_SYSTEM_PROMPT, qwen_client)
        self.cto_agent = Agent("CTO Agent", CTO_SYSTEM_PROMPT, qwen_client)
        self.revision_agent = Agent("Revision Coordinator Agent", REVISION_SYSTEM_PROMPT, qwen_client)
        self.baseline_agent = Agent("Single Agent Baseline", BASELINE_SYSTEM_PROMPT, qwen_client)

    async def _emit(
        self,
        progress: ProgressCallback | None,
        event_type: str,
        agent: str,
        message: str,
        payload: dict[str, Any] | None = None,
    ) -> None:
        if progress is not None:
            await progress(event_type, agent, message, payload)

    def _event_payload(self, artifact: dict[str, Any]) -> dict[str, Any]:
        payload: dict[str, Any] = {"keys": list(artifact.keys())}
        for field in ("summary", "title", "overview"):
            value = artifact.get(field)
            if isinstance(value, str) and value.strip():
                payload["summary"] = value[:400]
                break
        return payload

    async def _run_agent_step(
        self,
        agent: Agent,
        payload: dict[str, Any],
        temperature: float,
        progress: ProgressCallback | None,
        started_message: str,
        completed_message: str,
        event_agent: str | None = None,
    ) -> dict[str, Any]:
        display_name = event_agent or agent.name
        await self._emit(progress, "agent_started", display_name, started_message)
        try:
            artifact = await agent.run(payload, temperature=temperature)
        except Exception as exc:
            await self._emit(
                progress,
                "agent_failed",
                display_name,
                f"{display_name} failed: {exc}",
                {"error": str(exc)},
            )
            raise
        await self._emit(
            progress,
            "agent_completed",
            display_name,
            completed_message,
            self._event_payload(artifact),
        )
        return artifact

    async def run(
        self,
        request: ProjectRunRequest,
        progress: ProgressCallback | None = None,
    ) -> dict[str, Any]:
        project_id = str(uuid.uuid4())
        memory_matches = self.memory_store.search_memory(request.idea)
        conversation: list[dict[str, Any]] = []

        base_payload = {
            "idea": request.idea,
            "target_users": request.target_users,
            "platform": request.platform,
            "domain_context": request.domain_context,
            "constraints": request.constraints,
            "preferred_frontend_stack": request.preferred_frontend_stack or "Auto-select best stack",
            "relevant_previous_projects": memory_matches,
        }

        baseline = None

        prd = await self._run_agent_step(
            self.pm_agent,
            base_payload,
            0.2,
            progress,
            "PM Agent started creating the PRD",
            "PM Agent completed the PRD",
        )
        conversation.append({"agent": "PM Agent", "type": "artifact", "content": prd})

        architecture = await self._run_agent_step(
            self.architect_agent,
            {**base_payload, "prd": prd},
            0.2,
            progress,
            "Architect Agent started designing the system",
            "Architect Agent completed the architecture",
        )
        conversation.append({"agent": "Architect Agent", "type": "artifact", "content": architecture})

        backend_payload = {**base_payload, "prd": prd, "architecture": architecture}
        backend_task = asyncio.create_task(
            self._run_agent_step(
                self.backend_agent,
                backend_payload,
                0.2,
                progress,
                "Backend Agent started designing APIs and data models",
                "Backend Agent completed backend deliverables",
            )
        )
        frontend_task = asyncio.create_task(
            self._run_agent_step(
                self.frontend_agent,
                backend_payload,
                0.2,
                progress,
                "Frontend Agent started planning the frontend experience",
                "Frontend Agent completed frontend deliverables",
            )
        )
        try:
            backend, frontend = await asyncio.gather(backend_task, frontend_task)
        except Exception:
            for task in (backend_task, frontend_task):
                if not task.done():
                    task.cancel()
            await asyncio.gather(backend_task, frontend_task, return_exceptions=True)
            raise
        conversation.append({"agent": "Backend Agent", "type": "artifact", "content": backend})
        conversation.append({"agent": "Frontend Agent", "type": "artifact", "content": frontend})

        qa = await self._run_agent_step(
            self.qa_agent,
            {
                **base_payload,
                "prd": prd,
                "architecture": architecture,
                "backend": backend,
                "frontend": frontend,
            },
            0.2,
            progress,
            "QA Agent started creating the test strategy",
            "QA Agent completed the QA plan",
        )
        conversation.append({"agent": "QA Agent", "type": "artifact", "content": qa})

        cto_review = await self._run_agent_step(
            self.cto_agent,
            {
                **base_payload,
                "prd": prd,
                "architecture": architecture,
                "backend": backend,
                "frontend": frontend,
                "qa": qa,
            },
            0.1,
            progress,
            "CTO Agent started reviewing the combined plan",
            "CTO Agent completed the review",
        )
        conversation.append({"agent": "CTO Agent", "type": "review", "content": cto_review})

        revision = await self._run_agent_step(
            self.revision_agent,
            {
                **base_payload,
                "prd": prd,
                "architecture": architecture,
                "backend": backend,
                "frontend": frontend,
                "qa": qa,
                "cto_review": cto_review,
            },
            0.15,
            progress,
            "Revision Coordinator started resolving CTO feedback",
            "Revision Coordinator completed the revision plan",
            "Revision Coordinator",
        )
        conversation.append({"agent": "Revision Coordinator Agent", "type": "revision", "content": revision})

        if request.include_baseline:
            await self._emit(
                progress,
                "agent_started",
                "System",
                "Single-agent baseline comparison started",
            )
            try:
                baseline = await self.baseline_agent.run(base_payload, temperature=0.25)
            except Exception as exc:
                await self._emit(
                    progress,
                    "agent_failed",
                    "System",
                    f"Single-agent baseline failed: {exc}",
                    {"error": str(exc)},
                )
                raise
            baseline["score"] = score_baseline(baseline)
            await self._emit(
                progress,
                "agent_completed",
                "System",
                "Single-agent baseline comparison completed",
                {"score": baseline["score"]},
            )

        artifacts = {
            "prd": prd,
            "architecture": architecture,
            "backend": backend,
            "frontend": frontend,
            "qa": qa,
            "cto_review": cto_review,
            "revision": revision,
        }
        score = score_devteam(artifacts, memory_matches)

        self.memory_store.save_project(
            project_id=project_id,
            idea=request.idea,
            target_users=request.target_users,
            platform=request.platform,
            artifacts=artifacts,
            conversation=conversation,
            score=score,
        )

        result = {
            "project_id": project_id,
            "idea": request.idea,
            "memory_matches": memory_matches,
            "conversation": conversation,
            "artifacts": artifacts,
            "baseline": baseline,
            "score": score,
        }
        await self._emit(
            progress,
            "workflow_completed",
            "System",
            "DevTeam AI workflow completed",
            result,
        )
        return result
