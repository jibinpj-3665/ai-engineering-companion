import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .config import APP_NAME, LOG_DIR, STATIC_DIR, VERSION, ensure_directories
from .database import init_db
from .routers import ai, analytics, documents, labs, planner, quizzes, revision, settings, subjects, syllabus, teaching

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
    logger.info("Backend started")
    yield
    logger.info("Backend stopped")


app = FastAPI(title=APP_NAME, version=VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_routers = [
    subjects.router,
    documents.router,
    syllabus.router,
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
        candidate = (STATIC_DIR / full_path).resolve()
        if full_path and candidate.is_file() and str(candidate).startswith(str(STATIC_DIR.resolve())):
            return FileResponse(candidate)
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(index)
    return JSONResponse({
        "app": APP_NAME,
        "version": VERSION,
        "message": "Backend is running. Start the frontend dev server with npm run dev, or build it with npm run build.",
        "docs": "/docs",
    })
