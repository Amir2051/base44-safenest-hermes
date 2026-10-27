# SafeNestT Custom Backend — Hermes adapter (migration slice)

This is the first independent backend slice in the `custom-backend-migration` branch. It proxies the existing Hermes API; it does not clone/reimplement Hermes or connect to a SafeNestT production database.

## Routes

- `GET /health` — minimal liveness endpoint.
- `GET /api/v1/hermes/health` — upstream Hermes health.
- `POST /api/v1/investigations` — create an investigation.
- `POST /api/v1/investigations/{id}/start` — start asynchronously (`wait=false`).
- `GET /api/v1/investigations/{id}` — status/result.
- `GET /api/v1/investigations/{id}/evidence` — evidence.
- `GET /api/v1/investigations/{id}/findings` — findings.
- `GET /api/v1/investigations/{id}/report` — report.

Every `/api/v1/*` route requires a backend-only bearer token. Hermes credentials are read only from server-side environment variables and never returned to callers. Non-local Hermes URLs must use HTTPS.

## Local test run

```bash
python -m pip install -r custom_backend/requirements.txt
pytest -q custom_backend/tests
```

## Important limitations / deployment gate

- This is a **private service-to-service adapter**, not yet safe to expose directly to a browser or public internet.
- Do not put `CUSTOM_BACKEND_SERVICE_TOKEN` or `HERMES_API_KEY` into any `VITE_*` variable or frontend bundle.
- The token currently authenticates a trusted internal service, not an end user. Before wiring the browser to this API, implement independent user authentication and server-side case ownership/role checks.
- `case_id` is passed to Hermes as metadata only. This adapter does not claim that the caller owns the case.
- The existing engine persists its own investigation records. SafeNestT case/entity persistence, graph writes, object storage, subscription checks, and audit log parity are not implemented here yet.
- Never point this migration slice at the production SafeNestT database. Use the isolated Hermes instance and synthetic targets until staging acceptance tests pass.

## Independent authentication (first migration slice)

`auth.py` provides email/password registration and sign-in, a current-user endpoint, CSRF token retrieval, logout, and session rotation. It does not call Base44. Sessions are opaque random values; only SHA-256 hashes are persisted. Passwords are hashed with PBKDF2-HMAC-SHA256 and per-password random salts. Cookies are `HttpOnly`, `SameSite=Strict`, and `Secure` by default.

### Dedicated database setup

1. Provision a **new, dedicated PostgreSQL database** for the custom backend. Do not point `DATABASE_URL` at the SafeNestT production database or at the existing production/test Hermes databases.
2. Install `custom_backend/requirements.txt` into the backend environment.
3. Set `DATABASE_URL`, `AUTH_CSRF_SECRET` (at least 32 characters of independent randomness), `AUTH_ALLOWED_ORIGINS` (comma-separated exact HTTPS origins), and `AUTH_COOKIE_SECURE=true` in the server environment. Keep secrets out of source control and the browser bundle.
4. Apply `custom_backend/auth_schema.sql` manually to that dedicated database using its administrator/managed migration workflow.
5. Start the API and verify `/health`, then test `/api/v1/auth/register`, `/api/v1/auth/me`, and `/api/v1/auth/logout` against the isolated environment.

Login throttling uses PostgreSQL-backed 15-minute buckets keyed by SHA-256 digests of email and client IP. The current limits are 8 attempts per normalized email and 30 per client IP per window. This is a baseline control, not a substitute for edge/WAF throttling and monitoring.

Routes:
- `POST /api/v1/auth/register` — email, password (12+ characters), display name; creates an investigator account and session.
- `POST /api/v1/auth/login` — email/password; creates a session.
- `GET /api/v1/auth/me` — current session identity.
- `GET /api/v1/auth/csrf` — obtains a session-bound CSRF token after reload.
- `POST /api/v1/auth/refresh` — rotates the session; requires `X-CSRF-Token`.
- `POST /api/v1/auth/logout` — revokes the session; requires `X-CSRF-Token`.

Registration does not accept a role, and new users always receive the `investigator` role. Email verification and password-reset delivery are not yet enabled because no email delivery service is wired. Account recovery, email verification, MFA, admin provisioning, and frontend migration are still required before a public production cutover. Case ownership/role checks must be implemented before browser users can invoke investigation routes; the current Hermes adapter remains private service-token-only.

## Frontend compatibility bridge (staged)

The frontend now routes the existing `base44.auth.me()`, `updateMe()`, `logout()`, `redirectToLogin()`, `loginViaEmailPassword()`, `register()`, and `isAuthenticated()` calls through `src/lib/customAuthApi.js` to the custom auth API. `src/lib/AuthContext.jsx` uses this independent identity for its session gate, and `src/pages/CustomLogin.jsx` supplies the local sign-in/create-account screen. Base44 entities, function invocation, and integrations are intentionally still on the existing SDK; this change is not a full Base44 backend removal.

Profile writes are restricted to an allow-list and stored in the custom database JSONB profile column. Role, active status, email verification, subscription/billing status, points, and other privileged fields cannot be set through this profile endpoint. The API should be served same-origin through a reverse proxy in production, or set `VITE_CUSTOM_BACKEND_URL` at frontend build time and configure exact `AUTH_ALLOWED_ORIGINS` for that deployment. Do not deploy the frontend bridge until a staging reverse proxy and CORS/origin policy are configured and validated.

## Staging-only auth schema migration

The Render staging service must use a **separate** database. The auth schema is not
applied automatically at app startup. Once the staging service has its internal
`DATABASE_URL` configured and `APP_ENV=staging`, run this one-shot command from the
repository root:

```sh
python -m custom_backend.migrate_auth
```

The command verifies the live PostgreSQL database name before applying the idempotent
`auth_schema.sql`. It refuses `safenestt_ai`, `safenestt_ai_test`, non-staging app
modes, and databases without the approved `safenestt_migration_` or
`safenestt_staging_` prefix. It creates only the isolated authentication tables; it
never migrates cases, evidence, findings, or audit history.

## Initial owner-scoped case API

The first case-data slice supports only `MyCase` and `InvestigationCase` through
`/api/v1/entities/{entity_type}`. New records are assigned to the authenticated
session user on the server; owner fields from the browser are not trusted. Reads,
updates, and deletes are scoped to that owner, and writes require the session-bound
CSRF token. A small audit table records action metadata and changed field names, not
case contents or victim/suspect PII.

To apply both the authentication and case tables on a dedicated staging database,
use `APP_ENV=staging` and run `python -m custom_backend.migrate_staging`. This is an
explicit one-shot command and does not run on service startup. It still does not
import historical Base44 data, evidence files, findings, or the 172 historical audit
events; those require separate reconciliation and preservation checks.

## Case-scoped Hermes routes

The authenticated route family now supports creating, starting, and reading a Hermes
investigation only after verifying the signed-in user owns the linked custom case.
A mapping table ties each Hermes investigation ID to its case and owner; the private
service-token routes remain separate for service-to-service use. Starts use
`wait=false` so HTTP requests return promptly while Hermes runs asynchronously.
If Hermes creates a run but the mapping insert fails, the API reports the persistence
failure and explicitly warns callers not to retry blindly; reconciliation is needed.
