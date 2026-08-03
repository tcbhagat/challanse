// ─── Upload Endpoints ────────────────────────────────────────────────────────
// Handlers for resumable upload session lifecycle.
// Ported from services/enrichment/app/authoritative.py
// Uses R2 for multipart upload parts and D1 for session metadata.

import { error, json } from '../responses';
import { authenticateDevice, authenticateDeviceNonce, DeviceAuthError } from '../auth';
import { uuid, exec, first, getSite } from '../db';
import { appendAuditEvent, uploadCreatedEvent, uploadCompletedEvent } from '../audit-chain';
import { upsertGraphNode, ensureReceiptInGraph } from '../graph';
import { drainReceiptEnrichment } from '../enrichment-drain';
import type { Env } from '../types';

const UPLOAD_PART_SIZE = 256_000;
const MAX_IMAGE_BYTES = 10_000_000; // 10MB max image

// ─── POST /v1/uploads ────────────────────────────────────────────────────────

export async function handleCreateUpload(request: Request, env: Env): Promise<Response> {
  const db = env.DB;
  let device;
  try {
    device = await authenticateDevice(db, request.headers.get('Authorization'), env.DEVICE_TOKEN_PEPPER);
    await authenticateDeviceNonce(db, device, request.headers);
  } catch (err) {
    if (err instanceof DeviceAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  let body: {
    receiptId?: string;
    vendorId?: string;
    capturedAtUnix?: number;
    capturedQuantity?: number;
    imageSha256?: string;
    appVersion?: string;
    configurationVersion?: number;
    totalBytes?: number;
    mimeType?: string;
  };
  try {
    body = await request.json();
  } catch {
    return error(request, env, 400, 'INVALID_REQUEST', 'Request body must be valid JSON.');
  }

  // Validate required fields
  if (!body.receiptId || !body.vendorId || !body.capturedAtUnix || body.capturedQuantity === undefined || !body.imageSha256 || !body.totalBytes) {
    return error(request, env, 400, 'MISSING_FIELDS', 'Required fields: receiptId, vendorId, capturedAtUnix, capturedQuantity, imageSha256, totalBytes.');
  }

  if (body.totalBytes > MAX_IMAGE_BYTES) {
    return error(request, env, 413, 'IMAGE_TOO_LARGE', `Image must be under ${MAX_IMAGE_BYTES} bytes.`);
  }

  // Verify site limits
  const site = await getSite(db, device.siteId);
  if (!site) {
    return error(request, env, 404, 'SITE_NOT_FOUND', 'Site not found.');
  }

  // Check daily receipt limit
  const today = new Date().toISOString().slice(0, 10);
  const dailyCount = await first<{ cnt: number }>(
    db,
    'SELECT COUNT(*) as cnt FROM receipts WHERE site_id = ? AND date(created_at) = ?',
    device.siteId, today,
  );
  if (dailyCount && dailyCount.cnt >= site.daily_receipt_limit) {
    return error(request, env, 429, 'DAILY_LIMIT_EXCEEDED', 'Daily receipt limit reached for this site.');
  }

  // Check storage byte limit for the site
  const storageUsed = await first<{ total: number }>(
    db,
    'SELECT COALESCE(SUM(image_bytes), 0) as total FROM receipts WHERE site_id = ?',
    device.siteId,
  );
  if (storageUsed && storageUsed.total + body.totalBytes > site.storage_byte_limit) {
    return error(request, env, 429, 'STORAGE_LIMIT_EXCEEDED', 'Storage limit would be exceeded.');
  }

  const uploadId = uuid();
  const imageKey = `receipts/${device.organizationId}/${device.siteId}/${body.receiptId}.webp`;

  // Create receipt record
  await exec(
    db,
    `INSERT INTO receipts (id, site_id, device_id, vendor_id, captured_at_unix, captured_quantity, image_key, image_bytes, image_sha256, status, version, app_version, configuration_version, enrichment_status, mime_type, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 'RECEIVED', 1, ?, ?, 'PENDING', ?, ?, ?)`,
    body.receiptId, device.siteId, device.id, body.vendorId,
    body.capturedAtUnix, body.capturedQuantity, imageKey,
    body.imageSha256, body.appVersion ?? 'unknown', body.configurationVersion ?? 1,
    body.mimeType ?? 'image/webp',
    new Date().toISOString(), new Date().toISOString(),
  );

  // Create upload session
  await exec(
    db,
    `INSERT INTO upload_sessions (id, receipt_id, device_id, site_id, organization_id, total_bytes, uploaded_bytes, status, mime_type, declared_sha256, cdn_domain, url_path, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 'IN_PROGRESS', ?, ?, '', ?, ?)`,
    uploadId, body.receiptId, device.id, device.siteId, device.organizationId,
    body.totalBytes, body.mimeType ?? 'image/webp', body.imageSha256,
    imageKey, new Date().toISOString(),
  );

  // Record audit event: UPLOAD_CREATED
  const chainId = `org:${device.organizationId}:site:${device.siteId}`;
  await appendAuditEvent(db, chainId, 'UPLOAD_CREATED', uploadCreatedEvent(
    uploadId, device.id, device.siteId, device.organizationId, body.totalBytes ? Math.ceil(body.totalBytes / UPLOAD_PART_SIZE) : 0,
  ));

  return json(request, env, {
    uploadId,
    receiptId: body.receiptId,
    partSize: UPLOAD_PART_SIZE,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(), // 24 hours
  }, 201);
}

// ─── GET /v1/uploads/{uploadId} ──────────────────────────────────────────────

export async function handleUploadStatus(request: Request, env: Env, uploadId: string): Promise<Response> {
  const db = env.DB;
  let device;
  try {
    device = await authenticateDevice(db, request.headers.get('Authorization'), env.DEVICE_TOKEN_PEPPER);
  } catch (err) {
    if (err instanceof DeviceAuthError) {
      return error(request, env, err.statusCode, err.code, 'Device authentication failed.');
    }
    throw err;
  }

  const session = await first<{
    id: string;
    receipt_id: string;
    total_bytes: number;
    uploaded_bytes: number;
    status: string;
    mime_type: string;
  }>(
    db,
    'SELECT id, receipt_id, total_bytes, uploaded_bytes, status, mime_type FROM upload_sessions WHERE id = ? AND device_id = ?',
    uploadId, device.id,
  );

  if (!session) {
    return error(request, env, 404, 'UPLOAD_NOT_FOUND', 'Upload session not found.');
  }

  return json(request, env, {
    uploadId: session.id,
    receiptId: session.receipt_id,
    totalBytes: session.total_bytes,
    uploadedBytes: session.uploaded_bytes,
    status: session.status,
    mimeType: session.mime_type,
  });
}

// ─── PUT /v1/uploads/{uploadId}/parts/{partNumber} ───────────────────────────

export async function handleUploadPart(
  request: Request,
  env: Env,
  uploadId: string,
  partNumber: number,
): Promise<Response> {
  const db = env.DB;
  let device;
  try {
    device = await authenticateDevice(db, request.headers.get('Authorization'), env.DEVICE_TOKEN_PEPPER);
  } catch (err) {
    if (err instanceof DeviceAuthError) {
      return error(request, env, err.statusCode, err.code, 'Device authentication failed.');
    }
    throw err;
  }

  // Verify upload session exists and belongs to device
  const session = await first<{
    id: string;
    receipt_id: string;
    total_bytes: number;
    uploaded_bytes: number;
    status: string;
    declared_sha256: string;
  }>(
    db,
    'SELECT id, receipt_id, total_bytes, uploaded_bytes, status, declared_sha256 FROM upload_sessions WHERE id = ? AND device_id = ?',
    uploadId, device.id,
  );

  if (!session) {
    return error(request, env, 404, 'UPLOAD_NOT_FOUND', 'Upload session not found.');
  }
  if (session.status !== 'IN_PROGRESS') {
    return error(request, env, 400, 'UPLOAD_COMPLETED', 'Upload session is already completed.');
  }

  // Read and validate part
  const body = await request.arrayBuffer();
  if (body.byteLength > UPLOAD_PART_SIZE) {
    return error(request, env, 413, 'PART_TOO_LARGE', `Part must be under ${UPLOAD_PART_SIZE} bytes.`);
  }

  // Verify declared hash (optional header check)
  const declaredHash = request.headers.get('X-Part-Sha256');
  if (declaredHash) {
    const actualHash = await sha256Hex(body);
    if (actualHash !== declaredHash) {
      return error(request, env, 400, 'HASH_MISMATCH', 'Part SHA-256 does not match declared hash.');
    }
  }

  // Store part in R2 under the upload session path
  const partKey = `uploads/${device.organizationId}/${device.siteId}/${uploadId}/part_${String(partNumber).padStart(4, '0')}`;
  await env.RECEIPTS.put(partKey, body, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });

  // Update upload progress
  const newUploadedBytes = session.uploaded_bytes + body.byteLength;
  const isComplete = newUploadedBytes >= session.total_bytes;

  await exec(
    db,
    'UPDATE upload_sessions SET uploaded_bytes = ?, status = ? WHERE id = ?',
    newUploadedBytes, isComplete ? 'PARTS_UPLOADED' : 'IN_PROGRESS', uploadId,
  );

  return new Response(null, { status: 204 });
}

// Helper: SHA-256 for ArrayBuffer
async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ─── POST /v1/uploads/{uploadId}/complete ────────────────────────────────────

export async function handleCompleteUpload(request: Request, env: Env, uploadId: string): Promise<Response> {
  const db = env.DB;
  let device;
  try {
    device = await authenticateDevice(db, request.headers.get('Authorization'), env.DEVICE_TOKEN_PEPPER);
    await authenticateDeviceNonce(db, device, request.headers);
  } catch (err) {
    if (err instanceof DeviceAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  // Verify upload session
  const session = await first<{
    id: string;
    receipt_id: string;
    total_bytes: number;
    uploaded_bytes: number;
    status: string;
    declared_sha256: string;
    mime_type: string;
  }>(
    db,
    'SELECT id, receipt_id, total_bytes, uploaded_bytes, status, declared_sha256, mime_type FROM upload_sessions WHERE id = ? AND device_id = ?',
    uploadId, device.id,
  );

  if (!session) {
    return error(request, env, 404, 'UPLOAD_NOT_FOUND', 'Upload session not found.');
  }
  if (session.status !== 'PARTS_UPLOADED') {
    return error(request, env, 400, 'UPLOAD_NOT_COMPLETE',
      session.status === 'IN_PROGRESS'
        ? `Upload in progress (${session.uploaded_bytes}/${session.total_bytes} bytes).`
        : `Upload is in status: ${session.status}.`);
  }

  // Concatenate parts from R2 into a single object
  const baseKey = `uploads/${device.organizationId}/${device.siteId}/${uploadId}`;
  let totalParts = 0;
  let cursor: string | undefined;

  // List all parts
  const listed = await env.RECEIPTS.list({ prefix: `${baseKey}/part_` });
  const partKeys = listed.objects
    .map((obj) => obj.key)
    .sort();

  if (partKeys.length === 0) {
    return error(request, env, 400, 'NO_PARTS_FOUND', 'No uploaded parts were found.');
  }

  // Read and concatenate all parts
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for (const key of partKeys) {
    const obj = await env.RECEIPTS.get(key);
    if (!obj) continue;
    const chunk = await obj.arrayBuffer();
    chunks.push(new Uint8Array(chunk));
    totalBytes += chunk.byteLength;
  }

  // Concatenate into single image
  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  // Verify complete image SHA-256
  const actualSha256 = await sha256Hex(combined.buffer);
  if (actualSha256 !== session.declared_sha256) {
    return error(request, env, 400, 'IMAGE_HASH_MISMATCH', 'Final image SHA-256 does not match declared hash.');
  }

  // Store the assembled image in R2 under the permanent receipt key
  const imageKey = `receipts/${device.organizationId}/${device.siteId}/${session.receipt_id}.webp`;
  await env.RECEIPTS.put(imageKey, combined, {
    httpMetadata: { contentType: session.mime_type },
  });

  // Clean up temporary part objects
  await Promise.all(partKeys.map((key) => env.RECEIPTS.delete(key)));

  // Update receipt record
  const now = new Date().toISOString();
  await exec(
    db,
    "UPDATE receipts SET image_bytes = ?, status = 'RECEIVED', enrichment_status = 'IMAGE_STORED', updated_at = ? WHERE id = ?",
    totalBytes, now, session.receipt_id,
  );

  // Mark upload session as completed
  await exec(
    db,
    "UPDATE upload_sessions SET status = 'COMPLETED', uploaded_at = ? WHERE id = ?",
    now, uploadId,
  );

  // Record audit event
  const chainId = `org:${device.organizationId}:site:${device.siteId}`;
  await appendAuditEvent(db, chainId, 'UPLOAD_COMPLETED', uploadCompletedEvent(
    session.receipt_id, device.id, device.siteId, device.organizationId, totalBytes,
  ));

  // Record in property graph
  // Ensure nodes for receipt context exist
  await upsertGraphNode(db, device.organizationId, 'Organization', {
    id: device.organizationId,
  });
  // Create Receipt node with edges to Device (CAPTURED_BY), Vendor (FROM_VENDOR), Site (RECORDED_AT)
  const receiptBody = JSON.parse(request.headers.get('X-Receipt-Meta') || '{}');
  await ensureReceiptInGraph(
    db,
    session.receipt_id,
    device.id,
    '', // vendor_id is on the receipt record; we'll update after lookup
    device.siteId,
    device.organizationId,
    {
      image_bytes: totalBytes,
      image_sha256: actualSha256,
      status: 'RECEIVED',
      captured_at: now,
      vendor_id: null, // will be filled when the receipt is enriched
    },
  );

  // Send to enrichment queue
  await env.RECEIPT_QUEUE.send({
    type: 'receipt_enrichment',
    receiptId: session.receipt_id,
    organizationId: device.organizationId,
    siteId: device.siteId,
    imageKey,
    imageBytes: totalBytes,
  });

  // Local pilot: drain inline because `wrangler dev --local` does not guarantee
  // queue delivery. Idempotent with the queue consumer ([[queues.consumers]]).
  if (env.ENVIRONMENT === 'local-pilot') {
    await drainReceiptEnrichment(db, {
      receiptId: session.receipt_id,
      organizationId: device.organizationId,
      siteId: device.siteId,
    });
  }

  return json(request, env, {
    receiptId: session.receipt_id,
    imageBytes: totalBytes,
    imageSha256: actualSha256,
    status: 'RECEIVED',
  }, 202);
}
