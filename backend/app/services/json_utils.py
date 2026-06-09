import json
import re
from typing import Any


class JsonParseError(ValueError):
    pass


def extract_json_object(text: str) -> dict[str, Any]:
    """Extract a JSON object from an LLM response.

    Qwen can be instructed to return JSON, but models sometimes wrap JSON in
    markdown fences. This helper keeps the app resilient.
    """
    cleaned = text.strip()

    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?", "", cleaned, flags=re.IGNORECASE).strip()
        cleaned = re.sub(r"```$", "", cleaned).strip()

    try:
        value = json.loads(cleaned)
        if isinstance(value, dict):
            return value
    except json.JSONDecodeError:
        pass

    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if not match:
        raise JsonParseError("No JSON object found in model output")

    try:
        value = json.loads(match.group(0))
    except json.JSONDecodeError as exc:
        raise JsonParseError(f"Invalid JSON object from model: {exc}") from exc

    if not isinstance(value, dict):
        raise JsonParseError("Model output was JSON, but not an object")

    return value
