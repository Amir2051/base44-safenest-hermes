"""Independent SafeNestT email/password authentication backed by PostgreSQL.

This module intentionally does not modify or import Base44. It is an auth slice;
case-level authorization and frontend cutover remain separate migration steps.
"""
from __future__ import annotations

import hashlib
import json
import hmac
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

try:
    import asyncpg
except ImportError:  # The liveness endpoint and unit tests can run without DB extras installed.
    asyncpg = None  # type: ignore[assignment]
from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])
SESSION_COOKIE = "safenestt_session"
SESSION_DAYS = 7
PROFILE_ALIASES = {"full_name": "display_name", "profile_image": "avatar_url"}
PROFILE_FIELDS = {
    "display_name", "phone", "company", "job_title", "title", "bio", "website",
    "avatar_url", "timezone", "locale", "theme", "onboarding_completed",
    "onboarding_step", "chat_notifications_enabled", "email_notifications_enabled",
    "vpn_enabled", "profile_completed", "profile_completion_dismissed",
}
LOGIN_WINDOW_MINUTES = 15
LOGIN_EMAIL_ATTEMPTS = 8
LOGIN_IP_ATTEMPTS = 30
PBKDF2_ITERATIONS = 600_000
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
_pool: asyncpg.Pool | None = None


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=12, max_length=256)


class RegisterPayload(Credentials):
    display_name: str = Field(min_length=1, max_length=120)


class LoginPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


def normalize_email(value: str) -> str:
    email = value.strip().lower()
    if len(email) > 254 or not EMAIL_RE.fullmatch(email):
        raise HTTPException(status_code=422, detail="Enter a valid email address")
    return email


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    """PBKDF2-SHA256 hash with a unique random salt; output is versioned."""
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations_int = int(iterations)
        if iterations_int < 100_000 or iterations_int > 2_000_000:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), iterations_int)
        return hmac.compare_digest(actual.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def _session_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _consume_rate_limit(pool: asyncpg.Pool, key: str, maximum: int) -> None:
    """Atomically consume a fixed-window rate-limit bucket without storing raw keys."""
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    attempts = await pool.fetchval(
        """INSERT INTO auth_rate_limits (key_hash, window_started_at, attempts, updated_at)
           VALUES ($1, now(), 1, now())
           ON CONFLICT (key_hash) DO UPDATE SET
             attempts = CASE
               WHEN auth_rate_limits.window_started_at < now() - ($2 * interval '1 minute') THEN 1
               ELSE auth_rate_limits.attempts + 1
             END,
             window_started_at = CASE
               WHEN auth_rate_limits.window_started_at < now() - ($2 * interval '1 minute') THEN now()
               ELSE auth_rate_limits.window_started_at
             END,
             updated_at = now()
           RETURNING attempts""",
        key_hash, LOGIN_WINDOW_MINUTES,
    )
    if attempts > maximum:
        raise HTTPException(429, detail="Too many login attempts. Try again in 15 minutes.", headers={"Retry-After": str(LOGIN_WINDOW_MINUTES * 60)})


def _csrf_secret() -> bytes:
    secret = os.getenv("AUTH_CSRF_SECRET", "").strip()
    if len(secret) < 32:
        raise HTTPException(status_code=503, detail="Authentication is not configured")
    return secret.encode()


def _csrf_for_session(raw_session: str) -> str:
    return hmac.new(_csrf_secret(), raw_session.encode(), hashlib.sha256).hexdigest()


def _database_url() -> str:
    value = os.getenv("DATABASE_URL", "").strip()
    if not value:
        raise HTTPException(status_code=503, detail="Authentication database is not configured")
    return value


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if asyncpg is None:
            raise HTTPException(status_code=503, detail="Authentication database driver is not installed")
        try:
            _pool = await asyncpg.create_pool(
                dsn=_database_url(), min_size=1, max_size=int(os.getenv("AUTH_DB_POOL_MAX", "10")),
                command_timeout=10,
            )
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=503, detail="Authentication database is unavailable") from None
    return _pool


def _cookie_secure() -> bool:
    return os.getenv("AUTH_COOKIE_SECURE", "true").strip().lower() not in {"0", "false", "no"}


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE, value=token, httponly=True, secure=_cookie_secure(),
        samesite="strict", max_age=SESSION_DAYS * 24 * 60 * 60, path="/",
    )


def _normalize_profile_updates(values: dict[str, Any]) -> dict[str, Any]:
    """Translate legacy frontend profile names to canonical safe profile fields."""
    normalized: dict[str, Any] = {}
    for key, value in values.items():
        canonical = PROFILE_ALIASES.get(key, key)
        if canonical in normalized:
            raise HTTPException(status_code=422, detail="Duplicate profile fields were supplied")
        normalized[canonical] = value
    return normalized


def _public_user(row: Any) -> dict[str, Any]:
    profile = row.get("profile", {})
    # asyncpg returns JSON/JSONB as text unless a custom codec is registered.
    if isinstance(profile, str):
        try:
            profile = json.loads(profile)
        except (ValueError, TypeError):
            profile = {}
    if not isinstance(profile, dict):
        profile = {}
    display_name = row["display_name"]
    avatar_url = profile.get("avatar_url")
    return {
        "id": str(row["id"]), "email": row["email"],
        "display_name": display_name,
        # Preserve the legacy Base44 user shape while the frontend migration is staged.
        "full_name": display_name,
        "profile_image": avatar_url,
        "role": row["role"],
        "email_verified": bool(row["email_verified"]),
        "created_at": row["created_at"].isoformat() if row["created_at"] else None,
        **profile,
        # Canonical stored fields win; aliases are response-only compatibility fields.
        "full_name": display_name,
        "profile_image": avatar_url,
    }


def _check_origin(request: Request) -> None:
    """Reject browser Origin headers unless explicitly allow-listed."""
    origin = request.headers.get("origin")
    if not origin:
        return  # non-browser clients; cookie-authenticated writes still require CSRF
    allowed = {item.strip().rstrip("/") for item in os.getenv("AUTH_ALLOWED_ORIGINS", "").split(",") if item.strip()}
    if not allowed or origin.rstrip("/") not in allowed:
        raise HTTPException(status_code=403, detail="Origin is not allowed")


async def _new_session(pool: asyncpg.Pool, user_id: Any) -> tuple[str, str]:
    token = secrets.token_urlsafe(32)
    csrf = _csrf_for_session(token)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    await pool.execute(
        "INSERT INTO auth_sessions (user_id, token_hash, expires_at, created_at) VALUES ($1, $2, $3, now())",
        user_id, _session_hash(token), expires_at,
    )
    return token, csrf


async def current_user(
    safenestt_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict[str, Any]:
    if not safenestt_session:
        raise HTTPException(status_code=401, detail="Authentication required")
    pool = await get_pool()
    try:
        row = await pool.fetchrow(
            """SELECT u.id, u.email, u.display_name, u.role, u.email_verified, u.created_at, u.profile
               FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
               WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active = true""",
            _session_hash(safenestt_session),
        )
    except Exception:
        raise HTTPException(status_code=503, detail="Authentication database is unavailable") from None
    if row is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return _public_user(row)


def require_csrf(
    request: Request,
    safenestt_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    csrf_header: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> None:
    _check_origin(request)
    if not safenestt_session or not csrf_header:
        raise HTTPException(status_code=403, detail="CSRF validation failed")
    try:
        expected = _csrf_for_session(safenestt_session)
    except HTTPException:
        raise
    if not hmac.compare_digest(expected, csrf_header):
        raise HTTPException(status_code=403, detail="CSRF validation failed")


@router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(payload: RegisterPayload, request: Request, response: Response) -> dict[str, Any]:
    _check_origin(request)
    email = normalize_email(payload.email)
    display_name = payload.display_name.strip()
    if not display_name:
        raise HTTPException(status_code=422, detail="Display name must not be blank")
    pool = await get_pool()
    encoded = hash_password(payload.password)
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """INSERT INTO auth_users (email, password_hash, display_name, role, is_active, email_verified, created_at)
                       VALUES ($1, $2, $3, 'investigator', true, false, now())
                       RETURNING id, email, display_name, role, email_verified, created_at, profile""",
                    email, encoded, display_name,
                )
                token, csrf = await _new_session(conn, row["id"])
    except HTTPException:
        raise
    except Exception as exc:
        if getattr(exc, "sqlstate", None) == "23505":
            raise HTTPException(status_code=409, detail="An account with this email already exists") from None
        raise HTTPException(status_code=503, detail="Could not create account") from None
    _set_session_cookie(response, token)
    return {"user": _public_user(row), "csrf_token": csrf}


@router.post("/login")
async def login(payload: LoginPayload, request: Request, response: Response) -> dict[str, Any]:
    _check_origin(request)
    email = normalize_email(payload.email)
    pool = await get_pool()
    client_ip = request.client.host if request.client else "unknown"
    try:
        await _consume_rate_limit(pool, f"email:{email}", LOGIN_EMAIL_ATTEMPTS)
        await _consume_rate_limit(pool, f"ip:{client_ip}", LOGIN_IP_ATTEMPTS)
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, email, display_name, role, email_verified, created_at, password_hash, is_active, profile FROM auth_users WHERE email = $1",
                email,
            )
            # Use a dummy hash to reduce email-enumeration timing differences for absent users.
            dummy = "pbkdf2_sha256$600000$00112233445566778899aabbccddeeff$" + ("0" * 64)
            valid = verify_password(payload.password, row["password_hash"] if row else dummy)
            if not row or not valid or not row["is_active"]:
                raise HTTPException(status_code=401, detail="Invalid email or password")
            token, csrf = await _new_session(conn, row["id"])
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="Authentication database is unavailable") from None
    _set_session_cookie(response, token)
    return {"user": _public_user(row), "csrf_token": csrf}


@router.get("/me")
async def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    return {"user": user}


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    values: dict[str, Any] = Field(min_length=1, max_length=40)


@router.patch("/me", dependencies=[Depends(require_csrf)])
async def update_me(payload: ProfileUpdate, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    updates = _normalize_profile_updates(payload.values)
    forbidden = set(updates) - PROFILE_FIELDS
    if forbidden:
        raise HTTPException(status_code=422, detail="One or more profile fields cannot be changed through this endpoint")
    if "display_name" in updates:
        if not isinstance(updates["display_name"], str) or not updates["display_name"].strip() or len(updates["display_name"]) > 120:
            raise HTTPException(status_code=422, detail="Display name must be 1–120 characters")
        updates["display_name"] = updates["display_name"].strip()
    for key, value in updates.items():
        if key.endswith("_enabled") or key in {"onboarding_completed", "profile_completed", "profile_completion_dismissed"}:
            if not isinstance(value, bool):
                raise HTTPException(status_code=422, detail=f"{key} must be a boolean")
        elif key == "onboarding_step":
            if not isinstance(value, (str, int)) or isinstance(value, bool):
                raise HTTPException(status_code=422, detail="onboarding_step must be text or an integer")
        elif not isinstance(value, str) or len(value) > 2000:
            raise HTTPException(status_code=422, detail=f"{key} must be text up to 2000 characters")
    pool = await get_pool()
    try:
        row = await pool.fetchrow(
            """UPDATE auth_users SET display_name = CASE WHEN $2::boolean THEN $3 ELSE display_name END,
                 profile = profile || $4::jsonb, updated_at = now()
               WHERE id = $1 RETURNING id, email, display_name, role, email_verified, created_at, profile""",
            user["id"], "display_name" in updates, updates.get("display_name", ""),
            __import__("json").dumps({k: v for k, v in updates.items() if k != "display_name"}),
        )
    except Exception:
        raise HTTPException(status_code=503, detail="Could not update profile") from None
    if row is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return {"user": _public_user(row)}


@router.get("/csrf")
async def csrf_token(
    safenestt_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, str]:
    assert user  # current_user validates the session against PostgreSQL
    return {"csrf_token": _csrf_for_session(safenestt_session or "")}


@router.post("/logout", dependencies=[Depends(require_csrf)])
async def logout(
    response: Response,
    safenestt_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict[str, str]:
    if safenestt_session:
        pool = await get_pool()
        await pool.execute("DELETE FROM auth_sessions WHERE token_hash = $1", _session_hash(safenestt_session))
    response.delete_cookie(key=SESSION_COOKIE, path="/", secure=_cookie_secure(), httponly=True, samesite="strict")
    return {"status": "logged_out"}


@router.post("/refresh", dependencies=[Depends(require_csrf)])
async def refresh(
    request: Request,
    response: Response,
    safenestt_session: str | None = Cookie(default=None, alias=SESSION_COOKIE),
    user: dict[str, Any] = Depends(current_user),
) -> dict[str, Any]:
    _check_origin(request)
    assert safenestt_session
    pool = await get_pool()
    new_token = secrets.token_urlsafe(32)
    new_csrf = _csrf_for_session(new_token)
    expires_at = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
    result = await pool.execute(
        "UPDATE auth_sessions SET token_hash = $1, expires_at = $2, last_used_at = now() WHERE token_hash = $3",
        _session_hash(new_token), expires_at, _session_hash(safenestt_session),
    )
    if result != "UPDATE 1":
        raise HTTPException(status_code=401, detail="Authentication required")
    _set_session_cookie(response, new_token)
    return {"user": user, "csrf_token": new_csrf}
