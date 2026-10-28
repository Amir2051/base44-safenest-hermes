"""Session-authenticated Hermes status/health endpoints and terminal result persistence."""
from __future__ import annotations

import json
import uuid
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException

from .auth import current_user, get_pool

router = APIRouter(prefix="/api/v1/user", tags=["user Hermes"])
TERMINAL_STATUSES = {
    "COMPLETED", "COMPLETE", "DONE", "SUCCESS", "SUCCEEDED", "FINISHED", "OK",
    "COMPLETED_WITH_ERRORS", "COMPLETED_WITH_WARNINGS", "COMPLETED_WITH_FAILURES",
    "PARTIAL_SUCCESS", "PARTIALLY_COMPLETED", "PARTIAL_FAILURE", "PARTIALLY_FAILED",
    "FAILED", "ERROR", "ERRORED", "FAILED_WITH_RESULTS", "CANCELLED", "CANCELED",
    "ABORTED", "EXPIRED", "TIMEOUT", "TIMED_OUT",
}


def _normalize_status(value: Any) -> str:
    return str(value or "").upper().replace(" ", "_").replace("-", "_")


def _json_value(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:
            return default
    return value


@router.get("/hermes/health")
async def user_hermes_health(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    from .main import _hermes_request
    try:
        result = await _hermes_request("GET", "/v1/health")
        return result if isinstance(result, dict) else {"status": "unknown"}
    except HTTPException:
        return {"status": "unavailable", "detail": "Hermes is not reachable from the staging backend"}


@router.get("/investigations/{investigation_id}")
async def user_investigation_status(
    investigation_id: str,
    user: dict[str, Any] = Depends(current_user),
    pool=Depends(get_pool),
) -> dict[str, Any]:
    owner_id = uuid.UUID(user["id"])
    try:
        mapping = await pool.fetchrow(
            """SELECT ci.case_record_id, ci.status, cr.entity_type
               FROM case_investigations ci JOIN case_records cr ON cr.id=ci.case_record_id
               WHERE ci.investigation_id=$1 AND ci.owner_user_id=$2""",
            investigation_id, owner_id,
        )
    except Exception:
        raise HTTPException(status_code=503, detail="Investigation access could not be verified") from None
    if mapping is None:
        raise HTTPException(status_code=404, detail="Investigation not found")

    from .main import _hermes_request
    safe_id = quote(investigation_id, safe="")
    status_result = await _hermes_request("GET", f"/v1/investigations/{safe_id}")
    status_value = str(status_result.get("status") or "UNKNOWN") if isinstance(status_result, dict) else "UNKNOWN"
    try:
        await pool.execute(
            "UPDATE case_investigations SET status=$2, updated_at=now() WHERE investigation_id=$1 AND owner_user_id=$3",
            investigation_id, status_value, owner_id,
        )
    except Exception:
        raise HTTPException(status_code=503, detail="Investigation status could not be persisted") from None

    if _normalize_status(status_value) not in TERMINAL_STATUSES:
        return status_result

    # Terminal snapshots are immutable for this workflow. Reuse a prior successful
    # sync rather than re-fetching artifacts or appending duplicate audit events.
    try:
        cached = await pool.fetchrow(
            "SELECT status,evidence,findings,report FROM case_investigation_results WHERE investigation_id=$1",
            investigation_id,
        )
    except Exception:
        cached = None
    if cached is not None and _normalize_status(cached["status"]) == _normalize_status(status_value):
        return {
            **(status_result if isinstance(status_result, dict) else {}),
            "results_synced": True,
            "results": {
                "evidence": _json_value(cached["evidence"], []),
                "findings": _json_value(cached["findings"], []),
                "report": _json_value(cached["report"], {}),
            },
        }

    # Persist terminal results idempotently. If an upstream artifact is not yet
    # available, leave prior snapshots untouched and tell the caller sync is pending.
    try:
        evidence = await _hermes_request("GET", f"/v1/investigations/{safe_id}/evidence")
        findings = await _hermes_request("GET", f"/v1/investigations/{safe_id}/findings")
        report = await _hermes_request("GET", f"/v1/investigations/{safe_id}/report")
        evidence_json = json.dumps(evidence if evidence is not None else [], ensure_ascii=False, separators=(",", ":"))
        findings_json = json.dumps(findings if findings is not None else [], ensure_ascii=False, separators=(",", ":"))
        report_json = json.dumps(report if report is not None else {}, ensure_ascii=False, separators=(",", ":"))
        status_json = json.dumps(status_result, ensure_ascii=False, separators=(",", ":"))
        async with pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    """INSERT INTO case_investigation_results(investigation_id,status,evidence,findings,report,upstream_status,synced_at)
                       VALUES($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,now())
                       ON CONFLICT(investigation_id) DO UPDATE SET status=EXCLUDED.status,evidence=EXCLUDED.evidence,
                         findings=EXCLUDED.findings,report=EXCLUDED.report,upstream_status=EXCLUDED.upstream_status,synced_at=now()""",
                    investigation_id, status_value, evidence_json, findings_json, report_json, status_json,
                )
                await conn.execute(
                    """INSERT INTO case_audit_events(case_record_id,entity_type,actor_user_id,action,changed_fields)
                       VALUES($1,$2,$3,'update',$4::jsonb)""",
                    mapping["case_record_id"], mapping["entity_type"], owner_id,
                    json.dumps(["investigation_status", "evidence", "findings", "report"]),
                )
    except HTTPException:
        return {**(status_result if isinstance(status_result, dict) else {}), "results_synced": False, "sync_status": "pending"}
    except Exception:
        return {**(status_result if isinstance(status_result, dict) else {}), "results_synced": False, "sync_status": "pending"}

    return {
        **(status_result if isinstance(status_result, dict) else {}),
        "results_synced": True,
        "results": {
            "evidence": _json_value(evidence_json, []),
            "findings": _json_value(findings_json, []),
            "report": _json_value(report_json, {}),
        },
    }
