CREATE TABLE upload_sessions (
  id TEXT PRIMARY KEY,
  receipt_id TEXT NOT NULL UNIQUE,
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  metadata_json TEXT NOT NULL,
  total_bytes INTEGER NOT NULL CHECK(total_bytes > 0 AND total_bytes <= 750000),
  image_sha256 TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type = 'image/webp'),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'COMPLETE', 'ABORTED')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
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
