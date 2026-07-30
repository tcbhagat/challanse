// ─── ChallanSe D1 Database Helpers ────────────────────────────────────────────
// Provides parameterized query helpers, row mappers, and batch operations for D1.
// D1 is SQLite-based: UUIDs → TEXT, JSON → TEXT (parse/stringify), no SERIALIZABLE.

import type {
  DeviceRow,
  EnrichmentReceiptRow,
  OrganizationRow,
  ReceiptRow,
  ReviewerRow,
  SiteRow,
  TallyImportRow,
  VendorRow,
  VerifiedReceiptRow,
} from './types';

// ─── UUID Generation ─────────────────────────────────────────────────────────

export function uuid(): string {
  return crypto.randomUUID();
}

export function nowISO(): string {
  return new Date().toISOString();
}

// ─── Row Mapping Helpers ────────────────────────────────────────────────────

/** Safely parse a JSON text column, returning a default on failure. */
export function parseJson<T = Record<string, unknown>>(text: string | null | undefined, fallback: T = {} as T): T {
  if (!text) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

/** Convert an optional raw value to a string, or return null. */
export function str(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  return String(val);
}

/** Convert an optional raw value to a number, or return null. */
export function num(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

// ─── Query Shortcuts ─────────────────────────────────────────────────────────

/** Execute a D1 prepared statement and return all rows. */
export async function all<T = Record<string, unknown>>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const stmt = db.prepare(sql).bind(...params);
  const { results } = await stmt.all<T>();
  return results ?? [];
}

/** Execute a D1 prepared statement and return the first row, or null. */
export async function first<T = Record<string, unknown>>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  const stmt = db.prepare(sql).bind(...params);
  const { results } = await stmt.all<T>();
  return results && results.length > 0 ? results[0] : null;
}

/** Execute a D1 prepared statement (INSERT/UPDATE/DELETE) and return the meta. */
export async function exec(db: D1Database, sql: string, ...params: unknown[]): Promise<D1Result> {
  const stmt = db.prepare(sql).bind(...params);
  return stmt.run();
}

/** Execute multiple statements in a batch (D1 atomic batch). */
export async function batch(db: D1Database, stmts: D1PreparedStatement[]): Promise<D1Result[]> {
  return db.batch(stmts);
}

// ─── Organization Queries ────────────────────────────────────────────────────

export async function getOrganization(db: D1Database, id: string): Promise<OrganizationRow | null> {
  return first<OrganizationRow>(db, 'SELECT * FROM organizations WHERE id = ? AND active = 1', id);
}

// ─── Site Queries ────────────────────────────────────────────────────────────

export async function getSite(db: D1Database, id: string): Promise<SiteRow | null> {
  return first<SiteRow>(db, 'SELECT * FROM sites WHERE id = ? AND active = 1', id);
}

export async function getSitesByOrg(db: D1Database, organizationId: string): Promise<SiteRow[]> {
  return all<SiteRow>(db, 'SELECT * FROM sites WHERE organization_id = ? AND active = 1 ORDER BY name', organizationId);
}

// ─── Device Queries ──────────────────────────────────────────────────────────

export async function getDeviceByTokenHash(db: D1Database, tokenHash: string): Promise<DeviceRow | null> {
  return first<DeviceRow>(db, 'SELECT * FROM devices WHERE token_hash = ? AND active = 1', tokenHash);
}

export async function getDevice(db: D1Database, id: string): Promise<DeviceRow | null> {
  return first<DeviceRow>(db, 'SELECT * FROM devices WHERE id = ?', id);
}

export async function touchDevice(db: D1Database, id: string): Promise<void> {
  await exec(db, 'UPDATE devices SET last_seen_at = ? WHERE id = ?', nowISO(), id);
}

export async function getDevicesBySite(db: D1Database, siteId: string): Promise<DeviceRow[]> {
  return all<DeviceRow>(db, 'SELECT * FROM devices WHERE site_id = ? AND active = 1 ORDER BY name', siteId);
}

// ─── Reviewer Queries ────────────────────────────────────────────────────────

export async function getReviewer(db: D1Database, issuer: string, subject: string): Promise<ReviewerRow | null> {
  return first<ReviewerRow>(
    db,
    'SELECT * FROM reviewers WHERE issuer = ? AND subject = ? AND active = 1',
    issuer, subject,
  );
}

export async function getReviewersByOrg(db: D1Database, organizationId: string): Promise<ReviewerRow[]> {
  return all<ReviewerRow>(
    db,
    'SELECT * FROM reviewers WHERE organization_id = ? AND active = 1 ORDER BY email',
    organizationId,
  );
}

// ─── Vendor Queries ──────────────────────────────────────────────────────────

export async function getVendor(db: D1Database, id: string): Promise<VendorRow | null> {
  return first<VendorRow>(db, 'SELECT * FROM vendors WHERE id = ? AND active = 1', id);
}

export async function getVendorsBySite(db: D1Database, siteId: string): Promise<VendorRow[]> {
  return all<VendorRow>(db, 'SELECT * FROM vendors WHERE site_id = ? AND active = 1 ORDER BY display_order, name', siteId);
}

// ─── Receipt Queries ─────────────────────────────────────────────────────────

export async function getReceipt(db: D1Database, id: string): Promise<ReceiptRow | null> {
  return first<ReceiptRow>(db, 'SELECT * FROM receipts WHERE id = ?', id);
}

export async function getReceiptsBySite(
  db: D1Database,
  siteId: string,
  status: string,
  limit: number,
): Promise<ReceiptRow[]> {
  return all<ReceiptRow>(
    db,
    'SELECT * FROM receipts WHERE site_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?',
    siteId, status, limit,
  );
}

// ─── Enrichment Receipt Queries ──────────────────────────────────────────────

export async function getEnrichmentReceipt(db: D1Database, receiptId: string): Promise<EnrichmentReceiptRow | null> {
  return first<EnrichmentReceiptRow>(
    db,
    'SELECT * FROM enrichment_receipts WHERE receipt_id = ?',
    receiptId,
  );
}

// ─── Tally Import Queries ────────────────────────────────────────────────────

export async function getTallyImportRows(
  db: D1Database,
  importId: string,
): Promise<TallyImportRow[]> {
  return all<TallyImportRow>(
    db,
    'SELECT * FROM tally_import_rows WHERE import_id = ?',
    importId,
  );
}

export async function getTallyImportsBySite(
  db: D1Database,
  siteId: string,
): Promise<{ id: string; imported_at: string }[]> {
  return all<{ id: string; imported_at: string }>(
    db,
    'SELECT id, imported_at FROM tally_imports WHERE site_id = ? ORDER BY imported_at DESC',
    siteId,
  );
}

// ─── Verified Receipt Queries ────────────────────────────────────────────────

export async function getVerifiedReceiptsBySite(
  db: D1Database,
  siteId: string,
): Promise<VerifiedReceiptRow[]> {
  return all<VerifiedReceiptRow>(
    db,
    'SELECT * FROM verified_receipts WHERE site_id = ? ORDER BY reviewed_at DESC',
    siteId,
  );
}

// ─── Enriched Receipt Status (for reconciliation) ────────────────────────────

export interface ReceiptWithVerification {
  id: string;
  vendor_id: string;
  captured_quantity: number;
  verified_quantity: number | null;
  unit: string;
  po_number: string | null;
  material_code: string | null;
  status: string;
}

export async function getReceiptsForReconciliation(
  db: D1Database,
  siteId: string,
): Promise<ReceiptWithVerification[]> {
  return all<ReceiptWithVerification>(
    db,
    `SELECT r.id, r.vendor_id, r.captured_quantity, r.verified_quantity,
            r.unit, r.po_number, r.material_code, r.status
     FROM receipts r
     WHERE r.site_id = ?
       AND r.status IN ('VERIFIED', 'REJECTED')
     ORDER BY r.captured_at_unix DESC`,
    siteId,
  );
}

// ─── Nonce Replay Protection ─────────────────────────────────────────────────

export async function consumeNonce(
  db: D1Database,
  deviceId: string,
  timestamp: string,
  nonce: string,
): Promise<'ok' | 'replay' | 'expired'> {
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return 'expired';

  const existing = await first<{ id: string }>(
    db,
    'SELECT id FROM device_nonces WHERE device_id = ? AND nonce = ?',
    deviceId, nonce,
  );
  if (existing) return 'replay';

  await exec(
    db,
    'INSERT INTO device_nonces (id, device_id, nonce, expires_at) VALUES (?, ?, ?, ?)',
    uuid(), deviceId, nonce, new Date((ts + 300) * 1000).toISOString(),
  );
  return 'ok';
}

// ─── Graph Node/Edge Queries (re-exported from graph.ts) ─────────────────────

export {
  upsertGraphNode,
  upsertGraphEdge,
  deleteGraphNode,
  deleteGraphEdge,
  getGraphNode,
  getNeighbors,
  shortestPath,
  subgraphForSite,
  getOrganizationGraph,
  getReconciliationGraph,
  traverseAuditChain,
  findAnomalousReceipts,
  exportGraph,
  ensureSiteInGraph,
  ensureDeviceInGraph,
  ensureReviewerInGraph,
  ensureVendorInGraph,
  ensureReceiptInGraph,
  ensurePurchaseOrderInGraph,
  graphAwareReconciliation,
  reconcileReceiptsWithPOs,
} from './graph';

export type {
  GraphNodeWithEdges,
  NeighborResult,
  GraphPath,
  SubgraphResult,
  OrganizationGraph,
  ReconciliationSubgraph,
  AuditChainTraversal,
} from './graph';
