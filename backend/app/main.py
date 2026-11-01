import logging
import threading
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import APP_NAME, CORS_ORIGINS, HOST, LOG_DIR, STATIC_DIR, VERSION, WEB_PASSWORD, auth_required, ensure_directories
from .database import init_db
from .routers import ai, analytics, auth, documents, labs, planner, quizzes, revision, settings, subjects, syllabus, syllabus_library, teaching
from .web_middleware import AuthMiddleware, SecurityHeadersMiddleware

ensure_directories()
logger = logging.getLogger("aec")
logger.setLevel(logging.INFO)
if not logger.handlers:
    handler = RotatingFileHandler(LOG_DIR / "backend.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    logger.addHandler(handler)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("Backend started on %s", HOST)

    def _recover_documents():
        from .services.documents import recover_pending_documents

        try:
            count = recover_pending_documents()
            if count:
                logger.info("Recovered %s pending document processing job(s)", count)
        except Exception:
            logger.exception("Document recovery failed")

    threading.Thread(target=_recover_documents, name="aec-document-recovery", daemon=True).start()
    if auth_required():
        logger.info("Account authentication is required for API access")
    elif HOST not in {"127.0.0.1", "localhost", "::1"} and not WEB_PASSWORD:
        logger.warning(
            "Backend is listening on %s without accounts or AEC_WEB_PASSWORD. "
            "Set AEC_REQUIRE_AUTH=1 and use HTTPS before exposing it beyond a trusted network.",
            HOST,
        )
    yield
    logger.info("Backend stopped")


app = FastAPI(title=APP_NAME, version=VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(AuthMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

api_routers = [
    auth.router,
    subjects.router,
    documents.router,
    syllabus.router,
    syllabus_library.router,
    ai.router,
    teaching.router,
    quizzes.router,
    revision.router,
    planner.router,
    analytics.router,
    labs.router,
    settings.router,
]
for router in api_routers:
    app.include_router(router, prefix="/api")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "app": APP_NAME,
        "version": VERSION,
        "mode": "desktop" if STATIC_DIR.exists() else "api",
        "auth_required": auth_required(),
    }


@app.exception_handler(Exception)
async def unhandled_exception(request, exc):
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error. Check the backend log for details."})


if (STATIC_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")


@app.get("/{full_path:path}")
def spa(full_path: str):
    if full_path.startswith("api"):
        return JSONResponse(status_code=404, content={"detail": "Not found"})
    if STATIC_DIR.exists():
        root = STATIC_DIR.resolve()
        candidate = (STATIC_DIR / full_path).resolve()
        if full_path and candidate.is_file() and candidate.is_relative_to(root):
            response = FileResponse(candidate)
            if candidate.name == "sw.js" or candidate.name.startswith("workbox-"):
                response.headers["Cache-Control"] = "no-cache"
            return response
        index = STATIC_DIR / "index.html"
        if index.exists():
            response = FileResponse(index)
            response.headers["Cache-Control"] = "no-cache"
            return response
    return JSONResponse({
        "app": APP_NAME,
        "version": VERSION,
        "message": "Backend is running. Start the frontend dev server with npm run dev, or build it with npm run build.",
        "docs": "/docs",
    })
