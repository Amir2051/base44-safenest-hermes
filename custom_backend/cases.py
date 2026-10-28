"""Owner-scoped initial case API for the Base44 migration.

This intentionally supports only MyCase and InvestigationCase. Every query is
scoped to the authenticated user's server-validated identity; client-supplied
owner IDs are overwritten on create and rejected on update. Historical records
must be reconciled before importing them into this model.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .auth import current_user, get_pool, require_csrf

router = APIRouter(prefix="/api/v1/entities", tags=["case records"])
SUPPORTED_ENTITIES = {"MyCase", "InvestigationCase"}
OWNER_FIELDS = {"user_id", "created_by", "created_by_email", "owner_user_id"}
SORT_FIELDS = {
    "created_date": "created_at",
    "created_at": "created_at",
    "updated_date": "updated_at",
    "updated_at": "updated_at",
    "case_title": "payload->>'case_title'",
    "case_number": "payload->>'case_number'",
}


class CaseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data: dict[str, Any] = Field(min_length=1, max_length=180)

    @field_validator("data")
    @classmethod
    def payload_is_bounded(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        except (TypeError, ValueError):
            raise ValueError("Case data must be JSON serializable") from None
        if len(encoded.encode("utf-8")) > 512_000:
            raise ValueError("Case data exceeds the 512 KB limit")
        return value


class CaseUpdate(CaseCreate):
    @field_validator("data")
    @classmethod
    def owner_fields_cannot_be_changed(cls, value: dict[str, Any]) -> dict[str, Any]:
        forbidden = OWNER_FIELDS.intersection(value)
        if forbidden:
            raise ValueError("Case ownership fields cannot be changed")
        return value


def _entity_name(entity_type: str) -> str:
    if entity_type not in SUPPORTED_ENTITIES:
        raise HTTPException(status_code=404, detail="Unsupported entity type")
    return entity_type


def _safe_sort(sort: str) -> tuple[str, str]:
    descending = sort.startswith("-")
    key = sort[1:] if descending else sort
    expression = SORT_FIELDS.get(key)
    if not expression:
        raise HTTPException(status_code=422, detail="Unsupported sort field")
    return expression, "DESC" if descending else "ASC"


def _owned_payload(entity_type: str, data: dict[str, Any], user: dict[str, Any]) -> dict[str, Any]:
    payload = dict(data)
    # Compatibility fields are server-derived, never trusted from browser input.
    if entity_type == "MyCase":
        payload["user_id"] = user["id"]
        payload["created_by"] = user["email"]
        payload["created_by_email"] = user["email"]
    else:
        payload["created_by"] = user["id"]
        payload["created_by_email"] = user["email"]
    return payload


def _decode_record(row: Any) -> dict[str, Any]:
    payload = row["payload"]
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except ValueError:
            payload = {}
    if not isinstance(payload, dict):
        payload = {}
    result = dict(payload)
    result.update({
        "id": row["id"],
        "created_date": row["created_at"].isoformat(),
        "updated_date": row["updated_at"].isoformat(),
    })
    return result


@router.get("/{entity_type}")
async def list_cases(
    entity_type: str,
    user: dict[str, Any] = Depends(current_user),
    pool=Depends(get_pool),
    sort: str = Query(default="-created_date", max_length=40),
    limit: int = Query(default=100, ge=1, le=5000),
    skip: int = Query(default=0, ge=0, le=100000),
    filters: str | None = Query(default=None, max_length=8000),
) -> list[dict[str, Any]]:
    entity_type = _entity_name(entity_type)
    sort_expr, direction = _safe_sort(sort or "-created_date")
    filter_data: dict[str, Any] = {}
    record_id: str | None = None
    if filters:
        try:
            parsed = json.loads(filters)
        except ValueError:
            raise HTTPException(status_code=422, detail="Filters must be a JSON object") from None
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=422, detail="Filters must be a JSON object")
        parsed = dict(parsed)
        record_id_value = parsed.pop("id", None)
        if record_id_value is not None:
            if not isinstance(record_id_value, str) or not record_id_value.strip() or len(record_id_value) > 200:
                raise HTTPException(status_code=422, detail="Invalid record ID filter")
            record_id = record_id_value.strip()
        # Owner filters can never widen the server-enforced owner scope. A filter
        # for another owner returns an empty result rather than being silently widened.
        for key in ("user_id", "owner_user_id"):
            if key in parsed:
                if str(parsed[key]) != str(user["id"]):
                    return []
                parsed.pop(key)
        if "created_by" in parsed:
            expected_creator = user["email"] if entity_type == "MyCase" else user["id"]
            if str(parsed.pop("created_by")) != str(expected_creator):
                return []
        # Compatibility fields are derived from the session, not queryable as
        # arbitrary ownership selectors. Remaining fields use JSONB containment.
        parsed.pop("created_by_email", None)
        filter_data = parsed
    encoded_filter = json.dumps(filter_data, separators=(",", ":"))
    query = f"""SELECT id, payload, created_at, updated_at FROM case_records
               WHERE owner_user_id = $1 AND entity_type = $2 AND payload @> $3::jsonb
                 AND ($4::text IS NULL OR id = $4)
               ORDER BY {sort_expr} {direction} LIMIT $5 OFFSET $6"""
    try:
        rows = await pool.fetch(
            query, uuid.UUID(user["id"]), entity_type, encoded_filter, record_id, limit, skip
        )
    except Exception:
        raise HTTPException(status_code=503, detail="Case storage is unavailable") from None
    return [_decode_record(row) for row in rows]


@router.get("/{entity_type}/{record_id}")
async def get_case(
    entity_type: str,
    record_id: str,
    user: dict[str, Any] = Depends(current_user),
    pool=Depends(get_pool),
) -> dict[str, Any]:
    entity_type = _entity_name(entity_type)
    try:
        row = await pool.fetchrow(
            "SELECT id, payload, created_at, updated_at FROM case_records WHERE id=$1 AND entity_type=$2 AND owner_user_id=$3",
            record_id, entity_type, uuid.UUID(user["id"]),
        )
    except Exception:
        raise HTTPException(status_code=503, detail="Case storage is unavailable") from None
    if row is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return _decode_record(row)


@router.post("/{entity_type}", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_csrf)])
async def create_case(
    entity_type: str,
    payload: CaseCreate,
    user: dict[str, Any] = Depends(current_user),
    pool=Depends(get_pool),
) -> dict[str, Any]:
    entity_type = _entity_name(entity_type)
    now = datetime.now(timezone.utc).isoformat()
    record_id = str(uuid.uuid4())
    data = _owned_payload(entity_type, payload.data, user)
    data.setdefault("created_date", now)
    data["updated_date"] = now
    encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    """INSERT INTO case_records(id, entity_type, owner_user_id, payload)
                       VALUES($1, $2, $3, $4::jsonb)
                       RETURNING id, payload, created_at, updated_at""",
                    record_id, entity_type, uuid.UUID(user["id"]), encoded,
                )
                await conn.execute(
                    "INSERT INTO case_audit_events(case_record_id, entity_type, actor_user_id, action, changed_fields) VALUES($1,$2,$3,'create',$4::jsonb)",
                    record_id, entity_type, uuid.UUID(user["id"]), json.dumps(sorted(data.keys())),
                )
    except Exception:
        raise HTTPException(status_code=503, detail="Case storage is unavailable") from None
    return _decode_record(row)


@router.patch("/{entity_type}/{record_id}", dependencies=[Depends(require_csrf)])
async def update_case(
    entity_type: str,
    record_id: str,
    payload: CaseUpdate,
    user: dict[str, Any] = Depends(current_user),
    pool=Depends(get_pool),
) -> dict[str, Any]:
    entity_type = _entity_name(entity_type)
    now = datetime.now(timezone.utc).isoformat()
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    "SELECT id, payload, created_at, updated_at FROM case_records WHERE id=$1 AND entity_type=$2 AND owner_user_id=$3 FOR UPDATE",
                    record_id, entity_type, uuid.UUID(user["id"]),
                )
                if row is None:
                    raise HTTPException(status_code=404, detail="Case not found")
                before = row["payload"]
                if isinstance(before, str):
                    before = json.loads(before)
                merged = {**(before if isinstance(before, dict) else {}), **payload.data}
                merged = _owned_payload(entity_type, merged, user)
                merged["updated_date"] = now
                changed = sorted(payload.data.keys())
                updated = await conn.fetchrow(
                    "UPDATE case_records SET payload=$2::jsonb, updated_at=now() WHERE id=$1 RETURNING id, payload, created_at, updated_at",
                    record_id, json.dumps(merged, ensure_ascii=False, separators=(",", ":")),
                )
                await conn.execute(
                    "INSERT INTO case_audit_events(case_record_id, entity_type, actor_user_id, action, changed_fields) VALUES($1,$2,$3,'update',$4::jsonb)",
                    record_id, entity_type, uuid.UUID(user["id"]), json.dumps(changed),
                )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="Case storage is unavailable") from None
    return _decode_record(updated)


@router.delete("/{entity_type}/{record_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_csrf)])
async def delete_case(
    entity_type: str,
    record_id: str,
    user: dict[str, Any] = Depends(current_user),
    pool=Depends(get_pool),
) -> None:
    entity_type = _entity_name(entity_type)
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                row = await conn.fetchrow(
                    "SELECT id FROM case_records WHERE id=$1 AND entity_type=$2 AND owner_user_id=$3 FOR UPDATE",
                    record_id, entity_type, uuid.UUID(user["id"]),
                )
                if row is None:
                    raise HTTPException(status_code=404, detail="Case not found")
                linked = await conn.fetchrow(
                    "SELECT investigation_id FROM case_investigations WHERE case_record_id=$1 AND owner_user_id=$2 LIMIT 1",
                    record_id, uuid.UUID(user["id"]),
                )
                if linked is not None:
                    raise HTTPException(status_code=409, detail="Case has linked investigations and cannot be deleted")
                await conn.execute("DELETE FROM case_records WHERE id=$1", record_id)
                await conn.execute(
                    "INSERT INTO case_audit_events(case_record_id, entity_type, actor_user_id, action, changed_fields) VALUES($1,$2,$3,'delete','[]'::jsonb)",
                    record_id, entity_type, uuid.UUID(user["id"]),
                )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="Case storage is unavailable") from None


class UserInvestigationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: dict[str, str]
    investigation_type: str = Field(default="web", min_length=1, max_length=80)

    @field_validator("target")
    @classmethod
    def validate_target(cls, value: dict[str, str]) -> dict[str, str]:
        if set(value) != {"type", "value"}:
            raise ValueError("Target must contain only type and value")
        target_type = value["type"].strip()
        target_value = value["value"].strip()
        if not target_type or len(target_type) > 40 or not target_value or len(target_value) > 500:
            raise ValueError("Target type/value is invalid")
        return {"type": target_type, "value": target_value}


async def _require_owned_case(pool: Any, case_id: str, user: dict[str, Any]) -> None:
    try:
        row = await pool.fetchrow(
            "SELECT id FROM case_records WHERE id=$1 AND owner_user_id=$2",
            case_id, uuid.UUID(user["id"]),
        )
    except Exception:
        raise HTTPException(status_code=503, detail="Case storage is unavailable") from None
    if row is None:
        # Avoid revealing whether a case exists but belongs to someone else.
        raise HTTPException(status_code=404, detail="Case not found")


async def _require_owned_investigation(
    pool: Any, case_id: str, investigation_id: str, user: dict[str, Any]
) -> None:
    try:
        row = await pool.fetchrow(
            "SELECT investigation_id FROM case_investigations WHERE case_record_id=$1 AND investigation_id=$2 AND owner_user_id=$3",
            case_id, investigation_id, uuid.UUID(user["id"]),
        )
    except Exception:
        raise HTTPException(status_code=503, detail="Investigation access could not be verified") from None
    if row is None:
        raise HTTPException(status_code=404, detail="Investigation not found")


@router.post("/{entity_type}/{case_id}/investigations", status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_csrf)])
async def create_case_investigation(
    entity_type: str,
    case_id: str,
    payload: UserInvestigationCreate,
    user: dict[str, Any] = Depends(current_user),
    pool=Depends(get_pool),
) -> dict[str, Any]:
    entity_type = _entity_name(entity_type)
    await _require_owned_case(pool, case_id, user)
    from .main import _hermes_request

    created = await _hermes_request("POST", "/v1/investigations", payload={
        "target": payload.target,
        "investigation_type": payload.investigation_type,
        "case_id": case_id,
    })
    investigation_id = created.get("investigation_id") if isinstance(created, dict) else None
    if not investigation_id:
        raise HTTPException(status_code=502, detail="Hermes did not return an investigation ID")
    status_value = str(created.get("status") or "CREATED")
    try:
        await pool.execute(
            "INSERT INTO case_investigations(investigation_id, case_record_id, owner_user_id, status) VALUES($1,$2,$3,$4)",
            str(investigation_id), case_id, uuid.UUID(user["id"]), status_value,
        )
    except Exception:
        # Do not claim persistence succeeded if Hermes accepted the run but mapping storage failed.
        raise HTTPException(status_code=503, detail="Investigation was created but its case link could not be saved; contact support before retrying") from None
    return created


@router.post("/{entity_type}/{case_id}/investigations/{investigation_id}/start", dependencies=[Depends(require_csrf)])
async def start_case_investigation(
    entity_type: str,
    case_id: str,
    investigation_id: str,
    user: dict[str, Any] = Depends(current_user),
    pool=Depends(get_pool),
) -> dict[str, Any]:
    _entity_name(entity_type)
    await _require_owned_investigation(pool, case_id, investigation_id, user)
    from .main import _hermes_request

    started = await _hermes_request("POST", f"/v1/investigations/{quote(investigation_id, safe='')}/start?wait=false")
    if isinstance(started, dict) and started.get("status"):
        await pool.execute(
            "UPDATE case_investigations SET status=$3, updated_at=now() WHERE case_record_id=$1 AND investigation_id=$2 AND owner_user_id=$4",
            case_id, investigation_id, str(started["status"]), uuid.UUID(user["id"]),
        )
    return started


@router.get("/{entity_type}/{case_id}/investigations/{investigation_id}")
async def get_case_investigation(
    entity_type: str,
    case_id: str,
    investigation_id: str,
    user: dict[str, Any] = Depends(current_user),
    pool=Depends(get_pool),
) -> dict[str, Any]:
    _entity_name(entity_type)
    await _require_owned_investigation(pool, case_id, investigation_id, user)
    from .main import _hermes_request

    return await _hermes_request("GET", f"/v1/investigations/{quote(investigation_id, safe='')}")


@router.get("/{entity_type}/{case_id}/investigations/{investigation_id}/{resource}")
async def get_case_investigation_resource(
    entity_type: str,
    case_id: str,
    investigation_id: str,
    resource: str,
    user: dict[str, Any] = Depends(current_user),
    pool=Depends(get_pool),
) -> Any:
    _entity_name(entity_type)
    if resource not in {"evidence", "findings", "report"}:
        raise HTTPException(status_code=404, detail="Resource not found")
    await _require_owned_investigation(pool, case_id, investigation_id, user)
    from .main import _hermes_request

    return await _hermes_request("GET", f"/v1/investigations/{quote(investigation_id, safe='')}/{resource}")
