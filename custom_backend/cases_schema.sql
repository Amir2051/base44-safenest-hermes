-- Dedicated staging-only SafeNestT case records. Never apply to production.
CREATE TABLE IF NOT EXISTS case_records (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('MyCase', 'InvestigationCase')),
    owner_user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_records_owner_type_created_idx
    ON case_records(owner_user_id, entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS case_records_payload_gin_idx
    ON case_records USING GIN(payload);

-- Audit metadata deliberately stores changed field names, not victim/suspect PII.
CREATE TABLE IF NOT EXISTS case_audit_events (
    id BIGSERIAL PRIMARY KEY,
    case_record_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('MyCase', 'InvestigationCase')),
    actor_user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
    action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_audit_events_record_created_idx
    ON case_audit_events(case_record_id, created_at DESC);

-- Mapping prevents one authenticated user from probing another case's Hermes IDs.
CREATE TABLE IF NOT EXISTS case_investigations (
    investigation_id TEXT PRIMARY KEY,
    case_record_id TEXT NOT NULL REFERENCES case_records(id) ON DELETE RESTRICT,
    owner_user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'CREATED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_investigations_case_owner_idx
    ON case_investigations(case_record_id, owner_user_id, created_at DESC);
