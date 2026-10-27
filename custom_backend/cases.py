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
    filters: str | None = Query(default=None, max_length=8000),
) -> list[dict[str, Any]]:
    entity_type = _entity_name(entity_type)
    sort_expr, direction = _safe_sort(sort)
    filter_data: dict[str, Any] = {}
    if filters:
        try:
            parsed = json.loads(filters)
        except ValueError:
            raise HTTPException(status_code=422, detail="Filters must be a JSON object") from None
        if not isinstance(parsed, dict):
            raise HTTPException(status_code=422, detail="Filters must be a JSON object")
        if OWNER_FIELDS.intersection(parsed):
            # Never permit clients to use ownership filters to infer other users' records.
            parsed = {key: value for key, value in parsed.items() if key not in OWNER_FIELDS}
        filter_data = parsed
    encoded_filter = json.dumps(filter_data, separators=(",", ":"))
    query = f"""SELECT id, payload, created_at, updated_at FROM case_records
               WHERE owner_user_id = $1 AND entity_type = $2 AND payload @> $3::jsonb
               ORDER BY {sort_expr} {direction} LIMIT $4"""
    try:
        rows = await pool.fetch(query, uuid.UUID(user["id"]), entity_type, encoded_filter, limit)
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
                await conn.execute("DELETE FROM case_records WHERE id=$1", record_id)
                await conn.execute(
                    "INSERT INTO case_audit_events(case_record_id, entity_type, actor_user_id, action, changed_fields) VALUES($1,$2,$3,'delete','[]'::jsonb)",
                    record_id, entity_type, uuid.UUID(user["id"]),
                )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="Case storage is unavailable") from None
