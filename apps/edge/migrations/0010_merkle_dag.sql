-- Migration 0010: Merkle DAG Audit Trail
-- Phase 3: Extends the existing audit chain into a full Merkle DAG with
-- fork detection, branch verification, and tamper-evident reconciliation proofs.
-- Tables are created with IF NOT EXISTS for idempotent application.

-- ── Audit chains (scope-level chain root) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_chains (
  chain_id TEXT PRIMARY KEY,         -- 'org:<org_id>' or 'org:<org_id>:site:<site_id>'
  head_hash TEXT NOT NULL,            -- current tip of the chain (hash of last event)
  event_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Audit events (immutable, hash-linked) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL REFERENCES audit_chains(chain_id),
  event_type TEXT NOT NULL,
  event_json TEXT NOT NULL,           -- canonical JSON string
  previous_hash TEXT NOT NULL DEFAULT '',
  event_hash TEXT NOT NULL,           -- SHA256(previous_hash + ':' + canonical(event_json))
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_events_chain
  ON audit_events(chain_id, created_at, event_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_prev_hash
  ON audit_events(previous_hash);

-- ── Fork records (detected chain forks) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS chain_forks (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL REFERENCES audit_chains(chain_id),
  parent_event_id TEXT NOT NULL REFERENCES audit_events(event_id),
  fork_event_id_1 TEXT NOT NULL REFERENCES audit_events(event_id),
  fork_event_id_2 TEXT NOT NULL REFERENCES audit_events(event_id),
  fork_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chain_forks_chain
  ON chain_forks(chain_id, resolved);

-- ── Integrity alerts (triggered by verification failures) ────────────────────
CREATE TABLE IF NOT EXISTS integrity_alerts (
  id TEXT PRIMARY KEY,
  chain_id TEXT NOT NULL REFERENCES audit_chains(chain_id),
  alert_type TEXT NOT NULL,           -- 'HASH_MISMATCH', 'FORK_DETECTED', 'CHAIN_BROKEN'
  alert_detail TEXT NOT NULL DEFAULT '{}',
  severity TEXT NOT NULL DEFAULT 'WARNING',  -- 'INFO', 'WARNING', 'CRITICAL'
  acknowledged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_integrity_alerts_chain
  ON integrity_alerts(chain_id, created_at);
