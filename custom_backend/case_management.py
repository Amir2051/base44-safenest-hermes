"""First user-scoped replacement for the legacy caseManagement function.

Only ordinary user create/update operations are supported here. Admin recovery,
merge, create-for-user, redaction administration, and workflow triggers remain
blocked from this route until their separate permission/side-effect contracts are
migrated explicitly.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .auth import current_user, get_pool, require_csrf
from .cases import CaseCreate, CaseUpdate, _decode_record, _entity_name, _owned_payload, update_case

router = APIRouter(prefix="/api/v1/case-management", tags=["case management"])
CLASSIFICATION_MAP = {
    "crypto_theft": "cryptocurrency_fraud",
    "cryptocurrency_fraud": "cryptocurrency_fraud",
    "phishing": "other_cyber_fraud",
    "romance_scam": "romance_scam",
    "investment_scam": "investment_fraud",
    "investment_fraud": "investment_fraud",
    "business_email_compromise": "business_email_compromise",
    "identity_theft": "identity_theft",
    "impersonation_scam": "impersonation_individual",
    "tech_support_fraud": "tech_support_fraud",
    "scam": "other_cyber_fraud",
}
ALLOWED_CLASSIFICATIONS = {
    "impersonation_government", "impersonation_business", "impersonation_individual",
    "investment_fraud", "romance_scam", "business_email_compromise", "tech_support_fraud",
    "cryptocurrency_fraud", "identity_theft", "other_cyber_fraud",
}


class CaseManagementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: str = Field(min_length=1, max_length=40)
    data: dict[str, Any] = Field(default_factory=dict, max_length=180)


async def _next_case_number(conn: Any, year: int) -> str:
    sequence = await conn.fetchval(
        """INSERT INTO case_sequences(year, last_value, updated_at) VALUES($1, 1, now())
           ON CONFLICT(year) DO UPDATE SET last_value=case_sequences.last_value+1, updated_at=now()
           RETURNING last_value""",
        year,
    )
    return f"SN-{year}-{int(sequence):05d}"


def _amount(value: Any) -> float:
    try:
        number = float(value or 0)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="amount_lost must be numeric") from None
    if number < 0 or number > 1_000_000_000_000:
        raise HTTPException(status_code=422, detail="amount_lost is outside the allowed range")
    return number


@router.post("/", dependencies=[Depends(require_csrf)])
async def case_management(
    request: CaseManagementRequest,
    user: dict[str, Any] = Depends(current_user),
    pool=Depends(get_pool),
) -> dict[str, Any]:
    if request.action not in {"create", "update"}:
        raise HTTPException(status_code=501, detail="This case-management action has not been migrated yet")

    if request.action == "update":
        data = dict(request.data)
        record_id = str(data.pop("id", "")).strip()
        entity_type = str(data.pop("entityName", "MyCase")).strip() or "MyCase"
        updates = data.pop("updates", None)
        if not record_id:
            raise HTTPException(status_code=400, detail="Missing case ID")
        if not isinstance(updates, dict) or not updates:
            raise HTTPException(status_code=422, detail="Invalid updates payload")
        entity_type = _entity_name(entity_type)
        updated = await update_case(entity_type, record_id, CaseUpdate(data=updates), user, pool)
        return {"success": True, "case": updated}

    # Create always assigns the record to the authenticated user. Admin create-for-user
    # is a distinct action and is intentionally not handled by this endpoint.
    data = dict(request.data)
    if not isinstance(data.get("client_name"), str) or not data["client_name"].strip():
        raise HTTPException(status_code=400, detail="Client name is required")
    classification = data.get("incident_classification")
    if not isinstance(classification, str) or not classification.strip():
        issue = str(data.get("issue_type") or "scam").strip().lower().replace(" ", "_")
        classification = CLASSIFICATION_MAP.get(issue, "other_cyber_fraud")
    if classification not in ALLOWED_CLASSIFICATIONS:
        raise HTTPException(status_code=422, detail="Unsupported incident classification")
    data["incident_classification"] = classification
    data["amount_lost"] = _amount(data.get("amount_lost"))
    if not data.get("status"):
        data["status"] = "Pending"
    now = datetime.now(timezone.utc).isoformat()
    data.setdefault("created_date", now)
    data["last_activity"] = now
    data["updated_date"] = now
    data["created_by"] = user["email"]
    data["created_by_email"] = user["email"]
    data["created_by_name"] = user.get("display_name") or user.get("full_name") or user["email"]
    data["user_id"] = user["id"]
    if not data.get("client_email"):
        data["client_email"] = user["email"]
    if not data.get("case_title"):
        data["case_title"] = f"Fraud Report: {data.get('issue_type') or 'Other'}"
    data.setdefault("wallet_analysis", {})
    data.setdefault("linked_case_ids", [])
    data.setdefault("ai_analysis", "Case submitted successfully")
    scammer_wallet = str(data.get("scammer_wallet") or "").strip()
    data.setdefault("monitored_wallets", [scammer_wallet] if scammer_wallet else [])
    scammer_info = data.get("scammer_info") if isinstance(data.get("scammer_info"), dict) else {}
    if scammer_wallet:
        scammer_info = {**scammer_info, "wallet_addresses": list(dict.fromkeys([*(scammer_info.get("wallet_addresses") or []), scammer_wallet]))}
    data["scammer_info"] = scammer_info
    data["created_by_admin"] = False
    data["admin_creator_email"] = None

    # Bound payload size and JSON shape before any database work.
    validated = CaseCreate(data=data).data
    owner_id = uuid.UUID(user["id"])
    entity_type = "MyCase"
    encoded_wallet = str(data.get("scammer_wallet") or "").strip().lower()
    amount_lost = data["amount_lost"]
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                if encoded_wallet and data["status"] == "Pending":
                    recent_rows = await conn.fetch(
                        """SELECT payload FROM case_records WHERE owner_user_id=$1 AND entity_type='MyCase'
                           AND created_at > now() - interval '5 minutes' AND payload->>'status'='Pending'""",
                        owner_id,
                    )
                    for row in recent_rows:
                        existing = row["payload"]
                        if isinstance(existing, str):
                            existing = json.loads(existing)
                        existing_wallet = str((existing or {}).get("scammer_wallet") or "").strip().lower()
                        try:
                            existing_amount = float((existing or {}).get("amount_lost") or 0)
                        except (TypeError, ValueError):
                            existing_amount = -999999999
                        if existing_wallet == encoded_wallet and abs(existing_amount - amount_lost) < 1:
                            raise HTTPException(status_code=409, detail="Duplicate submission detected. Please wait before resubmitting.")

                year = datetime.now(timezone.utc).year
                case_number = await _next_case_number(conn, year)
                validated["case_number"] = case_number
                validated = _owned_payload(entity_type, validated, user)
                validated["created_date"] = validated.get("created_date") or now
                validated["updated_date"] = now
                record_id = str(uuid.uuid4())
                row = await conn.fetchrow(
                    """INSERT INTO case_records(id, entity_type, owner_user_id, payload)
                       VALUES($1, $2, $3, $4::jsonb)
                       RETURNING id, payload, created_at, updated_at""",
                    record_id, entity_type, owner_id,
                    json.dumps(validated, ensure_ascii=False, separators=(",", ":")),
                )
                await conn.execute(
                    "INSERT INTO case_audit_events(case_record_id, entity_type, actor_user_id, action, changed_fields) VALUES($1,$2,$3,'create',$4::jsonb)",
                    record_id, entity_type, owner_id, json.dumps(sorted(validated.keys())),
                )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="Case storage is unavailable") from None
    return {"success": True, "case": _decode_record(row)}
