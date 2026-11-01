import asyncio
import os
from types import SimpleNamespace

import httpx
import pytest
from google.genai import errors as genai_errors

from app.ai import providers
from app.ai.providers import (
    AIRequestError,
    _gemini_chat,
    _gemini_error,
    _gemini_http_options,
    _stream_gemini,
)
from tests.conftest import upload_text


def _cfg(**updates):
    cfg = {
        "provider": "gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "api_key": "mock-key-never-sent",
        "model": "gemini-3.5-flash",
        "temperature": 0.4,
        "max_tokens": 4096,
    }
    cfg.update(updates)
    return cfg


class FakeAsyncModels:
    def __init__(self, text="", chunks=None, error=None, models=None):
        self.text = text
        self.chunks = chunks or []
        self.error = error
        self.models = models or []
        self.calls = []
        self.list_calls = []

    async def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return SimpleNamespace(text=self.text, candidates=[], prompt_feedback=None)

    async def generate_content_stream(self, **kwargs):
        self.calls.append(kwargs)

        async def stream():
            if self.error:
                raise self.error
            for text in self.chunks:
                yield SimpleNamespace(text=text, candidates=[], prompt_feedback=None)

        return stream()

    async def list(self, **kwargs):
        self.list_calls.append(kwargs)

        async def pager():
            for name, actions in self.models:
                yield SimpleNamespace(name=name, supported_actions=actions)

        return pager()


class FakeClient:
    def __init__(self, text="", chunks=None, error=None, models=None):
        self.aio = SimpleNamespace(
            models=FakeAsyncModels(text=text, chunks=chunks, error=error, models=models),
            aclose=self._aclose,
        )
        self.closed = False

    async def _aclose(self):
        self.closed = True


def _patch_client(monkeypatch, client):
    monkeypatch.setattr(providers, "_gemini_client", lambda cfg: client)


def test_official_sdk_chat_maps_contents_and_config(monkeypatch):
    fake = FakeClient(text="Use [S1] for the sampling theorem.")
    _patch_client(monkeypatch, fake)
    messages = [
        {"role": "system", "content": "Be precise."},
        {"role": "user", "content": "Explain sampling."},
        {"role": "assistant", "content": "Start with bandwidth."},
        {"role": "user", "content": "Now define Nyquist rate."},
    ]

    answer = asyncio.run(
        _gemini_chat(_cfg(), messages, temperature=0.2, max_tokens=333, json_mode=True)
    )

    assert answer == "Use [S1] for the sampling theorem."
    assert fake.closed is True
    call = fake.aio.models.calls[0]
    assert call["model"] == "gemini-3.5-flash"
    assert [item.role for item in call["contents"]] == ["user", "model", "user"]
    assert call["contents"][0].parts[0].text == "Explain sampling."
    assert call["config"].system_instruction == "Be precise."
    assert call["config"].temperature == 0.2
    assert call["config"].max_output_tokens == 333
    assert call["config"].response_mime_type == "application/json"


def test_official_sdk_streaming_yields_deltas(monkeypatch):
    fake = FakeClient(chunks=["Nyquist ", "rate ", "is 2fmax. [S1]"])
    _patch_client(monkeypatch, fake)

    async def collect():
        return [
            chunk
            async for chunk in _stream_gemini(
                _cfg(),
                [{"role": "user", "content": "Define Nyquist rate."}],
                0.1,
                100,
                False,
            )
        ]

    assert asyncio.run(collect()) == ["Nyquist ", "rate ", "is 2fmax. [S1]"]
    assert fake.closed is True


def test_official_sdk_model_list_awaits_async_pager(monkeypatch):
    fake = FakeClient(
        models=[
            ("models/gemini-3.5-flash", ["generateContent"]),
            ("models/text-embedding-004", ["embedContent"]),
            ("models/gemini-3.8-pro", ["generateContent"]),
        ]
    )
    _patch_client(monkeypatch, fake)
    monkeypatch.setattr(providers, "get_ai_config", lambda db: _cfg())

    result = asyncio.run(providers.list_models(None))

    assert result["provider"] == "gemini"
    assert result["models"] == ["gemini-3.5-flash", "gemini-3.8-pro"]
    assert fake.aio.models.list_calls == [{"config": providers.genai_types.ListModelsConfig(page_size=200)}]
    assert fake.closed is True


def test_aq_google_api_keys_are_redacted():
    key = "AQ." + "Ab8RN6KO3PYGqpqy6OOylbowunXRS9NFkSDyiUp5mPp6cYsgQg"
    message = providers._redact(f"request failed for {key}")
    assert "AQ.Ab8RN" not in message
    assert "[redacted]" in message


def test_gemini_quota_error_is_safe_and_actionable(monkeypatch):
    error = genai_errors.ClientError(
        429,
        {
            "error": {
                "code": 429,
                "message": "quota exceeded for mock-key-never-sent",
                "status": "RESOURCE_EXHAUSTED",
            }
        },
    )
    _patch_client(monkeypatch, FakeClient(error=error))

    with pytest.raises(AIRequestError) as raised:
        asyncio.run(
            _gemini_chat(_cfg(), [{"role": "user", "content": "Hello"}], 0.1, 20, False)
        )

    message = str(raised.value)
    assert "quota" in message.lower()
    assert "mock-key-never-sent" not in message


@pytest.mark.parametrize(
    ("code", "status", "expected"),
    [
        (400, "INVALID_ARGUMENT", "API key"),
        (401, "UNAUTHENTICATED", "API key"),
        (403, "PERMISSION_DENIED", "permission"),
        (404, "NOT_FOUND", "not found"),
        (429, "RESOURCE_EXHAUSTED", "quota"),
        (503, "UNAVAILABLE", "temporarily unavailable"),
    ],
)
def test_gemini_api_errors_are_mapped_without_secrets(code, status, expected):
    cfg = _cfg()
    error = genai_errors.APIError(
        code,
        {"error": {"code": code, "status": status, "message": "API key not valid: mock-key-never-sent"}},
    )
    message = str(_gemini_error(error, cfg))
    assert expected.lower() in message.lower()
    assert "mock-key-never-sent" not in message


def test_gemini_timeout_is_mapped():
    message = str(_gemini_error(httpx.ConnectTimeout("timed out"), _cfg()))
    assert "timed out" in message.lower()


def test_gemini_base_url_version_is_split_for_the_sdk():
    options = _gemini_http_options(
        _cfg(base_url="https://generativelanguage.googleapis.com/v1beta")
    )
    assert options.base_url == "https://generativelanguage.googleapis.com"
    assert options.api_version == "v1beta"
    assert options.timeout == 120000
    assert options.retry_options.attempts == 2


def test_chat_endpoint_uses_official_sdk_and_preserves_citations(client, subject, monkeypatch):
    upload_text(
        client,
        subject["id"],
        "gemini-notes.txt",
        "The Nyquist rate is twice the highest signal frequency. [S1]",
    )
    try:
        saved = client.put(
            "/api/settings",
            json={
                "ai_provider": "gemini",
                "ai_base_url": "https://generativelanguage.googleapis.com/v1beta",
                "ai_model": "gemini-3.5-flash",
                "ai_api_key": "mock-key-never-sent",
                "ai_max_tokens": "4321",
                "embedding_provider": "local",
            },
        )
        assert saved.status_code == 200, saved.text
        fake = FakeClient(text="The Nyquist rate is twice the maximum frequency [S1].")
        _patch_client(monkeypatch, fake)

        response = client.post(
            "/api/ai/chat",
            json={
                "message": "What is the Nyquist rate?",
                "subject_id": subject["id"],
                "mode": "explain",
            },
        )
        assert response.status_code == 200, response.text
        assert fake.aio.models.calls[0]["config"].max_output_tokens == 4321
        body = response.json()
        assert body["generator"] == "ai"
        assert body["sources"]
        assert body["sources"][0]["label"] == "S1"
        assert body["sources"][0]["cited"] is True
        assert body["citations"]["labels"] == ["S1"]
        assert body["citations"]["uncited"] is False
        assert "did not contain" not in body["note"]
    finally:
        client.put(
            "/api/settings",
            json={
                "ai_provider": "offline",
                "ai_api_key": "",
                "embedding_provider": "local",
            },
        )


def test_streaming_endpoint_emits_cited_sources(client, subject, monkeypatch):
    upload_text(
        client,
        subject["id"],
        "gemini-stream-notes.txt",
        "Aliasing occurs when the sampling rate is below the Nyquist rate. [S1]",
    )
    try:
        saved = client.put(
            "/api/settings",
            json={
                "ai_provider": "gemini",
                "ai_model": "gemini-3.5-flash",
                "ai_api_key": "mock-key-never-sent",
                "embedding_provider": "local",
            },
        )
        assert saved.status_code == 200, saved.text
        _patch_client(
            monkeypatch,
            FakeClient(chunks=["Aliasing occurs below ", "the Nyquist rate [S1]."]),
        )

        response = client.post(
            "/api/ai/chat/stream",
            json={
                "message": "When does aliasing occur?",
                "subject_id": subject["id"],
                "mode": "explain",
            },
        )
        assert response.status_code == 200, response.text
        assert "event: meta" in response.text
        assert "event: delta" in response.text
        assert "Aliasing occurs below" in response.text
        assert '"generator": "ai"' in response.text
        assert '"labels": ["S1"]' in response.text
        assert '"cited": true' in response.text
    finally:
        client.put(
            "/api/settings",
            json={
                "ai_provider": "offline",
                "ai_api_key": "",
                "embedding_provider": "local",
            },
        )


def _live_key():
    key = (
        os.environ.get("AEC_GEMINI_API_KEY")
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
    )
    if not key:
        pytest.skip("Set AEC_GEMINI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY to run the live Gemini test.")
    return key


def _live_cfg():
    return _cfg(
        api_key=_live_key(),
        model=os.environ.get("AEC_GEMINI_MODEL", "gemini-3.5-flash"),
    )


@pytest.mark.live
def test_live_gemini_round_trip():
    answer = asyncio.run(
        _gemini_chat(
            _live_cfg(),
            [{"role": "user", "content": "Reply with exactly: ready"}],
            temperature=0,
            max_tokens=256,
            json_mode=False,
        )
    )
    assert "ready" in answer.lower()


@pytest.mark.live
def test_live_gemini_streaming():
    async def collect():
        return [
            chunk
            async for chunk in _stream_gemini(
                _live_cfg(),
                [
                    {
                        "role": "user",
                        "content": "Write one short sentence explaining why an anti-aliasing filter is used before sampling.",
                    }
                ],
                0.2,
                4096,
                False,
            )
        ]

    chunks = asyncio.run(collect())
    text = "".join(chunks).lower()
    assert len(chunks) >= 2
    assert "filter" in text or "sampling" in text or "alias" in text


@pytest.mark.live
def test_live_gemini_engineering_and_numerical_answers():
    explanation = asyncio.run(
        _gemini_chat(
            _live_cfg(),
            [
                {
                    "role": "user",
                    "content": (
                        "Explain the Nyquist-Shannon sampling theorem to an undergraduate engineering student. "
                        "Include the sampling-rate condition, the Nyquist rate, and aliasing. Keep it under 220 words."
                    ),
                }
            ],
            0.2,
            4096,
            False,
        )
    )
    lowered = explanation.lower()
    assert all(term in lowered for term in ("nyquist", "sampling", "alias"))

    numerical = asyncio.run(
        _gemini_chat(
            _live_cfg(),
            [
                {
                    "role": "user",
                    "content": (
                        "A 3 kHz sinusoidal signal is sampled at 8 kHz. Compute the Nyquist rate, "
                        "state whether aliasing occurs, and show the calculation with units."
                    ),
                }
            ],
            0.1,
            4096,
            False,
        )
    )
    lowered = numerical.lower()
    assert "6" in numerical and ("khz" in lowered or "hz" in lowered)
    assert "alias" in lowered
