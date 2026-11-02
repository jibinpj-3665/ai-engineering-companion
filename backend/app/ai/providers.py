import hashlib
import json
import math
import re
import time
from collections import Counter
from typing import AsyncIterator, List, Sequence
from urllib.parse import urlparse, urlunparse

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from sqlalchemy.orm import Session

from ..config import EMBEDDING_DIMENSIONS
from ..database import SessionLocal
from ..models import AIUsageLog
from ..services.settings import (
    LOCAL_EMBEDDING_MODEL,
    REMOTE_EMBEDDING_PROVIDERS,
    embedding_signature,
    get_ai_config,
)

EMBED_DIM = EMBEDDING_DIMENSIONS
_TOKEN_RE = re.compile(r"[a-z0-9]+")
TIMEOUT = httpx.Timeout(120.0, connect=15.0)
GEMINI_TIMEOUT_MS = 120_000
GEMINI_EMBED_DEFAULT = "gemini-embedding-2"
GEMINI_DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com"
_GEMINI_VERSION_RE = re.compile(r"^v\d+(?:alpha|beta)?\d*$")
_SECRET_PATTERNS = (
    re.compile(r"AIza[0-9A-Za-z_-]{20,}"),
    re.compile(r"AQ\.[A-Za-z0-9._-]{20,}"),
    re.compile(r"sk-[A-Za-z0-9_-]{20,}"),
)


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


def _normalized_signature(value: object) -> str:
    signature = str(value or "").strip()
    if signature in {"", "local", LOCAL_EMBEDDING_MODEL}:
        return LOCAL_EMBEDDING_MODEL
    return signature


def embedding_signature_matches(stored: object, active: object) -> bool:
    return _normalized_signature(stored) == _normalized_signature(active)


def _validate_base_url(cfg: dict) -> None:
    raw = (cfg.get("base_url") or "").strip()
    if not raw:
        raise AIConfigError("An endpoint URL is required for the selected provider.")
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise AIConfigError("The provider endpoint must be a valid http(s) URL.")
    if parsed.username or parsed.password:
        raise AIConfigError("The provider endpoint must not contain embedded credentials.")


def _auth_headers(cfg: dict) -> dict:
    headers = {"Content-Type": "application/json"}
    if cfg.get("api_key"):
        headers["Authorization"] = f"Bearer {cfg['api_key']}"
    return headers


def _openai_url(cfg: dict, suffix: str) -> str:
    base = (cfg.get("base_url") or "").rstrip("/")
    if base.endswith(suffix):
        return base
    return f"{base}{suffix}"


def _gemini_model(model: str) -> str:
    return (model or "").split("/")[-1]


def _redact(value: object, cfg: dict | None = None) -> str:
    text = str(value or "")
    key = str((cfg or {}).get("api_key") or "")
    if key:
        text = text.replace(key, "[redacted]")
    for pattern in _SECRET_PATTERNS:
        text = pattern.sub("[redacted]", text)
    return text[:600]


def _gemini_http_options(cfg: dict) -> genai_types.HttpOptions:
    raw = (cfg.get("base_url") or GEMINI_DEFAULT_BASE_URL).strip().rstrip("/")
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise AIConfigError("Gemini base URL must be a valid http(s) endpoint.")

    path = parsed.path.rstrip("/")
    api_version = "v1beta"
    if path:
        candidate = path.rsplit("/", 1)[-1]
        if _GEMINI_VERSION_RE.match(candidate):
            api_version = candidate
            path = path[: -(len(candidate) + 1)].rstrip("/")

    base_url = urlunparse((parsed.scheme, parsed.netloc, path, "", "", ""))
    return genai_types.HttpOptions(
        base_url=base_url,
        api_version=api_version,
        timeout=GEMINI_TIMEOUT_MS,
        retry_options=genai_types.HttpRetryOptions(
            attempts=2,
            initial_delay=0.5,
            max_delay=3.0,
        ),
    )


def _gemini_client(cfg: dict) -> genai.Client:
    return genai.Client(api_key=cfg.get("api_key") or "", http_options=_gemini_http_options(cfg))


async def _close_gemini(client: genai.Client) -> None:
    try:
        closer = getattr(getattr(client, "aio", None), "aclose", None)
        if closer is not None:
            await closer()
        else:
            client.close()
    except Exception:
        pass


def _gemini_error(exc: Exception, cfg: dict) -> AIRequestError:
    if isinstance(exc, genai_errors.APIError):
        code = int(getattr(exc, "code", 0) or 0)
        status = str(getattr(exc, "status", "") or "")
        message = _redact(getattr(exc, "message", "") or "", cfg)
        combined = f"{status} {message}".lower()
        if code == 429:
            return AIRequestError(
                "Gemini rate limit or quota exceeded. Wait and retry, or check the quota for this API key in Google AI Studio."
            )
        if code in {401, 403}:
            return AIRequestError(
                "Gemini rejected the API key or the account does not have permission to use this model."
            )
        if code == 404:
            return AIRequestError(
                f"Gemini model or endpoint was not found. Check the model name and base URL. {message}".strip()
            )
        if code == 400 and ("api key not valid" in combined or "api_key_invalid" in combined):
            return AIRequestError(
                "Gemini rejected the API key. Check that the key is valid and has access to the selected model."
            )
        if code == 400:
            return AIRequestError(f"Gemini rejected the request: {message or status or 'invalid request'}.")
        if code >= 500:
            return AIRequestError(
                "Gemini is temporarily unavailable. The request can be retried after a short delay."
            )
        return AIRequestError(
            f"Gemini request failed ({code or 'unknown'} {status}). {message}".strip()
        )
    if isinstance(exc, (httpx.TimeoutException, TimeoutError)):
        return AIRequestError("Gemini timed out. Check the connection and try again.")
    if isinstance(exc, httpx.HTTPError):
        return AIRequestError(f"Could not reach Gemini: {_redact(exc, cfg)}")
    return AIRequestError(f"Gemini request failed: {_redact(exc, cfg)}")


def _require_config(cfg: dict) -> None:
    if not cfg["configured"]:
        raise AIConfigError(
            "AI provider is not configured. Add a provider, endpoint, model and API key in Settings, "
            "or continue with explicit offline retrieval mode."
        )


def _log_usage(
    provider: str,
    model: str,
    operation: str,
    status: str,
    input_chars: int,
    output_chars: int,
    latency_ms: int,
    error: str = "",
) -> None:
    from ..database import current_user_id

    uid = current_user_id.get()
    if uid is None:
        return
    db = SessionLocal()
    try:
        db.add(
            AIUsageLog(
                user_id=uid,
                provider=provider,
                model=model,
                operation=operation,
                status=status,
                input_chars=input_chars,
                output_chars=output_chars,
                latency_ms=latency_ms,
                error=(error or "")[:2000],
            )
        )
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _message_chars(messages: Sequence[dict]) -> int:
    return sum(len(str(item.get("content", ""))) for item in messages)


def _gemini_contents(messages: Sequence[dict]) -> tuple[List[genai_types.Content], str]:
    system_parts: List[str] = []
    contents: List[genai_types.Content] = []
    for message in messages:
        role = message.get("role", "user")
        text = str(message.get("content", ""))
        if role == "system":
            system_parts.append(text)
            continue
        if not text:
            continue
        gemini_role = "model" if role == "assistant" else "user"
        if contents and contents[-1].role == gemini_role:
            contents[-1].parts.append(genai_types.Part.from_text(text=text))
        else:
            contents.append(
                genai_types.Content(role=gemini_role, parts=[genai_types.Part.from_text(text=text)])
            )
    if not contents:
        raise AIConfigError("The request did not contain a user or assistant message for Gemini.")
    return contents, "\n\n".join(part for part in system_parts if part)


def _gemini_config(temperature: float, max_tokens: int, json_mode: bool, system: str) -> genai_types.GenerateContentConfig:
    return genai_types.GenerateContentConfig(
        system_instruction=system or None,
        temperature=max(0.0, min(2.0, float(temperature))),
        max_output_tokens=max(1, int(max_tokens)),
        response_mime_type="application/json" if json_mode else None,
    )


def _gemini_response_text(response: genai_types.GenerateContentResponse) -> str:
    try:
        text = response.text
    except (AttributeError, ValueError):
        text = None
    if text and text.strip():
        return text

    feedback = getattr(response, "prompt_feedback", None)
    reason = getattr(getattr(feedback, "block_reason", None), "value", None) or getattr(feedback, "block_reason", None)
    if reason:
        message = getattr(feedback, "block_reason_message", "") or ""
        raise AIRequestError(
            f"Gemini blocked the request ({str(reason).lower()})"
            + (f": {_redact(message)}" if message else ".")
        )

    candidates = getattr(response, "candidates", None) or []
    finish = ""
    if candidates:
        raw_finish = getattr(candidates[0], "finish_reason", None)
        finish = getattr(raw_finish, "value", None) or str(raw_finish or "")
    if finish == "MAX_TOKENS":
        raise AIRequestError("Gemini reached the output token limit before producing an answer. Increase Max tokens.")
    if finish and finish not in {"STOP", "FINISH_REASON_UNSPECIFIED"}:
        raise AIRequestError(f"Gemini returned no text (finish reason: {finish.lower()}).")
    raise AIRequestError("Gemini returned an empty response.")


async def _openai_chat(cfg: dict, messages: Sequence[dict], temperature: float, max_tokens: int, json_mode: bool) -> str:
    payload = {
        "model": cfg["model"],
        "messages": list(messages),
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(_openai_url(cfg, "/chat/completions"), json=payload, headers=_auth_headers(cfg))
    except httpx.TimeoutException as exc:
        raise AIRequestError("The AI provider timed out. Check the connection and try again.") from exc
    except httpx.HTTPError as exc:
        raise AIRequestError(f"Could not reach the AI provider: {_redact(exc, cfg)}") from exc
    if response.status_code >= 400:
        raise AIRequestError(f"AI provider returned HTTP {response.status_code}: {_redact(response.text, cfg)}")
    try:
        data = response.json()
        return data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, ValueError) as exc:
        raise AIRequestError("The AI endpoint returned an unexpected response format.") from exc


async def _gemini_chat(cfg: dict, messages: Sequence[dict], temperature: float, max_tokens: int, json_mode: bool) -> str:
    contents, system = _gemini_contents(messages)
    client = _gemini_client(cfg)
    try:
        response = await client.aio.models.generate_content(
            model=_gemini_model(cfg["model"]),
            contents=contents,
            config=_gemini_config(temperature, max_tokens, json_mode, system),
        )
        return _gemini_response_text(response)
    except AIError:
        raise
    except Exception as exc:
        raise _gemini_error(exc, cfg) from exc
    finally:
        await _close_gemini(client)


async def chat_completion(
    db: Session,
    messages: Sequence[dict],
    temperature: float | None = None,
    max_tokens: int | None = None,
    json_mode: bool = False,
    operation: str = "chat",
) -> str:
    cfg = get_ai_config(db)
    _require_config(cfg)
    started = time.perf_counter()
    chars = _message_chars(messages)
    try:
        if cfg["provider"] == "gemini":
            answer = await _gemini_chat(cfg, messages, cfg["temperature"] if temperature is None else temperature,
                                        cfg["max_tokens"] if max_tokens is None else max_tokens, json_mode)
        else:
            answer = await _openai_chat(cfg, messages, cfg["temperature"] if temperature is None else temperature,
                                        cfg["max_tokens"] if max_tokens is None else max_tokens, json_mode)
        _log_usage(cfg["provider"], cfg["model"], operation, "ok", chars, len(answer),
                   int((time.perf_counter() - started) * 1000))
        return answer
    except AIError as exc:
        _log_usage(cfg["provider"], cfg["model"], operation, "error", chars, 0,
                   int((time.perf_counter() - started) * 1000), str(exc))
        raise


async def _stream_openai(cfg: dict, messages: Sequence[dict], temperature: float, max_tokens: int,
                         json_mode: bool) -> AsyncIterator[str]:
    payload = {
        "model": cfg["model"],
        "messages": list(messages),
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": True,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            async with client.stream(
                "POST", _openai_url(cfg, "/chat/completions"), json=payload, headers=_auth_headers(cfg)
            ) as response:
                if response.status_code >= 400:
                    body = (await response.aread()).decode("utf-8", "replace")
                    raise AIRequestError(
                        f"AI provider returned HTTP {response.status_code}: {_redact(body, cfg)}"
                    )
                content_type = response.headers.get("content-type", "")
                if "text/event-stream" not in content_type:
                    body = await response.aread()
                    try:
                        data = json.loads(body)
                        text = data["choices"][0]["message"]["content"] or ""
                    except (ValueError, KeyError, IndexError, TypeError) as exc:
                        raise AIRequestError("The AI endpoint did not return a streaming response.") from exc
                    if text:
                        yield text
                    return
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data_text = line[5:].strip()
                    if data_text == "[DONE]":
                        break
                    try:
                        data = json.loads(data_text)
                    except ValueError:
                        continue
                    if data.get("error"):
                        raise AIRequestError(_redact(data["error"], cfg))
                    choices = data.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    text = delta.get("content")
                    if text is None:
                        text = choices[0].get("text")
                    if text:
                        yield text
    except httpx.TimeoutException as exc:
        raise AIRequestError("The AI provider timed out while streaming. Check the connection and try again.") from exc
    except httpx.HTTPError as exc:
        raise AIRequestError(f"Could not reach the AI provider: {_redact(exc, cfg)}") from exc


async def _stream_gemini(cfg: dict, messages: Sequence[dict], temperature: float, max_tokens: int,
                         json_mode: bool) -> AsyncIterator[str]:
    contents, system = _gemini_contents(messages)
    client = _gemini_client(cfg)
    produced = False
    last_response: genai_types.GenerateContentResponse | None = None
    try:
        stream = await client.aio.models.generate_content_stream(
            model=_gemini_model(cfg["model"]),
            contents=contents,
            config=_gemini_config(temperature, max_tokens, json_mode, system),
        )
        async for chunk in stream:
            last_response = chunk
            try:
                text = chunk.text
            except (AttributeError, ValueError):
                text = None
            if text:
                produced = True
                yield text
        if not produced and last_response is not None:
            _gemini_response_text(last_response)
    except AIError:
        raise
    except Exception as exc:
        raise _gemini_error(exc, cfg) from exc
    finally:
        await _close_gemini(client)


async def stream_chat_completion(
    db: Session,
    messages: Sequence[dict],
    temperature: float | None = None,
    max_tokens: int | None = None,
    json_mode: bool = False,
    operation: str = "chat_stream",
) -> AsyncIterator[str]:
    cfg = get_ai_config(db)
    _require_config(cfg)
    started = time.perf_counter()
    chars = _message_chars(messages)
    produced = 0
    try:
        temp = cfg["temperature"] if temperature is None else temperature
        limit = cfg["max_tokens"] if max_tokens is None else max_tokens
        iterator = (
            _stream_gemini(cfg, messages, temp, limit, json_mode)
            if cfg["provider"] == "gemini"
            else _stream_openai(cfg, messages, temp, limit, json_mode)
        )
        async for text in iterator:
            produced += len(text)
            yield text
        _log_usage(cfg["provider"], cfg["model"], operation, "ok", chars, produced,
                   int((time.perf_counter() - started) * 1000))
    except AIError as exc:
        _log_usage(cfg["provider"], cfg["model"], operation, "error", chars, produced,
                   int((time.perf_counter() - started) * 1000), str(exc))
        raise


def _validate_embedding_vectors(
    vectors: Sequence[Sequence[float]], expected_count: int, provider: str
) -> List[List[float]]:
    output = [list(vector or []) for vector in vectors]
    if len(output) != expected_count or any(not vector for vector in output):
        raise AIRequestError(f"{provider} embeddings returned a mismatched vector count.")
    dimensions = {len(vector) for vector in output}
    if dimensions != {EMBED_DIM}:
        found = ", ".join(str(value) for value in sorted(dimensions)) or "none"
        raise AIRequestError(
            f"{provider} embeddings returned {found} dimensions; this index requires {EMBED_DIM}. "
            "Use a model/configuration that returns the required dimension, then re-index."
        )
    return output


def _gemini_embedding(
    cfg: dict, texts: Sequence[str], task_type: str = "RETRIEVAL_DOCUMENT"
) -> tuple[List[List[float]], str]:
    model = _gemini_model(cfg.get("embedding_model") or GEMINI_EMBED_DEFAULT)
    client = _gemini_client(cfg)
    try:
        response = client.models.embed_content(
            model=model,
            contents=[
                genai_types.Content(parts=[genai_types.Part.from_text(text=text)])
                for text in texts
            ],
            config=genai_types.EmbedContentConfig(
                task_type=task_type,
                output_dimensionality=EMBED_DIM,
            ),
        )
        vectors = [list(item.values or []) for item in (response.embeddings or [])]
        return _validate_embedding_vectors(vectors, len(texts), "Gemini"), embedding_signature("gemini", model)
    except AIError:
        raise
    except Exception as exc:
        raise _gemini_error(exc, cfg) from exc
    finally:
        try:
            client.close()
        except Exception:
            pass


def _openai_embeddings(cfg: dict, texts: Sequence[str]) -> tuple[List[List[float]], str]:
    model = cfg["embedding_model"] or "text-embedding-3-small"
    payload = {"model": model, "input": list(texts)}
    if model.startswith("text-embedding-3"):
        payload["dimensions"] = EMBED_DIM
    try:
        with httpx.Client(timeout=TIMEOUT) as client:
            response = client.post(_openai_url(cfg, "/embeddings"), json=payload, headers=_auth_headers(cfg))
    except httpx.TimeoutException as exc:
        raise AIRequestError("The embedding provider timed out. Check the connection and try again.") from exc
    except httpx.HTTPError as exc:
        raise AIRequestError(f"Could not reach the embedding provider: {_redact(exc, cfg)}") from exc
    if response.status_code >= 400:
        raise AIRequestError(f"Embedding provider returned HTTP {response.status_code}: {_redact(response.text, cfg)}")
    try:
        data = response.json()
        vectors = [item["embedding"] for item in data["data"]]
    except (KeyError, TypeError, ValueError) as exc:
        raise AIRequestError("Embedding endpoint returned an unexpected response.") from exc
    provider = cfg.get("embedding_provider") or cfg.get("provider") or "openai"
    return _validate_embedding_vectors(vectors, len(texts), "Embedding provider"), embedding_signature(provider, model)


def _embedding_config(cfg: dict) -> tuple[str, str]:
    provider = cfg.get("embedding_provider") or "local"
    model = cfg.get("embedding_model") or ""
    if provider == "local" or not cfg.get("configured"):
        return "local", LOCAL_EMBEDDING_MODEL
    if provider not in REMOTE_EMBEDDING_PROVIDERS:
        raise AIConfigError(
            "The selected provider does not support remote embeddings. Use local embeddings or choose "
            "Gemini/OpenAI-compatible embeddings."
        )
    if not cfg.get("embedding_configured"):
        raise AIConfigError("Embedding settings are incomplete. Select a supported embedding model and provider.")
    return provider, model


def embed_texts(
    db: Session, texts: Sequence[str], task_type: str = "RETRIEVAL_DOCUMENT"
) -> tuple[List[List[float]], str]:
    cfg = get_ai_config(db)
    provider, _model = _embedding_config(cfg)
    if provider == "local":
        return [local_embedding(text) for text in texts], LOCAL_EMBEDDING_MODEL
    if provider == "gemini":
        return _gemini_embedding(cfg, texts, task_type)
    return _openai_embeddings(cfg, texts)


def embed_texts_sync(
    db: Session, texts: Sequence[str], task_type: str = "RETRIEVAL_DOCUMENT"
) -> tuple[List[List[float]], str]:
    cfg = get_ai_config(db)
    provider, _model = _embedding_config(cfg)
    if provider == "local":
        return [local_embedding(text) for text in texts], LOCAL_EMBEDDING_MODEL
    if provider == "gemini":
        return _gemini_embedding(cfg, texts, task_type)
    return _openai_embeddings(cfg, texts)


def _model_info(item: object) -> dict:
    name = (getattr(item, "name", "") or "").split("/")[-1]
    return {
        "id": name,
        "display_name": getattr(item, "display_name", "") or name,
        "input_token_limit": getattr(item, "input_token_limit", None),
        "output_token_limit": getattr(item, "output_token_limit", None),
    }


async def list_models_for_config(cfg: dict) -> dict:
    if cfg["provider"] == "offline":
        return {
            "provider": "offline",
            "models": [],
            "chat_models": [],
            "embedding_models": [],
            "message": "Offline mode has no remote models.",
        }
    _validate_base_url(cfg)
    if cfg["provider"] in {"openai", "groq"} and not cfg["api_key"]:
        raise AIConfigError("Add an API key or configure it on the server before loading models.")
    chat_models: dict[str, dict] = {}
    embedding_models: dict[str, dict] = {}
    if cfg["provider"] == "gemini":
        client = _gemini_client(cfg)
        try:
            pager = await client.aio.models.list(config=genai_types.ListModelsConfig(page_size=200))
            async for item in pager:
                info = _model_info(item)
                if not info["id"]:
                    continue
                actions = getattr(item, "supported_actions", None) or []
                if "generateContent" in actions or not actions:
                    chat_models[info["id"]] = info
                if "embedContent" in actions:
                    embedding_models[info["id"]] = info
        except AIError:
            raise
        except Exception as exc:
            raise _gemini_error(exc, cfg) from exc
        finally:
            await _close_gemini(client)
    else:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                response = await client.get(
                    _openai_url(cfg, "/models"),
                    headers=_auth_headers(cfg),
                )
        except httpx.HTTPError as exc:
            raise AIRequestError(f"Could not reach the provider: {_redact(exc, cfg)}") from exc
        if response.status_code >= 400:
            raise AIRequestError(f"Provider returned HTTP {response.status_code}: {_redact(response.text, cfg)}")
        try:
            data = response.json()
        except ValueError as exc:
            raise AIRequestError("Provider returned an unexpected model list.") from exc
        for item in data.get("data", []):
            name = str(item.get("id") or "").strip()
            if not name:
                continue
            info = {"id": name, "display_name": name, "input_token_limit": None, "output_token_limit": None}
            if "embed" in name.lower() or "embedding" in name.lower():
                embedding_models[name] = info
            else:
                chat_models[name] = info
    chat = [chat_models[key] for key in sorted(chat_models)]
    embeddings = [embedding_models[key] for key in sorted(embedding_models)]
    message = ""
    if not chat:
        message = "The provider did not report any chat models."
    elif cfg.get("embedding_mode", "local") == "remote" and not embeddings:
        message = "The provider did not report any embedding models."
    return {
        "provider": cfg["provider"],
        "models": [item["id"] for item in chat],
        "chat_models": chat,
        "embedding_models": embeddings,
        "message": message,
    }


async def list_models(db: Session) -> dict:
    return await list_models_for_config(get_ai_config(db))


async def validate_ai_config(cfg: dict) -> None:
    if cfg["provider"] == "offline":
        return
    _validate_base_url(cfg)
    if not cfg.get("model"):
        raise AIConfigError("A model ID is required for the selected provider.")
    if cfg["provider"] in {"gemini", "openai", "groq"}:
        if not cfg["configured"]:
            raise AIConfigError("The provider configuration is incomplete. Add the API key and required fields.")
        catalog = await list_models_for_config(cfg)
        chat_ids = {item["id"] for item in catalog["chat_models"]}
        if cfg["model"] not in chat_ids:
            raise AIConfigError(
                f'The model "{cfg["model"]}" is not available for generateContent with {cfg["provider"]}. '
                "Load the provider model list and select an exact available model ID."
            )
    if cfg["embedding_mode"] == "remote":
        if cfg["embedding_provider"] == "unsupported":
            raise AIConfigError(
                f"{cfg['provider']} does not expose a supported remote embedding endpoint. "
                "Use local embeddings or select a different chat provider."
            )
        if not cfg.get("embedding_configured"):
            raise AIConfigError("Remote embedding settings are incomplete. Select an exact embedding model.")
        if cfg["embedding_provider"] != cfg["provider"]:
            raise AIConfigError(
                "Remote embeddings must use the same provider as the chat model. "
                "Use local embeddings or select the matching provider."
            )
        if cfg["provider"] in {"gemini", "openai"}:
            embedding_ids = {item["id"] for item in catalog["embedding_models"]}
            if cfg["embedding_model"] not in embedding_ids:
                raise AIConfigError(
                    f'The embedding model "{cfg["embedding_model"]}" is not available for embedContent with '
                    f'{cfg["provider"]}. Load the provider model list and select an exact embedding model ID.'
                )
    elif cfg["embedding_provider"] != "local":
        raise AIConfigError("Local embedding mode must use local feature hashing.")


async def _chat_test(db: Session, cfg: dict) -> dict:
    if cfg["provider"] == "offline":
        return {
            "ok": True,
            "skipped": True,
            "provider": "offline",
            "model": "",
            "message": "Offline retrieval mode has no remote chat model to test.",
        }
    try:
        answer = await chat_completion(
            db,
            [{"role": "user", "content": "Reply with the single word: ready"}],
            max_tokens=1024,
            temperature=0,
            operation="connection_test",
        )
        return {
            "ok": True,
            "provider": cfg["provider"],
            "model": cfg["model"],
            "message": f"Chat connection succeeded. Model replied: {answer.strip()[:60]}",
        }
    except AIError as exc:
        return {
            "ok": False,
            "provider": cfg["provider"],
            "model": cfg["model"],
            "message": str(exc),
        }


def _embedding_test(db: Session, cfg: dict) -> dict:
    if not cfg.get("embedding_configured"):
        return {
            "ok": False,
            "provider": cfg.get("embedding_provider", ""),
            "model": cfg.get("embedding_model", ""),
            "dimensions": 0,
            "message": "Embedding settings are incomplete.",
        }
    try:
        vectors, signature = embed_texts_sync(db, ["embedding connectivity test"], task_type="RETRIEVAL_QUERY")
        dimensions = len(vectors[0]) if vectors else 0
        if dimensions != EMBED_DIM:
            return {
                "ok": False,
                "provider": signature.split(":", 1)[0],
                "model": cfg.get("embedding_model", ""),
                "signature": signature,
                "dimensions": dimensions,
                "message": f"Embedding test returned {dimensions} dimensions; expected {EMBED_DIM}.",
            }
        if not embedding_signature_matches(signature, cfg.get("embedding_signature")):
            return {
                "ok": False,
                "provider": signature.split(":", 1)[0],
                "model": cfg.get("embedding_model", ""),
                "signature": signature,
                "dimensions": dimensions,
                "message": "Embedding test returned a different provider/model signature than the saved config.",
            }
        return {
            "ok": True,
            "provider": cfg.get("embedding_provider", ""),
            "model": cfg.get("embedding_model", ""),
            "signature": signature,
            "dimensions": dimensions,
            "message": f"Embedding test succeeded with {dimensions} dimensions ({signature}).",
        }
    except AIError as exc:
        return {
            "ok": False,
            "provider": cfg.get("embedding_provider", ""),
            "model": cfg.get("embedding_model", ""),
            "dimensions": 0,
            "message": str(exc),
        }


async def test_connection(db: Session) -> dict:
    cfg = get_ai_config(db)
    chat = await _chat_test(db, cfg)
    embedding = _embedding_test(db, cfg)
    ok = bool(chat.get("ok")) and bool(embedding.get("ok"))
    if ok:
        message = (
            f"Chat and embedding tests succeeded for {cfg['provider']}."
            if cfg["provider"] != "offline"
            else "Offline mode is active; local embeddings are available."
        )
    else:
        failures = [part["message"] for part in (chat, embedding) if not part.get("ok")]
        message = " ".join(failures) or "AI validation failed."
    return {
        "ok": ok,
        "provider": cfg["provider"],
        "model": cfg["model"],
        "message": message,
        "chat": chat,
        "embedding": embedding,
    }
