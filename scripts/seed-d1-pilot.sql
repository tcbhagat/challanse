-- seed-d1-pilot.sql
-- Sanctioned D1 synthetic pilot seeder (edge/D1 path only).
--
-- Mirrors the Postgres synthetic tenants created by services/enrichment/app/
-- local_seed.py (pilot) and local_acceptance.py (acceptance) so the edge can
-- serve the mobile bootstrap and the acceptance contract entirely from D1:
--   * pilot tenant     org 10000000-...-0001 / site 20000000-...-0001
--   * acceptance tenant org 10000000-...-0002 / site 20000000-...-0002
--
-- The edge applies migrations 0001-0011 (fresh D1 on a tmpfs) and then runs
-- this file, so every table is empty when it executes. DELETE-then-INSERT keeps
-- a manual re-run idempotent (acts as a synthetic reset). Synthetic data only.
--
-- The dynamic, per-run enrollment codes used by scripts/local-pilot.sh (from
-- app.local_enroll / app.local_acceptance) are inserted at runtime through the
-- edge bridge POST /v1/local/enrollment-codes, not by this file. This file
-- seeds one baseline pilot code for direct mobile-link testing.

PRAGMA foreign_keys = ON;

-- ── Reset (reverse dependency order) ─────────────────────────────────────────
DELETE FROM enrollment_codes;
DELETE FROM reviewers;
DELETE FROM vendors;
DELETE FROM sites;
DELETE FROM organizations;

-- ── Pilot tenant (local_seed.py) ─────────────────────────────────────────────
INSERT INTO organizations (
  id, name, active, device_limit, device_request_limit_per_minute,
  daily_receipt_limit, storage_byte_limit, created_at, updated_at
) VALUES (
  '10000000-0000-4000-8000-000000000001', 'Synthetic Client Test', 1, 5, 60,
  50, 5000000000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO sites (
  id, name, active, allowed_wifi_ssids_json, configuration_version,
  daily_receipt_limit, image_byte_limit, storage_byte_limit, stored_image_bytes,
  created_at, updated_at, organization_id
) VALUES (
  '20000000-0000-4000-8000-000000000001', 'Synthetic Construction Site', 1,
  '["SYNTHETIC-SITE-WIFI"]', 1, 50, 750000, 5000000000, 0,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
  '10000000-0000-4000-8000-000000000001'
);

INSERT INTO reviewers (
  email, site_id, role, active, created_at, organization_id, subject, issuer, updated_at
) VALUES
  ('admin@constrovet.com', '20000000-0000-4000-8000-000000000001', 'ADMIN', 1,
   CURRENT_TIMESTAMP, '10000000-0000-4000-8000-000000000001',
   'local:admin@constrovet.com', 'https://local-pilot.challanse', CURRENT_TIMESTAMP),
  ('bhagat.taran@gmail.com', '20000000-0000-4000-8000-000000000001', 'CONTROLLER', 1,
   CURRENT_TIMESTAMP, '10000000-0000-4000-8000-000000000001',
   'local:bhagat.taran@gmail.com', 'https://local-pilot.challanse', CURRENT_TIMESTAMP);

INSERT INTO vendors (
  id, site_id, name, initials, color, display_order, active, organization_id, created_at, updated_at
) VALUES
  ('vendor-cement', '20000000-0000-4000-8000-000000000001', 'Synthetic Cement Co', 'SC', '#F59E0B', 0, 1,
   '10000000-0000-4000-8000-000000000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('vendor-steel', '20000000-0000-4000-8000-000000000001', 'Synthetic Steel Works', 'SS', '#0F766E', 1, 1,
   '10000000-0000-4000-8000-000000000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('vendor-sand', '20000000-0000-4000-8000-000000000001', 'Synthetic Sand Supply', 'MS', '#2563EB', 2, 1,
   '10000000-0000-4000-8000-000000000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('vendor-brick', '20000000-0000-4000-8000-000000000001', 'Synthetic Brick Yard', 'FB', '#DC2626', 3, 1,
   '10000000-0000-4000-8000-000000000001', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Baseline pilot enrollment code (synthetic, mobile-link testing only).
INSERT INTO enrollment_codes (
  code_hash, site_id, device_name, expires_at, created_by, used_at,
  created_at, used_by_device_id, organization_id, id, code, active
) VALUES (
  'seed:Synthetic Pilot Code 0001',
  '20000000-0000-4000-8000-000000000001', 'Pilot Device',
  datetime('now', '+30 days'), 'local-pilot-seeder', NULL,
  CURRENT_TIMESTAMP, NULL,
  '10000000-0000-4000-8000-000000000001',
  'seed:00000000-0000-4000-8000-000000000001',
  'SYNTHETIC-PILOT-0001', 1
);

-- ── Acceptance tenant (local_acceptance.py) ──────────────────────────────────
INSERT INTO organizations (
  id, name, active, device_limit, device_request_limit_per_minute,
  daily_receipt_limit, storage_byte_limit, created_at, updated_at
) VALUES (
  '10000000-0000-4000-8000-000000000002', 'Synthetic Acceptance Workload', 1, 5, 60,
  1000, 5000000000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

INSERT INTO sites (
  id, name, active, allowed_wifi_ssids_json, configuration_version,
  daily_receipt_limit, image_byte_limit, storage_byte_limit, stored_image_bytes,
  created_at, updated_at, organization_id
) VALUES (
  '20000000-0000-4000-8000-000000000002', 'Synthetic Acceptance Site', 1,
  '["SYNTHETIC-ACCEPTANCE-WIFI"]', 1, 100, 750000, 5000000000, 0,
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
  '10000000-0000-4000-8000-000000000002'
);

INSERT INTO reviewers (
  email, site_id, role, active, created_at, organization_id, subject, issuer, updated_at
) VALUES (
  'acceptance@synthetic.invalid', '20000000-0000-4000-8000-000000000002', 'ADMIN', 1,
  CURRENT_TIMESTAMP, '10000000-0000-4000-8000-000000000002',
  'local:acceptance', 'https://local-acceptance.challanse', CURRENT_TIMESTAMP
);

INSERT INTO vendors (
  id, site_id, name, initials, color, display_order, active, organization_id, created_at, updated_at
) VALUES
  ('accept-cement', '20000000-0000-4000-8000-000000000002', 'Acceptance Cement', 'AC', '#F59E0B', 0, 1,
   '10000000-0000-4000-8000-000000000002', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('accept-steel', '20000000-0000-4000-8000-000000000002', 'Acceptance Steel', 'AS', '#0F766E', 1, 1,
   '10000000-0000-4000-8000-000000000002', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('accept-sand', '20000000-0000-4000-8000-000000000002', 'Acceptance Sand', 'AM', '#2563EB', 2, 1,
   '10000000-0000-4000-8000-000000000002', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('accept-brick', '20000000-0000-4000-8000-000000000002', 'Acceptance Brick', 'AB', '#DC2626', 3, 1,
   '10000000-0000-4000-8000-000000000002', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
