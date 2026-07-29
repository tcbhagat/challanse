-- Migration 0011: Support manual invoice entries (one invoice at a time, no device/image)
ALTER TABLE receipts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MOBILE'
  CHECK (source IN ('MOBILE', 'MANUAL'));

ALTER TABLE receipts ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE receipts ALTER COLUMN image_key DROP NOT NULL;
ALTER TABLE receipts ALTER COLUMN image_bytes DROP NOT NULL;
ALTER TABLE receipts ALTER COLUMN app_version DROP NOT NULL;
ALTER TABLE receipts ALTER COLUMN configuration_version DROP NOT NULL;

ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_image_bytes_check;
ALTER TABLE receipts ADD CONSTRAINT receipts_image_bytes_check
  CHECK (image_bytes IS NULL OR image_bytes > 0);

ALTER TABLE receipts DROP CONSTRAINT IF EXISTS receipts_image_sha256_check;
ALTER TABLE receipts ALTER COLUMN image_sha256 DROP NOT NULL;
ALTER TABLE receipts ADD CONSTRAINT receipts_image_sha256_check
  CHECK (image_sha256 IS NULL OR image_sha256 ~ '^[a-f0-9]{64}$');
