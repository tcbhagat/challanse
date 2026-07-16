import { error, json } from './responses';
import type { Env } from './types';

async function hmac(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature), (value) => value.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

async function consumeServiceRequest(request: Request, env: Env, payload: string): Promise<boolean> {
  if (!env.ENRICHMENT_SHARED_SECRET) return false;
  const timestamp = request.headers.get('X-ChallanSe-Timestamp') ?? '';
  const requestId = request.headers.get('X-ChallanSe-Request-Id') ?? '';
  const signature = request.headers.get('X-ChallanSe-Signature') ?? '';
  const timestampNumber = Number(timestamp);
  if (!requestId || !Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber * 1000) > 60_000) return false;
  const expected = await hmac(env.ENRICHMENT_SHARED_SECRET, `${timestamp}.${requestId}.${payload}`);
  if (!constantTimeEqual(signature, expected)) return false;
  try {
    await env.DB.prepare(
      `INSERT INTO service_request_nonces (request_id, expires_at) VALUES (?, datetime('now', '+2 minutes'))`,
    ).bind(requestId).run();
    return true;
  } catch {
    return false;
  }
}

export async function dispatchEnrichment(env: Env, receipt: {
  id: string;
  siteId: string;
  imageKey: string;
  vendorId: string;
  capturedAtUnix: number;
  capturedQuantity: number;
}): Promise<'DISABLED' | 'DISPATCHED'> {
  if (!env.ENRICHMENT_URL || !env.ENRICHMENT_SHARED_SECRET) {
    await env.DB.prepare(`INSERT INTO operations_log (id, site_id, event_type, detail_json) VALUES (?, ?, 'ENRICHMENT_DISABLED', ?)`)
      .bind(crypto.randomUUID(), receipt.siteId, JSON.stringify({ receiptId: receipt.id })).run();
    return 'DISABLED';
  }
  const body = JSON.stringify({
    receipt_id: receipt.id,
    site_id: receipt.siteId,
    image_key: receipt.imageKey,
    vendor_id: receipt.vendorId,
    captured_at_unix: receipt.capturedAtUnix,
    site_captured_quantity: receipt.capturedQuantity,
    schema_version: '1.0',
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const requestId = crypto.randomUUID();
  const signature = await hmac(env.ENRICHMENT_SHARED_SECRET, `${timestamp}.${requestId}.${body}`);
  const response = await fetch(`${env.ENRICHMENT_URL.replace(/\/$/, '')}/v1/events/receipts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-ChallanSe-Signature': signature,
      'X-ChallanSe-Timestamp': timestamp,
      'X-ChallanSe-Request-Id': requestId,
    },
    body,
  });
  if (!response.ok) throw new Error(`enrichment_http_${response.status}`);
  return 'DISPATCHED';
}

export async function internalReceiptImage(request: Request, env: Env, receiptId: string): Promise<Response> {
  if (!env.ENRICHMENT_SHARED_SECRET) return error(request, env, 503, 'ENRICHMENT_DISABLED', 'Enrichment is not configured.');
  const timestamp = request.headers.get('X-ChallanSe-Timestamp') ?? '';
  const signature = request.headers.get('X-ChallanSe-Signature') ?? '';
  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber * 1000) > 60_000) return error(request, env, 401, 'SERVICE_AUTH_EXPIRED', 'Service authentication expired.');
  const expected = await hmac(env.ENRICHMENT_SHARED_SECRET, `${receiptId}:${timestamp}`);
  if (!constantTimeEqual(signature, expected)) return error(request, env, 401, 'SERVICE_AUTH_INVALID', 'Service authentication failed.');
  const receipt = await env.DB.prepare(`SELECT image_key, image_sha256 FROM receipts WHERE id = ? AND image_deleted_at IS NULL LIMIT 1`)
    .bind(receiptId).first<{ image_key: string; image_sha256: string }>();
  if (!receipt) return error(request, env, 404, 'IMAGE_NOT_FOUND', 'Receipt image is unavailable.');
  const object = await env.RECEIPTS.get(receipt.image_key);
  if (!object) return error(request, env, 404, 'IMAGE_NOT_FOUND', 'Receipt image is unavailable.');
  return new Response(object.body, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', ETag: `"${receipt.image_sha256}"` } });
}

export async function enrichmentCallback(request: Request, env: Env, receiptId: string): Promise<Response> {
  if (!env.ENRICHMENT_SHARED_SECRET) return error(request, env, 503, 'ENRICHMENT_DISABLED', 'Enrichment is not configured.');
  const raw = await request.text();
  if (!(await consumeServiceRequest(request, env, raw))) return error(request, env, 401, 'SERVICE_AUTH_INVALID', 'Service authentication failed.');
  const payload = JSON.parse(raw) as { status?: unknown; ocr_confidence?: unknown; raw_ocr_json?: unknown; gst_status?: unknown; version?: unknown };
  const allowedStatuses = new Set(['READY_FOR_REVIEW', 'NEEDS_HUMAN_REVIEW', 'VERIFIED_GST', 'GST_ANOMALY']);
  if (
    typeof payload.status !== 'string'
    || !allowedStatuses.has(payload.status)
    || !Number.isInteger(payload.version)
    || Number(payload.version) < 1
    || (payload.ocr_confidence != null && (typeof payload.ocr_confidence !== 'number' || payload.ocr_confidence < 0 || payload.ocr_confidence > 100))
    || JSON.stringify(payload.raw_ocr_json ?? {}).length > 250_000
  ) return error(request, env, 400, 'INVALID_ENRICHMENT', 'Enrichment result is invalid.');
  const version = Number(payload.version);
  const updated = await env.DB.prepare(
    `UPDATE receipts SET enrichment_status = ?, ocr_confidence = ?, raw_ocr_json = ?, gst_status = ?, enrichment_version = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND enrichment_version < ?`,
  ).bind(payload.status, payload.ocr_confidence ?? null, JSON.stringify(payload.raw_ocr_json ?? {}), typeof payload.gst_status === 'string' ? payload.gst_status : 'NOT_CHECKED', version, receiptId, version).run();
  if (Number(updated.meta.changes ?? 0) !== 1) return error(request, env, 409, 'ENRICHMENT_VERSION_CONFLICT', 'A newer enrichment result already exists.');
  await env.DB.prepare(`INSERT INTO receipt_audits (id, receipt_id, site_id, event_type, actor, event_json) SELECT ?, id, site_id, 'ENRICHMENT_UPDATED', 'service:enrichment', ? FROM receipts WHERE id = ?`)
    .bind(crypto.randomUUID(), JSON.stringify({ status: payload.status, version }), receiptId).run();
  return json(request, env, { receiptId, accepted: true });
}
