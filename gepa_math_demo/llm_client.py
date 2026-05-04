"""LLM clients for the GEPA math demo.

Two backends, each with a blocking and a streaming variant:
- call_local_llm / stream_local_llm      → LM Studio at http://localhost:1234/v1
- call_openrouter_llm / stream_openrouter_llm → OpenRouter

Override defaults via env vars:
- LMSTUDIO_BASE_URL   (default: http://localhost:1234/v1)
- LMSTUDIO_MODEL      (default: mathstral-7b-v0.1)
- OPENROUTER_API_KEY  (required for OpenRouter)
"""
import json
import os
from collections.abc import Generator

import requests
from dotenv import load_dotenv

load_dotenv()

DEFAULT_LOCAL_BASE_URL = "http://localhost:1234/v1"
DEFAULT_LOCAL_MODEL    = "mathstral-7b-v0.1"
OPENROUTER_BASE_URL    = "https://openrouter.ai/api/v1"

# ── helpers ───────────────────────────────────────────────────────────────────

def _parse_sse_token(line: str) -> str:
    """Extract token text from one SSE data line."""
    if not line.startswith("data: "):
        return ""
    data = line[6:]
    if data.strip() == "[DONE]":
        return ""
    try:
        chunk = json.loads(data)
        return chunk["choices"][0]["delta"].get("content", "") or ""
    except (json.JSONDecodeError, KeyError, IndexError):
        return ""

# ── local LM Studio ───────────────────────────────────────────────────────────

def _local_headers() -> dict:
    return {"Content-Type": "application/json", "Authorization": "Bearer lm-studio"}

def _local_payload(system_prompt: str, user_content: str, model: str, stream: bool) -> dict:
    # Mistral's chat template rejects the system role → fold into user message
    merged = f"{system_prompt.strip()}\n\n{user_content.strip()}"
    return {
        "model": model,
        "messages": [{"role": "user", "content": merged}],
        "stream": stream,
    }

def call_local_llm(system_prompt: str, user_content: str,
                   model: str | None = None) -> str:
    """Blocking call to LM Studio. Returns the complete response string."""
    base_url = os.getenv("LMSTUDIO_BASE_URL", DEFAULT_LOCAL_BASE_URL).rstrip("/")
    model    = model or os.getenv("LMSTUDIO_MODEL", DEFAULT_LOCAL_MODEL)
    try:
        resp = requests.post(
            f"{base_url}/chat/completions",
            headers=_local_headers(),
            json=_local_payload(system_prompt, user_content, model, stream=False),
            timeout=300,
        )
    except requests.exceptions.ConnectionError as e:
        raise RuntimeError(
            f"Could not reach LM Studio at {base_url}. "
            "Is the server running? (LM Studio → Developer → Start Server)"
        ) from e
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def stream_local_llm(system_prompt: str, user_content: str,
                     model: str | None = None) -> Generator[str, None, None]:
    """Streaming call to LM Studio. Yields token strings one by one."""
    base_url = os.getenv("LMSTUDIO_BASE_URL", DEFAULT_LOCAL_BASE_URL).rstrip("/")
    model    = model or os.getenv("LMSTUDIO_MODEL", DEFAULT_LOCAL_MODEL)
    try:
        with requests.post(
            f"{base_url}/chat/completions",
            headers=_local_headers(),
            json=_local_payload(system_prompt, user_content, model, stream=True),
            stream=True,
            timeout=300,
        ) as resp:
            resp.raise_for_status()
            for raw_line in resp.iter_lines():
                if not raw_line:
                    continue
                line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
                if line.strip() == "data: [DONE]":
                    return
                token = _parse_sse_token(line)
                if token:
                    yield token
    except requests.exceptions.ConnectionError as e:
        raise RuntimeError(
            f"Could not reach LM Studio at {base_url}. "
            "Is the server running? (LM Studio → Developer → Start Server)"
        ) from e

# ── OpenRouter ────────────────────────────────────────────────────────────────

def _openrouter_headers() -> dict:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY env var not set (check .env)")
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:8000",
        "X-Title": "gepa-demo-math-optimizer",
    }

def _openrouter_payload(system_prompt: str, user_content: str,
                        model: str, stream: bool) -> dict:
    return {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_content},
        ],
        "stream": stream,
    }

def call_openrouter_llm(system_prompt: str, user_content: str,
                        model: str = "google/gemma-4-26b-a4b-it") -> str:
    """Blocking call to OpenRouter. Returns the complete response string."""
    resp = requests.post(
        f"{OPENROUTER_BASE_URL}/chat/completions",
        headers=_openrouter_headers(),
        json=_openrouter_payload(system_prompt, user_content, model, stream=False),
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"].strip()


def stream_openrouter_llm(system_prompt: str, user_content: str,
                          model: str = "google/gemma-4-26b-a4b-it") -> Generator[str, None, None]:
    """Streaming call to OpenRouter. Yields token strings one by one."""
    with requests.post(
        f"{OPENROUTER_BASE_URL}/chat/completions",
        headers=_openrouter_headers(),
        json=_openrouter_payload(system_prompt, user_content, model, stream=True),
        stream=True,
        timeout=120,
    ) as resp:
        resp.raise_for_status()
        for raw_line in resp.iter_lines():
            if not raw_line:
                continue
            line = raw_line.decode("utf-8") if isinstance(raw_line, bytes) else raw_line
            if line.strip() == "data: [DONE]":
                return
            token = _parse_sse_token(line)
            if token:
                yield token


# Back-compat alias
call_llm = call_local_llm
