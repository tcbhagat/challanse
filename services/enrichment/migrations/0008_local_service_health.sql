CREATE TABLE IF NOT EXISTS local_service_health (
  service_name TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('READY', 'UNAVAILABLE')),
  model_name TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

REVOKE ALL ON TABLE local_service_health FROM PUBLIC;
