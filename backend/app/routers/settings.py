import shutil
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..config import BACKUP_DIR, DATABASE_PATH, UPLOAD_DIR
from ..database import SessionLocal, engine, get_db, init_db
from ..models import Notification
from ..serializers import notification_dict
from ..services.documents import reindex_subject_documents
from ..services.settings import get_ai_config, public_settings, update_settings

router = APIRouter(tags=["settings"])


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


@router.get("/settings")
def get_settings_route(db: Session = Depends(get_db)):
    data = public_settings(db)
    cfg = get_ai_config(db)
    data["ai_configured"] = cfg["configured"]
    data["effective_base_url"] = cfg["base_url"]
    data["effective_model"] = cfg["model"]
    return data


@router.put("/settings")
def put_settings(payload: SettingsUpdate, db: Session = Depends(get_db)):
    updates = payload.model_dump(exclude_none=True)
    if "ai_provider" in updates and updates["ai_provider"] not in {"offline", "openai", "openai_compatible", "local"}:
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
    update_settings(db, updates)
    data = public_settings(db)
    cfg = get_ai_config(db)
    data["ai_configured"] = cfg["configured"]
    data["effective_base_url"] = cfg["base_url"]
    data["effective_model"] = cfg["model"]
    return data


def _reindex_task() -> None:
    db = SessionLocal()
    try:
        reindex_subject_documents(db)
    finally:
        db.close()


@router.post("/settings/reindex")
def reindex(background: BackgroundTasks, db: Session = Depends(get_db)):
    background.add_task(_reindex_task)
    return {"ok": True, "message": "Re-indexing started in the background. Embeddings will use the current provider."}


def _backup_zip() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = BACKUP_DIR / f"ai-engineering-companion-backup-{stamp}.zip"
    temp_db = BACKUP_DIR / f".tmp-{stamp}.db"
    source = sqlite3.connect(str(DATABASE_PATH))
    destination = sqlite3.connect(str(temp_db))
    with destination:
        source.backup(destination)
    source.close()
    destination.close()
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.write(temp_db, "aec.db")
        if UPLOAD_DIR.exists():
            for path in UPLOAD_DIR.glob("*"):
                if path.is_file():
                    archive.write(path, f"uploads/{path.name}")
    temp_db.unlink(missing_ok=True)
    return target


@router.post("/backup")
def create_backup():
    try:
        path = _backup_zip()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backup failed: {exc}") from exc
    return {"ok": True, "filename": path.name, "path": str(path)}


@router.get("/backup/download")
def download_backup():
    try:
        path = _backup_zip()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Backup failed: {exc}") from exc
    return FileResponse(path, filename=path.name, media_type="application/zip")


@router.post("/backup/restore")
async def restore_backup(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not (file.filename or "").lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Restore requires a .zip backup created by this app.")
    data = await file.read()
    if len(data) > 500 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Backup archive is too large.")
    with tempfile.TemporaryDirectory() as temp_dir:
        archive_path = Path(temp_dir) / "restore.zip"
        archive_path.write_bytes(data)
        extract_dir = Path(temp_dir) / "extract"
        extract_dir.mkdir()
        try:
            with zipfile.ZipFile(archive_path) as archive:
                for member in archive.infolist():
                    resolved = (extract_dir / member.filename).resolve()
                    if not str(resolved).startswith(str(extract_dir.resolve())):
                        raise HTTPException(status_code=400, detail="Backup archive contains unsafe paths.")
                archive.extractall(extract_dir)
        except zipfile.BadZipFile as exc:
            raise HTTPException(status_code=400, detail="Invalid zip archive.") from exc
        db_file = extract_dir / "aec.db"
        if not db_file.exists():
            raise HTTPException(status_code=400, detail="Backup does not contain an aec.db database.")
        _backup_zip()
        db.close()
        engine.dispose()
        for suffix in ("", "-wal", "-shm"):
            latent = Path(str(DATABASE_PATH) + suffix)
            if latent.exists():
                latent.unlink()
        shutil.copy2(db_file, DATABASE_PATH)
        uploads = extract_dir / "uploads"
        if uploads.exists():
            UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
            for item in uploads.glob("*"):
                if item.is_file():
                    shutil.copy2(item, UPLOAD_DIR / item.name)
        init_db()
    return {"ok": True, "message": "Backup restored. Reload the application.", "reload": True}


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
