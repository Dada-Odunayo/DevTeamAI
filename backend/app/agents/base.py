from __future__ import annotations

import json
from typing import Any

from app.services.json_utils import extract_json_object
from app.services.qwen_client import QwenClient


class Agent:
    def __init__(self, name: str, system_prompt: str, qwen_client: QwenClient):
        self.name = name
        self.system_prompt = system_prompt
        self.qwen_client = qwen_client

    async def run(self, payload: dict[str, Any], temperature: float = 0.2) -> dict[str, Any]:
        user_prompt = json.dumps(payload, indent=2, ensure_ascii=False)
        response_text = await self.qwen_client.chat_json(
            system_prompt=self.system_prompt,
            user_prompt=user_prompt,
            temperature=temperature,
        )
        return extract_json_object(response_text)
