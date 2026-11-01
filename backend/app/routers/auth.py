from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import (
    COOKIE_SECURE,
    ENV_AI_KEYS,
    ENV_KEYS_ONLY,
    PUBLIC_URL,
    SESSION_COOKIE,
    SESSION_DAYS,
    SMTP_HOST,
    auth_required,
)
from ..database import get_db
from ..models import User
from ..services.auth import (
    authenticate,
    change_password,
    clear_login_failures,
    consume_reset_token,
    create_reset_token,
    create_session,
    create_user,
    current_user,
    delete_other_sessions,
    delete_session,
    login_throttled,
    record_login_failure,
    registration_allowed,
    user_dict,
)
from ..services.email import send_password_reset

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    name: str = Field(default="Engineer", max_length=200)
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=8, max_length=200)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=200)


class ProfileUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)


class PasswordChange(BaseModel):
    current_password: str = ""
    new_password: str = Field(min_length=8, max_length=200)


class ResetRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class ResetConfirm(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    new_password: str = Field(min_length=8, max_length=200)


def _cookie_secure(request: Request) -> bool:
    if COOKIE_SECURE in {"1", "true", "yes", "on"}:
        return True
    if COOKIE_SECURE in {"0", "false", "no", "off"}:
        return False
    forwarded = request.headers.get("x-forwarded-proto", request.url.scheme)
    return forwarded == "https"


def _set_session_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 3600,
        httponly=True,
        secure=_cookie_secure(request),
        samesite="lax",
        path="/",
    )


def _status_payload(db: Session, request: Request) -> dict:
    user = current_user(db)
    return {
        "auth_required": auth_required(),
        "registration_allowed": registration_allowed(db),
        "smtp_configured": bool(SMTP_HOST),
        "env_keys_only": ENV_KEYS_ONLY,
        "provider_keys": {name: bool(value) for name, value in ENV_AI_KEYS.items()},
        "user": user_dict(user) if user else None,
    }


@router.get("/status")
def status(request: Request, db: Session = Depends(get_db)):
    return _status_payload(db, request)


@router.post("/register")
def register(payload: RegisterRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    try:
        user = create_user(db, payload.email, payload.password, payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    token = create_session(
        db,
        user,
        user_agent=request.headers.get("user-agent", ""),
        ip_address=request.client.host if request.client else "",
    )
    _set_session_cookie(response, request, token)
    return {"ok": True, "user": user_dict(user)}


@router.post("/login")
def login(payload: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    key = f"{request.client.host if request.client else 'unknown'}:{payload.email.strip().lower()}"
    if login_throttled(key):
        raise HTTPException(status_code=429, detail="Too many failed sign-in attempts. Try again in 15 minutes.")
    user = authenticate(db, payload.email, payload.password)
    if not user:
        record_login_failure(key)
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    clear_login_failures(key)
    token = create_session(
        db,
        user,
        user_agent=request.headers.get("user-agent", ""),
        ip_address=request.client.host if request.client else "",
    )
    _set_session_cookie(response, request, token)
    return {"ok": True, "user": user_dict(user)}


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    delete_session(db, request.cookies.get(SESSION_COOKIE, ""))
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(db: Session = Depends(get_db)):
    user = current_user(db)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    return user_dict(user)


@router.patch("/profile")
def update_profile(payload: ProfileUpdate, db: Session = Depends(get_db)):
    user = current_user(db)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    if payload.name is not None:
        user.name = payload.name.strip()[:200] or user.name
    db.commit()
    return user_dict(user)


@router.post("/password")
def update_password(payload: PasswordChange, request: Request, db: Session = Depends(get_db)):
    user = current_user(db)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required.")
    try:
        change_password(db, user, payload.current_password, payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    token = request.cookies.get(SESSION_COOKIE, "")
    delete_other_sessions(db, user.id, keep_token=token)
    return {"ok": True, "message": "Password updated. Other sessions were signed out."}


@router.post("/password-reset/request")
def request_password_reset(payload: ResetRequest, background: BackgroundTasks, db: Session = Depends(get_db)):
    if not SMTP_HOST:
        raise HTTPException(
            status_code=503,
            detail="Password reset email is not configured on this server. Ask the administrator to set SMTP settings.",
        )
    email = payload.email.strip().lower()
    user = db.query(User).filter(User.email == email, User.is_local.is_(False)).first()
    if user:
        token = create_reset_token(db, user)
        base = PUBLIC_URL or "http://localhost:5173"
        reset_url = f"{base}/reset-password?token={token}"
        background.add_task(send_password_reset, user.email, reset_url)
    return {"ok": True, "message": "If that email has an account, a reset link has been sent."}


@router.post("/password-reset/confirm")
def confirm_password_reset(payload: ResetConfirm, db: Session = Depends(get_db)):
    try:
        consume_reset_token(db, payload.token, payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "message": "Password updated. Sign in with your new password."}
