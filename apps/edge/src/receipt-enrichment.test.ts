import { describe, expect, it } from 'vitest';
import { isGuestReceiptMessage, parseAnswer } from './receipt-enrichment';

describe('guest Workers AI output boundary', () => {
  it('accepts only the expected schema and known units', () => {
    expect(parseAnswer(JSON.stringify({
      vendorName: 'Example Cement',
      challanNumber: 'CH-7',
      materialDescription: 'OPC Cement',
      quantity: 25,
      unit: 'bag',
    }))).toEqual({
      vendorName: 'Example Cement',
      challanNumber: 'CH-7',
      materialDescription: 'OPC Cement',
      quantity: 25,
      unit: 'BAG',
    });
    expect(parseAnswer('{"unit":"BOX","quantity":2}')).toMatchObject({ unit: null, quantity: 2 });
  });

  it('rejects malformed, oversized and non-object responses', () => {
    expect(parseAnswer('not json')).toBeNull();
    expect(parseAnswer('[]')).toBeNull();
    expect(parseAnswer('x'.repeat(8_001))).toBeNull();
    expect(parseAnswer({ vendorName: 'invented' })).toBeNull();
  });

  it('accepts only complete isolated guest queue messages', () => {
    expect(isGuestReceiptMessage({ type: 'guest_invoice_enrichment', receiptId: 'r', workspaceId: 'w', imageKey: 'k' })).toBe(true);
    expect(isGuestReceiptMessage({ type: 'guest_invoice_enrichment', receiptId: 'r', workspaceId: '', imageKey: 'k' })).toBe(false);
    expect(isGuestReceiptMessage({ type: 'receipt_enrichment', receiptId: 'r', workspaceId: 'w', imageKey: 'k' })).toBe(false);
  });
});
