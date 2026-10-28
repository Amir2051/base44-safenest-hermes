# SafeNestT Render migration status

Updated: 2026-10-27/28 UTC. This file records the isolated migration state; it is not a production runbook.

## Live staging resources

- GitHub repository: `Amir2051/base44-safenest-hermes`
- Staging branch: `safenestt-render-staging`
- The staging branch contains the custom-auth bridge, core case entity adapter, user-case update path, and the initial user-scoped case-management create/update slice; see the branch for its current commit.
- Render API service: `safenestt-api-staging` (`srv-dbgjj36gekts73eqmjqg`)
- Staging API URL: `https://safenestt-api-staging.onrender.com`
- Last verified deployed backend commit: `706d730` (branch changes after that commit are frontend-only)
- Render database: `safenestt-migration-staging-db` (`dpg-dbgjj4m1egvs73b3m0l0-a`), Ohio, free plan; expires 2026-11-26 unless upgraded/replaced.

## Implemented in the isolated backend slice

- FastAPI liveness route and private service-token-protected Hermes routes.
- Independent email/password sessions, HttpOnly cookie, session-bound CSRF, profile allowlist, and login rate limiting.
- Owner-scoped `MyCase` and `InvestigationCase` JSONB storage with server-derived owner fields and metadata-only audit events.
- Partial `caseManagement` replacement for ordinary user create/update, with atomic annual case numbers and duplicate prevention; admin/merge/recovery/workflow actions are intentionally not migrated yet.
- Case-scoped Hermes create/start/status/evidence/findings/report routes; investigation IDs are mapped to an owned case.
- Explicit, guarded `migrate_staging` command. It only permits `APP_ENV=staging|migration` and a DB name beginning `safenestt_migration_` or `safenestt_staging_`; it refuses `safenestt_ai` and `safenestt_ai_test`.
- Frontend compatibility adapter for `MyCase` and `InvestigationCase`, plus the custom-auth bridge. `UserCaseDetail` writes now use the custom API.

## Verification so far

- 35 backend unit tests passed.
- A DB-backed local smoke test passed against the dedicated local `safenestt_custom_auth` database on port 55433: registration/session, current-user, owner-scoped case create/list/update, case-linked Hermes create/read (Hermes mocked), and cross-owner read denial. Synthetic smoke users/cases were cleaned up afterward.
- Frontend production build passes. Existing bundle-size warning remains; repository-wide lint and typecheck still have pre-existing failures.
- Live Render `/health` returned HTTP 200; unauthenticated `/api/v1/auth/me` and case routes return HTTP 401.

## Deliberate blockers before end-to-end staging

- Render's new Postgres database is provisioned but **not linked** to the API service. `DATABASE_URL` is not configured on the service. The database connector only exposes metadata here, and read-only SQL queries are blocked by the empty IP allowlist; keep that allowlist closed. Link the database using Render's internal connection string in the service Environment settings or a Render Blueprint `fromDatabase` reference, without sharing the secret in chat.
- The staging service does not yet have `HERMES_BASE_URL`, `HERMES_API_KEY`, or `CUSTOM_BACKEND_SERVICE_TOKEN`; Hermes requests fail closed until those are configured server-side.
- `AUTH_ALLOWED_ORIGINS` must be set to the eventual staging frontend origin before browser auth tests. Do not add `safenestt.com` until a real frontend is deployed and validated.
- No staging frontend service has been deployed. The full frontend still contains many Base44 entity/function/integration dependencies; only two entity families have begun migrating. A successful build is not Base44 independence.

## Next safe sequence

1. Link the isolated Render Postgres database to `safenestt-api-staging` via internal connection string, set `APP_ENV=staging`, and run `python -m custom_backend.migrate_staging` once against that dedicated DB.
2. Configure server-side Hermes credentials and the staging frontend origin; smoke-test auth and case APIs against Render, then test a real Hermes run without duplicating existing runs.
3. Migrate case-management function contracts, evidence storage, findings/reports, and audit history with explicit data reconciliation. Preserve the 172 historical audit events; do not infer missing owners.
4. Migrate remaining entities/functions in small slices, run browser/security tests, then deploy a static frontend to a staging `onrender.com` URL.
5. Cut over `safenestt.com` only after acceptance checks and a rollback rehearsal. Production DNS and database have not been changed.
