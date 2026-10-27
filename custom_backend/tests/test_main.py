import os

import httpx
import pytest
from fastapi.testclient import TestClient

from custom_backend import main


@pytest.fixture(autouse=True)
def config(monkeypatch):
    monkeypatch.setenv("CUSTOM_BACKEND_SERVICE_TOKEN", "test-service-token-not-for-production")
    monkeypatch.setenv("HERMES_BASE_URL", "http://127.0.0.1:8003")
    monkeypatch.setenv("HERMES_API_KEY", "test-hermes-key")


@pytest.fixture
def client():
    return TestClient(main.app)


def test_health_is_public_and_minimal(client):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert "model" not in response.json()


def test_investigation_routes_reject_missing_auth(client):
    response = client.post(
        "/api/v1/investigations",
        json={"target": {"type": "domain", "value": "example.com"}, "investigation_type": "web"},
    )
    assert response.status_code == 401


def test_investigation_routes_reject_wrong_auth(client):
    response = client.get("/api/v1/hermes/health", headers={"Authorization": "Bearer wrong"})
    assert response.status_code == 401


def test_service_fails_closed_when_token_not_configured(client, monkeypatch):
    monkeypatch.delenv("CUSTOM_BACKEND_SERVICE_TOKEN")
    response = client.get("/api/v1/hermes/health", headers={"Authorization": "Bearer any"})
    assert response.status_code == 503


def test_create_forwards_validated_payload(client, monkeypatch):
    seen = {}

    async def fake_request(method, path, *, payload=None):
        seen.update(method=method, path=path, payload=payload)
        return {"investigation_id": "demo-id", "status": "QUEUED"}

    monkeypatch.setattr(main, "_hermes_request", fake_request)
    response = client.post(
        "/api/v1/investigations",
        headers={"Authorization": "Bearer test-service-token-not-for-production"},
        json={"target": {"type": "domain", "value": "example.com"}, "investigation_type": "web", "case_id": None},
    )
    assert response.status_code == 200
    assert response.json()["investigation_id"] == "demo-id"
    assert seen["method"] == "POST"
    assert seen["path"] == "/v1/investigations"
    assert seen["payload"]["target"] == {"type": "domain", "value": "example.com"}


def test_start_uses_async_engine_mode(client, monkeypatch):
    seen = {}

    async def fake_request(method, path, *, payload=None):
        seen.update(method=method, path=path)
        return {"investigation_id": "demo-id", "status": "RUNNING"}

    monkeypatch.setattr(main, "_hermes_request", fake_request)
    response = client.post(
        "/api/v1/investigations/demo-id/start",
        headers={"Authorization": "Bearer test-service-token-not-for-production"},
    )
    assert response.status_code == 200
    assert seen == {"method": "POST", "path": "/v1/investigations/demo-id/start?wait=false"}


def test_invalid_target_is_rejected_before_upstream(client, monkeypatch):
    async def should_not_call(*args, **kwargs):
        pytest.fail("Upstream should not be called for invalid payload")

    monkeypatch.setattr(main, "_hermes_request", should_not_call)
    response = client.post(
        "/api/v1/investigations",
        headers={"Authorization": "Bearer test-service-token-not-for-production"},
        json={"target": {"type": "domain", "value": "  "}, "investigation_type": "web"},
    )
    assert response.status_code == 422


def test_non_local_http_hermes_url_is_rejected(client, monkeypatch):
    monkeypatch.setenv("HERMES_BASE_URL", "http://untrusted.example")
    response = client.get(
        "/api/v1/hermes/health",
        headers={"Authorization": "Bearer test-service-token-not-for-production"},
    )
    assert response.status_code == 503


def test_auth_register_fails_closed_without_database(client, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("AUTH_CSRF_SECRET", "test-csrf-secret-that-is-long-enough-123456")
    response = client.post("/api/v1/auth/register", json={"email": "new@example.com", "password": "correct-horse-battery-staple-1", "display_name": "Test User"})
    assert response.status_code == 503
    assert "database" in response.json()["detail"].lower()


def test_auth_me_requires_session(client):
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401


def test_logout_rejects_missing_csrf(client):
    response = client.post("/api/v1/auth/logout")
    assert response.status_code == 403


def test_auth_origin_must_be_allowlisted(client, monkeypatch):
    monkeypatch.setenv("AUTH_ALLOWED_ORIGINS", "https://safenestt.example")
    response = client.post(
        "/api/v1/auth/login",
        headers={"Origin": "https://attacker.example"},
        json={"email": "user@example.com", "password": "some-long-password"},
    )
    assert response.status_code == 403


def test_password_hash_verifies_and_uses_unique_salts():
    from custom_backend.auth import hash_password, verify_password

    password = "correct-horse-battery-staple-1"
    first = hash_password(password)
    second = hash_password(password)
    assert first != second
    assert verify_password(password, first)
    assert not verify_password("wrong-password", first)
    assert not verify_password(password, "not-a-valid-hash")


def test_csrf_token_is_session_bound(monkeypatch):
    from custom_backend.auth import _csrf_for_session

    monkeypatch.setenv("AUTH_CSRF_SECRET", "test-csrf-secret-that-is-long-enough-123456")
    assert _csrf_for_session("session-one") != _csrf_for_session("session-two")
    assert _csrf_for_session("session-one") == _csrf_for_session("session-one")


def test_login_rate_limit_returns_429(monkeypatch):
    import asyncio
    from custom_backend import auth

    class RateLimitedPool:
        async def fetchval(self, query, *args):
            assert len(args) == 2
            assert len(args[0]) == 64  # Only a SHA-256 key digest is persisted.
            assert args[1] == auth.LOGIN_WINDOW_MINUTES
            return auth.LOGIN_EMAIL_ATTEMPTS + 1

    with pytest.raises(auth.HTTPException) as caught:
        asyncio.run(auth._consume_rate_limit(RateLimitedPool(), "email:private@example.com", auth.LOGIN_EMAIL_ATTEMPTS))
    assert caught.value.status_code == 429
    assert caught.value.headers["Retry-After"] == "900"


def test_profile_update_allowlist_excludes_privileged_fields():
    from custom_backend.auth import PROFILE_FIELDS

    assert "display_name" in PROFILE_FIELDS
    assert "onboarding_completed" in PROFILE_FIELDS
    assert "role" not in PROFILE_FIELDS
    assert "is_active" not in PROFILE_FIELDS
    assert "email_verified" not in PROFILE_FIELDS
    assert "subscription_status" not in PROFILE_FIELDS
    assert "total_points" not in PROFILE_FIELDS
    assert "payment_method_added" not in PROFILE_FIELDS


def test_public_user_decodes_jsonb_profile_text():
    from datetime import datetime, timezone
    from custom_backend.auth import _public_user

    row = {
        "id": "f94c12b8-9f88-4a3a-a2fd-74c28e1a5c66",
        "email": "profile@example.test",
        "display_name": "Profile User",
        "role": "investigator",
        "email_verified": False,
        "created_at": datetime.now(timezone.utc),
        "profile": '{"company":"SafeNestT Lab","onboarding_completed":true}',
    }
    user = _public_user(row)
    assert user["company"] == "SafeNestT Lab"
    assert user["onboarding_completed"] is True
    assert "password_hash" not in user


def test_profile_update_normalizes_legacy_profile_aliases():
    from custom_backend.auth import _normalize_profile_updates

    normalized = _normalize_profile_updates({
        "full_name": "SafeNestT Tester",
        "profile_image": "https://example.test/avatar.png",
        "phone": "555-0100",
    })
    assert normalized == {
        "display_name": "SafeNestT Tester",
        "avatar_url": "https://example.test/avatar.png",
        "phone": "555-0100",
    }


def test_profile_update_rejects_duplicate_alias_and_canonical_field():
    from fastapi import HTTPException
    from custom_backend.auth import _normalize_profile_updates

    try:
        _normalize_profile_updates({"full_name": "One", "display_name": "Two"})
    except HTTPException as exc:
        assert exc.status_code == 422
    else:
        raise AssertionError("conflicting aliases should be rejected")


def test_public_user_keeps_legacy_name_and_avatar_aliases():
    from datetime import datetime, timezone
    from custom_backend.auth import _public_user

    row = {
        "id": "00000000-0000-0000-0000-000000000001",
        "email": "legacy@example.test",
        "display_name": "Legacy User",
        "role": "investigator",
        "email_verified": False,
        "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "profile": {"avatar_url": "https://example.test/avatar.png"},
    }
    user = _public_user(row)
    assert user["display_name"] == "Legacy User"
    assert user["full_name"] == "Legacy User"
    assert user["avatar_url"] == "https://example.test/avatar.png"
    assert user["profile_image"] == "https://example.test/avatar.png"
