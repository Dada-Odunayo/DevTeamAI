from __future__ import annotations
from typing import Any


def _count_items(value: Any) -> int:
    if isinstance(value, list):
        return len(value)
    if isinstance(value, dict):
        return sum(_count_items(v) for v in value.values())
    if isinstance(value, str):
        return 1 if value.strip() else 0
    return 0


def score_devteam(artifacts: dict[str, Any], memory_matches: list[dict[str, Any]]) -> dict[str, Any]:
    prd = artifacts.get("prd", {})
    architecture = artifacts.get("architecture", {})
    backend = artifacts.get("backend", {})
    frontend = artifacts.get("frontend") or artifacts.get("mobile", {})
    qa = artifacts.get("qa", {})
    cto = artifacts.get("cto_review", {})

    requirements_coverage = min(100, 35 + _count_items(prd.get("core_features")) * 6 + _count_items(prd.get("acceptance_criteria")) * 4)
    architecture_depth = min(100, 40 + _count_items(architecture.get("services")) * 7 + _count_items(architecture.get("security_controls")) * 3)
    frontend_architecture = frontend.get("frontend_architecture", {}) if isinstance(frontend, dict) else {}
    screens = frontend.get("screens") or frontend_architecture.get("screens_or_pages") if isinstance(frontend, dict) else None
    implementation_detail = min(100, 35 + _count_items(backend.get("api_endpoints")) * 4 + _count_items(screens) * 4)
    testing_depth = min(100, 35 + _count_items(qa.get("acceptance_tests")) * 5 + _count_items(qa.get("security_tests")) * 3)
    review_depth = min(100, 45 + _count_items(cto.get("critical_findings")) * 8 + _count_items(cto.get("conflicts_detected")) * 5)
    memory_bonus = min(10, len(memory_matches) * 2)

    overall = round(
        (requirements_coverage * 0.22)
        + (architecture_depth * 0.22)
        + (implementation_detail * 0.20)
        + (testing_depth * 0.18)
        + (review_depth * 0.18)
        + memory_bonus,
        1,
    )

    return {
        "overall": min(100, overall),
        "requirements_coverage": requirements_coverage,
        "architecture_depth": architecture_depth,
        "implementation_detail": implementation_detail,
        "testing_depth": testing_depth,
        "review_depth": review_depth,
        "memory_bonus": memory_bonus,
        "method": "Deterministic demo scoring based on artifact coverage, not an external benchmark.",
    }


def score_baseline(baseline: dict[str, Any]) -> dict[str, Any]:
    requirements = _count_items(baseline.get("requirements"))
    architecture = _count_items(baseline.get("architecture"))
    api = _count_items(baseline.get("api_plan"))
    tests = _count_items(baseline.get("test_plan"))
    risks = _count_items(baseline.get("risks"))

    overall = min(100, 35 + requirements * 4 + architecture * 4 + api * 3 + tests * 3 + risks * 2)
    return {
        "overall": overall,
        "requirements_items": requirements,
        "architecture_items": architecture,
        "api_items": api,
        "test_items": tests,
        "risk_items": risks,
        "method": "Single-agent baseline coverage score.",
    }
