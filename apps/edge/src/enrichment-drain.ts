// ─── Enrichment Drain ─────────────────────────────────────────────────────────
// Drains a receipt from the enrichment queue by marking it enrichment-complete.
// Mirrors the OCR_COMPLETED receipts UPDATE in handlers/events.ts and additionally
// moves the receipt from RECEIVED to NEEDS_REVIEW so the local-pilot queueDepth
// (COUNT of RECEIVED receipts) reaches zero once enrichment is done.
//
// Used by the local-pilot queue handler (src/index.ts, a no-op outside the
// local-pilot runtime) and the inline local-pilot drain in handleCompleteUpload,
// which exists because `wrangler dev --local` does not guarantee queue delivery.
// Production enrichment runs on the AWS SQS pipeline in services/enrichment.

import { exec } from './db';

export interface EnrichmentMessage {
  receiptId: string;
  organizationId?: string;
  siteId?: string;
}

export async function drainReceiptEnrichment(db: D1Database, message: EnrichmentMessage): Promise<void> {
  const now = new Date().toISOString();

  // Receipts: RECEIVED → NEEDS_REVIEW with enrichment fields populated
  await exec(
    db,
    `UPDATE receipts SET
       status = 'NEEDS_REVIEW',
       enrichment_status = 'OCR_COMPLETED',
       ocr_confidence = ?,
       raw_ocr_json = ?,
       gst_status = ?,
       updated_at = ?
     WHERE id = ?`,
    0.99, '{"synthetic":true}', 'UNCHECKED', now, message.receiptId,
  );

  // enrichment_receipts: mirror the OCR_COMPLETED update from events.ts
  await exec(
    db,
    `UPDATE enrichment_receipts SET
       status = 'OCR_COMPLETED', raw_ocr_json = ?, ocr_confidence = ?,
       raw_text = ?, gst_status = ?, updated_at = ?
     WHERE receipt_id = ?`,
    '{"synthetic":true}', 0.99, '', 'UNCHECKED', now, message.receiptId,
  );
}
