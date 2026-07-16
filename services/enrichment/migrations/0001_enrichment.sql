CREATE TABLE IF NOT EXISTS enrichment_receipts (
  receipt_id UUID PRIMARY KEY,
  site_id UUID NOT NULL,
  vendor_id TEXT NOT NULL,
  captured_at_unix BIGINT NOT NULL,
  site_captured_quantity DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL,
  raw_ocr_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_text TEXT NOT NULL DEFAULT '',
  ocr_confidence DOUBLE PRECISION,
  gps_latitude DOUBLE PRECISION,
  gps_longitude DOUBLE PRECISION,
  gst_status TEXT NOT NULL DEFAULT 'NOT_CHECKED',
  audit_trail JSONB NOT NULL DEFAULT '[]'::jsonb,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vendor_integration_profiles (
  site_id UUID NOT NULL,
  vendor_id TEXT NOT NULL,
  vendor_gst_number TEXT,
  msme_udyam_number TEXT,
  recipient_bank_account TEXT,
  site_geo_hash TEXT NOT NULL DEFAULT '',
  material_description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (site_id, vendor_id)
);

CREATE TABLE IF NOT EXISTS tally_imports (
  id UUID PRIMARY KEY,
  site_id UUID NOT NULL,
  checksum TEXT NOT NULL,
  imported_by TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, checksum)
);

CREATE TABLE IF NOT EXISTS immutable_enrichment_audits (
  id UUID PRIMARY KEY,
  receipt_id UUID NOT NULL REFERENCES enrichment_receipts(receipt_id),
  event_type TEXT NOT NULL,
  event_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
