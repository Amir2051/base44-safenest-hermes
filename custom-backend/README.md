# SafeNestT Custom Backend

This directory is the foundation for migrating SafeNestT away from Base44.

## Goal

Replace Base44 backend dependencies incrementally while keeping the existing SafeNestT frontend operational.

Target architecture:

SafeNestT frontend -> Custom SafeNestT API -> PostgreSQL/RLS -> Hermes / SafeNestT AI Agency

## Rules

- Do not modify or remove Base44 integration from the existing application during the migration.
- New custom services must be isolated under this directory until they are verified.
- Authentication and authorization are server-side concerns.
- Case isolation must be enforced at the database/API layer, not only in the UI.
- Hermes remains a separate service/repository: Amir2051/safenestt-ai-agency.
- No secrets are committed.

## Initial stack

- Python 3.12+
- FastAPI
- PostgreSQL
- SQLAlchemy 2
- Pydantic Settings
- Argon2id for password hashing
- JWT access/refresh tokens
- pytest

Later phases can add object storage, background jobs, Stripe, email/SMS, and the Hermes client.

## Migration phases

1. Foundation and health endpoint
2. Configuration and database connectivity
3. Authentication
4. Users/roles/tenants
5. Cases and database-level isolation
6. Evidence/files/timeline
7. Investigation/Hermes integration
8. Admin
9. Billing/notifications/integrations
10. Data migration and cutover
11. Base44 dependency removal
