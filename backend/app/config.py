import os
import sys
from pathlib import Path

APP_NAME = "AI Engineering Companion"
APP_SLUG = "ai-engineering-companion"
VERSION = "1.3.0"
HOST = os.environ.get("AEC_HOST", "127.0.0.1")
PORT = int(os.environ.get("AEC_PORT", "8765"))
CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "AEC_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]
WEB_USER = os.environ.get("AEC_WEB_USER", "student")
WEB_PASSWORD = os.environ.get("AEC_WEB_PASSWORD", "")
PUBLIC_URL = os.environ.get("AEC_PUBLIC_URL", "").rstrip("/")
SESSION_COOKIE = "aec_session"
SESSION_DAYS = int(os.environ.get("AEC_SESSION_DAYS", "30"))
COOKIE_SECURE = os.environ.get("AEC_COOKIE_SECURE", "auto").lower()
ENV_KEYS_ONLY = os.environ.get("AEC_ENV_KEYS_ONLY", "").lower() in {"1", "true", "yes", "on"}
SMTP_HOST = os.environ.get("AEC_SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("AEC_SMTP_PORT", "587"))
SMTP_USER = os.environ.get("AEC_SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("AEC_SMTP_PASSWORD", "")
SMTP_FROM = os.environ.get("AEC_SMTP_FROM", SMTP_USER or "noreply@localhost")
SMTP_TLS = os.environ.get("AEC_SMTP_TLS", "1").lower() not in {"0", "false", "no"}

ENV_AI_KEYS = {
    "openai": os.environ.get("AEC_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY", ""),
    "gemini": os.environ.get("AEC_GEMINI_API_KEY") or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY", ""),
    "groq": os.environ.get("AEC_GROQ_API_KEY") or os.environ.get("GROQ_API_KEY", ""),
    "custom": os.environ.get("AEC_CUSTOM_API_KEY", ""),
    "local": os.environ.get("AEC_LOCAL_API_KEY", ""),
}
ENV_AI_BASE_URLS = {
    "openai": os.environ.get("AEC_OPENAI_BASE_URL", ""),
    "gemini": os.environ.get("AEC_GEMINI_BASE_URL", ""),
    "groq": os.environ.get("AEC_GROQ_BASE_URL", ""),
    "custom": os.environ.get("AEC_CUSTOM_BASE_URL", ""),
    "local": os.environ.get("AEC_LOCAL_BASE_URL", ""),
}
ENV_AI_MODELS = {
    "openai": os.environ.get("AEC_OPENAI_MODEL", ""),
    "gemini": os.environ.get("AEC_GEMINI_MODEL", ""),
    "groq": os.environ.get("AEC_GROQ_MODEL", ""),
    "custom": os.environ.get("AEC_CUSTOM_MODEL", ""),
    "local": os.environ.get("AEC_LOCAL_MODEL", ""),
}


def auth_required() -> bool:
    return os.environ.get("AEC_REQUIRE_AUTH", "0").lower() in {"1", "true", "yes", "on"}


def registration_mode() -> str:
    return os.environ.get("AEC_ALLOW_REGISTRATION", "auto").lower()


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


def _database_url() -> str:
    configured = os.environ.get("AEC_DATABASE_URL", "").strip()
    if not configured:
        return f"sqlite:///{DATABASE_PATH.as_posix()}"
    if configured.startswith("postgres://"):
        configured = configured.replace("postgres://", "postgresql+psycopg://", 1)
    elif configured.startswith("postgresql://"):
        configured = configured.replace("postgresql://", "postgresql+psycopg://", 1)
    return configured


DATABASE_URL = _database_url()
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
    "ai_max_tokens": "4096",
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
