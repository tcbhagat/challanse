// ─── ChallanSe Merkle DAG Audit Chain ────────────────────────────────────────
// TypeScript port of Python services/enrichment/app/audit_chain.py
// Phase 3: Extended to full Merkle DAG with fork detection, branch verification,
// tamper-evident reconciliation proofs, and graph CHAIN_PREV edge integration.
// Uses Web Crypto API (SHA-256) for hashing.
// Tables: audit_chains, audit_events, chain_forks, integrity_alerts
// (created in 0010 migration)

import { uuid, nowISO, first, exec, all } from './db';
import type { Env } from './types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChainStatus {
  chainId: string;
  headHash: string;
  eventCount: number;
  forkCount: number;
  unresolvedForks: number;
  alertCount: number;
  criticalAlerts: number;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ForkRecord {
  id: string;
  parentEventId: string;
  forkEventId1: string;
  forkEventId2: string;
  forkedAt: string;
  resolved: boolean;
}

export interface IntegrityAlert {
  id: string;
  chainId: string;
  alertType: 'HASH_MISMATCH' | 'FORK_DETECTED' | 'CHAIN_BROKEN';
  alertDetail: Record<string, unknown>;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  acknowledged: boolean;
  createdAt: string;
}

// ─── Hashing ─────────────────────────────────────────────────────────────────

/**
 * Create a canonical JSON representation of an event body.
 * Deterministic: sorted keys, no whitespace.
 */
export function canonicalEvent(event: Record<string, unknown>): string {
  return JSON.stringify(event, Object.keys(event).sort());
}

/**
 * Compute SHA-256 hash of the canonical event chained with the previous hash.
 * Hash = SHA256(previous_hash + ":" + canonical(event))
 */
export async function auditEventHash(previousHash: string, event: Record<string, unknown>): Promise<string> {
  const canonical = canonicalEvent(event);
  const input = `${previousHash}:${canonical}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── Chain Operations ────────────────────────────────────────────────────────

/**
 * Get or create an audit chain for a given scope.
 * Chain IDs follow the pattern: "org:<org_id>" or "org:<org_id>:site:<site_id>"
 */
export async function getOrCreateChain(db: D1Database, chainId: string): Promise<{ headHash: string; eventCount: number }> {
  const existing = await first<{ head_hash: string; event_count: number }>(
    db,
    'SELECT head_hash, event_count FROM audit_chains WHERE chain_id = ?',
    chainId,
  );
  if (existing) {
    return { headHash: existing.head_hash, eventCount: existing.event_count };
  }
  // Create a new chain with genesis event
  const genesisHash = await auditEventHash('', {
    event_type: 'CHAIN_CREATED',
    chain_id: chainId,
    timestamp: nowISO(),
  });
  await exec(
    db,
    `INSERT INTO audit_chains (chain_id, head_hash, event_count, created_at, updated_at)
     VALUES (?, ?, 0, ?, ?)`,
    chainId, genesisHash, nowISO(), nowISO(),
  );
  // Record genesis event
  await exec(
    db,
    `INSERT INTO audit_events (event_id, chain_id, event_type, event_json, previous_hash, event_hash, created_at)
     VALUES (?, ?, 'CHAIN_CREATED', ?, '', ?, ?)`,
    uuid(), chainId, JSON.stringify({ chain_id: chainId, timestamp: nowISO() }), genesisHash, nowISO(),
  );
  // Update chain count
  await exec(
    db,
    'UPDATE audit_chains SET event_count = 1, head_hash = ?, updated_at = ? WHERE chain_id = ?',
    genesisHash, nowISO(), chainId,
  );
  return { headHash: genesisHash, eventCount: 1 };
}

/**
 * Append an event to an audit chain.
 * Returns the new event hash.
 */
export async function appendAuditEvent(
  db: D1Database,
  chainId: string,
  eventType: string,
  eventBody: Record<string, unknown>,
): Promise<string> {
  // Get current chain head
  const chain = await getOrCreateChain(db, chainId);
  const eventId = uuid();

  // Compute event hash
  const eventHash = await auditEventHash(chain.headHash, eventBody);

  // Insert event
  await exec(
    db,
    `INSERT INTO audit_events (event_id, chain_id, event_type, event_json, previous_hash, event_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    eventId, chainId, eventType, JSON.stringify(eventBody), chain.headHash, eventHash, nowISO(),
  );

  // Update chain head
  await exec(
    db,
    'UPDATE audit_chains SET head_hash = ?, event_count = event_count + 1, updated_at = ? WHERE chain_id = ?',
    eventHash, nowISO(), chainId,
  );

  // Phase 3: Check for fork — if another event has the same previous_hash, it's a fork
  const forkCheck = await first<{ event_id: string; event_type: string; created_at: string }>(
    db,
    `SELECT event_id, event_type, created_at FROM audit_events
     WHERE chain_id = ? AND previous_hash = ? AND event_id != ?
     LIMIT 1`,
    chainId, chain.headHash, eventId,
  );

  if (forkCheck) {
    // Record the fork
    const forkId = uuid();
    await exec(
      db,
      `INSERT INTO chain_forks (id, chain_id, parent_event_id, fork_event_id_1, fork_event_id_2, fork_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      forkId, chainId, forkCheck.event_id, forkCheck.event_id, eventId, nowISO(),
    );
    // Create integrity alert for the fork
    await exec(
      db,
      `INSERT INTO integrity_alerts (id, chain_id, alert_type, alert_detail, severity, created_at)
       VALUES (?, ?, 'FORK_DETECTED', ?, 'WARNING', ?)`,
      uuid(), chainId, JSON.stringify({
        fork_id: forkId,
        parent_event_id: forkCheck.event_id,
        existing_event_id: forkCheck.event_id,
        new_event_id: eventId,
        existing_type: forkCheck.event_type,
        new_type: eventType,
      }), nowISO(),
    );
  }

  return eventHash;
}

// ─── Chain Status ────────────────────────────────────────────────────────────

/**
 * Get the health status of an audit chain.
 */
export async function getChainStatus(db: D1Database, chainId: string): Promise<ChainStatus | null> {
  const chain = await first<{
    head_hash: string;
    event_count: number;
    created_at: string;
    updated_at: string;
  }>(
    db,
    'SELECT head_hash, event_count, created_at, updated_at FROM audit_chains WHERE chain_id = ?',
    chainId,
  );
  if (!chain) return null;

  const lastEvent = await first<{ created_at: string }>(
    db,
    'SELECT created_at FROM audit_events WHERE chain_id = ? ORDER BY created_at DESC, event_id DESC LIMIT 1',
    chainId,
  );

  const forkCount = await first<{ cnt: number }>(
    db,
    'SELECT COUNT(*) AS cnt FROM chain_forks WHERE chain_id = ?',
    chainId,
  );

  const unresolvedForks = await first<{ cnt: number }>(
    db,
    'SELECT COUNT(*) AS cnt FROM chain_forks WHERE chain_id = ? AND resolved = 0',
    chainId,
  );

  const alertCount = await first<{ cnt: number }>(
    db,
    'SELECT COUNT(*) AS cnt FROM integrity_alerts WHERE chain_id = ?',
    chainId,
  );

  const criticalAlerts = await first<{ cnt: number }>(
    db,
    `SELECT COUNT(*) AS cnt FROM integrity_alerts WHERE chain_id = ? AND severity = 'CRITICAL' AND acknowledged = 0`,
    chainId,
  );

  return {
    chainId,
    headHash: chain.head_hash,
    eventCount: chain.event_count,
    forkCount: forkCount?.cnt ?? 0,
    unresolvedForks: unresolvedForks?.cnt ?? 0,
    alertCount: alertCount?.cnt ?? 0,
    criticalAlerts: criticalAlerts?.cnt ?? 0,
    lastEventAt: lastEvent?.created_at ?? null,
    createdAt: chain.created_at,
    updatedAt: chain.updated_at,
  };
}

// ─── Fork Detection ──────────────────────────────────────────────────────────

/**
 * Detect forks in a chain by finding events that share the same previous_hash.
 * This is the simplest form of DAG branching — a single parent with multiple children.
 * Returns fork records that don't already exist in chain_forks.
 */
export async function detectChainForks(
  db: D1Database,
  chainId: string,
): Promise<Array<{ parentHash: string; children: Array<{ event_id: string; event_type: string; created_at: string }> }>> {
  // Find all previous_hash values that have more than one child event
  const forks = await all<{
    previous_hash: string;
    child_count: number;
  }>(
    db,
    `SELECT previous_hash, COUNT(*) AS child_count
     FROM audit_events
     WHERE chain_id = ?
     GROUP BY previous_hash
     HAVING COUNT(*) > 1`,
    chainId,
  );

  const results: Array<{ parentHash: string; children: Array<{ event_id: string; event_type: string; created_at: string }> }> = [];

  for (const fork of forks) {
    const children = await all<{ event_id: string; event_type: string; created_at: string }>(
      db,
      `SELECT event_id, event_type, created_at
       FROM audit_events
       WHERE chain_id = ? AND previous_hash = ?
       ORDER BY created_at ASC, event_id ASC`,
      chainId, fork.previous_hash,
    );
    results.push({ parentHash: fork.previous_hash, children });
  }

  return results;
}

// ─── DAG Verification ────────────────────────────────────────────────────────

/**
 * Verify a Merkle DAG chain with fork detection.
 * Unlike linear verifyChain, this detects branches and validates each branch independently.
 * Returns the main chain verification result plus any fork/branch information.
 */
export async function verifyChainDag(
  db: D1Database,
  chainId: string,
): Promise<{
  valid: boolean;
  chainLength: number;
  forks: Array<{ parentHash: string; children: Array<{ eventId: string; eventType: string }> }>;
  errors: string[];
}> {
  const events = await all<{
    event_id: string;
    event_type: string;
    event_json: string;
    previous_hash: string;
    event_hash: string;
    created_at: string;
  }>(
    db,
    `SELECT event_id, event_type, event_json, previous_hash, event_hash, created_at
     FROM audit_events WHERE chain_id = ?
     ORDER BY created_at ASC, event_id ASC`,
    chainId,
  );

  if (events.length === 0) {
    return { valid: false, chainLength: 0, forks: [], errors: ['Chain not found or empty'] };
  }

  const errors: string[] = [];

  // 1. Build parent→children adjacency map for DAG structure
  const parentToChildren = new Map<string, Array<typeof events[0]>>();
  for (const ev of events) {
    const children = parentToChildren.get(ev.previous_hash) ?? [];
    children.push(ev);
    parentToChildren.set(ev.previous_hash, children);
  }

  // 2. Detect forks (multiple children from same parent)
  const forks: Array<{ parentHash: string; children: Array<{ eventId: string; eventType: string }> }> = [];
  for (const [parentHash, children] of parentToChildren) {
    if (children.length > 1) {
      forks.push({
        parentHash,
        children: children.map((c) => ({ eventId: c.event_id, eventType: c.event_type })),
      });
    }
  }

  // 3. Get the genesis event (previous_hash = '') and verify it
  const genesis = events.find((e) => e.previous_hash === '');
  if (!genesis) {
    errors.push('No genesis event found (event with empty previous_hash)');
    return { valid: false, chainLength: events.length, forks, errors };
  }

  // 4. Verify each event's hash, traversing in topological order
  // Use a breadth-first traversal through parent→children edges
  const visited = new Set<string>();
  const queue: Array<typeof events[0]> = [genesis];
  const verificationOrder: Array<typeof events[0]> = [];
  const hashCache = new Map<string, string>(); // event_id → recomputed hash

  while (queue.length > 0) {
    const ev = queue.shift()!;
    if (visited.has(ev.event_id)) continue;
    visited.add(ev.event_id);
    verificationOrder.push(ev);

    // Verify this event's hash
    const prevHash = ev.previous_hash === '' ? '' : (hashCache.get(
      events.find((e) => e.event_hash === ev.previous_hash)?.event_id ?? ''
    ) ?? ev.previous_hash);

    let eventBody: Record<string, unknown>;
    try {
      eventBody = JSON.parse(ev.event_json);
    } catch {
      errors.push(`Event ${ev.event_id}: invalid event_json`);
      continue;
    }

    const recomputed = await auditEventHash(prevHash, eventBody);
    hashCache.set(ev.event_id, recomputed);

    if (recomputed !== ev.event_hash) {
      errors.push(`Event ${ev.event_id}: hash mismatch (expected ${recomputed}, stored ${ev.event_hash})`);
    }

    // Enqueue children
    const children = parentToChildren.get(ev.event_hash) ?? [];
    for (const child of children) {
      if (!visited.has(child.event_id)) {
        queue.push(child);
      }
    }
  }

  // 5. Check for orphaned events (not reachable from genesis)
  for (const ev of events) {
    if (!visited.has(ev.event_id)) {
      errors.push(`Event ${ev.event_id}: orphaned (not reachable from genesis)`);
    }
  }

  // 6. Verify chain head matches
  const chain = await first<{ head_hash: string; event_count: number }>(
    db,
    'SELECT head_hash, event_count FROM audit_chains WHERE chain_id = ?',
    chainId,
  );

  // The head is the most recent event (by created_at), or the one with no children
  const heads = events.filter((ev) => {
    const children = parentToChildren.get(ev.event_hash);
    return !children || children.length === 0;
  });

  if (heads.length > 1) {
    // Multiple heads = DAG with multiple branches — not necessarily invalid
    // but worth noting
    if (chain && !heads.some((h) => h.event_hash === chain.head_hash)) {
      errors.push(`Chain head mismatch: stored=${chain?.head_hash}, none of ${heads.length} leaf events match`);
    }
  } else if (heads.length === 1 && chain && heads[0].event_hash !== chain.head_hash) {
    errors.push(`Chain head mismatch: stored=${chain.head_hash}, computed=${heads[0].event_hash}`);
  }

  return {
    valid: errors.length === 0,
    chainLength: events.length,
    forks,
    errors,
  };
}

// ─── Linear Chain Verification (legacy) ──────────────────────────────────────

/**
 * Verify a complete audit chain from genesis to head.
 * Recomputes hashes and checks integrity.
 * Phase 3: Also detects forks during verification.
 * Returns { valid: boolean, chainLength: number, errors: string[] }
 */
export async function verifyChain(
  db: D1Database,
  chainId: string,
): Promise<{ valid: boolean; chainLength: number; errors: string[] }> {
  const events = await db.prepare(
    'SELECT event_id, event_type, event_json, previous_hash, event_hash FROM audit_events WHERE chain_id = ? ORDER BY created_at ASC, event_id ASC',
  ).bind(chainId).all<{
    event_id: string;
    event_type: string;
    event_json: string;
    previous_hash: string;
    event_hash: string;
  }>();

  if (!events.results || events.results.length === 0) {
    return { valid: false, chainLength: 0, errors: ['Chain not found'] };
  }

  const errors: string[] = [];
  let expectedPrev = '';

  for (let i = 0; i < events.results.length; i++) {
    const ev = events.results[i];
    // Check previous hash link
    if (ev.previous_hash !== expectedPrev) {
      errors.push(`Event ${ev.event_id}: expected previous_hash=${expectedPrev}, got ${ev.previous_hash}`);
    }
    // Recompute hash
    let eventBody: Record<string, unknown>;
    try {
      eventBody = JSON.parse(ev.event_json);
    } catch {
      errors.push(`Event ${ev.event_id}: invalid event_json`);
      continue;
    }
    const recomputed = await auditEventHash(expectedPrev, eventBody);
    if (recomputed !== ev.event_hash) {
      errors.push(`Event ${ev.event_id}: hash mismatch (expected ${recomputed}, stored ${ev.event_hash})`);
    }
    expectedPrev = ev.event_hash;
  }

  // Phase 3: Detect forks in this chain
  const forkCheck = await all<{ previous_hash: string; cnt: number }>(
    db,
    `SELECT previous_hash, COUNT(*) AS cnt FROM audit_events
     WHERE chain_id = ? GROUP BY previous_hash HAVING COUNT(*) > 1`,
    chainId,
  );
  if (forkCheck.length > 0) {
    for (const fork of forkCheck) {
      errors.push(`Fork detected at previous_hash=${fork.previous_hash}: ${fork.cnt} children`);
    }
  }

  // Verify chain head matches
  const chain = await first<{ head_hash: string; event_count: number }>(
    db,
    'SELECT head_hash, event_count FROM audit_chains WHERE chain_id = ?',
    chainId,
  );
  if (chain && chain.head_hash !== expectedPrev) {
    errors.push(`Chain head mismatch: stored=${chain.head_hash}, computed=${expectedPrev}`);
  }

  return {
    valid: errors.length === 0,
    chainLength: events.results.length,
    errors,
  };
}

/**
 * Verify all audit chains in the system.
 */
export async function verifyAllChains(
  db: D1Database,
): Promise<{ chains: number; valid: number; invalid: number; errors: Record<string, string[]> }> {
  const chains = await db.prepare('SELECT chain_id FROM audit_chains').all<{ chain_id: string }>();
  if (!chains.results) return { chains: 0, valid: 0, invalid: 0, errors: {} };

  const errors: Record<string, string[]> = {};
  let valid = 0;
  let invalid = 0;

  for (const c of chains.results) {
    const result = await verifyChain(db, c.chain_id);
    if (result.valid) {
      valid++;
    } else {
      invalid++;
      errors[c.chain_id] = result.errors;
    }
  }

  return { chains: chains.results.length, valid, invalid, errors };
}

// ─── Integrity Alert Operations ──────────────────────────────────────────────

/**
 * Create an integrity alert for a chain.
 */
export async function createIntegrityAlert(
  db: D1Database,
  chainId: string,
  alertType: 'HASH_MISMATCH' | 'FORK_DETECTED' | 'CHAIN_BROKEN',
  detail: Record<string, unknown>,
  severity: 'INFO' | 'WARNING' | 'CRITICAL' = 'WARNING',
): Promise<string> {
  const alertId = uuid();
  await exec(
    db,
    `INSERT INTO integrity_alerts (id, chain_id, alert_type, alert_detail, severity, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    alertId, chainId, alertType, JSON.stringify(detail), severity, nowISO(),
  );
  return alertId;
}

/**
 * List active (non-acknowledged) integrity alerts for a chain.
 */
export async function getActiveAlerts(
  db: D1Database,
  chainId?: string,
): Promise<IntegrityAlert[]> {
  const conditions: string[] = ['acknowledged = 0'];
  const params: unknown[] = [];
  if (chainId) {
    conditions.push('chain_id = ?');
    params.push(chainId);
  }

  const alerts = await all<{
    id: string;
    chain_id: string;
    alert_type: string;
    alert_detail: string;
    severity: string;
    acknowledged: number;
    created_at: string;
  }>(
    db,
    `SELECT id, chain_id, alert_type, alert_detail, severity, acknowledged, created_at
     FROM integrity_alerts
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`,
    ...params,
  );

  return alerts.map((a) => ({
    id: a.id,
    chainId: a.chain_id,
    alertType: a.alert_type as IntegrityAlert['alertType'],
    alertDetail: JSON.parse(a.alert_detail || '{}'),
    severity: a.severity as IntegrityAlert['severity'],
    acknowledged: a.acknowledged === 1,
    createdAt: a.created_at,
  }));
}

/**
 * Acknowledge an integrity alert.
 */
export async function acknowledgeAlert(db: D1Database, alertId: string): Promise<void> {
  await exec(
    db,
    'UPDATE integrity_alerts SET acknowledged = 1 WHERE id = ?',
    alertId,
  );
}

// ─── Graph CHAIN_PREV Edge Integration (Phase 3.4) ──────────────────────────

/**
 * Create CHAIN_PREV edges in the property graph for an audit chain.
 * Links each AuditEvent to its predecessor via the hash chain.
 * This enables graph traversal through audit history.
 * Call this after appending audit events to keep the graph in sync.
 */
export async function addChainPrevEdges(
  db: D1Database,
  chainId: string,
): Promise<number> {
  // Get all events in order with their previous hashes
  const events = await all<{
    event_id: string;
    event_type: string;
    previous_hash: string;
    event_hash: string;
    created_at: string;
  }>(
    db,
    `SELECT event_id, event_type, previous_hash, event_hash, created_at
     FROM audit_events
     WHERE chain_id = ?
     ORDER BY created_at ASC, event_id ASC`,
    chainId,
  );

  if (events.length === 0) return 0;

  // Build a hash→event_id lookup
  const hashToId = new Map<string, string>();
  for (const ev of events) {
    hashToId.set(ev.event_hash, ev.event_id);
  }

  let edgesCreated = 0;

  for (const ev of events) {
    if (!ev.previous_hash) continue; // Genesis event, no predecessor

    const predecessorId = hashToId.get(ev.previous_hash);
    if (!predecessorId) continue;

    // Upsert CHAIN_PREV edge in the property graph
    const edgeId = `${predecessorId}->${ev.event_id}:CHAIN_PREV`;
    await exec(
      db,
      `INSERT OR REPLACE INTO graph_edges (edge_id, source_node_id, target_node_id, edge_type, properties, created_at)
       VALUES (?, ?, ?, 'CHAIN_PREV', ?, ?)`,
      edgeId,
      predecessorId,
      ev.event_id,
      JSON.stringify({
        chain_id: chainId,
        event_type: ev.event_type,
        hash_link: `${ev.previous_hash}→${ev.event_hash}`,
      }),
      nowISO(),
    );
    edgesCreated++;
  }

  return edgesCreated;
}

/**
 * Traverse all chains and create/update CHAIN_PREV edges in the graph.
 * Useful as a one-time backfill or periodic sync operation.
 */
export async function syncAllChainPrevEdges(db: D1Database): Promise<{ chainsProcessed: number; edgesCreated: number }> {
  const chains = await all<{ chain_id: string }>(
    db,
    'SELECT chain_id FROM audit_chains',
  );

  let totalEdges = 0;

  for (const c of chains) {
    const edges = await addChainPrevEdges(db, c.chain_id);
    totalEdges += edges;
  }

  return { chainsProcessed: chains.length, edgesCreated: totalEdges };
}

// ─── Convenience: common audit event types ───────────────────────────────────

export function deviceEnrolledEvent(deviceId: string, siteId: string, organizationId: string, name: string) {
  return { event_type: 'DEVICE_ENROLLED', device_id: deviceId, site_id: siteId, organization_id: organizationId, name, timestamp: nowISO() };
}

export function deviceRevokedEvent(deviceId: string, siteId: string, organizationId: string) {
  return { event_type: 'DEVICE_REVOKED', device_id: deviceId, site_id: siteId, organization_id: organizationId, timestamp: nowISO() };
}

export function uploadCreatedEvent(uploadId: string, deviceId: string, siteId: string, organizationId: string, partCount: number) {
  return { event_type: 'UPLOAD_CREATED', upload_id: uploadId, device_id: deviceId, site_id: siteId, organization_id: organizationId, part_count: partCount, timestamp: nowISO() };
}

export function uploadCompletedEvent(receiptId: string, deviceId: string, siteId: string, organizationId: string, imageBytes: number) {
  return { event_type: 'UPLOAD_COMPLETED', receipt_id: receiptId, device_id: deviceId, site_id: siteId, organization_id: organizationId, image_bytes: imageBytes, timestamp: nowISO() };
}

export function receiptReviewedEvent(receiptId: string, reviewerEmail: string, action: string, version: number) {
  return { event_type: 'RECEIPT_REVIEWED', receipt_id: receiptId, reviewer: reviewerEmail, action, version, timestamp: nowISO() };
}

export function invoiceCreatedEvent(invoiceId: string, reviewerEmail: string, siteId: string, organizationId: string) {
  return { event_type: 'INVOICE_CREATED', invoice_id: invoiceId, reviewer: reviewerEmail, site_id: siteId, organization_id: organizationId, timestamp: nowISO() };
}

export function invoiceVerifiedEvent(invoiceId: string, reviewerEmail: string, siteId: string, organizationId: string) {
  return { event_type: 'INVOICE_VERIFIED', invoice_id: invoiceId, reviewer: reviewerEmail, site_id: siteId, organization_id: organizationId, timestamp: nowISO() };
}

export function tallyImportedEvent(importId: string, siteId: string, organizationId: string, rowCount: number) {
  return { event_type: 'TALLY_IMPORTED', import_id: importId, site_id: siteId, organization_id: organizationId, row_count: rowCount, timestamp: nowISO() };
}

export function reviewerInvitedEvent(invitationId: string, invitedBy: string, email: string, siteId: string, organizationId: string, role: string) {
  return { event_type: 'REVIEWER_INVITED', invitation_id: invitationId, invited_by: invitedBy, email, site_id: siteId, organization_id: organizationId, role, timestamp: nowISO() };
}

export function reviewerJoinedEvent(email: string, siteId: string, organizationId: string, role: string) {
  return { event_type: 'REVIEWER_JOINED', email, site_id: siteId, organization_id: organizationId, role, timestamp: nowISO() };
}

export function reviewerRemovedEvent(email: string, removedBy: string, siteId: string, organizationId: string) {
  return { event_type: 'REVIEWER_REMOVED', email, removed_by: removedBy, site_id: siteId, organization_id: organizationId, timestamp: nowISO() };
}

export function reconciliationViewedEvent(siteId: string, organizationId: string, viewedBy: string, poCount: number, receiptCount: number) {
  return { event_type: 'RECONCILIATION_VIEWED', site_id: siteId, organization_id: organizationId, viewed_by: viewedBy, po_count: poCount, receipt_count: receiptCount, timestamp: nowISO() };
}

export function exportDownloadedEvent(siteId: string, organizationId: string, downloadedBy: string, exportType: string) {
  return { event_type: 'EXPORT_DOWNLOADED', site_id: siteId, organization_id: organizationId, downloaded_by: downloadedBy, export_type: exportType, timestamp: nowISO() };
}

export function configChangedEvent(changedBy: string, organizationId: string, changes: Record<string, unknown>) {
  return { event_type: 'CONFIG_CHANGED', changed_by: changedBy, organization_id: organizationId, changes, timestamp: nowISO() };
}

export function quotaChangedEvent(changedBy: string, organizationId: string, quotaType: string, oldValue: number, newValue: number) {
  return { event_type: 'QUOTA_CHANGED', changed_by: changedBy, organization_id: organizationId, quota_type: quotaType, old_value: oldValue, new_value: newValue, timestamp: nowISO() };
}

export function siteChangedEvent(siteId: string, organizationId: string, changedBy: string, action: string, changes: Record<string, unknown>) {
  return { event_type: 'SITE_CHANGED', site_id: siteId, organization_id: organizationId, changed_by: changedBy, action, changes, timestamp: nowISO() };
}

export function vendorChangedEvent(vendorId: string, siteId: string, organizationId: string, changedBy: string, action: string) {
  return { event_type: 'VENDOR_CHANGED', vendor_id: vendorId, site_id: siteId, organization_id: organizationId, changed_by: changedBy, action, timestamp: nowISO() };
}

export function membershipChangedEvent(email: string, siteId: string, organizationId: string, changedBy: string, action: string, role?: string) {
  return { event_type: 'MEMBERSHIP_CHANGED', email, site_id: siteId, organization_id: organizationId, changed_by: changedBy, action, role, timestamp: nowISO() };
}
