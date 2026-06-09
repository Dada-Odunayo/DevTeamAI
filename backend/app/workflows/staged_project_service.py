from __future__ import annotations

import copy
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from app.agents.base import Agent
from app.prompts import (
    ARCHITECT_SYSTEM_PROMPT,
    BACKEND_SYSTEM_PROMPT,
    BASELINE_SYSTEM_PROMPT,
    CODE_GENERATOR_SYSTEM_PROMPT,
    CODE_REVIEWER_SYSTEM_PROMPT,
    CTO_SYSTEM_PROMPT,
    FRONTEND_SYSTEM_PROMPT,
    NEGOTIATOR_SYSTEM_PROMPT,
    ORCHESTRATOR_SYSTEM_PROMPT,
    PM_SYSTEM_PROMPT,
    QA_SYSTEM_PROMPT,
    REVISION_SYSTEM_PROMPT,
)
from app.schemas import ProjectCreateRequest
from app.services.memory_store import MemoryStore
from app.services.qwen_client import QwenClient
from app.services.scoring_service import build_baseline_comparison, detect_conflicts, score_artifacts


STAGE_DEFINITIONS: list[dict[str, Any]] = [
    {"name": "decomposition", "title": "Task Decomposition", "agent": "Orchestrator Agent", "dependencies": []},
    {"name": "prd", "title": "PRD", "agent": "PM Agent", "dependencies": ["decomposition"]},
    {"name": "architecture", "title": "Architecture", "agent": "Architect Agent", "dependencies": ["prd"]},
    {"name": "backend_plan", "title": "Backend Plan", "agent": "Backend Agent", "dependencies": ["architecture"]},
    {"name": "frontend_plan", "title": "Frontend Plan", "agent": "Frontend Agent", "dependencies": ["architecture"]},
    {"name": "qa_plan", "title": "QA Plan", "agent": "QA Agent", "dependencies": ["backend_plan", "frontend_plan"]},
    {"name": "cto_review", "title": "CTO Review", "agent": "CTO Agent", "dependencies": ["qa_plan"]},
    {"name": "negotiation", "title": "Negotiation", "agent": "Negotiator Agent", "dependencies": ["cto_review"]},
    {"name": "revision_summary", "title": "Revision Summary", "agent": "Revision Coordinator Agent", "dependencies": ["cto_review"]},
    {"name": "code_generation", "title": "Code Generation", "agent": "Code Generator Agent", "dependencies": ["revision_summary"]},
    {"name": "code_review", "title": "Code Review", "agent": "Code Reviewer Agent", "dependencies": ["code_generation"]},
]

ARTIFACT_STAGE_MAP = {
    "decomposition": "decomposition",
    "prd": "prd",
    "architecture": "architecture",
    "backend_plan": "backend",
    "frontend_plan": "frontend",
    "qa_plan": "qa",
    "cto_review": "cto_review",
    "negotiation": "negotiation",
    "revision_summary": "revision",
    "code_generation": "code_generation",
    "code_review": "code_review",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class StagedProjectService:
    def __init__(self, qwen_client: QwenClient, memory_store: MemoryStore):
        self.memory_store = memory_store
        self.projects: dict[str, dict[str, Any]] = {}
        self.agents = {
            "decomposition": Agent("Orchestrator Agent", ORCHESTRATOR_SYSTEM_PROMPT, qwen_client),
            "prd": Agent("PM Agent", PM_SYSTEM_PROMPT, qwen_client),
            "architecture": Agent("Architect Agent", ARCHITECT_SYSTEM_PROMPT, qwen_client),
            "backend_plan": Agent("Backend Agent", BACKEND_SYSTEM_PROMPT, qwen_client),
            "frontend_plan": Agent("Frontend Agent", FRONTEND_SYSTEM_PROMPT, qwen_client),
            "qa_plan": Agent("QA Agent", QA_SYSTEM_PROMPT, qwen_client),
            "cto_review": Agent("CTO Agent", CTO_SYSTEM_PROMPT, qwen_client),
            "negotiation": Agent("Negotiator Agent", NEGOTIATOR_SYSTEM_PROMPT, qwen_client),
            "revision_summary": Agent("Revision Coordinator Agent", REVISION_SYSTEM_PROMPT, qwen_client),
            "code_generation": Agent("Code Generator Agent", CODE_GENERATOR_SYSTEM_PROMPT, qwen_client),
            "code_review": Agent("Code Reviewer Agent", CODE_REVIEWER_SYSTEM_PROMPT, qwen_client),
            "baseline": Agent("Single Agent Baseline", BASELINE_SYSTEM_PROMPT, qwen_client),
        }

    def create_project(self, request: ProjectCreateRequest) -> dict[str, Any]:
        project_id = str(uuid.uuid4())
        created_at = now_iso()
        stages = []
        for definition in STAGE_DEFINITIONS:
            stages.append(
                {
                    "id": str(uuid.uuid4()),
                    "project_id": project_id,
                    "name": definition["name"],
                    "status": "locked",
                    "version": 0,
                    "assigned_agent": definition["agent"],
                    "dependencies": definition["dependencies"],
                    "content": None,
                    "user_feedback": None,
                    "created_at": created_at,
                    "updated_at": created_at,
                    "human_approval_required": definition["name"] not in {"code_generation", "code_review"},
                }
            )

        project = {
            "id": project_id,
            "idea": request.idea,
            "target_users": request.target_users,
            "platform": request.platform,
            "domain_context": request.domain_context,
            "constraints": request.constraints,
            "preferred_frontend_stack": request.preferred_frontend_stack or "Auto-select best stack",
            "include_baseline": request.include_baseline,
            "current_stage": "decomposition",
            "created_at": created_at,
            "updated_at": created_at,
            "stages": stages,
            "dialogue": [],
            "conflicts": [],
            "baseline_result": None,
            "baseline_comparison": None,
            "generated_files": [],
            "artifacts": {},
            "memory_matches": self.memory_store.search_memory(request.idea),
        }
        self.projects[project_id] = project
        self._add_dialogue(
            project,
            "decomposition",
            "Orchestrator Agent",
            "All Agents",
            "proposal",
            "I will decompose the project, assign specialist agents, and make approval gates explicit.",
            "decomposition",
        )
        self._save_project(project)
        return self._public_project(project)

    def get_project(self, project_id: str) -> dict[str, Any]:
        return self._public_project(self._require_project(project_id))

    async def run_stage(self, project_id: str, stage_name: str, feedback: str | None = None) -> dict[str, Any]:
        project = self._require_project(project_id)
        stage = self._require_stage(project, stage_name)
        if not self._stage_can_run(project, stage_name):
            raise HTTPException(status_code=409, detail="Stage dependencies are not approved yet")

        stage["status"] = "running"
        stage["updated_at"] = now_iso()
        stage["user_feedback"] = feedback
        project["current_stage"] = stage_name
        project["updated_at"] = stage["updated_at"]
        self._add_dialogue(
            project,
            stage_name,
            stage["assigned_agent"],
            "User",
            "proposal" if feedback is None else "revision_request",
            self._stage_start_message(stage_name, feedback),
            ARTIFACT_STAGE_MAP.get(stage_name, stage_name),
        )
        self._save_project(project)

        payload = self._stage_payload(project, stage_name, feedback)
        try:
            output = await self.agents[stage_name].run(payload, temperature=0.15 if stage_name == "cto_review" else 0.2)
        except Exception:
            stage["status"] = "failed"
            stage["updated_at"] = now_iso()
            project["updated_at"] = stage["updated_at"]
            self._save_project(project)
            raise

        if stage_name == "code_generation":
            files = self._coerce_generated_files(project, output)
            output["files"] = files
            project["generated_files"] = [self._generated_file(project["id"], file) for file in files]

        stage["version"] += 1
        stage["status"] = "awaiting_approval" if stage.get("human_approval_required") else "approved"
        stage["updated_at"] = now_iso()
        stage["content"] = self._stage_content(project, stage_name, payload, output)
        project["updated_at"] = stage["updated_at"]
        self._store_artifact(project, stage_name, output)
        self._add_dialogue(
            project,
            stage_name,
            stage["assigned_agent"],
            "All Agents",
            "final_decision" if stage_name in {"negotiation", "revision_summary"} else "agreement",
            f"{stage['assigned_agent']} completed {stage_name.replace('_', ' ')} and is awaiting review.",
            ARTIFACT_STAGE_MAP.get(stage_name, stage_name),
        )

        if stage_name in {"backend_plan", "frontend_plan", "cto_review"}:
            self._sync_conflicts(project)

        if stage_name == "code_review":
            stage["status"] = "approved"

        self._save_project(project)
        return self._public_project(project)

    def approve_stage(self, project_id: str, stage_name: str) -> dict[str, Any]:
        project = self._require_project(project_id)
        stage = self._require_stage(project, stage_name)
        if stage["status"] not in {"awaiting_approval", "needs_revision", "approved"}:
            raise HTTPException(status_code=409, detail="Stage has no completed output to approve")
        stage["status"] = "approved"
        stage["updated_at"] = now_iso()
        project["updated_at"] = stage["updated_at"]
        project["current_stage"] = self._next_unapproved_stage(project) or stage_name
        self._add_dialogue(
            project,
            stage_name,
            "User",
            stage["assigned_agent"],
            "agreement",
            f"Approved {stage_name.replace('_', ' ')} version {stage['version']}.",
            ARTIFACT_STAGE_MAP.get(stage_name, stage_name),
        )
        self._save_project(project)
        return self._public_project(project)

    async def revise_stage(self, project_id: str, stage_name: str, feedback: str | None) -> dict[str, Any]:
        project = self._require_project(project_id)
        stage = self._require_stage(project, stage_name)
        stage["status"] = "needs_revision"
        stage["user_feedback"] = feedback
        self._add_dialogue(
            project,
            stage_name,
            "User",
            stage["assigned_agent"],
            "revision_request",
            feedback or f"Please revise {stage_name.replace('_', ' ')}.",
            ARTIFACT_STAGE_MAP.get(stage_name, stage_name),
        )
        return await self.run_stage(project_id, stage_name, feedback)

    async def regenerate_stage(self, project_id: str, stage_name: str) -> dict[str, Any]:
        return await self.run_stage(project_id, stage_name, None)

    def list_dialogue(self, project_id: str) -> list[dict[str, Any]]:
        return self._require_project(project_id)["dialogue"]

    def list_conflicts(self, project_id: str) -> list[dict[str, Any]]:
        return self._require_project(project_id)["conflicts"]

    async def resolve_conflict(self, project_id: str, conflict_id: str, accept_risk: bool = False, feedback: str | None = None) -> dict[str, Any]:
        project = self._require_project(project_id)
        conflict = self._require_conflict(project, conflict_id)
        if accept_risk:
            conflict["status"] = "accepted_risk"
            conflict["resolved_at"] = now_iso()
            conflict["resolution"] = {"decision_title": "Accepted Risk", "final_decision": feedback or "User accepted this risk."}
            self._add_dialogue(
                project,
                "negotiation",
                "User",
                "Negotiator Agent",
                "final_decision",
                f"Accepted risk for conflict {conflict_id}.",
                "negotiation",
            )
            self._save_project(project)
            return self._public_project(project)

        payload = {
            "project": self._request_context(project),
            "conflict": conflict,
            "approved_artifacts": self._approved_artifacts(project),
            "user_feedback": feedback,
        }
        self._add_dialogue(
            project,
            "negotiation",
            "CTO Agent",
            "Negotiator Agent",
            "challenge",
            conflict["description"],
            "negotiation",
        )
        decision = await self.agents["negotiation"].run(payload, temperature=0.15)
        conflict["status"] = "resolved"
        conflict["resolved_at"] = now_iso()
        conflict["resolution"] = decision
        project["artifacts"]["negotiation"] = decision
        negotiation_stage = self._require_stage(project, "negotiation")
        negotiation_stage["version"] += 1
        negotiation_stage["status"] = "awaiting_approval"
        negotiation_stage["content"] = self._stage_content(project, "negotiation", payload, decision)
        negotiation_stage["updated_at"] = now_iso()
        self._add_dialogue(
            project,
            "negotiation",
            "Negotiator Agent",
            "All Agents",
            "resolution",
            decision.get("final_decision") or f"Resolved conflict {conflict_id}.",
            "negotiation",
        )
        self._save_project(project)
        return self._public_project(project)

    async def run_baseline(self, project_id: str) -> dict[str, Any]:
        project = self._require_project(project_id)
        baseline = await self.agents["baseline"].run(self._request_context(project), temperature=0.25)
        project["baseline_result"] = baseline
        project["baseline_comparison"] = build_baseline_comparison(
            baseline,
            self._approved_artifacts(project) or project["artifacts"],
            project["conflicts"],
        )
        self._add_dialogue(
            project,
            "baseline",
            "Single Agent Baseline",
            "System",
            "agreement",
            "Generated the single-agent baseline and compared it with the multi-agent plan.",
            "baseline_comparison",
        )
        self._save_project(project)
        return self._public_project(project)

    def get_comparison(self, project_id: str) -> dict[str, Any]:
        project = self._require_project(project_id)
        if project["baseline_comparison"] is None:
            project["baseline_comparison"] = build_baseline_comparison(
                project["baseline_result"] or {},
                self._approved_artifacts(project) or project["artifacts"],
                project["conflicts"],
            )
            self._save_project(project)
        return project["baseline_comparison"]

    async def generate_code(self, project_id: str) -> dict[str, Any]:
        project = self._require_project(project_id)
        if not self._is_approved(project, "revision_summary"):
            raise HTTPException(status_code=409, detail="Final plan approval is required before code generation")
        return await self.run_stage(project_id, "code_generation")

    async def review_code(self, project_id: str) -> dict[str, Any]:
        project = self._require_project(project_id)
        if not project["generated_files"]:
            raise HTTPException(status_code=409, detail="Generate code before requesting code review")
        return await self.run_stage(project_id, "code_review")

    def _require_project(self, project_id: str) -> dict[str, Any]:
        project = self.projects.get(project_id)
        if project is None:
            project = self.memory_store.get_staged_project(project_id)
            if project is None:
                raise HTTPException(status_code=404, detail="Project not found")
            self.projects[project_id] = project
        return project

    def _save_project(self, project: dict[str, Any]) -> None:
        persisted = copy.deepcopy(project)
        persisted["score"] = score_artifacts(project["artifacts"], project["conflicts"])
        self.memory_store.save_staged_project(persisted)

    def _require_stage(self, project: dict[str, Any], stage_name: str) -> dict[str, Any]:
        for stage in project["stages"]:
            if stage["name"] == stage_name:
                return stage
        raise HTTPException(status_code=404, detail="Stage not found")

    def _require_conflict(self, project: dict[str, Any], conflict_id: str) -> dict[str, Any]:
        for conflict in project["conflicts"]:
            if conflict["id"] == conflict_id or conflict.get("conflict_id") == conflict_id:
                return conflict
        raise HTTPException(status_code=404, detail="Conflict not found")

    def _is_approved(self, project: dict[str, Any], stage_name: str) -> bool:
        return self._require_stage(project, stage_name)["status"] == "approved"

    def _stage_can_run(self, project: dict[str, Any], stage_name: str) -> bool:
        stage = self._require_stage(project, stage_name)
        if stage_name == "negotiation":
            return self._is_approved(project, "cto_review") and bool(
                [conflict for conflict in project["conflicts"] if conflict["status"] == "open"]
            )
        if stage_name == "code_generation":
            return self._is_approved(project, "revision_summary")
        if stage_name == "code_review":
            return bool(project["generated_files"])
        return all(self._is_approved(project, dep) for dep in stage["dependencies"])

    def _next_unapproved_stage(self, project: dict[str, Any]) -> str | None:
        for definition in STAGE_DEFINITIONS:
            stage = self._require_stage(project, definition["name"])
            if stage["status"] != "approved" and self._stage_can_run(project, definition["name"]):
                return definition["name"]
        return None

    def _request_context(self, project: dict[str, Any]) -> dict[str, Any]:
        return {
            "idea": project["idea"],
            "target_users": project.get("target_users"),
            "platform": project.get("platform"),
            "domain_context": project.get("domain_context"),
            "constraints": project.get("constraints", []),
            "preferred_frontend_stack": project.get("preferred_frontend_stack"),
            "relevant_previous_projects": project.get("memory_matches", []),
        }

    def _approved_artifacts(self, project: dict[str, Any]) -> dict[str, Any]:
        artifacts: dict[str, Any] = {}
        for stage in project["stages"]:
            artifact_key = ARTIFACT_STAGE_MAP.get(stage["name"])
            if artifact_key and stage["status"] == "approved" and stage.get("content"):
                artifacts[artifact_key] = stage["content"]["output"]
        return artifacts

    def _stage_payload(self, project: dict[str, Any], stage_name: str, feedback: str | None) -> dict[str, Any]:
        return {
            **self._request_context(project),
            "stage": stage_name,
            "assigned_agent": self._require_stage(project, stage_name)["assigned_agent"],
            "task_assigned": self._task_for_stage(stage_name),
            "approved_artifacts": self._approved_artifacts(project),
            "current_artifacts": project["artifacts"],
            "open_conflicts": [conflict for conflict in project["conflicts"] if conflict["status"] == "open"],
            "user_feedback": feedback,
        }

    def _stage_content(
        self,
        project: dict[str, Any],
        stage_name: str,
        payload: dict[str, Any],
        output: dict[str, Any],
    ) -> dict[str, Any]:
        conflicts = [conflict for conflict in project["conflicts"] if conflict.get("stage_name") == stage_name or conflict["status"] == "open"]
        return {
            "stage_name": stage_name,
            "responsible_agent": self._require_stage(project, stage_name)["assigned_agent"],
            "input_received": {
                "project": self._request_context(project),
                "approved_artifact_keys": list(payload.get("approved_artifacts", {}).keys()),
                "open_conflict_ids": [conflict["id"] for conflict in payload.get("open_conflicts", [])],
                "user_feedback": payload.get("user_feedback"),
            },
            "task_assigned": payload["task_assigned"],
            "output": output,
            "disagreements": [conflict["description"] for conflict in conflicts],
            "conflicts_resolved": [
                conflict["description"] for conflict in project["conflicts"] if conflict["status"] == "resolved"
            ],
            "human_approval_required": self._require_stage(project, stage_name).get("human_approval_required", True),
        }

    def _store_artifact(self, project: dict[str, Any], stage_name: str, output: dict[str, Any]) -> None:
        artifact_key = ARTIFACT_STAGE_MAP.get(stage_name)
        if artifact_key:
            project["artifacts"][artifact_key] = output

    def _add_dialogue(
        self,
        project: dict[str, Any],
        stage_name: str,
        speaker: str,
        recipient: str | None,
        dialogue_type: str,
        message: str,
        related_artifact: str | None,
    ) -> None:
        project["dialogue"].append(
            {
                "id": str(uuid.uuid4()),
                "project_id": project["id"],
                "stage_name": stage_name,
                "speaker": speaker,
                "recipient": recipient,
                "type": dialogue_type,
                "message": message,
                "related_artifact": related_artifact,
                "created_at": now_iso(),
            }
        )

    def _sync_conflicts(self, project: dict[str, Any]) -> None:
        existing = {conflict.get("conflict_id"): conflict for conflict in project["conflicts"]}
        for raw in detect_conflicts(project["artifacts"], self._request_context(project)):
            if raw["conflict_id"] in existing:
                continue
            conflict = {
                "id": raw["conflict_id"],
                "project_id": project["id"],
                "created_at": now_iso(),
                "resolved_at": None,
                "resolution": None,
                **raw,
            }
            project["conflicts"].append(conflict)
            self._add_dialogue(
                project,
                "cto_review",
                "CTO Agent",
                ", ".join(raw["affected_agents"]),
                "challenge",
                raw["description"],
                "cto_review",
            )

        cto = project["artifacts"].get("cto_review", {})
        if isinstance(cto, dict):
            for index, raw_conflict in enumerate(cto.get("conflicts_detected") or []):
                if not isinstance(raw_conflict, dict):
                    continue
                conflict_id = f"cto_conflict_{index + 1}"
                if conflict_id in existing:
                    continue
                severity = str(raw_conflict.get("severity", "medium")).lower()
                if severity not in {"low", "medium", "high", "critical"}:
                    severity = "medium"
                conflict = {
                    "id": conflict_id,
                    "conflict_id": conflict_id,
                    "project_id": project["id"],
                    "severity": severity,
                    "detected_by": "CTO Agent",
                    "affected_agents": raw_conflict.get("affected_agents", ["CTO Agent"]),
                    "description": raw_conflict.get("description") or raw_conflict.get("title") or "CTO detected a conflict.",
                    "evidence": raw_conflict.get("evidence", []),
                    "recommended_resolution": raw_conflict.get("recommended_resolution", "Resolve through negotiation."),
                    "status": "open",
                    "created_at": now_iso(),
                    "resolved_at": None,
                    "resolution": None,
                }
                project["conflicts"].append(conflict)

    def _public_project(self, project: dict[str, Any]) -> dict[str, Any]:
        public = copy.deepcopy(project)
        public["stages"] = [
            {
                **stage,
                "can_run": self._stage_can_run(project, stage["name"]),
            }
            for stage in public["stages"]
        ]
        public["artifacts"] = copy.deepcopy(project["artifacts"])
        if project["baseline_comparison"] is None and project["baseline_result"] is not None:
            public["baseline_comparison"] = build_baseline_comparison(
                project["baseline_result"],
                self._approved_artifacts(project) or project["artifacts"],
                project["conflicts"],
            )
        public.pop("baseline_result", None)
        public["score"] = score_artifacts(project["artifacts"], project["conflicts"])
        return public

    def _task_for_stage(self, stage_name: str) -> str:
        tasks = {
            "decomposition": "Decompose the user request into staged work, assign roles, and define dependencies.",
            "prd": "Create the product requirements document from the approved decomposition.",
            "architecture": "Design architecture from the approved PRD.",
            "backend_plan": "Design backend services, data model, APIs, auth, validation, jobs, logging, and observability.",
            "frontend_plan": "Design frontend/mobile/web experience using the preferred stack decision.",
            "qa_plan": "Create functional, negative, edge, performance, security, and regression tests.",
            "cto_review": "Challenge all artifacts and identify contradictions, gaps, risks, and conflicts.",
            "negotiation": "Resolve open disagreements and produce an ADR-style decision record.",
            "revision_summary": "Apply accepted CTO and negotiation recommendations to affected artifacts.",
            "code_generation": "Generate a clean starter scaffold from the approved plan.",
            "code_review": "Review generated starter code for correctness, contracts, security, and missing files.",
        }
        return tasks[stage_name]

    def _stage_start_message(self, stage_name: str, feedback: str | None) -> str:
        if feedback:
            return f"Running {stage_name.replace('_', ' ')} with human feedback: {feedback}"
        return f"Running {stage_name.replace('_', ' ')} with approved dependencies."

    def _coerce_generated_files(self, project: dict[str, Any], output: dict[str, Any]) -> list[dict[str, str]]:
        files = output.get("files") if isinstance(output, dict) else None
        if isinstance(files, list) and files:
            return [
                {
                    "path": str(file.get("path", "README.md")),
                    "language": str(file.get("language", "text")),
                    "content": str(file.get("content", "")),
                }
                for file in files
                if isinstance(file, dict)
            ]
        return self._starter_files(project)

    def _generated_file(self, project_id: str, file: dict[str, str]) -> dict[str, str]:
        return {
            "id": str(uuid.uuid4()),
            "project_id": project_id,
            "path": file["path"],
            "language": file["language"],
            "content": file["content"],
            "created_at": now_iso(),
        }

    def _starter_files(self, project: dict[str, Any]) -> list[dict[str, str]]:
        name = project["idea"].split(".")[0][:80]
        artifacts = project["artifacts"]
        backend = artifacts.get("backend", {})
        frontend = artifacts.get("frontend", {})
        stack = ""
        if isinstance(frontend, dict):
            stack = str((frontend.get("frontend_stack_decision") or {}).get("recommended_stack") or "")
        use_next = "next" in stack.lower() or "web" in str(project.get("platform", "")).lower()
        use_kotlin = "kotlin" in stack.lower()
        files = [
            {
                "path": "README.md",
                "language": "markdown",
                "content": f"# {name}\n\nStarter scaffold generated from the approved DevTeam AI plan.\n\n## Run\n\nReview `.env.example`, then start the backend and selected frontend/mobile scaffold.\n",
            },
            {
                "path": "docker-compose.yml",
                "language": "yaml",
                "content": "services:\n  api:\n    build: ./backend\n    env_file: .env\n    ports:\n      - \"8000:8000\"\n",
            },
            {"path": ".env.example", "language": "dotenv", "content": "DATABASE_URL=sqlite:///./app.db\nAPI_PORT=8000\n"},
            {
                "path": "database/schema.sql",
                "language": "sql",
                "content": backend.get("database_schema_sql", "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL);\n"),
            },
            {
                "path": "openapi.yaml",
                "language": "yaml",
                "content": backend.get("openapi_yaml", "openapi: 3.0.3\ninfo:\n  title: Generated API\n  version: 1.0.0\npaths: {}\n"),
            },
            {"path": "backend/requirements.txt", "language": "text", "content": "fastapi\nuvicorn[standard]\npydantic\n"},
            {
                "path": "backend/app/main.py",
                "language": "python",
                "content": "from fastapi import FastAPI\n\napp = FastAPI(title=\"Generated DevTeam API\")\n\n@app.get(\"/health\")\ndef health():\n    return {\"status\": \"ok\"}\n",
            },
            {"path": "backend/app/config.py", "language": "python", "content": "DATABASE_URL = \"sqlite:///./app.db\"\n"},
            {"path": "backend/app/database.py", "language": "python", "content": "def get_database_url():\n    return \"sqlite:///./app.db\"\n"},
            {"path": "backend/app/routes/__init__.py", "language": "python", "content": ""},
            {"path": "backend/app/schemas/__init__.py", "language": "python", "content": ""},
            {"path": "backend/app/services/__init__.py", "language": "python", "content": ""},
        ]
        if use_next:
            files.extend(
                [
                    {
                        "path": "frontend/package.json",
                        "language": "json",
                        "content": "{\"scripts\":{\"dev\":\"next dev\"},\"dependencies\":{\"next\":\"latest\",\"react\":\"latest\",\"react-dom\":\"latest\"},\"devDependencies\":{\"typescript\":\"latest\"}}\n",
                    },
                    {"path": "frontend/app/layout.tsx", "language": "tsx", "content": "export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n"},
                    {"path": "frontend/app/page.tsx", "language": "tsx", "content": "export default function Page() { return <main>Generated starter UI</main>; }\n"},
                    {"path": "frontend/lib/api.ts", "language": "typescript", "content": "export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';\n"},
                    {"path": "frontend/components/README.md", "language": "markdown", "content": "# Components\n\nAdd reusable UI components here.\n"},
                ]
            )
        if use_kotlin:
            files.extend(
                [
                    {"path": "mobile/README.md", "language": "markdown", "content": "# Android Mobile Starter\n\nKotlin + Jetpack Compose scaffold notes.\n"},
                    {"path": "mobile/app_structure.md", "language": "markdown", "content": "# App Structure\n\n- data\n- domain\n- ui\n- sync\n"},
                    {"path": "mobile/build.gradle.kts", "language": "kotlin", "content": "plugins { id(\"com.android.application\") version \"8.5.0\" apply false }\n"},
                    {"path": "mobile/core_architecture.md", "language": "markdown", "content": "# Core Architecture\n\nUse local storage, queued sync, and hardware integration boundaries.\n"},
                ]
            )
        return files
