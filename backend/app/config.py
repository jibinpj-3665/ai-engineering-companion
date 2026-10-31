import os
import sys
from pathlib import Path

APP_NAME = "AI Engineering Companion"
APP_SLUG = "ai-engineering-companion"
VERSION = "1.0.0"
HOST = "127.0.0.1"
PORT = int(os.environ.get("AEC_PORT", "8765"))


def _default_data_dir() -> Path:
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
    if base:
        return Path(base) / "AIEngineeringCompanion"
    return Path.home() / ".ai-engineering-companion"


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("AIEC_DATA_DIR", str(_default_data_dir()))).resolve()
UPLOAD_DIR = DATA_DIR / "uploads"
BACKUP_DIR = DATA_DIR / "backups"
LOG_DIR = DATA_DIR / "logs"
DATABASE_PATH = DATA_DIR / "aec.db"
DATABASE_URL = f"sqlite:///{DATABASE_PATH.as_posix()}"
SECRET_KEY_PATH = DATA_DIR / "secret.key"

if getattr(sys, "frozen", False):
    _default_static = Path(getattr(sys, "_MEIPASS", PROJECT_ROOT)) / "frontend" / "dist"
else:
    _default_static = PROJECT_ROOT / "frontend" / "dist"
STATIC_DIR = Path(os.environ.get("AEC_STATIC_DIR", str(_default_static)))

ALLOWED_DOCUMENT_EXTENSIONS = {
    ".pdf", ".docx", ".pptx", ".txt", ".md", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"
}
MAX_UPLOAD_MB = int(os.environ.get("AEC_MAX_UPLOAD_MB", "80"))

DEFAULT_SETTINGS = {
    "ai_provider": "offline",
    "ai_base_url": "https://api.openai.com/v1",
    "ai_model": "gpt-4o-mini",
    "ai_embedding_model": "text-embedding-3-small",
    "ai_temperature": "0.4",
    "ai_max_tokens": "1400",
    "embedding_provider": "local",
    "local_base_url": "http://127.0.0.1:11434/v1",
    "local_model": "llama3.1",
    "student_name": "Engineer",
    "accent": "violet",
    "theme": "dark",
    "daily_goal_minutes": "120",
    "personality": "study_buddy",
    "voice_enabled": "false",
    "onboarding_complete": "false",
}

SECRET_SETTING_KEYS = {"ai_api_key"}


def ensure_directories() -> None:
    for directory in (DATA_DIR, UPLOAD_DIR, BACKUP_DIR, LOG_DIR):
        directory.mkdir(parents=True, exist_ok=True)
