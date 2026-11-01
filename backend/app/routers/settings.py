import tempfile
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import ENV_KEYS_ONLY
from ..database import SessionLocal, current_user_id, get_db, reset_current_user, set_current_user
from ..models import Notification
from ..serializers import notification_dict
from ..services.backup import MAX_RESTORE_BYTES, export_user_backup, restore_user_backup
from ..services.documents import reindex_subject_documents
from ..services.settings import get_ai_config, public_settings, update_settings

router = APIRouter(tags=["settings"])

PROVIDERS = {"offline", "openai", "gemini", "groq", "custom", "local", "openai_compatible", "ollama", "google"}


class SettingsUpdate(BaseModel):
    ai_provider: str | None = None
    ai_base_url: str | None = None
    ai_api_key: str | None = None
    ai_model: str | None = None
    ai_embedding_model: str | None = None
    ai_temperature: str | None = None
    ai_max_tokens: str | None = None
    embedding_provider: str | None = None
    local_base_url: str | None = None
    local_model: str | None = None
    student_name: str | None = None
    accent: str | None = None
    theme: str | None = None
    daily_goal_minutes: str | None = None
    personality: str | None = None
    voice_enabled: str | None = None
    onboarding_complete: str | None = None


def _settings_response(db: Session) -> dict:
    data = public_settings(db)
    cfg = get_ai_config(db)
    data["ai_configured"] = cfg["configured"]
    data["effective_base_url"] = cfg["base_url"]
    data["effective_model"] = cfg["model"]
    data["key_source"] = cfg["key_source"]
    data["env_key_set"] = cfg["env_key_set"]
    data["env_keys_only"] = ENV_KEYS_ONLY
    return data


@router.get("/settings")
def get_settings_route(db: Session = Depends(get_db)):
    return _settings_response(db)


@router.put("/settings")
def put_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    updates = payload.model_dump(exclude_none=True)
    if "ai_provider" in updates and updates["ai_provider"] not in PROVIDERS:
        raise HTTPException(status_code=400, detail="Unsupported AI provider")
    if "embedding_provider" in updates and updates["embedding_provider"] not in {"local", "remote"}:
        raise HTTPException(status_code=400, detail="Embedding provider must be local or remote")
    if "theme" in updates and updates["theme"] not in {"dark", "light"}:
        raise HTTPException(status_code=400, detail="Theme must be dark or light")
    if "accent" in updates and updates["accent"] not in {"violet", "blue", "emerald", "rose", "amber"}:
        raise HTTPException(status_code=400, detail="Unsupported accent colour")
    if "daily_goal_minutes" in updates:
        try:
            goal = int(updates["daily_goal_minutes"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Daily goal must be a number") from exc
        if goal < 15 or goal > 900:
            raise HTTPException(status_code=400, detail="Daily goal must be between 15 and 900 minutes")
    if "ai_temperature" in updates:
        try:
            temperature = float(updates["ai_temperature"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Temperature must be a number") from exc
        if temperature < 0 or temperature > 2:
            raise HTTPException(status_code=400, detail="Temperature must be between 0 and 2")
    if "ai_max_tokens" in updates:
        try:
            tokens = int(updates["ai_max_tokens"])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Max tokens must be a number") from exc
        if tokens < 128 or tokens > 32000:
            raise HTTPException(status_code=400, detail="Max tokens must be between 128 and 32000")
    update_settings(db, updates)
    return _settings_response(db)


def _reindex_task(uid: int) -> None:
    token = set_current_user(uid)
    db = SessionLocal()
    try:
        reindex_subject_documents(db)
    finally:
        db.close()
        reset_current_user(token)


@router.post("/settings/reindex")
def reindex(background: BackgroundTasks, db: Session = Depends(get_db)):
    uid = current_user_id.get()
    if uid is None:
        raise HTTPException(status_code=401, detail="Authentication required.")
    background.add_task(_reindex_task, uid)
    return {"ok": True, "message": "Re-indexing started in the background with the current embedding provider."}


@router.post("/backup")
def create_backup(db: Session = Depends(get_db)):
    try:
        path = export_user_backup(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backup failed: {exc}") from exc
    return {
        "ok": True,
        "filename": path.name,
        "path": str(path),
        "scope": "current account only",
        "credentials_excluded": True,
    }


@router.get("/backup/download")
def download_backup(db: Session = Depends(get_db)):
    try:
        path = export_user_backup(db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backup failed: {exc}") from exc
    return FileResponse(path, filename=path.name, media_type="application/zip")


@router.post("/backup/restore")
async def restore_backup(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Restore requires a .zip backup created by this app.")
    with tempfile.TemporaryDirectory() as temp_dir:
        archive_path = Path(temp_dir) / "restore.zip"
        total = 0
        with archive_path.open("wb") as handle:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_RESTORE_BYTES:
                    raise HTTPException(status_code=413, detail="Backup archive is too large.")
                handle.write(chunk)
        try:
            result = restore_user_backup(db, archive_path)
        except ValueError as exc:
            db.rollback()
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            db.rollback()
            raise HTTPException(status_code=500, detail=f"Restore failed: {exc}") from exc
    return {**result, "reload": True}


@router.get("/notifications")
def list_notifications(db: Session = Depends(get_db)):
    rows = db.query(Notification).order_by(Notification.created_at.desc()).limit(50).all()
    return [notification_dict(row) for row in rows]


@router.post("/notifications/{notification_id}/read")
def read_notification(notification_id: int, db: Session = Depends(get_db)):
    row = db.get(Notification, notification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    row.read = True
    db.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def read_all(db: Session = Depends(get_db)):
    for row in db.query(Notification).filter(Notification.read == False).all():  # noqa: E712
        row.read = True
    db.commit()
    return {"ok": True}


@router.delete("/notifications/{notification_id}")
def delete_notification(notification_id: int, db: Session = Depends(get_db)):
    row = db.get(Notification, notification_id)
    if not row:
        raise HTTPException(status_code=404, detail="Notification not found")
    db.delete(row)
    db.commit()
    return {"ok": True}
