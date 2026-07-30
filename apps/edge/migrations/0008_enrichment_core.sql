-- Migration 0008: Enrichment service core tables (D1-compatible)
-- Ported from services/enrichment/migrations/ with PostgreSQL→SQLite adaptations:
--   UUID → TEXT, JSONB → TEXT, TIMESTAMPTZ → TEXT, BYTEA → TEXT (base64)
--   NOW() → CURRENT_TIMESTAMP, DOUBLE PRECISION → REAL
--   CHECK constraints with regex → application-level validation

-- Organizations (multi-tenant root entity)
CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  device_limit INTEGER NOT NULL DEFAULT 100,
  device_request_limit_per_minute INTEGER NOT NULL DEFAULT 60,
  daily_receipt_limit INTEGER NOT NULL DEFAULT 1000,
  storage_byte_limit INTEGER NOT NULL DEFAULT 5000000000,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE sites ADD COLUMN organization_id TEXT REFERENCES organizations(id);
ALTER TABLE sites ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sites ADD COLUMN image_byte_limit INTEGER NOT NULL DEFAULT 5000000;
ALTER TABLE sites ADD COLUMN storage_byte_limit INTEGER NOT NULL DEFAULT 5000000000;

-- Enrichment receipts (processed receipt data)
CREATE TABLE IF NOT EXISTS enrichment_receipts (
  receipt_id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  captured_at_unix INTEGER NOT NULL,
  site_captured_quantity REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  raw_ocr_json TEXT NOT NULL DEFAULT '{}',
  raw_text TEXT NOT NULL DEFAULT '',
  ocr_confidence REAL,
  gps_latitude REAL,
  gps_longitude REAL,
  gst_status TEXT NOT NULL DEFAULT 'NOT_CHECKED',
  audit_trail TEXT NOT NULL DEFAULT '[]',
  version INTEGER NOT NULL DEFAULT 1,
  image_sha256 TEXT,
  image_bytes INTEGER,
  provider_version TEXT NOT NULL DEFAULT '',
  processing_started_at TEXT,
  processing_completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Receipt audit events (immutable audit log)
CREATE TABLE IF NOT EXISTS receipt_audit_events (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (receipt_id) REFERENCES enrichment_receipts(receipt_id)
);
CREATE INDEX IF NOT EXISTS idx_receipt_audit_receipt ON receipt_audit_events(receipt_id, created_at);

-- Vendor integration profiles (per-site vendor config)
CREATE TABLE IF NOT EXISTS vendor_integration_profiles (
  site_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  vendor_gst_number TEXT,
  vendor_gst_number_encrypted TEXT,
  msme_udyam_number TEXT,
  msme_udyam_number_encrypted TEXT,
  recipient_bank_account TEXT,
  recipient_bank_account_encrypted TEXT,
  site_geo_hash TEXT NOT NULL DEFAULT '',
  material_description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (site_id, vendor_id)
);

-- Site integration profiles
CREATE TABLE IF NOT EXISTS site_integration_profiles (
  site_id TEXT PRIMARY KEY,
  developer_gst_number_encrypted TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Service ingress requests (request deduplication)
CREATE TABLE IF NOT EXISTS service_ingress_requests (
  request_id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL UNIQUE,
  key_id TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RESERVED',
  task_id TEXT,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  queued_at TEXT
);

-- Workflow stages (OCR processing pipeline tracking)
CREATE TABLE IF NOT EXISTS workflow_stages (
  receipt_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PROCESSING',
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error_code TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (receipt_id, stage)
);

-- Transactional outbox (event-driven outbox pattern)
CREATE TABLE IF NOT EXISTS transactional_outbox (
  id TEXT PRIMARY KEY,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (aggregate_id, event_type, event_version)
);
CREATE INDEX IF NOT EXISTS idx_outbox_pending ON transactional_outbox(status, available_at);

-- Tally import rows (Purchase Order data from Tally CSV)
CREATE TABLE IF NOT EXISTS tally_imports (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  checksum TEXT NOT NULL,
  imported_by TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (site_id, checksum)
);

CREATE TABLE IF NOT EXISTS tally_import_rows (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  po_number TEXT NOT NULL,
  material_code TEXT NOT NULL,
  quantity REAL NOT NULL CHECK(quantity >= 0),
  unit TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (import_id) REFERENCES tally_imports(id),
  UNIQUE (import_id, po_number, material_code, unit)
);
CREATE INDEX IF NOT EXISTS idx_tally_rows_site ON tally_import_rows(site_id, po_number, material_code, unit);

-- Verified receipts (reviewer-verified receipt data for reconciliation)
CREATE TABLE IF NOT EXISTS verified_receipts (
  receipt_id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  po_number TEXT NOT NULL,
  material_code TEXT NOT NULL,
  verified_quantity REAL NOT NULL CHECK(verified_quantity > 0),
  unit TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  review_version INTEGER NOT NULL,
  reviewed_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_verified_receipts_site ON verified_receipts(site_id, po_number, material_code, unit);

-- Notification digests
CREATE TABLE IF NOT EXISTS notification_digests (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  manager_id TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  receipt_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  body TEXT NOT NULL,
  provider_status TEXT NOT NULL DEFAULT 'DISABLED',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (site_id, manager_id, period_start, period_end)
);

-- Device enrollment codes (for edge-initiated enrollment)
ALTER TABLE enrollment_codes ADD COLUMN organization_id TEXT REFERENCES organizations(id);

-- Add organization_id to existing tables for multi-tenant support
ALTER TABLE devices ADD COLUMN organization_id TEXT REFERENCES organizations(id);
ALTER TABLE reviewers ADD COLUMN organization_id TEXT REFERENCES organizations(id);
ALTER TABLE reviewers ADD COLUMN subject TEXT NOT NULL DEFAULT '';
ALTER TABLE reviewers ADD COLUMN issuer TEXT NOT NULL DEFAULT '';
