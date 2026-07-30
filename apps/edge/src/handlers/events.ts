// ─── Event Ingestion Endpoints ───────────────────────────────────────────────
// Internal endpoints for processing events from queues and other sources.
// These are Worker-to-Worker calls (no Cloudflare Access required, but
// internal HMAC verification should be added in Phase 7).

import { error, json } from '../responses';
import { uuid, exec, first } from '../db';
import { appendAuditEvent } from '../audit-chain';
import { upsertGraphNode, upsertGraphEdge } from '../graph';
import type { Env } from '../types';

// ─── POST /v1/events/receipts ────────────────────────────────────────────────
// Called by the queue consumer worker after OCR enrichment completes.

export async function handleReceiptEvent(request: Request, env: Env): Promise<Response> {
  const db = env.DB;
  let body: {
    receiptId?: string;
    organizationId?: string;
    siteId?: string;
    eventType?: string;
    ocrText?: string;
    ocrConfidence?: number;
    rawOcrJson?: string;
    gstStatus?: string;
    error?: string;
  };
  try {
    body = await request.json();
  } catch {
    return error(request, env, 400, 'INVALID_EVENT', 'Event body must be valid JSON.');
  }

  if (!body.receiptId || !body.eventType) {
    return error(request, env, 400, 'MISSING_FIELDS', 'receiptId and eventType are required.');
  }

  const now = new Date().toISOString();

  switch (body.eventType) {
    case 'OCR_COMPLETED': {
      // Update enrichment_receipts with OCR results
      if (body.ocrConfidence !== undefined) {
        await exec(
          db,
          `UPDATE enrichment_receipts SET
            status = 'OCR_COMPLETED', raw_ocr_json = ?, ocr_confidence = ?,
            raw_text = ?, gst_status = ?, updated_at = ?
           WHERE receipt_id = ?`,
          body.rawOcrJson || '{}', body.ocrConfidence,
          body.ocrText || '', body.gstStatus || 'UNCHECKED', now,
          body.receiptId,
        );
      }

      // Also update the receipts table
      await exec(
        db,
        `UPDATE receipts SET
          enrichment_status = 'OCR_COMPLETED', ocr_confidence = ?,
          raw_ocr_json = ?, gst_status = ?, updated_at = ?
         WHERE id = ?`,
        body.ocrConfidence ?? null, body.rawOcrJson || '{}',
        body.gstStatus || 'UNCHECKED', now, body.receiptId,
      );

      // Record audit event
      if (body.organizationId && body.siteId) {
        const chainId = `org:${body.organizationId}:site:${body.siteId}`;
        await appendAuditEvent(db, chainId, 'OCR_COMPLETED', {
          event_type: 'OCR_COMPLETED',
          receipt_id: body.receiptId,
          ocr_confidence: body.ocrConfidence,
          gst_status: body.gstStatus,
          timestamp: now,
        });

        // Record in graph: AuditEvent node with HAS_STATUS edge to receipt
        const auditEventId = uuid();
        await upsertGraphNode(db, auditEventId, 'AuditEvent', {
          chain_id: chainId,
          event_type: 'OCR_COMPLETED',
          receipt_id: body.receiptId,
          ocr_confidence: body.ocrConfidence,
          gst_status: body.gstStatus,
          organization_id: body.organizationId,
          site_id: body.siteId,
          timestamp: now,
        });
        // Receipt --[:HAS_STATUS]-> AuditEvent
        if (body.receiptId) {
          await upsertGraphEdge(
            db,
            `${body.receiptId}->${auditEventId}:HAS_STATUS`,
            body.receiptId,
            auditEventId,
            'HAS_STATUS',
            { status: 'OCR_COMPLETED', at: now },
          );
        }
      }
      break;
    }

    case 'OCR_FAILED': {
      await exec(
        db,
        "UPDATE receipts SET enrichment_status = 'OCR_FAILED', updated_at = ? WHERE id = ?",
        now, body.receiptId,
      );
      await exec(
        db,
        "UPDATE enrichment_receipts SET status = 'OCR_FAILED', updated_at = ? WHERE receipt_id = ?",
        now, body.receiptId,
      );

      if (body.organizationId && body.siteId) {
        const chainId = `org:${body.organizationId}:site:${body.siteId}`;
        await appendAuditEvent(db, chainId, 'OCR_FAILED', {
          event_type: 'OCR_FAILED',
          receipt_id: body.receiptId,
          error: body.error || 'Unknown OCR error',
          timestamp: now,
        });

        // Record in graph: AuditEvent node
        const auditEventId = uuid();
        await upsertGraphNode(db, auditEventId, 'AuditEvent', {
          chain_id: chainId,
          event_type: 'OCR_FAILED',
          receipt_id: body.receiptId,
          error: body.error || 'Unknown OCR error',
          organization_id: body.organizationId,
          site_id: body.siteId,
          timestamp: now,
        });
        if (body.receiptId) {
          await upsertGraphEdge(
            db,
            `${body.receiptId}->${auditEventId}:HAS_STATUS`,
            body.receiptId,
            auditEventId,
            'HAS_STATUS',
            { status: 'OCR_FAILED', at: now },
          );
        }
      }
      break;
    }

    default:
      return error(request, env, 400, 'UNKNOWN_EVENT_TYPE', `Unknown event type: ${body.eventType}`);
  }

  return json(request, env, { received: true }, 202);
}

// ─── POST /v1/events/reviews ─────────────────────────────────────────────────
// Called when a review event needs to be processed asynchronously.

export async function handleReviewEvent(request: Request, env: Env): Promise<Response> {
  const db = env.DB;
  let body: {
    receiptId?: string;
    reviewerEmail?: string;
    action?: string;
    organizationId?: string;
    siteId?: string;
  };
  try {
    body = await request.json();
  } catch {
    return error(request, env, 400, 'INVALID_EVENT', 'Event body must be valid JSON.');
  }

  if (!body.receiptId) {
    return error(request, env, 400, 'MISSING_FIELDS', 'receiptId is required.');
  }

  const now = new Date().toISOString();

  // Update enrichment_receipts status to match
  if (body.action === 'VERIFY' || body.action === 'REJECT') {
    const status = body.action === 'VERIFY' ? 'VERIFIED' : 'REJECTED';
    await exec(
      db,
      "UPDATE enrichment_receipts SET status = ?, updated_at = ? WHERE receipt_id = ?",
      status, now, body.receiptId,
    );
  }

  return json(request, env, { received: true }, 202);
}

// ─── POST /v1/events/telemetry ───────────────────────────────────────────────
// Batch telemetry ingestion from devices.

export async function handleTelemetryEvent(request: Request, env: Env): Promise<Response> {
  const db = env.DB;
  let body: { measurements?: unknown[] };
  try {
    body = await request.json();
  } catch {
    return error(request, env, 400, 'INVALID_EVENT', 'Event body must be valid JSON.');
  }

  if (body.measurements && Array.isArray(body.measurements)) {
    const stmts = [];
    for (const m of body.measurements) {
      if (m && typeof m === 'object') {
        const record = m as Record<string, unknown>;
        stmts.push(
          db.prepare(
            `INSERT INTO telemetry_measurements (id, device_id, site_id, organization_id, metric_name, metric_value, tags_json, recorded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            uuid(),
            String(record.deviceId ?? ''),
            String(record.siteId ?? ''),
            String(record.organizationId ?? ''),
            String(record.metricName ?? ''),
            Number(record.metricValue ?? 0),
            JSON.stringify(record.tags ?? {}),
            new Date().toISOString(),
          ),
        );
      }
    }
    if (stmts.length > 0) {
      await db.batch(stmts);
    }
  }

  return json(request, env, { received: true }, 202);
}
