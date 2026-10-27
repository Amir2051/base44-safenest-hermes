"""Private, service-to-service Hermes API adapter for SafeNestT migration.

This is an isolated migration slice, not yet the public SafeNestT API. It does
not expose a browser-safe token, read/write SafeNestT case data, or replace the
application's user authentication. Keep it on a private network until the
independent user-auth and case-authorization layer is implemented.
"""
from __future__ import annotations

import hmac
import os
from typing import Any
from urllib.parse import quote

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .auth import router as auth_router
from .cases import router as cases_router

app = FastAPI(
    title="SafeNestT Custom Backend — Hermes Adapter",
    version="0.1.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


class Target(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: str = Field(min_length=1, max_length=40)
    value: str = Field(min_length=1, max_length=500)

    @field_validator("type", "value")
    @classmethod
    def trim_nonempty(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


class InvestigationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: Target
    investigation_type: str = Field(default="web", min_length=1, max_length=80)
    # This is metadata only in this adapter. It does NOT prove that the caller
    # owns a SafeNestT case; user/case authorization is a later migration gate.
    case_id: str | None = Field(default=None, max_length=200)

    @field_validator("investigation_type")
    @classmethod
    def trim_type(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value


def _configured_token() -> str:
    return os.getenv("CUSTOM_BACKEND_SERVICE_TOKEN", "").strip()


def require_service_token(authorization: str | None = Header(default=None)) -> None:
    """Fail closed unless a private service token is configured and supplied."""
    expected = _configured_token()
    if not expected:
        raise HTTPException(status_code=503, detail="Service authentication is not configured")
    scheme, _, supplied = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")


def _hermes_config() -> tuple[str, str]:
    base_url = os.getenv("HERMES_BASE_URL", "").strip().rstrip("/")
    api_key = os.getenv("HERMES_API_KEY", "").strip()
    if not base_url or not api_key:
        raise HTTPException(status_code=503, detail="Hermes integration is not configured")
    if not base_url.startswith("https://") and not (
        base_url.startswith("http://127.0.0.1") or base_url.startswith("http://localhost")
    ):
        raise HTTPException(status_code=503, detail="Hermes URL must use HTTPS outside localhost")
    return base_url, api_key


async def _hermes_request(method: str, path: str, *, payload: dict[str, Any] | None = None) -> Any:
    base_url, api_key = _hermes_config()
    url = f"{base_url}{path}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
            response = await client.request(
                method,
                url,
                headers={"X-API-Key": api_key, "Accept": "application/json"},
                json=payload,
            )
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Hermes request timed out") from None
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Hermes service is unavailable") from None

    if response.status_code >= 400:
        # Do not forward upstream internals, stack traces, or credentials to callers.
        mapped = response.status_code if response.status_code in {400, 401, 403, 404, 409, 422, 429} else 502
        raise HTTPException(status_code=mapped, detail="Hermes request failed")
    try:
        return response.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Hermes returned an invalid response") from None


app.include_router(auth_router)
app.include_router(cases_router)


@app.get("/health")
async def health() -> dict[str, str]:
    """Liveness only; intentionally does not expose model/provider or secret state."""
    return {"status": "ok", "service": "safenestt-custom-backend-hermes-adapter"}


@app.get("/api/v1/hermes/health", dependencies=[Depends(require_service_token)])
async def hermes_health() -> dict[str, Any]:
    return await _hermes_request("GET", "/v1/health")


@app.post("/api/v1/investigations", dependencies=[Depends(require_service_token)])
async def create_investigation(payload: InvestigationCreate) -> dict[str, Any]:
    upstream_payload = {
        "target": {"type": payload.target.type, "value": payload.target.value},
        "investigation_type": payload.investigation_type,
        "case_id": payload.case_id,
    }
    return await _hermes_request("POST", "/v1/investigations", payload=upstream_payload)


@app.post("/api/v1/investigations/{investigation_id}/start", dependencies=[Depends(require_service_token)])
async def start_investigation(investigation_id: str) -> dict[str, Any]:
    safe_id = quote(investigation_id, safe="")
    # Always return promptly; callers poll status instead of holding an HTTP
    # request open for the full investigation runtime.
    return await _hermes_request("POST", f"/v1/investigations/{safe_id}/start?wait=false")


@app.get("/api/v1/investigations/{investigation_id}", dependencies=[Depends(require_service_token)])
async def get_investigation(investigation_id: str) -> dict[str, Any]:
    return await _hermes_request("GET", f"/v1/investigations/{quote(investigation_id, safe='')}")


@app.get("/api/v1/investigations/{investigation_id}/evidence", dependencies=[Depends(require_service_token)])
async def get_evidence(investigation_id: str) -> list[dict[str, Any]]:
    return await _hermes_request("GET", f"/v1/investigations/{quote(investigation_id, safe='')}/evidence")


@app.get("/api/v1/investigations/{investigation_id}/findings", dependencies=[Depends(require_service_token)])
async def get_findings(investigation_id: str) -> list[dict[str, Any]]:
    return await _hermes_request("GET", f"/v1/investigations/{quote(investigation_id, safe='')}/findings")


@app.get("/api/v1/investigations/{investigation_id}/report", dependencies=[Depends(require_service_token)])
async def get_report(investigation_id: str) -> dict[str, Any]:
    return await _hermes_request("GET", f"/v1/investigations/{quote(investigation_id, safe='')}/report")
