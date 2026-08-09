import { describe, expect, it } from 'vitest';
import { invoiceFieldsSchema } from '@challanse/contracts';
describe('invoice confirmation fields', () => {
  it('accepts construction invoice fields', () => expect(invoiceFieldsSchema.parse({ vendor:'Vendor', invoiceNumber:'CH-1', invoiceDate:'2026-08-09', material:'Cement', quantity:25, unit:'BAG' }).unit).toBe('BAG'));
  it('rejects unsupported units', () => expect(() => invoiceFieldsSchema.parse({ vendor:'Vendor', invoiceNumber:'CH-1', invoiceDate:'', material:'Cement', quantity:25, unit:'BOX' })).toThrow());
});
