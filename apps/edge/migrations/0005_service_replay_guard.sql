CREATE TABLE service_request_nonces (
  request_id TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_service_request_nonces_expiry ON service_request_nonces(expires_at);
