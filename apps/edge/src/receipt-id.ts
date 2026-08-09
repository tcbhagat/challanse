// ─── Receipt ID Validation ───────────────────────────────────────────────────
// Receipt IDs are client-generated and embedded verbatim in R2 object keys
// (receipts/{org}/{site}/{receiptId}.webp). The mobile app generates UUID v4
// (apps/mobile/src/engine/receiptStore.ts), so any other value is rejected here
// to keep object keys predictable and to prevent path traversal via the key.

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidReceiptId(receiptId: string | undefined | null): receiptId is string {
  return typeof receiptId === 'string' && UUID_V4_RE.test(receiptId);
}
