from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


class ProjectRunRequest(BaseModel):
    idea: str = Field(..., min_length=10, description="The product or software idea to analyze")
    target_users: Optional[str] = Field(default=None, description="Who the product is for")
    platform: Optional[str] = Field(default=None, description="Target platform, e.g. Android, iOS, web")
    domain_context: Optional[str] = Field(default=None, description="Extra domain/business context")
    constraints: list[str] = Field(default_factory=list, description="Hard constraints the agents must respect")
    preferred_frontend_stack: Optional[str] = Field(
        default="Auto-select best stack",
        description="Preferred frontend/mobile technology stack",
    )
    include_baseline: bool = Field(default=True, description="Also generate a single-agent baseline")


StageStatus = Literal["locked", "running", "awaiting_approval", "approved", "needs_revision", "failed"]
DialogueType = Literal[
    "proposal",
    "question",
    "challenge",
    "defense",
    "agreement",
    "disagreement",
    "resolution",
    "revision_request",
    "final_decision",
]
ConflictStatus = Literal["open", "resolved", "accepted_risk"]
ConflictSeverity = Literal["low", "medium", "high", "critical"]


class ProjectCreateRequest(ProjectRunRequest):
    pass


class StageActionRequest(BaseModel):
    feedback: Optional[str] = Field(default=None, description="Human feedback for stage revision")


class ConflictResolutionRequest(BaseModel):
    action: Literal["resolve", "accept_risk"] = "resolve"
    feedback: Optional[str] = None


class ProjectStage(BaseModel):
    id: str
    project_id: str
    name: str
    status: StageStatus
    version: int
    assigned_agent: str
    dependencies: list[str]
    content: dict[str, Any] | None = None
    user_feedback: Optional[str] = None
    created_at: str
    updated_at: str
    can_run: bool = False
    human_approval_required: bool = True


class AgentDialogueItem(BaseModel):
    id: str
    project_id: str
    stage_name: str
    speaker: str
    recipient: Optional[str] = None
    type: DialogueType
    message: str
    related_artifact: Optional[str] = None
    created_at: str


class ProjectConflict(BaseModel):
    id: str
    project_id: str
    severity: ConflictSeverity
    detected_by: str
    affected_agents: list[str]
    description: str
    evidence: list[str]
    recommended_resolution: str
    status: ConflictStatus
    created_at: str
    resolved_at: Optional[str] = None
    resolution: Optional[dict[str, Any]] = None


class GeneratedFile(BaseModel):
    id: str
    project_id: str
    path: str
    language: str
    content: str
    created_at: str


class StagedProjectResponse(BaseModel):
    id: str
    idea: str
    target_users: Optional[str] = None
    platform: Optional[str] = None
    constraints: list[str]
    preferred_frontend_stack: Optional[str] = None
    include_baseline: bool = True
    current_stage: str
    created_at: str
    updated_at: str
    stages: list[ProjectStage]
    dialogue: list[AgentDialogueItem]
    conflicts: list[ProjectConflict]
    baseline_comparison: Optional[dict[str, Any]] = None
    generated_files: list[GeneratedFile]
    artifacts: dict[str, Any]
    score: dict[str, Any] = Field(default_factory=dict)


class ProjectSummary(BaseModel):
    id: str
    idea: str
    created_at: str
    updated_at: Optional[str] = None
    current_stage: Optional[str] = None
    type: str = "quick_run"
    score: dict[str, Any]


class AgentMessage(BaseModel):
    agent: str
    type: str
    content: Any


class ProjectRunResponse(BaseModel):
    project_id: str
    idea: str
    memory_matches: list[dict[str, Any]]
    conversation: list[AgentMessage]
    artifacts: dict[str, Any]
    baseline: Optional[dict[str, Any]] = None
    score: dict[str, Any]
