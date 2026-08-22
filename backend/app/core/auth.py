"""Login sessions: password hashing, the session cookie's JWT, and the
role-gate dependency admin routes use instead of (or alongside) require_api_key.

Cookie, not a bearer header returned to the caller to store: it's what lets the
Next.js server-side proxy (frontend's fix for NEXT_PUBLIC_API_KEY being public)
forward a session without the browser ever holding a long-lived secret.
"""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Cookie, Depends, HTTPException

from app.core.config import JWT_SECRET_KEY
from app.data.database import get_user_by_id

COOKIE_NAME = "session"
SESSION_HOURS = 12
_PBKDF2_ITERATIONS = 390_000  # OWASP's 2024 minimum for PBKDF2-HMAC-SHA256


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), _PBKDF2_ITERATIONS)
    return digest.hex(), salt


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    candidate, _ = hash_password(password, salt)
    return secrets.compare_digest(candidate, password_hash)


def create_session_token(user_id: int, email: str, role: str) -> str:
    if not JWT_SECRET_KEY:
        raise RuntimeError("JWT_SECRET_KEY (or API_SECRET_KEY) is not configured.")
    payload = {
        "sub": str(user_id),
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm="HS256")


def decode_session_token(token: str) -> dict | None:
    if not JWT_SECRET_KEY:
        return None
    try:
        return jwt.decode(token, JWT_SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


def get_current_user(session: str | None = Cookie(default=None)) -> dict | None:
    """None, not a 401 — /auth/me turns None into 401 itself; role gates below
    treat None as "not logged in" without forcing every caller to catch."""
    if not session:
        return None
    return decode_session_token(session)


def require_role(*roles: str):
    """FastAPI dependency: 401 with no/invalid session, 403 if logged in but
    the wrong role. Usage: Depends(require_role("developer")).

    Re-checks the role (and existence) against the `users` table rather than
    trusting the JWT's `role` claim alone: the claim is a snapshot taken at
    login and doesn't see a role change or account deletion until the 12h
    session expires otherwise. None of this dependency's callers are on the
    latency-sensitive /run-agent path, so the extra query is fine here."""

    def _check(user: dict | None = Depends(get_current_user)) -> dict:
        if user is None:
            raise HTTPException(status_code=401, detail="Login required.")

        current = get_user_by_id(int(user["sub"]))
        if current is None:
            raise HTTPException(status_code=401, detail="Account no longer exists.")
        current_role = current[2]
        if current_role not in roles:
            raise HTTPException(status_code=403, detail="Your account does not have access to this.")

        return {**user, "role": current_role}

    return _check
