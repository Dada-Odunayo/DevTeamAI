from __future__ import annotations

import httpx
from app.config import Settings


class QwenClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def chat_json(self, system_prompt: str, user_prompt: str, temperature: float = 0.2) -> str:
        if not self.settings.qwen_api_key or self.settings.qwen_api_key == "replace_me":
            raise RuntimeError("QWEN_API_KEY is missing. Add it to backend/.env")

        url = f"{self.settings.qwen_base_url.rstrip('/')}/chat/completions"
        payload = {
            "model": self.settings.qwen_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        }
        headers = {
            "Authorization": f"Bearer {self.settings.qwen_api_key}",
            "Content-Type": "application/json",
        }

        timeout = httpx.Timeout(self.settings.qwen_timeout_seconds)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                body = response.json()
        except httpx.TimeoutException as exc:
            raise RuntimeError(
                f"Qwen request timed out after {self.settings.qwen_timeout_seconds} seconds"
            ) from exc
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(
                f"Qwen API returned {exc.response.status_code}: {exc.response.text}"
            ) from exc
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Qwen request failed: {exc}") from exc

        try:
            return body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise RuntimeError(f"Unexpected Qwen response shape: {body}") from exc
