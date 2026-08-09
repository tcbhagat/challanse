import { all, exec, first, uuid } from '../db';
import { validateImage } from '../image-validation';
import { error, json } from '../responses';
import { corsHeaders, sha256Hex } from '../security';
import type { AccessIdentity, Env } from '../types';

const CONSENT_VERSION = 'guest-privacy-2026-08-09';
const MAX_PART_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 5_000_000;
const SHA256_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[0-9a-f-]{36}$/;
const FILE_RE = /^[a-zA-Z0-9][a-zA-Z0-9 ._()-]{0,119}$/;
const UNITS = new Set(['BAG', 'KG', 'TON', 'NOS', 'UNIT', 'M3', 'L']);

type WorkspaceRow = {
  id: string;
  identity_hash: string;
  csrf_hash: string;
  status: string;
  expires_at: string;
  deleted_at: string | null;
};

type UploadRow = {
  id: string;
  workspace_id: string;
  filename: string;
  declared_mime_type: string;
  total_bytes: number;
  expected_sha256: string;
  received_bytes: number;
  status: string;
};

type GuestFields = {
  vendorName: string | null;
  challanNumber: string | null;
  materialDescription: string | null;
  quantity: number | null;
  unit: string | null;
};

function numberSetting(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function now(): string { return new Date().toISOString(); }
function day(): string { return now().slice(0, 10); }
function expiresIn24Hours(): string { return new Date(Date.now() + 86_400_000).toISOString(); }

async function identityHash(identity: AccessIdentity, env: Env): Promise<string> {
  if (!env.GUEST_IDENTITY_PEPPER) throw new Error('GUEST_CONFIGURATION_MISSING');
  return sha256Hex(`${identity.issuer}\u0000${identity.subject}\u0000${env.GUEST_IDENTITY_PEPPER}`);
}

async function emailHash(identity: AccessIdentity, env: Env): Promise<string> {
  if (!env.GUEST_IDENTITY_PEPPER) throw new Error('GUEST_CONFIGURATION_MISSING');
  return sha256Hex(`${identity.email}\u0000${env.GUEST_IDENTITY_PEPPER}`);
}

async function ipHash(request: Request, env: Env): Promise<string> {
  const address = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  return sha256Hex(`${address}\u0000${env.GUEST_IDENTITY_PEPPER ?? 'missing'}`);
}

function exactGuestOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin') ?? '';
  return origin === 'https://guest.challanse.constrovet.com' && env.ALLOWED_ORIGINS.split(',').map((v) => v.trim()).includes(origin);
}

async function getWorkspace(env: Env, workspaceId: string, identity: AccessIdentity): Promise<WorkspaceRow | null> {
  if (!ID_RE.test(workspaceId)) return null;
  const hash = await identityHash(identity, env);
  return first<WorkspaceRow>(env.DB,
    `SELECT id, identity_hash, csrf_hash, status, expires_at, deleted_at
       FROM guest_workspaces
      WHERE id = ? AND identity_hash = ? AND deleted_at IS NULL AND expires_at > ?`,
    workspaceId, hash, now());
}

async function requireWorkspace(
  request: Request,
  env: Env,
  identity: AccessIdentity,
  workspaceId: string,
  csrf = false,
): Promise<WorkspaceRow | Response> {
  if (!exactGuestOrigin(request, env)) return error(request, env, 403, 'ORIGIN_DENIED', 'This request origin is not permitted.');
  const workspace = await getWorkspace(env, workspaceId, identity);
  if (!workspace) return error(request, env, 404, 'WORKSPACE_UNAVAILABLE', 'This private workspace is unavailable or expired.');
  if (csrf) {
    const token = request.headers.get('X-ChallanSe-CSRF') ?? '';
    if (!token || await sha256Hex(token) !== workspace.csrf_hash) {
      return error(request, env, 403, 'CSRF_REJECTED', 'Refresh the page and try again.');
    }
  }
  return workspace;
}

async function audit(env: Env, workspaceId: string | null, identityHashValue: string, eventType: string): Promise<void> {
  await exec(env.DB,
    'INSERT INTO guest_security_events (id, workspace_id, identity_hash, event_type, created_at) VALUES (?, ?, ?, ?, ?)',
    uuid(), workspaceId, identityHashValue, eventType, now());
}

function publicWorkspace(workspace: WorkspaceRow, csrfToken: string) {
  return { workspaceId: workspace.id, state: workspace.status, expiresAt: workspace.expires_at, csrfToken };
}

export async function handleGuestSession(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  if (!exactGuestOrigin(request, env)) return error(request, env, 403, 'ORIGIN_DENIED', 'This request origin is not permitted.');
  const hash = await identityHash(identity, env);
  const workspace = await first<WorkspaceRow>(env.DB,
    `SELECT id, identity_hash, csrf_hash, status, expires_at, deleted_at
       FROM guest_workspaces
      WHERE identity_hash = ? AND deleted_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC LIMIT 1`, hash, now());
  if (!workspace) return json(request, env, { workspace: null });
  const token = crypto.randomUUID() + crypto.randomUUID();
  await exec(env.DB, 'UPDATE guest_workspaces SET csrf_hash = ?, updated_at = ? WHERE id = ?', await sha256Hex(token), now(), workspace.id);
  return json(request, env, { workspace: publicWorkspace(workspace, token) });
}

export async function handleCreateGuestWorkspace(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  if (!exactGuestOrigin(request, env)) return error(request, env, 403, 'ORIGIN_DENIED', 'This request origin is not permitted.');
  let body: { accepted?: unknown; consentVersion?: unknown };
  try { body = await request.json(); } catch { return error(request, env, 400, 'CONSENT_REQUIRED', 'Accept the privacy and retention terms to continue.'); }
  if (body.accepted !== true || body.consentVersion !== CONSENT_VERSION) {
    return error(request, env, 400, 'CONSENT_REQUIRED', 'Accept the privacy and retention terms to continue.');
  }
  const identityHashValue = await identityHash(identity, env);
  const addressHash = await ipHash(request, env);
  const usageDay = day();
  const ipLimit = numberSetting(env.GUEST_DAILY_IP_LIMIT, 10);
  await exec(env.DB,
    `INSERT INTO guest_ip_usage (usage_day, ip_hash, attempts, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(usage_day, ip_hash) DO UPDATE SET attempts = attempts + 1, updated_at = excluded.updated_at`,
    usageDay, addressHash, now());
  const ipUsage = await first<{ attempts: number }>(env.DB, 'SELECT attempts FROM guest_ip_usage WHERE usage_day = ? AND ip_hash = ?', usageDay, addressHash);
  if ((ipUsage?.attempts ?? ipLimit + 1) > ipLimit) return error(request, env, 429, 'DAILY_CAPACITY_REACHED', 'Daily processing capacity reached. Please try tomorrow.');

  const existing = await first<WorkspaceRow>(env.DB,
    `SELECT id, identity_hash, csrf_hash, status, expires_at, deleted_at FROM guest_workspaces
      WHERE identity_hash = ? AND deleted_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1`, identityHashValue, now());
  if (existing) return error(request, env, 409, 'WORKSPACE_ACTIVE', 'One private workspace is already active. Refresh to continue.');

  const workspaceId = uuid();
  const csrfToken = crypto.randomUUID() + crypto.randomUUID();
  const timestamp = now();
  await exec(env.DB,
    `INSERT INTO guest_workspaces
      (id, identity_hash, email_hash, csrf_hash, consent_version, consent_at, status, expires_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'READY', ?, ?, ?)`,
    workspaceId, identityHashValue, await emailHash(identity, env), await sha256Hex(csrfToken), CONSENT_VERSION,
    timestamp, expiresIn24Hours(), timestamp, timestamp);
  await audit(env, workspaceId, identityHashValue, 'GUEST_CONSENT_ACCEPTED');
  const created = await getWorkspace(env, workspaceId, identity);
  return json(request, env, { workspace: publicWorkspace(created!, csrfToken) }, 201);
}

export async function handleCreateGuestUpload(request: Request, env: Env, identity: AccessIdentity, workspaceId: string): Promise<Response> {
  const workspace = await requireWorkspace(request, env, identity, workspaceId, true);
  if (workspace instanceof Response) return workspace;
  let body: { filename?: unknown; mimeType?: unknown; totalBytes?: unknown; sha256?: unknown };
  try { body = await request.json(); } catch { return error(request, env, 400, 'UPLOAD_INVALID', 'Choose a valid invoice image.'); }
  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : '';
  const totalBytes = Number(body.totalBytes);
  const checksum = typeof body.sha256 === 'string' ? body.sha256.toLowerCase() : '';
  if (!FILE_RE.test(filename) || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType) || !Number.isInteger(totalBytes) || totalBytes < 1 || totalBytes > MAX_IMAGE_BYTES || !SHA256_RE.test(checksum)) {
    return error(request, env, 400, 'UPLOAD_INVALID', 'Use one JPEG, PNG or WebP image up to 5 MB.');
  }
  const existing = await first<{ id: string }>(env.DB, 'SELECT id FROM guest_uploads WHERE workspace_id = ?', workspace.id);
  if (existing) return error(request, env, 409, 'UPLOAD_EXISTS', 'This workspace already has an invoice upload.');

  const identityHashValue = await identityHash(identity, env);
  const usageDay = day();
  const globalLimit = numberSetting(env.GUEST_DAILY_UPLOAD_LIMIT, 50);
  const identityLimit = numberSetting(env.GUEST_DAILY_IDENTITY_LIMIT, 3);
  const neuronBudget = numberSetting(env.GUEST_AI_NEURON_BUDGET, 9_000);
  const reservation = numberSetting(env.GUEST_AI_NEURON_RESERVATION, 500);
  await exec(env.DB, 'INSERT OR IGNORE INTO guest_daily_usage (usage_day, updated_at) VALUES (?, ?)', usageDay, now());
  await exec(env.DB, 'INSERT OR IGNORE INTO guest_identity_usage (usage_day, identity_hash, updated_at) VALUES (?, ?, ?)', usageDay, identityHashValue, now());
  const global = await first<{ accepted_uploads: number; reserved_neurons: number }>(env.DB, 'SELECT accepted_uploads, reserved_neurons FROM guest_daily_usage WHERE usage_day = ?', usageDay);
  const personal = await first<{ accepted_uploads: number }>(env.DB, 'SELECT accepted_uploads FROM guest_identity_usage WHERE usage_day = ? AND identity_hash = ?', usageDay, identityHashValue);
  if (!global || global.accepted_uploads >= globalLimit || global.reserved_neurons + reservation > neuronBudget || (personal?.accepted_uploads ?? identityLimit) >= identityLimit) {
    return error(request, env, 429, 'DAILY_CAPACITY_REACHED', 'Daily processing capacity reached. Please try tomorrow.');
  }

  const uploadId = uuid();
  const timestamp = now();
  const globalReservation = await exec(env.DB,
    `UPDATE guest_daily_usage SET accepted_uploads = accepted_uploads + 1, reserved_neurons = reserved_neurons + ?, updated_at = ?
      WHERE usage_day = ? AND accepted_uploads < ? AND reserved_neurons + ? <= ?`,
    reservation, timestamp, usageDay, globalLimit, reservation, neuronBudget);
  if ((globalReservation.meta.changes ?? 0) !== 1) return error(request, env, 429, 'DAILY_CAPACITY_REACHED', 'Daily processing capacity reached. Please try tomorrow.');
  const identityReservation = await exec(env.DB,
    'UPDATE guest_identity_usage SET accepted_uploads = accepted_uploads + 1, updated_at = ? WHERE usage_day = ? AND identity_hash = ? AND accepted_uploads < ?',
    timestamp, usageDay, identityHashValue, identityLimit);
  if ((identityReservation.meta.changes ?? 0) !== 1) {
    await exec(env.DB, 'UPDATE guest_daily_usage SET accepted_uploads = accepted_uploads - 1, reserved_neurons = reserved_neurons - ?, updated_at = ? WHERE usage_day = ?', reservation, timestamp, usageDay);
    return error(request, env, 429, 'DAILY_CAPACITY_REACHED', 'Daily processing capacity reached. Please try tomorrow.');
  }
  try {
    await exec(env.DB, `INSERT INTO guest_uploads
      (id, workspace_id, filename, declared_mime_type, total_bytes, expected_sha256, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'UPLOADING', ?, ?)`, uploadId, workspace.id, filename, mimeType, totalBytes, checksum, timestamp, timestamp);
  } catch (cause) {
    await env.DB.batch([
      env.DB.prepare('UPDATE guest_daily_usage SET accepted_uploads = accepted_uploads - 1, reserved_neurons = reserved_neurons - ?, updated_at = ? WHERE usage_day = ?').bind(reservation, timestamp, usageDay),
      env.DB.prepare('UPDATE guest_identity_usage SET accepted_uploads = accepted_uploads - 1, updated_at = ? WHERE usage_day = ? AND identity_hash = ?').bind(timestamp, usageDay, identityHashValue),
    ]);
    throw cause;
  }
  await audit(env, workspace.id, identityHashValue, 'GUEST_UPLOAD_CREATED');
  return json(request, env, { uploadId, partSize: MAX_PART_BYTES, nextOffset: 0 }, 201);
}

export async function handleGuestUploadStatus(request: Request, env: Env, identity: AccessIdentity, workspaceId: string, uploadId: string): Promise<Response> {
  const workspace = await requireWorkspace(request, env, identity, workspaceId);
  if (workspace instanceof Response) return workspace;
  const upload = await first<UploadRow>(env.DB, 'SELECT * FROM guest_uploads WHERE id = ? AND workspace_id = ?', uploadId, workspace.id);
  if (!upload) return error(request, env, 404, 'UPLOAD_UNAVAILABLE', 'Upload session not found.');
  return json(request, env, { uploadId, status: upload.status, receivedBytes: upload.received_bytes, nextOffset: upload.received_bytes, totalBytes: upload.total_bytes });
}

export async function handleGuestUploadPart(request: Request, env: Env, identity: AccessIdentity, workspaceId: string, uploadId: string, partNumber: number): Promise<Response> {
  const workspace = await requireWorkspace(request, env, identity, workspaceId, true);
  if (workspace instanceof Response) return workspace;
  if (!Number.isInteger(partNumber) || partNumber < 0 || partNumber > 19) return error(request, env, 400, 'PART_INVALID', 'Upload part is invalid.');
  const upload = await first<UploadRow>(env.DB, 'SELECT * FROM guest_uploads WHERE id = ? AND workspace_id = ? AND status = ?', uploadId, workspace.id, 'UPLOADING');
  if (!upload) return error(request, env, 404, 'UPLOAD_UNAVAILABLE', 'Upload session not found.');
  const offset = Number(request.headers.get('X-Part-Offset'));
  const checksum = (request.headers.get('X-Part-Sha256') ?? '').toLowerCase();
  if (!Number.isInteger(offset) || offset !== partNumber * MAX_PART_BYTES || offset !== upload.received_bytes || !SHA256_RE.test(checksum)) {
    return error(request, env, 409, 'PART_OFFSET_INVALID', 'Resume from the server-confirmed upload position.');
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length < 1 || bytes.length > MAX_PART_BYTES || offset + bytes.length > upload.total_bytes || await sha256Hex(bytes.buffer) !== checksum) {
    return error(request, env, 400, 'PART_INVALID', 'Upload part integrity check failed.');
  }
  const key = `guest-temporary/${workspace.id}/${upload.id}/${partNumber}`;
  await env.RECEIPTS.put(key, bytes, { httpMetadata: { contentType: 'application/octet-stream' } });
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO guest_upload_parts (upload_id, part_number, byte_offset, byte_length, sha256, object_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(upload.id, partNumber, offset, bytes.length, checksum, key, now()),
      env.DB.prepare('UPDATE guest_uploads SET received_bytes = received_bytes + ?, updated_at = ? WHERE id = ? AND received_bytes = ?').bind(bytes.length, now(), upload.id, offset),
    ]);
  } catch {
    const existing = await first<{ sha256: string; byte_length: number }>(env.DB, 'SELECT sha256, byte_length FROM guest_upload_parts WHERE upload_id = ? AND part_number = ?', upload.id, partNumber);
    if (!existing || existing.sha256 !== checksum || existing.byte_length !== bytes.length) return error(request, env, 409, 'PART_REPLAY_REJECTED', 'This upload part conflicts with the saved part.');
  }
  return json(request, env, { accepted: true, nextOffset: offset + bytes.length });
}

export async function handleCompleteGuestUpload(request: Request, env: Env, identity: AccessIdentity, workspaceId: string, uploadId: string): Promise<Response> {
  const workspace = await requireWorkspace(request, env, identity, workspaceId, true);
  if (workspace instanceof Response) return workspace;
  const upload = await first<UploadRow>(env.DB, 'SELECT * FROM guest_uploads WHERE id = ? AND workspace_id = ?', uploadId, workspace.id);
  if (!upload) return error(request, env, 404, 'UPLOAD_UNAVAILABLE', 'Upload session not found.');
  const existingReceipt = await first<{ id: string; state: string }>(env.DB, 'SELECT id, state FROM guest_receipts WHERE upload_id = ?', upload.id);
  if (existingReceipt) return json(request, env, { receiptId: existingReceipt.id, state: existingReceipt.state }, 202);
  if (upload.received_bytes !== upload.total_bytes) return error(request, env, 409, 'UPLOAD_INCOMPLETE', 'Resume the upload before completing it.');
  const parts = await all<{ object_key: string; part_number: number }>(env.DB, 'SELECT object_key, part_number FROM guest_upload_parts WHERE upload_id = ? ORDER BY part_number', upload.id);
  const image = new Uint8Array(upload.total_bytes);
  let cursor = 0;
  for (const part of parts) {
    const object = await env.RECEIPTS.get(part.object_key);
    if (!object) return error(request, env, 409, 'UPLOAD_INCOMPLETE', 'A saved upload part is unavailable. Please retry.');
    const bytes = new Uint8Array(await object.arrayBuffer());
    image.set(bytes, cursor); cursor += bytes.length;
  }
  if (cursor !== upload.total_bytes || await sha256Hex(image.buffer) !== upload.expected_sha256) return error(request, env, 400, 'CHECKSUM_MISMATCH', 'The uploaded image did not pass its integrity check.');
  let validated;
  try { validated = validateImage(image, upload.declared_mime_type); }
  catch { return error(request, env, 400, 'IMAGE_INVALID', 'Use a valid JPEG, PNG or WebP invoice image.'); }
  const receiptId = uuid();
  const imageKey = `guest/${workspace.id}/${receiptId}.${validated.extension}`;
  await env.RECEIPTS.put(imageKey, image, { httpMetadata: { contentType: validated.mimeType }, customMetadata: { sha256: upload.expected_sha256 } });
  const timestamp = now();
  const reservation = numberSetting(env.GUEST_AI_NEURON_RESERVATION, 500);
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO guest_receipts
        (id, workspace_id, upload_id, image_key, mime_type, image_bytes, image_sha256, width, height, state, reserved_neurons, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PROCESSING', ?, ?, ?)`).bind(receiptId, workspace.id, upload.id, imageKey, validated.mimeType, image.length, upload.expected_sha256, validated.width, validated.height, reservation, timestamp, timestamp),
      env.DB.prepare("UPDATE guest_uploads SET status = 'COMPLETED', updated_at = ? WHERE id = ? AND status = 'UPLOADING'").bind(timestamp, upload.id),
      env.DB.prepare("UPDATE guest_workspaces SET status = 'PROCESSING', updated_at = ? WHERE id = ?").bind(timestamp, workspace.id),
    ]);
  } catch {
    await env.RECEIPTS.delete(imageKey);
    throw new Error('GUEST_DURABILITY_FAILED');
  }
  try {
    await env.RECEIPT_QUEUE.send({ type: 'guest_invoice_enrichment', receiptId, workspaceId: workspace.id, imageKey });
  } catch {
    await env.DB.batch([
      env.DB.prepare("UPDATE guest_receipts SET state = 'NEEDS_CORRECTION', updated_at = ? WHERE id = ?").bind(now(), receiptId),
      env.DB.prepare("UPDATE guest_workspaces SET status = 'NEEDS_CORRECTION', updated_at = ? WHERE id = ?").bind(now(), workspace.id),
    ]);
  }
  for (const part of parts) await env.RECEIPTS.delete(part.object_key);
  await audit(env, workspace.id, await identityHash(identity, env), 'GUEST_UPLOAD_ACKNOWLEDGED');
  const finalState = await first<{ state: string }>(env.DB, 'SELECT state FROM guest_receipts WHERE id = ?', receiptId);
  return json(request, env, { receiptId, state: finalState?.state ?? 'NEEDS_CORRECTION' }, 202);
}

export async function handleGuestResult(request: Request, env: Env, identity: AccessIdentity, workspaceId: string): Promise<Response> {
  const workspace = await requireWorkspace(request, env, identity, workspaceId);
  if (workspace instanceof Response) return workspace;
  const receipt = await first<{ id: string; state: string; extracted_json: string; confirmed_json: string }>(env.DB, 'SELECT id, state, extracted_json, confirmed_json FROM guest_receipts WHERE workspace_id = ? AND deleted_at IS NULL', workspace.id);
  if (!receipt) return json(request, env, { state: workspace.status, fields: null });
  const source = receipt.state === 'COMPLETED' ? receipt.confirmed_json : receipt.extracted_json;
  let fields: unknown = {}; try { fields = JSON.parse(source); } catch { fields = {}; }
  return json(request, env, { receiptId: receipt.id, state: receipt.state, fields });
}

function validateConfirmedFields(value: unknown): GuestFields | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const requiredText = (key: string, max: number) => typeof row[key] === 'string' && row[key].trim().length > 0 && row[key].trim().length <= max ? row[key].trim() : null;
  const quantity = Number(row.quantity);
  const unit = requiredText('unit', 24)?.toUpperCase() ?? null;
  const result = { vendorName: requiredText('vendorName', 160), challanNumber: requiredText('challanNumber', 80), materialDescription: requiredText('materialDescription', 240), quantity, unit };
  return result.vendorName && result.challanNumber && result.materialDescription && Number.isFinite(quantity) && quantity > 0 && quantity <= 1_000_000_000 && unit && UNITS.has(unit) ? result : null;
}

export async function handleConfirmGuestResult(request: Request, env: Env, identity: AccessIdentity, workspaceId: string): Promise<Response> {
  const workspace = await requireWorkspace(request, env, identity, workspaceId, true);
  if (workspace instanceof Response) return workspace;
  let payload: unknown; try { payload = await request.json(); } catch { return error(request, env, 400, 'FIELDS_INVALID', 'Confirm every invoice field.'); }
  const fields = validateConfirmedFields(payload);
  if (!fields) return error(request, env, 400, 'FIELDS_INVALID', 'Confirm every invoice field using the available units.');
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare("UPDATE guest_receipts SET confirmed_json = ?, state = 'COMPLETED', updated_at = ? WHERE workspace_id = ? AND state IN ('READY_TO_CONFIRM', 'NEEDS_CORRECTION')").bind(JSON.stringify(fields), timestamp, workspace.id),
    env.DB.prepare("UPDATE guest_workspaces SET status = 'COMPLETED', updated_at = ? WHERE id = ?").bind(timestamp, workspace.id),
  ]);
  await audit(env, workspace.id, await identityHash(identity, env), 'GUEST_RESULT_CONFIRMED');
  return json(request, env, { state: 'COMPLETED', fields });
}

export async function handleGuestExport(request: Request, env: Env, identity: AccessIdentity, workspaceId: string): Promise<Response> {
  const workspace = await requireWorkspace(request, env, identity, workspaceId);
  if (workspace instanceof Response) return workspace;
  const receipt = await first<{ confirmed_json: string }>(env.DB, "SELECT confirmed_json FROM guest_receipts WHERE workspace_id = ? AND state = 'COMPLETED' AND deleted_at IS NULL", workspace.id);
  if (!receipt) return error(request, env, 409, 'RESULT_NOT_READY', 'Complete confirmation before downloading the result.');
  const fields = JSON.parse(receipt.confirmed_json) as GuestFields;
  const format = new URL(request.url).searchParams.get('format') === 'csv' ? 'csv' : 'json';
  const content = format === 'json' ? JSON.stringify(fields, null, 2) : `vendorName,challanNumber,materialDescription,quantity,unit\n${[fields.vendorName, fields.challanNumber, fields.materialDescription, fields.quantity, fields.unit].map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')}\n`;
  return new Response(content, { headers: { ...corsHeaders(request, env), 'Cache-Control': 'no-store', 'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="challanse-result.${format}"`, 'X-Content-Type-Options': 'nosniff' } });
}

export async function deleteGuestWorkspace(env: Env, workspaceId: string): Promise<void> {
  const receipt = await first<{ image_key: string }>(env.DB, 'SELECT image_key FROM guest_receipts WHERE workspace_id = ?', workspaceId);
  if (receipt) await env.RECEIPTS.delete(receipt.image_key);
  const parts = await all<{ object_key: string }>(env.DB, `SELECT p.object_key FROM guest_upload_parts p JOIN guest_uploads u ON u.id = p.upload_id WHERE u.workspace_id = ?`, workspaceId);
  for (const part of parts) await env.RECEIPTS.delete(part.object_key);
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM guest_security_events WHERE workspace_id = ?').bind(workspaceId),
    env.DB.prepare('DELETE FROM guest_upload_parts WHERE upload_id IN (SELECT id FROM guest_uploads WHERE workspace_id = ?)').bind(workspaceId),
    env.DB.prepare('DELETE FROM guest_receipts WHERE workspace_id = ?').bind(workspaceId),
    env.DB.prepare('DELETE FROM guest_uploads WHERE workspace_id = ?').bind(workspaceId),
    env.DB.prepare("UPDATE guest_workspaces SET identity_hash = '', email_hash = '', csrf_hash = '', status = 'DELETED', deleted_at = ?, updated_at = ? WHERE id = ?").bind(timestamp, timestamp, workspaceId),
    env.DB.prepare("INSERT OR IGNORE INTO retention_tombstones (id, receipt_id, resource_type, status, requested_at, completed_at) VALUES (?, ?, 'GUEST_WORKSPACE', 'COMPLETED', ?, ?)").bind(uuid(), workspaceId, timestamp, timestamp),
  ]);
}

export async function handleDeleteGuestWorkspace(request: Request, env: Env, identity: AccessIdentity, workspaceId: string): Promise<Response> {
  const workspace = await requireWorkspace(request, env, identity, workspaceId, true);
  if (workspace instanceof Response) return workspace;
  await deleteGuestWorkspace(env, workspace.id);
  return json(request, env, { state: 'DELETED' });
}

export async function deleteExpiredGuestWorkspaces(env: Env): Promise<number> {
  const expired = await all<{ id: string }>(env.DB, 'SELECT id FROM guest_workspaces WHERE deleted_at IS NULL AND expires_at <= ? LIMIT 100', now());
  for (const workspace of expired) await deleteGuestWorkspace(env, workspace.id);
  return expired.length;
}
