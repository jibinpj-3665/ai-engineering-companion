from typing import Optional

from sqlalchemy.orm import Session

from ..config import (
    DEFAULT_SETTINGS,
    ENV_AI_BASE_URLS,
    ENV_AI_KEYS,
    ENV_AI_MODELS,
    ENV_KEYS_ONLY,
    SECRET_SETTING_KEYS,
)
from ..database import current_user_id
from ..models import Preference, Secret
from ..security import decrypt_value, encrypt_value

PROVIDER_DEFAULTS = {
    "openai": {"base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini"},
    "gemini": {"base_url": "https://generativelanguage.googleapis.com/v1beta", "model": "gemini-3.5-flash"},
    "groq": {"base_url": "https://api.groq.com/openai/v1", "model": "llama-3.3-70b-versatile"},
    "custom": {"base_url": "", "model": ""},
    "local": {"base_url": "http://127.0.0.1:11434/v1", "model": "llama3.1"},
    "offline": {"base_url": "", "model": ""},
}
PROVIDER_ALIASES = {
    "openai_compatible": "custom",
    "ollama": "local",
    "google": "gemini",
}


def normalize_provider(provider: str) -> str:
    value = (provider or "offline").strip().lower()
    return PROVIDER_ALIASES.get(value, value)


def _scoped(key: str) -> str:
    uid = current_user_id.get()
    if uid is None:
        raise RuntimeError("No active user context for settings access.")
    return f"u{uid}:{key}"


def get_settings(db: Session) -> dict:
    values = dict(DEFAULT_SETTINGS)
    prefix = _scoped("")
    for row in db.query(Preference).all():
        if row.key.startswith(prefix):
            values[row.key[len(prefix):]] = row.value
    secret = db.get(Secret, _scoped("ai_api_key"))
    values["ai_api_key"] = decrypt_value(secret.encrypted_value) if secret else ""
    return values


def public_settings(db: Session) -> dict:
    values = get_settings(db)
    key = values.get("ai_api_key") or ""
    values["ai_api_key"] = ("*" * 8 + key[-4:]) if key else ""
    values["ai_api_key_set"] = bool(key)
    values["ai_provider"] = normalize_provider(values.get("ai_provider", "offline"))
    values["env_keys_only"] = ENV_KEYS_ONLY
    return values


def set_setting(db: Session, key: str, value: str) -> None:
    scoped = _scoped(key)
    if key in SECRET_SETTING_KEYS:
        row = db.get(Secret, scoped)
        if not row:
            row = Secret(key=scoped, encrypted_value="")
            db.add(row)
        row.encrypted_value = encrypt_value(value)
    else:
        row = db.get(Preference, scoped)
        if not row:
            row = Preference(key=scoped, value=value)
            db.add(row)
        else:
            row.value = value
    db.commit()


def update_settings(db: Session, updates: dict) -> None:
    for key, value in updates.items():
        if value is None:
            continue
        if key in DEFAULT_SETTINGS or key in SECRET_SETTING_KEYS:
            if key in SECRET_SETTING_KEYS and isinstance(value, str) and set(value.strip()) == {"*"}:
                continue
            if key in SECRET_SETTING_KEYS and ENV_KEYS_ONLY:
                continue
            if key == "ai_provider":
                value = normalize_provider(str(value))
            set_setting(db, key, str(value))


def _provider_key(provider: str, stored_key: str) -> tuple[str, str]:
    env_key = ENV_AI_KEYS.get(provider, "")
    if env_key:
        return env_key, "environment"
    if stored_key and not ENV_KEYS_ONLY:
        return stored_key, "account"
    return "", "none"


def get_ai_config(db: Session) -> dict:
    settings = get_settings(db)
    provider = normalize_provider(settings.get("ai_provider", "offline"))
    defaults = PROVIDER_DEFAULTS.get(provider, PROVIDER_DEFAULTS["offline"])
    stored_key = settings.get("ai_api_key", "")
    api_key, key_source = _provider_key(provider, stored_key)
    base_url = ENV_AI_BASE_URLS.get(provider) or settings.get("ai_base_url", "") or defaults["base_url"]
    model = ENV_AI_MODELS.get(provider) or settings.get("ai_model", "") or defaults["model"]
    if provider == "local":
        base_url = ENV_AI_BASE_URLS.get("local") or settings.get("local_base_url", "") or defaults["base_url"]
        model = ENV_AI_MODELS.get("local") or settings.get("local_model", "") or defaults["model"]
    embedding_provider = settings.get("embedding_provider", "local")
    embedding_model = settings.get("ai_embedding_model", "")

    if embedding_provider == "local":
        embedding_model = "local-hash-v1"

    try:
        temperature = float(settings.get("ai_temperature", "0.4"))
    except ValueError:
        temperature = 0.4
    try:
        max_tokens = max(128, min(8192, int(settings.get("ai_max_tokens", "4096"))))
    except ValueError:
        max_tokens = 4096

    configured = provider != "offline" and bool(model) and bool(base_url) and (
        bool(api_key) or provider in {"local", "custom"}
    )
    return {
        "provider": provider,
        "base_url": (base_url or "").rstrip("/"),
        "api_key": api_key,
        "key_source": key_source,
        "stored_key_set": bool(stored_key),
        "env_key_set": bool(ENV_AI_KEYS.get(provider, "")),
        "model": model,
        "embedding_provider": embedding_provider,
        "embedding_model": embedding_model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "configured": configured,
    }


def mask_secret(value: Optional[str]) -> str:
    if not value:
        return ""
    return "*" * 8 + value[-4:]
