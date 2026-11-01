import base64
import hashlib
import hmac
import os
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from datetime import timedelta
from typing import Optional

from sqlalchemy.orm import Session

from ..config import auth_required, registration_mode, SESSION_DAYS
from ..database import claim_legacy_data, current_user_id
from ..models import PasswordResetToken, Preference, Secret, User, UserSession, utcnow

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1
LOGIN_WINDOW_SECONDS = 15 * 60
LOGIN_MAX_FAILURES = 10
_failures: dict[str, deque] = defaultdict(deque)
_failures_lock = threading.Lock()


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def valid_email(email: str) -> bool:
    return bool(EMAIL_RE.match(email)) and len(email) <= 320


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return "scrypt${}${}${}${}${}".format(
        SCRYPT_N,
        SCRYPT_R,
        SCRYPT_P,
        base64.b64encode(salt).decode("ascii"),
        base64.b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, encoded: str) -> bool:
    if not encoded or not encoded.startswith("scrypt$"):
        return False
    try:
        _, n, r, p, salt_b64, hash_b64 = encoded.split("$", 5)
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(hash_b64)
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def migrate_legacy_scoped_keys(db: Session, user_id: int) -> None:
    prefix = f"u{user_id}:"
    for model in (Preference, Secret):
        rows = db.query(model).filter(model.user_id == user_id).all()
        for row in rows:
            if row.key.startswith(prefix):
                continue
            logical = row.key
            if logical.startswith("u") and ":" in logical:
                continue
            new_key = f"{prefix}{logical}"
            existing = db.get(model, new_key)
            if existing:
                db.delete(row)
            else:
                row.key = new_key
    db.commit()


def ensure_local_user(db: Session, claim_legacy: bool = False) -> User:
    user = db.query(User).filter(User.is_local.is_(True)).first()
    if not user:
        user = User(email="local@device.invalid", name="Engineer", is_local=True)
        db.add(user)
        db.commit()
        db.refresh(user)
    if claim_legacy:
        claim_legacy_data(user.id)
        migrate_legacy_scoped_keys(db, user.id)
    return user


def local_user_id(db: Session) -> Optional[int]:
    user = db.query(User).filter(User.is_local.is_(True)).first()
    return user.id if user else None


def registration_allowed(db: Session) -> bool:
    mode = registration_mode()
    if mode in {"0", "false", "no", "off"}:
        return False
    if mode in {"1", "true", "yes", "on"}:
        return True
    return db.query(User).filter(User.is_local.is_(False)).count() == 0


def create_user(db: Session, email: str, password: str, name: str = "Engineer") -> User:
    email = normalize_email(email)
    if not registration_allowed(db):
        raise ValueError("Registration is closed. Contact the administrator for an account.")
    if not valid_email(email):
        raise ValueError("Enter a valid email address.")
    if len(password or "") < 8:
        raise ValueError("Password must be at least 8 characters.")
    if db.query(User).filter(User.email == email).first():
        raise ValueError("An account with this email already exists.")
    first_remote = db.query(User).filter(User.is_local.is_(False)).count() == 0
    user = User(
        email=email,
        name=(name or "Engineer").strip()[:200] or "Engineer",
        password_hash=hash_password(password),
        is_local=False,
        password_changed_at=utcnow(),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    if first_remote:
        claim_legacy_data(user.id)
        migrate_legacy_scoped_keys(db, user.id)
    return user


def authenticate(db: Session, email: str, password: str) -> Optional[User]:
    user = db.query(User).filter(User.email == normalize_email(email), User.is_local.is_(False)).first()
    if not user:
        verify_password(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
        return None
    if not verify_password(password, user.password_hash):
        return None
    user.last_login_at = utcnow()
    db.commit()
    return user


def login_throttled(key: str) -> bool:
    now = time.time()
    with _failures_lock:
        bucket = _failures[key]
        while bucket and now - bucket[0] > LOGIN_WINDOW_SECONDS:
            bucket.popleft()
        return len(bucket) >= LOGIN_MAX_FAILURES


def record_login_failure(key: str) -> None:
    with _failures_lock:
        _failures[key].append(time.time())


def clear_login_failures(key: str) -> None:
    with _failures_lock:
        _failures.pop(key, None)


def create_session(db: Session, user: User, user_agent: str = "", ip_address: str = "") -> str:
    token = secrets.token_urlsafe(32)
    expires = utcnow() + timedelta(days=max(1, SESSION_DAYS))
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=_token_hash(token),
            expires_at=expires,
            user_agent=(user_agent or "")[:300],
            ip_address=(ip_address or "")[:80],
        )
    )
    db.query(UserSession).filter(UserSession.expires_at < utcnow()).delete(synchronize_session=False)
    db.commit()
    return token


def resolve_session(db: Session, token: str) -> Optional[UserSession]:
    if not token:
        return None
    row = db.query(UserSession).filter(UserSession.token_hash == _token_hash(token)).first()
    if not row:
        return None
    if row.expires_at < utcnow():
        db.delete(row)
        db.commit()
        return None
    if row.last_seen_at is None or (utcnow() - row.last_seen_at).total_seconds() > 300:
        row.last_seen_at = utcnow()
        db.commit()
    return row


def delete_session(db: Session, token: str) -> None:
    if not token:
        return
    db.query(UserSession).filter(UserSession.token_hash == _token_hash(token)).delete(synchronize_session=False)
    db.commit()


def delete_other_sessions(db: Session, user_id: int, keep_token: str = "") -> None:
    query = db.query(UserSession).filter(UserSession.user_id == user_id)
    if keep_token:
        query = query.filter(UserSession.token_hash != _token_hash(keep_token))
    query.delete(synchronize_session=False)
    db.commit()


def current_user(db: Session) -> Optional[User]:
    uid = current_user_id.get()
    if uid is None:
        return None
    return db.get(User, uid)


def user_dict(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "is_local": bool(user.is_local),
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "password_reset_available": True,
    }


def create_reset_token(db: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    db.add(
        PasswordResetToken(
            user_id=user.id,
            token_hash=_token_hash(token),
            expires_at=utcnow() + timedelta(minutes=30),
        )
    )
    db.query(PasswordResetToken).filter(PasswordResetToken.expires_at < utcnow()).delete(synchronize_session=False)
    db.commit()
    return token


def consume_reset_token(db: Session, token: str, password: str) -> User:
    if len(password or "") < 8:
        raise ValueError("Password must be at least 8 characters.")
    row = db.query(PasswordResetToken).filter(PasswordResetToken.token_hash == _token_hash(token)).first()
    if not row or row.used_at is not None or row.expires_at < utcnow():
        raise ValueError("This reset link is invalid or has expired.")
    user = db.get(User, row.user_id)
    if not user:
        raise ValueError("This reset link is invalid or has expired.")
    user.password_hash = hash_password(password)
    user.password_changed_at = utcnow()
    row.used_at = utcnow()
    db.query(UserSession).filter(UserSession.user_id == user.id).delete(synchronize_session=False)
    db.commit()
    return user


def change_password(db: Session, user: User, current: str, new: str) -> None:
    if not user.is_local and not verify_password(current, user.password_hash):
        raise ValueError("Current password is incorrect.")
    if len(new or "") < 8:
        raise ValueError("New password must be at least 8 characters.")
    user.password_hash = hash_password(new)
    user.password_changed_at = utcnow()
    db.commit()


def smtp_configured() -> bool:
    from ..config import SMTP_HOST

    return bool(SMTP_HOST)


def auth_mode_dict() -> dict:
    return {"require_auth": auth_required(), "registration": registration_mode()}
