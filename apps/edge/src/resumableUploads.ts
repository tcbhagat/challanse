import { receiptUploadMetadataSchema, uploadPartSize, uploadSessionRequestSchema } from '@challanse/contracts';
import { error, json } from './responses';
import { consumeReplayNonce, corsHeaders, isWebp, sha256Hex } from './security';
import type { DeviceIdentity, Env } from './types';

type UploadSessionRow = {
  id: string;
  receipt_id: string;
  site_id: string;
  device_id: string;
  metadata_json: string;
  total_bytes: number;
  image_sha256: string;
  mime_type: string;
  status: string;
};

export async function createUploadSession(request: Request, env: Env, device: DeviceIdentity): Promise<Response> {
  let input;
  try {
    if (!(request.headers.get('Content-Type') ?? '').toLowerCase().includes('application/json')) throw new Error('content_type');
    input = uploadSessionRequestSchema.parse(await request.json());
  } catch {
    return error(request, env, 400, 'INVALID_UPLOAD_SESSION', 'Upload metadata is invalid.');
  }
  const existingReceipt = await env.DB.prepare(`SELECT id, status FROM receipts WHERE id = ? LIMIT 1`)
    .bind(input.receiptId).first<{ id: string; status: string }>();
  if (existingReceipt) return json(request, env, { receiptId: input.receiptId, status: existingReceipt.status, complete: true }, 200);
  const existing = await env.DB.prepare(
    `SELECT id, status FROM upload_sessions WHERE receipt_id = ? AND site_id = ? AND device_id = ? LIMIT 1`,
  ).bind(input.receiptId, device.siteId, device.id).first<{ id: string; status: string }>();
  if (existing) return json(request, env, { uploadId: existing.id, receiptId: input.receiptId, status: existing.status, partSize: uploadPartSize }, 200);
  const site = await env.DB.prepare(
    `SELECT image_byte_limit, storage_byte_limit, stored_image_bytes FROM sites WHERE id = ? AND active = 1`,
  ).bind(device.siteId).first<{ image_byte_limit: number; storage_byte_limit: number; stored_image_bytes: number }>();
  if (!site) return error(request, env, 403, 'SITE_INACTIVE', 'The enrolled site is not active.');
  if (input.totalBytes > site.image_byte_limit) return error(request, env, 413, 'IMAGE_TOO_LARGE', 'Image exceeds the configured limit.');
  if (site.stored_image_bytes >= site.storage_byte_limit * 0.9) return error(request, env, 507, 'PILOT_STORAGE_PAUSED', 'Cloud storage is paused; the receipt remains safely queued on this device.');
  const vendor = await env.DB.prepare(`SELECT id FROM vendors WHERE id = ? AND site_id = ? AND active = 1`)
    .bind(input.vendorId, device.siteId).first<{ id: string }>();
  if (!vendor) return error(request, env, 400, 'INVALID_VENDOR', 'Vendor is not active for this site.');
  const uploadId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO upload_sessions (id, receipt_id, site_id, device_id, metadata_json, total_bytes, image_sha256, mime_type, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+24 hours'))`,
  ).bind(uploadId, input.receiptId, device.siteId, device.id, JSON.stringify(input), input.totalBytes, input.imageSha256, input.mimeType).run();
  return json(request, env, { uploadId, receiptId: input.receiptId, status: 'OPEN', partSize: uploadPartSize }, 201);
}

export async function getUploadSession(request: Request, env: Env, device: DeviceIdentity, uploadId: string): Promise<Response> {
  const session = await env.DB.prepare(
    `SELECT id, receipt_id, total_bytes, status FROM upload_sessions WHERE id = ? AND site_id = ? AND device_id = ? LIMIT 1`,
  ).bind(uploadId, device.siteId, device.id).first<{ id: string; receipt_id: string; total_bytes: number; status: string }>();
  if (!session) return error(request, env, 404, 'UPLOAD_NOT_FOUND', 'Upload session was not found.');
  const parts = await env.DB.prepare(
    `SELECT part_number, byte_offset, byte_length, sha256 FROM upload_parts WHERE upload_id = ? ORDER BY part_number`,
  ).bind(uploadId).all<{ part_number: number; byte_offset: number; byte_length: number; sha256: string }>();
  return json(request, env, {
    uploadId,
    receiptId: session.receipt_id,
    status: session.status,
    totalBytes: session.total_bytes,
    uploadedBytes: parts.results.reduce((sum, part) => sum + part.byte_length, 0),
    parts: parts.results.map((part) => ({ partNumber: part.part_number, byteOffset: part.byte_offset, byteLength: part.byte_length, sha256: part.sha256 })),
  });
}

export async function putUploadPart(request: Request, env: Env, device: DeviceIdentity, uploadId: string, partNumber: number): Promise<Response> {
  if (!(await consumeReplayNonce(request, env, device.id))) return error(request, env, 409, 'REPLAY_REJECTED', 'Upload timestamp or nonce is invalid or already used.');
  const session = await env.DB.prepare(
    `SELECT id, receipt_id, site_id, device_id, metadata_json, total_bytes, image_sha256, mime_type, status
     FROM upload_sessions WHERE id = ? AND site_id = ? AND device_id = ? AND expires_at > CURRENT_TIMESTAMP LIMIT 1`,
  ).bind(uploadId, device.siteId, device.id).first<UploadSessionRow>();
  if (!session || session.status !== 'OPEN') return error(request, env, 409, 'UPLOAD_NOT_OPEN', 'Upload session is unavailable or complete.');
  const expectedOffset = partNumber * uploadPartSize;
  if (expectedOffset >= session.total_bytes) return error(request, env, 416, 'PART_OUT_OF_RANGE', 'Upload part is outside the declared image size.');
  const bytes = await request.arrayBuffer();
  const expectedLength = Math.min(uploadPartSize, session.total_bytes - expectedOffset);
  if (bytes.byteLength !== expectedLength) return error(request, env, 400, 'PART_LENGTH_MISMATCH', 'Upload part length does not match its required byte range.');
  const declaredHash = request.headers.get('X-Part-Sha256') ?? '';
  const actualHash = await sha256Hex(bytes);
  if (declaredHash !== actualHash) return error(request, env, 422, 'PART_CHECKSUM_MISMATCH', 'Upload part checksum does not match.');
  const existing = await env.DB.prepare(`SELECT sha256, byte_length FROM upload_parts WHERE upload_id = ? AND part_number = ?`)
    .bind(uploadId, partNumber).first<{ sha256: string; byte_length: number }>();
  if (existing) {
    if (existing.sha256 !== actualHash || existing.byte_length !== bytes.byteLength) return error(request, env, 409, 'PART_CONFLICT', 'This upload part already contains different bytes.');
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }
  const objectKey = `${device.siteId}/uploads/${uploadId}/part-${String(partNumber).padStart(4, '0')}`;
  await env.RECEIPTS.put(objectKey, bytes, { httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' } });
  try {
    await env.DB.prepare(
      `INSERT INTO upload_parts (upload_id, part_number, byte_offset, byte_length, sha256, object_key) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(uploadId, partNumber, expectedOffset, bytes.byteLength, actualHash, objectKey).run();
  } catch (caught) {
    await env.RECEIPTS.delete(objectKey);
    throw caught;
  }
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function completeUploadSession(request: Request, env: Env, device: DeviceIdentity, uploadId: string): Promise<Response> {
  const session = await env.DB.prepare(
    `SELECT id, receipt_id, site_id, device_id, metadata_json, total_bytes, image_sha256, mime_type, status
     FROM upload_sessions WHERE id = ? AND site_id = ? AND device_id = ? LIMIT 1`,
  ).bind(uploadId, device.siteId, device.id).first<UploadSessionRow>();
  if (!session) return error(request, env, 404, 'UPLOAD_NOT_FOUND', 'Upload session was not found.');
  const existingReceipt = await env.DB.prepare(`SELECT id, status FROM receipts WHERE id = ? LIMIT 1`)
    .bind(session.receipt_id).first<{ id: string; status: string }>();
  if (existingReceipt) return json(request, env, { receiptId: session.receipt_id, status: existingReceipt.status, duplicate: true }, 202);
  if (session.status !== 'OPEN') return error(request, env, 409, 'UPLOAD_NOT_OPEN', 'Upload session is not open.');
  const parts = await env.DB.prepare(
    `SELECT part_number, byte_offset, byte_length, object_key FROM upload_parts WHERE upload_id = ? ORDER BY part_number`,
  ).bind(uploadId).all<{ part_number: number; byte_offset: number; byte_length: number; object_key: string }>();
  const combined = new Uint8Array(session.total_bytes);
  let confirmedBytes = 0;
  for (const part of parts.results) {
    if (part.byte_offset !== confirmedBytes) return error(request, env, 409, 'UPLOAD_INCOMPLETE', 'Upload contains a missing byte range.');
    const object = await env.RECEIPTS.get(part.object_key);
    if (!object) return error(request, env, 409, 'UPLOAD_PART_MISSING', 'A confirmed upload part is unavailable.');
    const bytes = new Uint8Array(await object.arrayBuffer());
    combined.set(bytes, part.byte_offset);
    confirmedBytes += bytes.byteLength;
  }
  if (confirmedBytes !== session.total_bytes) return error(request, env, 409, 'UPLOAD_INCOMPLETE', 'Upload is not complete.');
  if (!isWebp(combined)) return error(request, env, 415, 'INVALID_IMAGE', 'Only valid WebP receipt images are accepted.');
  const finalHash = await sha256Hex(combined.buffer);
  if (finalHash !== session.image_sha256) return error(request, env, 422, 'CHECKSUM_MISMATCH', 'Final image checksum does not match.');
  const metadata = receiptUploadMetadataSchema.parse(JSON.parse(session.metadata_json));
  const imageKey = `${device.siteId}/${new Date().toISOString().slice(0, 10)}/${session.receipt_id}.webp`;
  await env.RECEIPTS.put(imageKey, combined.buffer, { httpMetadata: { contentType: 'image/webp', cacheControl: 'private, no-store' }, customMetadata: { receiptId: session.receipt_id, siteId: device.siteId, sha256: finalHash } });
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO receipts (id, site_id, device_id, vendor_id, captured_at_unix, captured_quantity, image_key, image_bytes, image_sha256, status, app_version, configuration_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?)`,
      ).bind(metadata.receiptId, device.siteId, device.id, metadata.vendorId, metadata.capturedAtUnix, metadata.capturedQuantity, imageKey, session.total_bytes, finalHash, metadata.appVersion, metadata.configurationVersion),
      env.DB.prepare(`UPDATE sites SET stored_image_bytes = stored_image_bytes + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(session.total_bytes, device.siteId),
      env.DB.prepare(`UPDATE upload_sessions SET status = 'COMPLETE', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'OPEN'`).bind(uploadId),
      env.DB.prepare(`INSERT INTO receipt_audits (id, receipt_id, site_id, event_type, actor, event_json) VALUES (?, ?, ?, 'RECEIVED', ?, ?)`)
        .bind(crypto.randomUUID(), metadata.receiptId, device.siteId, `device:${device.id}`, JSON.stringify({ imageBytes: session.total_bytes, resumable: true })),
    ]);
  } catch (caught) {
    await env.RECEIPTS.delete(imageKey);
    throw caught;
  }
  for (const part of parts.results) await env.RECEIPTS.delete(part.object_key);
  try {
    await env.RECEIPT_QUEUE.send({ receiptId: metadata.receiptId, siteId: device.siteId });
  } catch {
    await env.DB.prepare(`INSERT INTO operations_log (id, site_id, event_type, detail_json) VALUES (?, ?, 'QUEUE_SEND_FAILED', ?)`)
      .bind(crypto.randomUUID(), device.siteId, JSON.stringify({ receiptId: metadata.receiptId })).run();
  }
  return json(request, env, { receiptId: metadata.receiptId, status: 'RECEIVED', duplicate: false }, 202);
}
