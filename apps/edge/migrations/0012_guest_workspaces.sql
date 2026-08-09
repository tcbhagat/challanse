CREATE TABLE guest_workspaces (
  id TEXT PRIMARY KEY,
  identity_hash TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  csrf_hash TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  consent_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('READY', 'PROCESSING', 'READY_TO_CONFIRM', 'COMPLETED', 'NEEDS_CORRECTION', 'DELETED')),
  expires_at TEXT NOT NULL,
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_guest_workspaces_identity ON guest_workspaces(identity_hash, expires_at, deleted_at);
CREATE INDEX idx_guest_workspaces_expiry ON guest_workspaces(expires_at, deleted_at);

CREATE TABLE guest_uploads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES guest_workspaces(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  declared_mime_type TEXT NOT NULL,
  total_bytes INTEGER NOT NULL,
  expected_sha256 TEXT NOT NULL,
  received_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('UPLOADING', 'COMPLETED', 'DELETED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE guest_upload_parts (
  upload_id TEXT NOT NULL REFERENCES guest_uploads(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  byte_offset INTEGER NOT NULL,
  byte_length INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (upload_id, part_number)
);

CREATE TABLE guest_receipts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES guest_workspaces(id) ON DELETE CASCADE,
  upload_id TEXT NOT NULL UNIQUE REFERENCES guest_uploads(id),
  image_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  image_bytes INTEGER NOT NULL,
  image_sha256 TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PROCESSING', 'READY_TO_CONFIRM', 'COMPLETED', 'NEEDS_CORRECTION', 'DELETED')),
  extracted_json TEXT NOT NULL DEFAULT '{}',
  confirmed_json TEXT NOT NULL DEFAULT '{}',
  reserved_neurons INTEGER NOT NULL DEFAULT 0,
  actual_neurons INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE guest_daily_usage (
  usage_day TEXT PRIMARY KEY,
  accepted_uploads INTEGER NOT NULL DEFAULT 0,
  reserved_neurons INTEGER NOT NULL DEFAULT 0,
  actual_neurons INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE guest_identity_usage (
  usage_day TEXT NOT NULL,
  identity_hash TEXT NOT NULL,
  accepted_uploads INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (usage_day, identity_hash)
);

CREATE TABLE guest_ip_usage (
  usage_day TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (usage_day, ip_hash)
);

CREATE TABLE guest_security_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT,
  identity_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_guest_events_expiry ON guest_security_events(created_at);
