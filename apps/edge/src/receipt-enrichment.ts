import { appendAuditEvent } from './audit-chain';
import { exec, first } from './db';
import type { Env } from './types';

type ReceiptMessage = {
  type: 'receipt_enrichment';
  receiptId: string;
  organizationId: string;
  siteId: string;
  imageKey: string;
};

type ExtractedFields = {
  vendorName: string | null;
  challanNumber: string | null;
  materialDescription: string | null;
  quantity: number | null;
  unit: string | null;
};

const UNITS = new Set(['BAG', 'KG', 'TON', 'NOS', 'UNIT', 'M3', 'L']);

function parseAnswer(answer: unknown): ExtractedFields | null {
  if (typeof answer !== 'string' || answer.length > 8_000) return null;
  const cleaned = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value: unknown;
  try { value = JSON.parse(cleaned); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const text = (key: string, max: number) => row[key] === null ? null : typeof row[key] === 'string' && row[key].trim().length <= max ? row[key].trim() : null;
  const quantity = row.quantity === null ? null : typeof row.quantity === 'number' && Number.isFinite(row.quantity) && row.quantity > 0 && row.quantity <= 1_000_000_000 ? row.quantity : null;
  const unit = text('unit', 24)?.toUpperCase() ?? null;
  return {
    vendorName: text('vendorName', 160),
    challanNumber: text('challanNumber', 80),
    materialDescription: text('materialDescription', 240),
    quantity,
    unit: unit && UNITS.has(unit) ? unit : null,
  };
}

function toDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

async function fallback(env: Env, message: ReceiptMessage, reason: string): Promise<void> {
  const now = new Date().toISOString();
  await exec(env.DB,
    `UPDATE receipts SET status = 'NEEDS_REVIEW', enrichment_status = 'MANUAL_REVIEW_REQUIRED', raw_ocr_json = ?, updated_at = ? WHERE id = ? AND site_id = ?`,
    JSON.stringify({ provider: 'workers-ai', reason }), now, message.receiptId, message.siteId);
  await appendAuditEvent(env.DB, `org:${message.organizationId}:site:${message.siteId}`, 'OCR_REVIEW_REQUIRED', {
    receiptId: message.receiptId, reason, occurredAt: now,
  });
}

export async function processReceiptWithWorkersAi(env: Env, message: ReceiptMessage): Promise<void> {
  const receipt = await first<{ id: string; mime_type: string }>(env.DB,
    'SELECT id, mime_type FROM receipts WHERE id = ? AND site_id = ?', message.receiptId, message.siteId);
  if (!receipt) return;
  await exec(env.DB, "UPDATE receipts SET enrichment_status = 'PROCESSING', updated_at = ? WHERE id = ?", new Date().toISOString(), message.receiptId);

  const today = new Date().toISOString().slice(0, 10);
  const usageKey = `workers-ai:requests:${today}`;
  const used = Number(await env.RATE_LIMITS.get(usageKey) ?? '0');
  const limit = Math.max(0, Number(env.AI_DAILY_REQUEST_LIMIT || '25'));
  if (!env.AI || used >= limit) return fallback(env, message, 'quota_or_provider_unavailable');

  const object = await env.RECEIPTS.get(message.imageKey);
  if (!object) return fallback(env, message, 'image_unavailable');
  const bytes = new Uint8Array(await object.arrayBuffer());
  const vendors = await env.DB.prepare('SELECT id, name FROM vendors WHERE site_id = ? AND active = 1').bind(message.siteId).all<{ id: string; name: string }>();
  const names = vendors.results.map((vendor) => vendor.name).join(', ');

  let answer: unknown;
  try {
    const result = await env.AI.run(env.AI_MODEL || '@cf/moondream/moondream3.1-9B-A2B', {
      task: 'query', image: toDataUrl(bytes, receipt.mime_type), reasoning: false, temperature: 0, max_tokens: 512, stream: false,
      question: `Read this construction challan. Return JSON only with exactly vendorName, challanNumber, materialDescription, quantity, unit. Use null when unreadable. Never infer missing values. Known vendors: ${names}.`,
    }) as { answer?: unknown };
    answer = result.answer;
    await env.RATE_LIMITS.put(usageKey, String(used + 1), { expirationTtl: 172800 });
  } catch {
    return fallback(env, message, 'provider_failure');
  }

  const fields = parseAnswer(answer);
  if (!fields) return fallback(env, message, 'invalid_output');
  const vendor = fields.vendorName
    ? vendors.results.find((candidate) => candidate.name.toLowerCase() === fields.vendorName?.toLowerCase())
    : undefined;
  const now = new Date().toISOString();
  await exec(env.DB,
    `UPDATE receipts SET vendor_id = CASE WHEN ? <> '' THEN ? ELSE vendor_id END, challan_number = ?, material_description = ?, verified_quantity = ?, unit = ?, status = 'NEEDS_REVIEW', enrichment_status = 'OCR_COMPLETED', raw_ocr_json = ?, updated_at = ? WHERE id = ? AND site_id = ?`,
    vendor?.id ?? '', vendor?.id ?? '', fields.challanNumber ?? '', fields.materialDescription ?? '', fields.quantity, fields.unit ?? '',
    JSON.stringify({ provider: 'workers-ai', model: env.AI_MODEL, fields }), now, message.receiptId, message.siteId);
  await appendAuditEvent(env.DB, `org:${message.organizationId}:site:${message.siteId}`, 'OCR_ASSISTED', {
    receiptId: message.receiptId, model: env.AI_MODEL, occurredAt: now,
  });
}

export function isReceiptMessage(value: unknown): value is ReceiptMessage {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return row.type === 'receipt_enrichment' && ['receiptId', 'organizationId', 'siteId', 'imageKey'].every((key) => typeof row[key] === 'string' && row[key] !== '');
}
