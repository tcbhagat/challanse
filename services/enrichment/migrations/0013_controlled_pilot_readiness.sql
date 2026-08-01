ALTER TABLE local_pilot_control
  ADD COLUMN IF NOT EXISTS android_field_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS operations_acceptance_sha256 TEXT,
  ADD COLUMN IF NOT EXISTS readiness_manifest_sha256 TEXT;

ALTER TABLE local_pilot_control DROP CONSTRAINT IF EXISTS local_pilot_control_android_field_sha256_check;
ALTER TABLE local_pilot_control ADD CONSTRAINT local_pilot_control_android_field_sha256_check
  CHECK (android_field_sha256 IS NULL OR android_field_sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE local_pilot_control DROP CONSTRAINT IF EXISTS local_pilot_control_operations_acceptance_sha256_check;
ALTER TABLE local_pilot_control ADD CONSTRAINT local_pilot_control_operations_acceptance_sha256_check
  CHECK (operations_acceptance_sha256 IS NULL OR operations_acceptance_sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE local_pilot_control DROP CONSTRAINT IF EXISTS local_pilot_control_readiness_manifest_sha256_check;
ALTER TABLE local_pilot_control ADD CONSTRAINT local_pilot_control_readiness_manifest_sha256_check
  CHECK (readiness_manifest_sha256 IS NULL OR readiness_manifest_sha256 ~ '^[a-f0-9]{64}$');
