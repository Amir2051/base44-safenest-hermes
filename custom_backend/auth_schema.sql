-- Apply only to the dedicated SafeNestT custom-backend database, never production.

CREATE TABLE IF NOT EXISTS auth_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'investigator' CHECK (role IN ('investigator', 'security_analyst', 'admin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    profile JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);


-- Hashed keys only; bounded login-attempt counters for basic brute-force resistance.
CREATE TABLE IF NOT EXISTS auth_rate_limits (
    key_hash TEXT PRIMARY KEY,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_updated_at_idx ON auth_rate_limits(updated_at);

ALTER TABLE auth_users ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;
