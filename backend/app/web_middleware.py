import base64
import os
import secrets
from typing import Optional

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .config import CORS_ORIGINS, PUBLIC_URL, SESSION_COOKIE, auth_required
from .database import SessionLocal, current_user_id, reset_current_user, set_current_user
from .models import User
from .services.auth import ensure_local_user, local_user_id, resolve_session

PUBLIC_API_PATHS = {
    "/api/health",
    "/api/auth/status",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/password-reset/request",
    "/api/auth/password-reset/confirm",
}
OPTIONAL_LOCAL_PATHS = {"/api/auth/status"}
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def _allowed_origins(scope) -> set[str]:
    origins = {origin.rstrip("/").lower() for origin in CORS_ORIGINS if origin.strip()}
    if PUBLIC_URL:
        origins.add(PUBLIC_URL.rstrip("/").lower())
    headers = {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in scope.get("headers", [])}
    host = headers.get("x-forwarded-host") or headers.get("host", "")
    proto = headers.get("x-forwarded-proto") or scope.get("scheme", "http")
    if host:
        origins.add(f"{proto}://{host}".rstrip("/").lower())
    return origins


def _same_origin(scope) -> bool:
    headers = {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in scope.get("headers", [])}
    origin = headers.get("origin", "").strip()
    if not origin:
        return True
    if origin == "null":
        return False
    return origin.rstrip("/").lower() in _allowed_origins(scope)


def _basic_credentials(header: str) -> Optional[tuple[str, str]]:
    if not header.startswith("Basic "):
        return None
    try:
        decoded = base64.b64decode(header[6:], validate=True).decode("utf-8")
        username, separator, password = decoded.partition(":")
        if separator:
            return username, password
    except (ValueError, UnicodeDecodeError):
        pass
    return None


class AuthMiddleware:
    """Session-cookie authentication with an optional legacy HTTP Basic gate.

    Static files and the SPA shell stay public so the login screen can render.
    Only API routes are protected.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        method = scope.get("method", "GET")
        if path.startswith("/api/") and method not in SAFE_METHODS and not _same_origin(scope):
            response = JSONResponse(
                {"detail": "Cross-site request blocked. Use the app from its configured origin."},
                status_code=403,
            )
            await response(scope, receive, send)
            return
        if not path.startswith("/api/") or method == "OPTIONS" or path in PUBLIC_API_PATHS:
            await self._pass_through(scope, receive, send, resolve_user=True)
            return

        request = Request(scope)
        auth_mode = auth_required()
        web_password = os.environ.get("AEC_WEB_PASSWORD", "")
        web_user = os.environ.get("AEC_WEB_USER", "student")

        token = request.cookies.get(SESSION_COOKIE, "")
        db = SessionLocal()
        user: Optional[User] = None
        try:
            session = resolve_session(db, token)
            if session:
                user = db.get(User, session.user_id)
            if not user and web_password and not auth_mode:
                supplied = _basic_credentials(request.headers.get("authorization", ""))
                if supplied and secrets.compare_digest(supplied[0], web_user) and secrets.compare_digest(supplied[1], web_password):
                    ensure_local_user(db)
                    local_id = local_user_id(db)
                    user = db.get(User, local_id) if local_id else None
            if not user and not auth_mode and not web_password:
                ensure_local_user(db)
                local_id = local_user_id(db)
                user = db.get(User, local_id) if local_id else None
        finally:
            db.close()

        if user is None:
            headers = {}
            if web_password and not auth_mode:
                headers["WWW-Authenticate"] = 'Basic realm="AI Engineering Companion", charset="UTF-8"'
            response = JSONResponse(
                {"detail": "Authentication required. Sign in to continue.", "auth_required": auth_mode},
                status_code=401,
                headers=headers,
            )
            await response(scope, receive, send)
            return

        scope.setdefault("state", {})["user_id"] = user.id
        scope.setdefault("state", {})["user"] = user
        token_context = set_current_user(user.id)
        try:
            await self.app(scope, receive, send)
        finally:
            reset_current_user(token_context)

    async def _pass_through(self, scope, receive, send, resolve_user: bool = False):
        user_id = None
        if resolve_user:
            request = Request(scope)
            token = request.cookies.get(SESSION_COOKIE, "")
            if token:
                db = SessionLocal()
                try:
                    session = resolve_session(db, token)
                    if session:
                        user_id = session.user_id
                finally:
                    db.close()
            if user_id is None and not auth_required() and scope.get("path") in OPTIONAL_LOCAL_PATHS:
                db = SessionLocal()
                try:
                    ensure_local_user(db)
                    user_id = local_user_id(db)
                finally:
                    db.close()
        if user_id is not None:
            scope.setdefault("state", {})["user_id"] = user_id
            token_context = set_current_user(user_id)
            try:
                await self.app(scope, receive, send)
            finally:
                reset_current_user(token_context)
            return
        await self.app(scope, receive, send)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; "
            "media-src 'self' blob:; worker-src 'self' blob:; manifest-src 'self'; "
            "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
        )
        forwarded = request.headers.get("x-forwarded-proto", request.url.scheme)
        if forwarded == "https":
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response
