CREATE TABLE IF NOT EXISTS local_receipt_queue (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  receipt_id UUID NOT NULL,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_until TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, receipt_id)
);

CREATE INDEX IF NOT EXISTS local_receipt_queue_delivery_idx
  ON local_receipt_queue(status, available_at, locked_until, created_at);

ALTER TABLE local_receipt_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_receipt_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON local_receipt_queue;
CREATE POLICY tenant_isolation ON local_receipt_queue
  USING (organization_id = challanse_current_organization_id())
  WITH CHECK (organization_id = challanse_current_organization_id());
