-- Migration 0011: Pilot schema completion for the local edge/D1 path
--
-- Completes the D1 schema so the edge handlers match the acceptance contract:
--   * enrollment_codes: id / code / active (handleEnroll SELECT + admin upsert)
--   * receipts:         mime_type (accepted by the upload handler)
--   * vendors:          organization_id + updated_at (admin vendor upsert)
--   * reviewers:        updated_at (admin membership upsert)
--   * upload_sessions:  rebuilt (v2) to the handler INSERT/UPDATE contract
--   * device_nonces:    nonce replay protection (consumeNonce)
--   * telemetry_measurements: mobile telemetry storage
--
-- D1 applies migrations in order on a fresh database, so every table is empty
-- when this file runs; the backfills below are no-ops in the normal path but
-- are included for safety when applied to an existing dev database.

-- ── enrollment_codes: id / code / active ─────────────────────────────────────
ALTER TABLE enrollment_codes ADD COLUMN id TEXT;
ALTER TABLE enrollment_codes ADD COLUMN code TEXT;
ALTER TABLE enrollment_codes ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
UPDATE enrollment_codes SET id = code_hash WHERE id IS NULL;
UPDATE enrollment_codes SET code = code_hash WHERE code IS NULL;

-- ── receipts: mime_type (image/webp enforced at the application layer) ───────
ALTER TABLE receipts ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'image/webp';

-- ── vendors: organization_id + updated_at ────────────────────────────────────
ALTER TABLE vendors ADD COLUMN organization_id TEXT REFERENCES organizations(id);
UPDATE vendors
   SET organization_id = (SELECT organization_id FROM sites WHERE sites.id = vendors.site_id)
 WHERE organization_id IS NULL;
ALTER TABLE vendors ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── reviewers: updated_at ────────────────────────────────────────────────────
ALTER TABLE reviewers ADD COLUMN updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ── upload_sessions: rebuild to the edge handler contract ────────────────────
-- The 0003 table required metadata_json / expires_at / image_sha256 at INSERT
-- time and allowed only OPEN/COMPLETE/ABORTED statuses, while the edge handler
-- omits those columns and writes IN_PROGRESS / PARTS_UPLOADED / COMPLETED.
-- SQLite cannot ALTER an existing column's default or check, so the table is
-- rebuilt with handler-compatible defaults, checks, and additional columns
-- (organization_id, uploaded_bytes, declared_sha256, cdn_domain, url_path,
-- uploaded_at). Existing upload_parts must be copied before the old parent is
-- dropped because its ON DELETE CASCADE would otherwise erase interrupted
-- upload progress during the upgrade.
CREATE TABLE upload_sessions_v2 (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  total_bytes INTEGER NOT NULL CHECK(total_bytes > 0 AND total_bytes <= 10000000),
  uploaded_bytes INTEGER NOT NULL DEFAULT 0 CHECK(uploaded_bytes >= 0),
  image_sha256 TEXT NOT NULL DEFAULT '',
  declared_sha256 TEXT NOT NULL DEFAULT '',
  mime_type TEXT NOT NULL CHECK(mime_type = 'image/webp'),
  status TEXT NOT NULL DEFAULT 'IN_PROGRESS'
    CHECK(status IN ('IN_PROGRESS', 'PARTS_UPLOADED', 'COMPLETED', 'ABORTED')),
  cdn_domain TEXT NOT NULL DEFAULT '',
  url_path TEXT NOT NULL DEFAULT '',
  uploaded_at TEXT,
  expires_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Backfill column/value alignment (18 target columns, 18 SELECT values):
--   cdn_domain = ''        (NOT NULL DEFAULT '')
--   url_path   = ''        (NOT NULL DEFAULT '')
--   uploaded_at = NULL     (nullable; legacy rows have no completed-upload time)
INSERT INTO upload_sessions_v2 (
  id, receipt_id, site_id, device_id, organization_id, metadata_json,
  total_bytes, uploaded_bytes, image_sha256, declared_sha256, mime_type,
  status, cdn_domain, url_path, uploaded_at, expires_at, created_at, updated_at
)
SELECT us.id, us.receipt_id, us.site_id, us.device_id, s.organization_id,
       COALESCE(us.metadata_json, '{}'), us.total_bytes, 0,
       us.image_sha256, us.image_sha256, us.mime_type,
       CASE us.status
         WHEN 'OPEN' THEN 'IN_PROGRESS'
         WHEN 'COMPLETE' THEN 'COMPLETED'
         ELSE 'ABORTED'
       END,
       '', '', NULL, COALESCE(us.expires_at, CURRENT_TIMESTAMP),
       us.created_at, us.updated_at
  FROM upload_sessions us
  LEFT JOIN sites s ON s.id = us.site_id;

CREATE TABLE upload_parts_backup AS
SELECT upload_id, part_number, byte_offset, byte_length, sha256, object_key, created_at
  FROM upload_parts;
DROP TABLE upload_parts;
DROP TABLE upload_sessions;
ALTER TABLE upload_sessions_v2 RENAME TO upload_sessions;
CREATE INDEX upload_sessions_expiry_idx ON upload_sessions(status, expires_at);

CREATE TABLE upload_parts (
  upload_id TEXT NOT NULL REFERENCES upload_sessions(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL CHECK(part_number >= 0),
  byte_offset INTEGER NOT NULL CHECK(byte_offset >= 0),
  byte_length INTEGER NOT NULL CHECK(byte_length > 0 AND byte_length <= 256000),
  sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(upload_id, part_number)
);
INSERT INTO upload_parts (
  upload_id, part_number, byte_offset, byte_length, sha256, object_key, created_at
)
SELECT upload_id, part_number, byte_offset, byte_length, sha256, object_key, created_at
  FROM upload_parts_backup;
DROP TABLE upload_parts_backup;

-- ── device_nonces (nonce replay protection) ──────────────────────────────────
CREATE TABLE device_nonces (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX device_nonces_lookup_idx ON device_nonces(device_id, nonce);

-- ── telemetry_measurements (mobile telemetry) ────────────────────────────────
CREATE TABLE telemetry_measurements (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id),
  metric_name TEXT NOT NULL,
  metric_value REAL NOT NULL DEFAULT 0,
  tags_json TEXT NOT NULL DEFAULT '{}',
  recorded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX telemetry_measurements_device_idx ON telemetry_measurements(device_id, recorded_at);
