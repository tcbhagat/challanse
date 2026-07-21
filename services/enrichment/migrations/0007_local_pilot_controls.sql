CREATE TABLE IF NOT EXISTS local_reviewer_credentials (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  totp_secret_ciphertext BYTEA NOT NULL,
  recovery_code_hashes JSONB NOT NULL DEFAULT '[]'::jsonb,
  failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS local_reviewer_sessions (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_hash TEXT NOT NULL CHECK (csrf_hash ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_reviewer_sessions_expiry_idx ON local_reviewer_sessions(expires_at);

CREATE TABLE IF NOT EXISTS local_auth_events (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'ENROLLED', 'LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOCKED', 'LOGOUT',
    'RECOVERY_CODE_USED', 'CREDENTIAL_DISABLED', 'CREDENTIAL_ROTATED'
  )),
  source_class TEXT NOT NULL DEFAULT 'LAN',
  event_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS local_pilot_control (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  mode TEXT NOT NULL DEFAULT 'synthetic-demo' CHECK (mode IN ('synthetic-demo', 'controlled-client-pilot')),
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 30),
  client_approval_sha256 TEXT,
  security_review_sha256 TEXT,
  backup_restore_sha256 TEXT,
  client_configuration_sha256 TEXT,
  activated_at TIMESTAMPTZ,
  activated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ended_at TIMESTAMPTZ,
  ended_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO local_pilot_control(singleton, mode) VALUES (TRUE, 'synthetic-demo') ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS local_backup_runs (
  id UUID PRIMARY KEY,
  repository_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED', 'RESTORE_VERIFIED')),
  manifest_sha256 TEXT CHECK (manifest_sha256 IS NULL OR manifest_sha256 ~ '^[a-f0-9]{64}$'),
  completed_at TIMESTAMPTZ NOT NULL,
  event_json JSONB NOT NULL DEFAULT '{}'::jsonb
);
