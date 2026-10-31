from typing import Optional

from sqlalchemy.orm import Session

from ..config import DEFAULT_SETTINGS, SECRET_SETTING_KEYS
from ..models import Preference, Secret
from ..security import decrypt_value, encrypt_value


def get_settings(db: Session) -> dict:
    values = dict(DEFAULT_SETTINGS)
    for row in db.query(Preference).all():
        values[row.key] = row.value
    secret = db.get(Secret, "ai_api_key")
    values["ai_api_key"] = decrypt_value(secret.encrypted_value) if secret else ""
    return values


def public_settings(db: Session) -> dict:
    values = get_settings(db)
    key = values.get("ai_api_key") or ""
    values["ai_api_key"] = ("*" * 8 + key[-4:]) if key else ""
    values["ai_api_key_set"] = bool(key)
    return values


def set_setting(db: Session, key: str, value: str) -> None:
    if key in SECRET_SETTING_KEYS:
        row = db.get(Secret, key)
        if not row:
            row = Secret(key=key, encrypted_value="")
            db.add(row)
        row.encrypted_value = encrypt_value(value)
    else:
        row = db.get(Preference, key)
        if not row:
            row = Preference(key=key, value=value)
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
            set_setting(db, key, str(value))


def get_ai_config(db: Session) -> dict:
    settings = get_settings(db)
    provider = settings.get("ai_provider", "offline")
    api_key = settings.get("ai_api_key", "")
    base_url = settings.get("ai_base_url", "")
    model = settings.get("ai_model", "")
    embedding_provider = settings.get("embedding_provider", "local")
    embedding_model = settings.get("ai_embedding_model", "")
    local_base_url = settings.get("local_base_url", "")

    if provider == "local":
        base_url = local_base_url
        model = settings.get("local_model") or model
    if embedding_provider == "local":
        embedding_model = "local-hash-v1"

    try:
        temperature = float(settings.get("ai_temperature", "0.4"))
    except ValueError:
        temperature = 0.4
    try:
        max_tokens = int(settings.get("ai_max_tokens", "1400"))
    except ValueError:
        max_tokens = 1400

    return {
        "provider": provider,
        "base_url": (base_url or "").rstrip("/"),
        "api_key": api_key,
        "model": model,
        "embedding_provider": embedding_provider,
        "embedding_model": embedding_model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "configured": provider != "offline" and bool(model) and bool(base_url)
        and (bool(api_key) or provider == "local"),
    }


def mask_secret(value: Optional[str]) -> str:
    if not value:
        return ""
    return "*" * 8 + value[-4:]
