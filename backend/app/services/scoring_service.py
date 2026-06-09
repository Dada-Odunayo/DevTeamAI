from __future__ import annotations

from typing import Any


def count_items(value: Any) -> int:
    if isinstance(value, list):
        return len(value)
    if isinstance(value, dict):
        return sum(count_items(item) for item in value.values())
    if isinstance(value, str):
        return 1 if value.strip() else 0
    return 0


def _contains(value: Any, *needles: str) -> bool:
    text = str(value).lower()
    return any(needle in text for needle in needles)


def score_artifacts(artifacts: dict[str, Any], conflicts: list[dict[str, Any]] | None = None) -> dict[str, int]:
    conflicts = conflicts or []
    prd = artifacts.get("prd", {})
    architecture = artifacts.get("architecture", {})
    backend = artifacts.get("backend", {})
    frontend = artifacts.get("frontend") or artifacts.get("mobile", {})
    qa = artifacts.get("qa", {})
    cto = artifacts.get("cto_review", {})
    revision = artifacts.get("revision", {})

    frontend_architecture = frontend.get("frontend_architecture", {}) if isinstance(frontend, dict) else {}
    screens = frontend_architecture.get("screens_or_pages") if isinstance(frontend_architecture, dict) else []
    endpoints = backend.get("api_endpoints", []) if isinstance(backend, dict) else []
    resolved_conflicts = [conflict for conflict in conflicts if conflict.get("status") == "resolved"]

    requirements_coverage_score = min(
        100,
        30 + count_items(prd.get("core_features")) * 7 + count_items(prd.get("acceptance_criteria")) * 4,
    )
    architecture_completeness_score = min(
        100,
        35
        + count_items(architecture.get("services")) * 7
        + count_items(architecture.get("data_flow")) * 4
        + count_items(architecture.get("security_controls")) * 3,
    )
    api_completeness_score = min(
        100,
        30
        + count_items(endpoints) * 5
        + count_items(backend.get("business_rules")) * 3
        + count_items(backend.get("security_notes")) * 3,
    )
    frontend_completeness_score = min(
        100,
        30
        + count_items(screens) * 5
        + count_items(frontend_architecture.get("navigation_flow")) * 4
        + count_items(frontend.get("implementation_plan")) * 3,
    )
    qa_coverage_score = min(
        100,
        30
        + count_items(qa.get("acceptance_tests")) * 5
        + count_items(qa.get("negative_tests")) * 3
        + count_items(qa.get("security_tests")) * 4,
    )
    risk_detection_score = min(
        100,
        35
        + count_items(cto.get("critical_findings")) * 7
        + count_items(cto.get("conflicts_detected")) * 6
        + count_items(frontend.get("risks")) * 2,
    )
    conflict_resolution_score = min(
        100,
        45 + len(conflicts) * 8 + len(resolved_conflicts) * 12 + count_items(revision.get("resolved_conflicts")) * 4,
    )
    implementation_readiness_score = min(
        100,
        round((api_completeness_score + frontend_completeness_score + qa_coverage_score) / 3),
    )
    overall_score = round(
        (
            requirements_coverage_score
            + architecture_completeness_score
            + api_completeness_score
            + frontend_completeness_score
            + qa_coverage_score
            + risk_detection_score
            + conflict_resolution_score
            + implementation_readiness_score
        )
        / 8
    )

    return {
        "requirements_coverage_score": requirements_coverage_score,
        "architecture_completeness_score": architecture_completeness_score,
        "api_completeness_score": api_completeness_score,
        "frontend_completeness_score": frontend_completeness_score,
        "qa_coverage_score": qa_coverage_score,
        "risk_detection_score": risk_detection_score,
        "conflict_resolution_score": conflict_resolution_score,
        "implementation_readiness_score": implementation_readiness_score,
        "overall_score": overall_score,
    }


def score_single_agent_baseline(baseline: dict[str, Any]) -> dict[str, int]:
    requirements_coverage_score = min(100, 35 + count_items(baseline.get("requirements")) * 6)
    architecture_completeness_score = min(100, 35 + count_items(baseline.get("architecture")) * 6)
    api_completeness_score = min(100, 30 + count_items(baseline.get("api_plan")) * 6)
    frontend_completeness_score = min(100, 30 + count_items(baseline.get("frontend_plan")) * 6)
    qa_coverage_score = min(100, 30 + count_items(baseline.get("test_plan")) * 6)
    risk_detection_score = min(100, 30 + count_items(baseline.get("risks")) * 5)
    conflict_resolution_score = 30
    implementation_readiness_score = round(
        (api_completeness_score + frontend_completeness_score + qa_coverage_score) / 3
    )
    overall_score = round(
        (
            requirements_coverage_score
            + architecture_completeness_score
            + api_completeness_score
            + frontend_completeness_score
            + qa_coverage_score
            + risk_detection_score
            + conflict_resolution_score
            + implementation_readiness_score
        )
        / 8
    )
    return {
        "requirements_coverage_score": requirements_coverage_score,
        "architecture_completeness_score": architecture_completeness_score,
        "api_completeness_score": api_completeness_score,
        "frontend_completeness_score": frontend_completeness_score,
        "qa_coverage_score": qa_coverage_score,
        "risk_detection_score": risk_detection_score,
        "conflict_resolution_score": conflict_resolution_score,
        "implementation_readiness_score": implementation_readiness_score,
        "overall_score": overall_score,
    }


def build_baseline_comparison(
    baseline: dict[str, Any],
    artifacts: dict[str, Any],
    conflicts: list[dict[str, Any]],
) -> dict[str, Any]:
    single_metrics = score_single_agent_baseline(baseline)
    multi_metrics = score_artifacts(artifacts, conflicts)
    single_overall = single_metrics["overall_score"]
    multi_overall = multi_metrics["overall_score"]
    improvement = 0.0 if single_overall == 0 else round(((multi_overall - single_overall) / single_overall) * 100, 1)
    resolved = len([conflict for conflict in conflicts if conflict.get("status") == "resolved"])
    missing_reduced = max(0, count_items(artifacts) - count_items(baseline))

    return {
        "single_agent": {
            "overall_score": single_overall,
            "metrics": single_metrics,
            "strengths": ["Fast single-pass planning", "Useful first draft"],
            "weaknesses": ["No visible negotiation", "Weak conflict resolution", "Less role-specific detail"],
            "result": baseline,
        },
        "multi_agent": {
            "overall_score": multi_overall,
            "metrics": multi_metrics,
            "strengths": ["Specialized agents", "Explicit review cycle", "Stored conflicts and decisions"],
            "weaknesses": ["More steps", "Requires human approvals"],
        },
        "efficiency_gain": {
            "score_improvement_percentage": improvement,
            "missing_items_reduced": missing_reduced,
            "conflicts_detected": len(conflicts),
            "conflicts_resolved": resolved,
            "review_cycles_completed": 2 if resolved else 1,
        },
        "explanation": (
            "The multi-agent workflow improves quality by separating responsibilities, making disagreements visible, "
            "resolving conflicts, and revising affected artifacts before code generation."
        ),
    }


def detect_conflicts(artifacts: dict[str, Any], request_context: dict[str, Any]) -> list[dict[str, Any]]:
    conflicts: list[dict[str, Any]] = []
    text = str({"artifacts": artifacts, "request": request_context}).lower()
    platform = str(request_context.get("platform") or "").lower()
    constraints = " ".join(request_context.get("constraints") or []).lower()
    preferred_stack = str(request_context.get("preferred_frontend_stack") or "").lower()
    frontend = artifacts.get("frontend") or {}
    stack_decision = frontend.get("frontend_stack_decision", {}) if isinstance(frontend, dict) else {}
    selected_stack = str(stack_decision.get("selected_stack") or stack_decision.get("recommended_stack") or "").lower()

    if _contains(constraints + " " + text, "offline") and not _contains(text, "sync", "local-first", "local first"):
        conflicts.append(
            {
                "conflict_id": "offline_sync_missing",
                "severity": "high",
                "detected_by": "CTO Agent",
                "affected_agents": ["Architect Agent", "Backend Agent", "Frontend Agent"],
                "description": "The requirements mention offline behavior, but the plan does not clearly define a sync strategy.",
                "evidence": ["Offline requirement found", "No explicit sync/local-first strategy found"],
                "recommended_resolution": "Add local persistence, queued writes, conflict handling, and backend sync endpoints.",
                "status": "open",
            }
        )

    if _contains(constraints + " " + text, "pos", "printer", "bluetooth", "sdk") and _contains(selected_stack + preferred_stack, "react native", "flutter"):
        conflicts.append(
            {
                "conflict_id": "hardware_stack_risk",
                "severity": "medium",
                "detected_by": "CTO Agent",
                "affected_agents": ["Frontend Agent", "CTO Agent"],
                "description": "The frontend stack may add risk for POS hardware, Bluetooth, printer, or vendor SDK integrations.",
                "evidence": [f"Selected stack: {selected_stack or preferred_stack}", "Hardware-oriented constraints detected"],
                "recommended_resolution": "Negotiate whether native Android/Kotlin should be used for reliability or whether native modules are acceptable.",
                "status": "open",
            }
        )

    if "android" in platform and "ios" in text and "ios" not in platform:
        conflicts.append(
            {
                "conflict_id": "platform_scope_drift",
                "severity": "medium",
                "detected_by": "CTO Agent",
                "affected_agents": ["Frontend Agent", "PM Agent"],
                "description": "The target platform is Android-only, but an iOS scope appears in the generated plan.",
                "evidence": ["Platform mentions Android", "Artifacts mention iOS"],
                "recommended_resolution": "Remove iOS from MVP unless the user explicitly approves it as future scope.",
                "status": "open",
            }
        )

    if _contains(text, "real-time", "realtime") and not _contains(text, "websocket", "sse", "polling"):
        conflicts.append(
            {
                "conflict_id": "realtime_transport_missing",
                "severity": "medium",
                "detected_by": "CTO Agent",
                "affected_agents": ["Backend Agent", "Frontend Agent", "Architect Agent"],
                "description": "The frontend appears to expect real-time updates, but the backend plan lacks a transport strategy.",
                "evidence": ["Real-time behavior detected", "No WebSocket, SSE, or polling plan detected"],
                "recommended_resolution": "Add WebSocket/SSE/polling decision and update backend/frontend contracts.",
                "status": "open",
            }
        )

    if _contains(text, "payment", "wallet", "cash") and not _contains(text, "auth", "authentication", "authorization"):
        conflicts.append(
            {
                "conflict_id": "financial_auth_missing",
                "severity": "critical",
                "detected_by": "CTO Agent",
                "affected_agents": ["Backend Agent", "Architect Agent", "QA Agent"],
                "description": "Financial features are present but authentication/authorization controls are unclear.",
                "evidence": ["Financial workflow detected", "No clear auth controls detected"],
                "recommended_resolution": "Add role-based auth, audit logs, transaction authorization, and security tests.",
                "status": "open",
            }
        )

    return conflicts
