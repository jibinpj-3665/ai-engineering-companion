import hashlib
import math
import re
from collections import Counter
from typing import List, Sequence

import httpx
from sqlalchemy.orm import Session

from ..services.settings import get_ai_config

EMBED_DIM = 384
_TOKEN_RE = re.compile(r"[a-z0-9]+")


class AIError(Exception):
    pass


class AIConfigError(AIError):
    pass


class AIRequestError(AIError):
    pass


def local_embedding(text: str) -> List[float]:
    vector = [0.0] * EMBED_DIM
    tokens = _TOKEN_RE.findall((text or "").lower())[:4000]
    if not tokens:
        return vector
    counts = Counter(tokens)
    for token, count in counts.items():
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "little") % EMBED_DIM
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign * (1.0 + math.log(count))
    for first, second in zip(tokens, tokens[1:]):
        digest = hashlib.blake2b((first + "_" + second).encode("utf-8"), digest_size=8).digest()
        index = int.from_bytes(digest[:4], "little") % EMBED_DIM
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vector[index] += sign * 0.5
    norm = math.sqrt(sum(v * v for v in vector))
    if norm == 0:
        return vector
    return [v / norm for v in vector]


def _headers(cfg: dict) -> dict:
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    return headers


def _chat_url(cfg: dict) -> str:
    base = (cfg.get("base_url") or "").rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    return f"{base}/chat/completions"


def _embeddings_url(cfg: dict) -> str:
    base = (cfg.get("base_url") or "").rstrip("/")
    if base.endswith("/embeddings"):
        return base
    return f"{base}/embeddings"


async def chat_completion(
    db: Session,
    messages: Sequence[dict],
    temperature: float | None = None,
    max_tokens: int | None = None,
    json_mode: bool = False,
) -> str:
    cfg = get_ai_config(db)
    if not cfg["configured"]:
        raise AIConfigError("AI provider is not configured. Add an endpoint, model and API key in Settings, or use offline mode.")
    payload = {
        "model": cfg["model"],
        "messages": list(messages),
        "temperature": cfg["temperature"] if temperature is None else temperature,
        "max_tokens": cfg["max_tokens"] if max_tokens is None else max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(_chat_url(cfg), json=payload, headers=_headers(cfg))
    except httpx.HTTPError as exc:
        raise AIRequestError(f"Could not reach the AI endpoint: {exc}") from exc
    if response.status_code >= 400:
        detail = response.text[:500]
        raise AIRequestError(f"AI provider returned HTTP {response.status_code}: {detail}")
    try:
        data = response.json()
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, ValueError) as exc:
        raise AIRequestError("The AI endpoint returned an unexpected response format.") from exc


async def embed_texts(db: Session, texts: Sequence[str]) -> tuple[List[List[float]], str]:
    cfg = get_ai_config(db)
    if cfg["embedding_provider"] == "local" or not cfg["configured"]:
        return [local_embedding(text) for text in texts], "local-hash-v1"
    payload = {"model": cfg["embedding_model"] or "text-embedding-3-small", "input": list(texts)}
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(_embeddings_url(cfg), json=payload, headers=_headers(cfg))
    except httpx.HTTPError as exc:
        raise AIRequestError(f"Embedding endpoint unreachable: {exc}") from exc
    if response.status_code >= 400:
        raise AIRequestError(f"Embedding provider returned HTTP {response.status_code}: {response.text[:300]}")
    try:
        data = response.json()
        vectors = [item["embedding"] for item in data["data"]]
    except (KeyError, TypeError, ValueError) as exc:
        raise AIRequestError("Embedding endpoint returned an unexpected response.") from exc
    return vectors, f"remote:{payload['model']}"


def embed_texts_sync(db: Session, texts: Sequence[str]) -> tuple[List[List[float]], str]:
    cfg = get_ai_config(db)
    if cfg["embedding_provider"] == "local" or not cfg["configured"]:
        return [local_embedding(text) for text in texts], "local-hash-v1"
    payload = {"model": cfg["embedding_model"] or "text-embedding-3-small", "input": list(texts)}
    try:
        with httpx.Client(timeout=90) as client:
            response = client.post(_embeddings_url(cfg), json=payload, headers=_headers(cfg))
    except httpx.HTTPError as exc:
        return [local_embedding(text) for text in texts], "local-hash-v1"
    if response.status_code >= 400:
        return [local_embedding(text) for text in texts], "local-hash-v1"
    try:
        data = response.json()
        vectors = [item["embedding"] for item in data["data"]]
        if len(vectors) != len(texts):
            raise ValueError("mismatched embedding count")
    except (KeyError, TypeError, ValueError):
        return [local_embedding(text) for text in texts], "local-hash-v1"
    return vectors, f"remote:{payload['model']}"


async def test_connection(db: Session) -> dict:
    cfg = get_ai_config(db)
    if cfg["provider"] == "offline":
        return {"ok": True, "provider": "offline", "message": "Offline mode is active. Local document, planning and revision features work without a network."}
    if not cfg["base_url"] or not cfg["model"]:
        return {"ok": False, "provider": cfg["provider"], "message": "Endpoint URL and model name are required."}
    try:
        answer = await chat_completion(db, [{"role": "user", "content": "Reply with the single word: ready"}], max_tokens=10, temperature=0)
        return {"ok": True, "provider": cfg["provider"], "message": f"Connection successful. Model replied: {answer.strip()[:60]}"}
    except AIError as exc:
        return {"ok": False, "provider": cfg["provider"], "message": str(exc)}
