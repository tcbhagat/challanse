// ─── Reviewer Endpoints ──────────────────────────────────────────────────────
// Handlers for receipt listing, review actions, invoice creation, reconciliation,
// PO imports (Tally CSV), and membership operations.
// All endpoints require Cloudflare Access authentication (reviewer context).

import { error, json } from '../responses';
import { authenticateReviewer, requireRole, ReviewerAuthError } from '../auth';
import { uuid, exec, first, all, getReceiptsBySite, getReceipt, getVendorsBySite, getSitesByOrg, getTallyImportRows, getTallyImportsBySite, getReceiptsForReconciliation, getVerifiedReceiptsBySite } from '../db';
import { appendAuditEvent, receiptReviewedEvent, tallyImportedEvent, invoiceCreatedEvent, invoiceVerifiedEvent, reconciliationViewedEvent, exportDownloadedEvent, reviewerJoinedEvent } from '../audit-chain';
import { parseTallyCsv, calculateReconciliationDeltas, normalizeUnit } from '../tally';
import { upsertGraphEdge, upsertGraphNode, ensurePurchaseOrderInGraph, graphAwareReconciliation, reconcileReceiptsWithPOs } from '../graph';
import type { AccessIdentity, Env } from '../types';
import type { PurchaseOrderRow } from '../tally';

// ─── GET /v1/reviewer/context ────────────────────────────────────────────────

export async function handleReviewerContext(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, 'Reviewer access denied.');
    }
    throw err;
  }

  const sites = await getSitesByOrg(db, reviewer.organizationId);
  const vendors = await getVendorsBySite(db, reviewer.siteId);

  return json(request, env, {
    userId: reviewer.userId,
    organizationId: reviewer.organizationId,
    siteId: reviewer.siteId,
    role: reviewer.role,
    email: reviewer.email,
    sites: sites.map((s) => ({ id: s.id, name: s.name })),
    vendors: vendors.map((v) => ({ id: v.id, name: v.name, initials: v.initials, color: v.color })),
  });
}

// ─── GET /v1/reviewer/receipts ───────────────────────────────────────────────

export async function handleListReceipts(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, 'Reviewer access denied.');
    }
    throw err;
  }

  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'NEEDS_REVIEW';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '25', 10), 100);
  const cursor = url.searchParams.get('cursor') || undefined;

  const rows = await all<Record<string, unknown>>(
    db,
    `SELECT r.id, r.vendor_id, r.captured_at_unix, r.captured_quantity, r.status,
            r.challan_number, r.material_description, r.verified_quantity, r.unit,
            r.enrichment_status, r.ocr_confidence, r.image_bytes,
            r.created_at, r.updated_at,
            v.name as vendor_name, v.initials as vendor_initials, v.color as vendor_color
     FROM receipts r
     JOIN vendors v ON v.id = r.vendor_id
     WHERE r.site_id = ? AND r.status = ?
     ORDER BY r.created_at DESC
     LIMIT ?`,
    reviewer.siteId, status, limit + 1,
  );

  const hasMore = rows.length > limit;
  const receipts = rows.slice(0, limit).map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    vendorName: r.vendor_name,
    vendorInitials: r.vendor_initials,
    vendorColor: r.vendor_color,
    capturedAtUnix: r.captured_at_unix,
    capturedQuantity: r.captured_quantity,
    verifiedQuantity: r.verified_quantity,
    unit: r.unit,
    challanNumber: r.challan_number,
    materialDescription: r.material_description,
    status: r.status,
    enrichmentStatus: r.enrichment_status,
    ocrConfidence: r.ocr_confidence,
    imageBytes: r.image_bytes,
    createdAt: r.created_at,
  }));

  return json(request, env, {
    receipts,
    hasMore,
    cursor: hasMore ? receipts[receipts.length - 1]?.id : undefined,
  });
}

// ─── GET /v1/reviewer/receipts/{receiptId}/image ─────────────────────────────

export async function handleReceiptImage(request: Request, env: Env, identity: AccessIdentity, receiptId: string): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, 'Reviewer access denied.');
    }
    throw err;
  }

  const receipt = await getReceipt(db, receiptId);
  if (!receipt || receipt.site_id !== reviewer.siteId) {
    return error(request, env, 404, 'RECEIPT_NOT_FOUND', 'Receipt not found.');
  }

  const imageObj = await env.RECEIPTS.get(receipt.image_key);
  if (!imageObj) {
    return error(request, env, 404, 'IMAGE_NOT_FOUND', 'Receipt image not found in storage.');
  }

  const headers = new Headers({
    'Content-Type': receipt.mime_type || 'image/webp',
    'Cache-Control': 'private, max-age=3600',
    'Content-Length': String(imageObj.size),
  });
  return new Response(imageObj.body, { headers });
}

// ─── PATCH /v1/reviewer/receipts/{receiptId} ─────────────────────────────────

export async function handleReview(
  request: Request,
  env: Env,
  identity: AccessIdentity,
  receiptId: string,
): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, 'Reviewer access denied.');
    }
    throw err;
  }

  let body: {
    action?: string;
    version?: number;
    challanNumber?: string;
    poNumber?: string;
    materialCode?: string;
    materialDescription?: string;
    verifiedQuantity?: number;
    unit?: string;
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return error(request, env, 400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
  }

  if (!body.action || !['VERIFY', 'REJECT'].includes(body.action)) {
    return error(request, env, 400, 'INVALID_ACTION', 'Action must be VERIFY or REJECT.');
  }

  const receipt = await getReceipt(db, receiptId);
  if (!receipt || receipt.site_id !== reviewer.siteId) {
    return error(request, env, 404, 'RECEIPT_NOT_FOUND', 'Receipt not found.');
  }

  // Optimistic concurrency check
  if (body.version !== undefined && body.version !== receipt.version) {
    return error(request, env, 409, 'VERSION_CONFLICT', 'Receipt has been modified. Refresh and try again.');
  }

  const now = new Date().toISOString();
  const nextStatus = body.action === 'VERIFY' ? 'VERIFIED' : 'REJECTED';
  const newVersion = receipt.version + 1;

  if (body.action === 'VERIFY') {
    await exec(
      db,
      `UPDATE receipts SET
        status = ?, version = ?, challan_number = ?, po_number = ?, material_code = ?,
        material_description = ?, verified_quantity = ?, unit = ?,
        reviewed_by = ?, reviewed_at = ?, notes = ?, updated_at = ?
       WHERE id = ? AND version = ?`,
      nextStatus, newVersion,
      body.challanNumber ?? receipt.challan_number,
      body.poNumber ?? receipt.po_number,
      body.materialCode ?? receipt.material_code,
      body.materialDescription ?? receipt.material_description,
      body.verifiedQuantity ?? receipt.verified_quantity,
      body.unit ?? receipt.unit,
      reviewer.email, now,
      body.notes ?? receipt.notes, now,
      receiptId, receipt.version,
    );
    // Record INVOICE_VERIFIED audit event
    const chainIdVerify = `org:${reviewer.organizationId}:site:${reviewer.siteId}`;
    await appendAuditEvent(db, chainIdVerify, 'INVOICE_VERIFIED', invoiceVerifiedEvent(
      receiptId, reviewer.email, reviewer.siteId, reviewer.organizationId,
    ));
  } else {
    await exec(
      db,
      `UPDATE receipts SET status = ?, version = ?, notes = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
       WHERE id = ? AND version = ?`,
      nextStatus, newVersion, body.notes ?? receipt.notes, reviewer.email, now, now,
      receiptId, receipt.version,
    );
  }

  // Record audit event
  const chainId = `org:${reviewer.organizationId}:site:${reviewer.siteId}`;
  await appendAuditEvent(db, chainId, 'RECEIPT_REVIEWED', receiptReviewedEvent(receiptId, reviewer.email, body.action, newVersion));

  // Record REVIEWED_BY edge in graph
  await upsertGraphEdge(
    db,
    `${receiptId}->${reviewer.email}:REVIEWED_BY`,
    receiptId,
    reviewer.subject || reviewer.email,
    'REVIEWED_BY',
    {
      action: body.action,
      version: newVersion,
      reviewer_email: reviewer.email,
      reviewed_at: now,
    },
  );

  return json(request, env, {
    receiptId,
    status: nextStatus,
    version: newVersion,
  });
}

// ─── POST /v1/reviewer/invoices ──────────────────────────────────────────────

export async function handleCreateInvoice(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN', 'CONTROLLER', 'AUDITOR']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  let body: {
    receiptIds?: string[];
    poNumber?: string;
    materialCode?: string;
    verifiedQuantity?: number;
    unit?: string;
    challanNumber?: string;
    notes?: string;
  };
  try {
    body = await request.json();
  } catch {
    return error(request, env, 400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
  }

  if (!body.receiptIds?.length || !body.poNumber || !body.materialCode || !body.verifiedQuantity) {
    return error(request, env, 400, 'MISSING_FIELDS', 'Required: receiptIds, poNumber, materialCode, verifiedQuantity.');
  }

  const invoiceId = uuid();
  const now = new Date().toISOString();

  // Create verified receipt records
  for (const receiptId of body.receiptIds) {
    await exec(
      db,
      `INSERT INTO verified_receipts (receipt_id, organization_id, site_id, po_number, material_code, verified_quantity, unit, reviewer_id, review_version, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(receipt_id) DO UPDATE SET
         po_number = excluded.po_number, material_code = excluded.material_code,
         verified_quantity = excluded.verified_quantity, unit = excluded.unit,
         reviewer_id = excluded.reviewer_id, review_version = review_version + 1`,
      receiptId, reviewer.organizationId, reviewer.siteId,
      body.poNumber, body.materialCode, body.verifiedQuantity,
      normalizeUnit(body.unit || 'NOS'), reviewer.email, 1, now,
    );
  }

  // Record audit event
  const chainId = `org:${reviewer.organizationId}:site:${reviewer.siteId}`;
  await appendAuditEvent(db, chainId, 'INVOICE_CREATED', invoiceCreatedEvent(invoiceId, reviewer.email, reviewer.siteId, reviewer.organizationId));

  return json(request, env, {
    invoiceId,
    receiptIds: body.receiptIds,
    poNumber: body.poNumber,
    status: 'CREATED',
  }, 201);
}

// ─── POST /v1/reviewer/invoice-images (streaming binary upload) ──────────────

export async function handleInvoiceImage(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN', 'CONTROLLER', 'AUDITOR']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const contentType = request.headers.get('Content-Type') || '';
  const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
  if (contentLength > 10_000_000) {
    return error(request, env, 413, 'IMAGE_TOO_LARGE', 'Image must be under 10 MB.');
  }

  const body = await request.arrayBuffer();
  const imageSha256 = await sha256Hex(body);

  const receiptId = uuid();
  const imageKey = `invoices/${reviewer.organizationId}/${reviewer.siteId}/${receiptId}.webp`;

  // Store image in R2
  await env.RECEIPTS.put(imageKey, body, {
    httpMetadata: { contentType },
  });

  // Create invoice receipt record
  const now = new Date().toISOString();
  await exec(
    db,
    `INSERT INTO receipts (id, site_id, device_id, vendor_id, captured_at_unix, captured_quantity, image_key, image_bytes, image_sha256, status, version, enrichment_status, mime_type, created_at, updated_at)
     VALUES (?, ?, '', '', ?, 0, ?, ?, ?, 'NEEDS_REVIEW', 1, 'IMAGE_STORED', ?, ?, ?)`,
    receiptId, reviewer.siteId,
    Math.floor(Date.now() / 1000), imageKey, body.byteLength,
    imageSha256, contentType,
    now, now,
  );

  // Record audit event
  const chainId = `org:${reviewer.organizationId}:site:${reviewer.siteId}`;
  await appendAuditEvent(db, chainId, 'INVOICE_CREATED', invoiceCreatedEvent(receiptId, reviewer.email, reviewer.siteId, reviewer.organizationId));

  return json(request, env, {
    receiptId,
    imageBytes: body.byteLength,
    imageSha256,
    status: 'NEEDS_REVIEW',
  }, 202);
}

// ─── POST /v1/reviewer/po-imports (Tally CSV Import) ─────────────────────────

export async function handleTallyImport(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN', 'CONTROLLER']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('text/csv') && !contentType.includes('application/octet-stream')) {
    return error(request, env, 400, 'INVALID_CONTENT_TYPE', 'Content-Type must be text/csv.');
  }

  const body = await request.text();
  if (body.length > 1_000_000) {
    return error(request, env, 413, 'CSV_TOO_LARGE', 'CSV must be under 1 MB.');
  }

  // Check for duplicate import by content checksum
  const checksum = await sha256Hex(body);
  const existing = await first<{ id: string }>(
    db,
    'SELECT id FROM tally_imports WHERE checksum = ? AND site_id = ?',
    checksum, reviewer.siteId,
  );
  if (existing) {
    return error(request, env, 409, 'DUPLICATE_IMPORT', 'This CSV has already been imported.');
  }

  const parsed = parseTallyCsv(body);
  if (parsed.rows.length === 0) {
    return error(request, env, 400, 'PARSE_ERROR', `No valid rows found. Errors: ${parsed.errors.join('; ')}`);
  }

  const importId = uuid();
  const now = new Date().toISOString();

  // Create import record
  await exec(
    db,
    `INSERT INTO tally_imports (id, organization_id, site_id, checksum, imported_by, imported_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    importId, reviewer.organizationId, reviewer.siteId, checksum, reviewer.email, now,
  );

  // Insert rows in batch
  const stmts = parsed.rows.map((row) =>
    db.prepare(
      `INSERT INTO tally_import_rows (id, import_id, organization_id, site_id, po_number, material_code, quantity, unit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uuid(), importId, reviewer.organizationId, reviewer.siteId, row.poNumber, row.materialCode, row.quantity, row.unit),
  );
  await db.batch(stmts);

  // Record in graph: create PurchaseOrder nodes for each PO row
  for (const row of parsed.rows) {
    const poNodeId = `${reviewer.siteId}:${row.poNumber}:${row.materialCode}:${row.unit}`;
    await ensurePurchaseOrderInGraph(db, poNodeId, reviewer.siteId, reviewer.organizationId, {
      po_number: row.poNumber,
      material_code: row.materialCode,
      quantity: row.quantity,
      unit: row.unit,
      import_id: importId,
    });
  }

  // Record audit event
  const chainId = `org:${reviewer.organizationId}:site:${reviewer.siteId}`;
  await appendAuditEvent(db, chainId, 'TALLY_IMPORTED', tallyImportedEvent(importId, reviewer.siteId, reviewer.organizationId, parsed.rows.length));

  return json(request, env, {
    importId,
    rowCount: parsed.rows.length,
    errors: parsed.errors.length > 0 ? parsed.errors : undefined,
  }, 201);
}

// ─── GET /v1/reviewer/reconciliation ─────────────────────────────────────────
// Graph-aware reconciliation: traverses the property graph to compute deltas.
// Falls back to SQL-based reconciliation when graph data is not yet available.

export async function handleReconciliation(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN', 'CONTROLLER', 'AUDITOR']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  // Phase 2.3: Try graph-aware reconciliation first.
  // Check if the graph has receipt nodes for this site.
  const graphReceiptCount = await first<{ cnt: number }>(
    db,
    `SELECT COUNT(*) AS cnt FROM graph_nodes
     WHERE node_type = 'Receipt'
       AND json_extract(properties, '$.site_id') = ?`,
    reviewer.siteId,
  );

  if (graphReceiptCount && graphReceiptCount.cnt > 0) {
    // Use graph-aware path: traverse graph edges for reconciliation
    await reconcileReceiptsWithPOs(db, reviewer.siteId);
    const result = await graphAwareReconciliation(db, reviewer.siteId);

    // Record RECONCILIATION_VIEWED audit event
    const chainIdRecon = `org:${reviewer.organizationId}:site:${reviewer.siteId}`;
    await appendAuditEvent(db, chainIdRecon, 'RECONCILIATION_VIEWED', reconciliationViewedEvent(
      reviewer.siteId, reviewer.organizationId, reviewer.email,
      'result' in arguments ? (result as any).deltas?.length ?? 0 : 0,
      'result' in arguments ? (result as any).graphNodeCount ?? 0 : 0,
    ));
  
    return json(request, env, {
      siteId: reviewer.siteId,
      mode: 'graph',
      deltas: result.deltas,
      graphNodeCount: result.graphNodeCount,
      graphEdgeCount: result.graphEdgeCount,
    });
  }

  // Fallback: SQL-based reconciliation (legacy path for sites without graph data)
  const imports = await getTallyImportsBySite(db, reviewer.siteId);
  let purchaseOrders: PurchaseOrderRow[] = [];
  if (imports.length > 0) {
    const rows = await getTallyImportRows(db, imports[0].id);
    purchaseOrders = rows.map((r) => ({
      poNumber: r.po_number,
      materialCode: r.material_code,
      materialDescription: '',
      quantity: r.quantity,
      unit: r.unit,
      rate: 0,
      amount: 0,
    }));
  }

  const receipts = await getReceiptsForReconciliation(db, reviewer.siteId);
  const siteReceipts = receipts.map((r) => ({
    poNumber: r.po_number || '',
    materialCode: r.material_code || '',
    verifiedQuantity: r.verified_quantity || r.captured_quantity,
    unit: r.unit,
  }));

  const deltas = calculateReconciliationDeltas(purchaseOrders, siteReceipts);

  return json(request, env, {
    siteId: reviewer.siteId,
    mode: 'sql',
    importId: imports.length > 0 ? imports[0].id : null,
    importDate: imports.length > 0 ? imports[0].imported_at : null,
    poCount: purchaseOrders.length,
    receiptCount: receipts.length,
    deltas,
  });
}

// ─── Audit Export ────────────────────────────────────────────────────────────

export async function handleAuditExport(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN', 'CONTROLLER', 'AUDITOR']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const chainId = `org:${reviewer.organizationId}:site:${reviewer.siteId}`;
  const events = await all<Record<string, unknown>>(
    db,
    `SELECT ae.event_id, ae.event_type, ae.event_json, ae.previous_hash, ae.event_hash, ae.created_at
     FROM audit_events ae
     WHERE ae.chain_id = ?
     ORDER BY ae.created_at ASC`,
    chainId,
  );

  const exportData = JSON.stringify({
    chainId,
    organizationId: reviewer.organizationId,
    siteId: reviewer.siteId,
    exportedAt: new Date().toISOString(),
    exportedBy: reviewer.email,
    events,
  }, null, 2);

  // Record EXPORT_DOWNLOADED audit event
  const chainIdExport = `org:${reviewer.organizationId}:site:${reviewer.siteId}`;
  await appendAuditEvent(db, chainIdExport, 'EXPORT_DOWNLOADED', exportDownloadedEvent(
    reviewer.siteId, reviewer.organizationId, reviewer.email, 'audit-export',
  ));

  return new Response(exportData, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="audit-${reviewer.siteId}-${Date.now()}.json"`,
    },
  });
}

// ─── POST /v1/reviewer/reconciliation/query ──────────────────────────────────

export async function handleReconciliationQuery(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  // Accepts a site_id in the request body (or uses the reviewer's default site).
  // Phase 2.3: Uses graph-aware reconciliation when graph data is available.
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN', 'CONTROLLER', 'AUDITOR']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  let body: { siteId?: string } = {};
  try { body = await request.json(); } catch { /* use default */ }

  const siteId = body.siteId || reviewer.siteId;

  // Try graph-aware reconciliation first
  const graphReceiptCount = await first<{ cnt: number }>(
    db,
    `SELECT COUNT(*) AS cnt FROM graph_nodes
     WHERE node_type = 'Receipt'
       AND json_extract(properties, '$.site_id') = ?`,
    siteId,
  );

  if (graphReceiptCount && graphReceiptCount.cnt > 0) {
    await reconcileReceiptsWithPOs(db, siteId);
    const result = await graphAwareReconciliation(db, siteId);

    return json(request, env, {
      siteId,
      mode: 'graph',
      deltas: result.deltas,
      graphNodeCount: result.graphNodeCount,
      graphEdgeCount: result.graphEdgeCount,
    });
  }

  // Fallback: SQL-based reconciliation
  const imports = await getTallyImportsBySite(db, siteId);
  let purchaseOrders: PurchaseOrderRow[] = [];
  if (imports.length > 0) {
    const rows = await getTallyImportRows(db, imports[0].id);
    purchaseOrders = rows.map((r) => ({
      poNumber: r.po_number,
      materialCode: r.material_code,
      materialDescription: '',
      quantity: r.quantity,
      unit: r.unit,
      rate: 0,
      amount: 0,
    }));
  }

  const receipts = await getReceiptsForReconciliation(db, siteId);
  const siteReceipts = receipts.map((r) => ({
    poNumber: r.po_number || '',
    materialCode: r.material_code || '',
    verifiedQuantity: r.verified_quantity || r.captured_quantity,
    unit: r.unit,
  }));

  const deltas = calculateReconciliationDeltas(purchaseOrders, siteReceipts);

  return json(request, env, {
    siteId,
    mode: 'sql',
    poCount: purchaseOrders.length,
    receiptCount: receipts.length,
    deltas,
  });
}

// ─── POST /v1/reviewer/digests/query ─────────────────────────────────────────

export async function handleDigestQuery(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, 'Reviewer access denied.');
    }
    throw err;
  }

  let body: { siteId?: string } = {};
  try { body = await request.json(); } catch { /* use default */ }

  const siteId = body.siteId || reviewer.siteId;

  const digests = await all<Record<string, unknown>>(
    db,
    `SELECT id, checksum, imported_by, imported_at, created_at
     FROM tally_imports
     WHERE site_id = ?
     ORDER BY imported_at DESC`,
    siteId,
  );

  return json(request, env, { siteId, digests });
}

// ─── POST /v1/reviewer/enrichment-status/query ───────────────────────────────

export async function handleEnrichmentStatusQuery(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, 'Reviewer access denied.');
    }
    throw err;
  }

  let body: { siteId?: string; receiptId?: string } = {};
  try { body = await request.json(); } catch { /* use default */ }

  const siteId = body.siteId || reviewer.siteId;

  let results;
  if (body.receiptId) {
    results = await all<Record<string, unknown>>(
      db,
      `SELECT r.id, r.status, r.enrichment_status, r.ocr_confidence, r.gst_status, r.raw_ocr_json, r.updated_at
       FROM receipts r
       WHERE r.site_id = ? AND r.id = ?
       ORDER BY r.updated_at DESC`,
      siteId, body.receiptId,
    );
  } else {
    results = await all<Record<string, unknown>>(
      db,
      `SELECT r.id, r.status, r.enrichment_status, r.ocr_confidence, r.gst_status, r.updated_at
       FROM receipts r
       WHERE r.site_id = ?
       ORDER BY r.updated_at DESC
       LIMIT 50`,
      siteId,
    );
  }

  return json(request, env, { siteId, receipts: results });
}

// ─── POST /v1/reviewer/membership-invitations/accept ─────────────────────────

export async function handleAcceptMembership(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let body: { invitationId?: string } = {};
  try { body = await request.json(); } catch { /* fail */ }
  if (!body.invitationId) {
    return error(request, env, 400, 'MISSING_INVITATION_ID', 'invitationId is required.');
  }

  const invitation = await first<{
    id: string;
    organization_id: string;
    site_id: string;
    role: string;
    email: string;
    expires_at: string | null;
    active: number;
  }>(
    db,
    'SELECT * FROM membership_invitations WHERE id = ?',
    body.invitationId,
  );

  if (!invitation || !invitation.active) {
    return error(request, env, 404, 'INVITATION_NOT_FOUND', 'Invitation not found or already used.');
  }
  if (invitation.expires_at && new Date(invitation.expires_at) < new Date()) {
    return error(request, env, 400, 'INVITATION_EXPIRED', 'Invitation has expired.');
  }
  if (invitation.email !== identity.email) {
    return error(request, env, 403, 'INVITATION_EMAIL_MISMATCH', 'Invitation is for a different email address.');
  }

  const now = new Date().toISOString();
  await exec(
    db,
    `INSERT INTO reviewers (email, site_id, organization_id, role, active, issuer, subject, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       site_id = excluded.site_id, role = excluded.role, active = 1,
       issuer = excluded.issuer, subject = excluded.subject`,
    identity.email, invitation.site_id, invitation.organization_id, invitation.role,
    identity.issuer, identity.subject, now,
  );

  // Mark invitation as used
  await exec(db, 'UPDATE membership_invitations SET active = 0 WHERE id = ?', body.invitationId);

  // Record REVIEWER_JOINED audit event
  const chainIdJoin = `org:${invitation.organization_id}:site:${invitation.site_id}`;
  await appendAuditEvent(db, chainIdJoin, 'REVIEWER_JOINED', reviewerJoinedEvent(
    identity.email, invitation.site_id, invitation.organization_id, invitation.role,
  ));

  return json(request, env, {
    email: identity.email,
    organizationId: invitation.organization_id,
    siteId: invitation.site_id,
    role: invitation.role,
  }, 201);
}

// ─── Helper ──────────────────────────────────────────────────────────────────

async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const source = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const digest = await crypto.subtle.digest('SHA-256', source);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
