from __future__ import annotations

import io
import json
import zipfile
from typing import Any


def _as_list_md(items: Any) -> str:
    if not items:
        return "- None specified\n"
    if isinstance(items, list):
        lines = []
        for item in items:
            if isinstance(item, dict):
                lines.append(f"- `{json.dumps(item, ensure_ascii=False)}`")
            else:
                lines.append(f"- {item}")
        return "\n".join(lines) + "\n"
    if isinstance(items, dict):
        return "```json\n" + json.dumps(items, indent=2, ensure_ascii=False) + "\n```\n"
    return str(items) + "\n"


def project_markdown(project: dict[str, Any]) -> dict[str, str]:
    artifacts = project["artifacts"]
    files: dict[str, str] = {}

    prd = artifacts.get("prd", {})
    files["PRD.md"] = f"""# Product Requirements Document\n\n## Idea\n{project['idea']}\n\n## Problem Statement\n{prd.get('problem_statement', '')}\n\n## Target Users\n{_as_list_md(prd.get('target_users'))}\n\n## Core Features\n{_as_list_md(prd.get('core_features'))}\n\n## MVP Scope\n{_as_list_md(prd.get('mvp_scope'))}\n\n## Acceptance Criteria\n{_as_list_md(prd.get('acceptance_criteria'))}\n\n## Success Metrics\n{_as_list_md(prd.get('success_metrics'))}\n"""

    architecture = artifacts.get("architecture", {})
    files["Architecture.md"] = f"""# Architecture\n\n## Summary\n{architecture.get('summary', '')}\n\n## Architecture Style\n{architecture.get('architecture_style', '')}\n\n## Services\n{_as_list_md(architecture.get('services'))}\n\n## Data Flow\n{_as_list_md(architecture.get('data_flow'))}\n\n## Mermaid Diagram\n```mermaid\n{architecture.get('mermaid_diagram', '')}\n```\n\n## Security Controls\n{_as_list_md(architecture.get('security_controls'))}\n\n## Reliability Controls\n{_as_list_md(architecture.get('reliability_controls'))}\n"""

    backend = artifacts.get("backend", {})
    files["DatabaseSchema.sql"] = backend.get("database_schema_sql", "-- No schema generated")
    files["OpenAPI.yaml"] = backend.get("openapi_yaml", "openapi: 3.0.3\ninfo:\n  title: Generated API\n  version: 1.0.0\n")
    files["Backend.md"] = f"""# Backend Plan\n\n## Summary\n{backend.get('summary', '')}\n\n## API Endpoints\n{_as_list_md(backend.get('api_endpoints'))}\n\n## Business Rules\n{_as_list_md(backend.get('business_rules'))}\n\n## Security Notes\n{_as_list_md(backend.get('security_notes'))}\n"""

    frontend = artifacts.get("frontend") or artifacts.get("mobile", {})
    frontend_architecture = frontend.get("frontend_architecture", {}) if isinstance(frontend, dict) else {}
    stack_decision = frontend.get("frontend_stack_decision", {}) if isinstance(frontend, dict) else {}
    files["FrontendPlan.md"] = f"""# Frontend Plan\n\n## Summary\n{frontend.get('summary', '')}\n\n## Stack Decision\n{_as_list_md(stack_decision)}\n\n## Screens or Pages\n{_as_list_md(frontend_architecture.get('screens_or_pages') or frontend.get('screens'))}\n\n## Navigation Flow\n{_as_list_md(frontend_architecture.get('navigation_flow') or frontend.get('navigation_flow'))}\n\n## State Management\n{frontend_architecture.get('state_management') or frontend.get('state_management', '')}\n\n## API Integration Strategy\n{frontend_architecture.get('api_integration_strategy') or frontend.get('api_integration_plan', '')}\n\n## Offline Strategy\n{_as_list_md(frontend_architecture.get('offline_strategy') or frontend.get('offline_strategy'))}\n\n## Implementation Plan\n{_as_list_md(frontend.get('implementation_plan'))}\n"""

    qa = artifacts.get("qa", {})
    files["TestPlan.md"] = f"""# QA Test Plan\n\n## Summary\n{qa.get('summary', '')}\n\n## Strategy\n{qa.get('test_strategy', '')}\n\n## Acceptance Tests\n{_as_list_md(qa.get('acceptance_tests'))}\n\n## Negative Tests\n{_as_list_md(qa.get('negative_tests'))}\n\n## Security Tests\n{_as_list_md(qa.get('security_tests'))}\n"""

    files["CTOReview.md"] = f"""# CTO Review\n\n{_as_list_md(artifacts.get('cto_review'))}\n"""
    files["RevisionPlan.md"] = f"""# Revision Plan\n\n{_as_list_md(artifacts.get('revision'))}\n"""
    files["Conversation.json"] = json.dumps(project.get("conversation", []), indent=2, ensure_ascii=False)
    files["FullProject.json"] = json.dumps(project, indent=2, ensure_ascii=False)
    return files


def project_zip_bytes(project: dict[str, Any]) -> bytes:
    files = project_markdown(project)
    for file in project.get("generated_files", []):
        if not isinstance(file, dict):
            continue
        path = file.get("path")
        content = file.get("content")
        if isinstance(path, str) and isinstance(content, str):
            files[f"generated/{path}"] = content
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for filename, content in files.items():
            zf.writestr(filename, content)
    buffer.seek(0)
    return buffer.read()
