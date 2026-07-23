import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, PUBLIC_API_URL, createLocalTestRun, logoutReviewer, reviewReceipt } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reviewer API configuration', () => {
  it('uses the same-origin reviewer proxy and an absolute enrollment API URL', () => {
    expect(API_BASE_URL).toBe('/api');
    expect(new URL(PUBLIC_API_URL).protocol).toBe('https:');
  });

  it('protects operator test execution and logout with the local CSRF token', async () => {
    vi.stubGlobal('document', { cookie: 'challanse_local_csrf=operator-csrf-token' });
    const assign = vi.fn();
    vi.stubGlobal('window', { location: { assign } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ id: 'run-1', status: 'QUEUED' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    await createLocalTestRun();
    await logoutReviewer();

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/v1/admin/local/test-runs', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'operator-csrf-token' }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/logout', expect.objectContaining({
      method: 'POST',
      headers: { 'X-CSRF-Token': 'operator-csrf-token' },
    }));
    expect(assign).toHaveBeenCalledWith('/login');
  });
});

describe('reviewer API request protection', () => {
  it('adds the local CSRF token to mutation requests', async () => {
    vi.stubGlobal('document', { cookie: 'challanse_local_csrf=test-csrf-token' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ receiptId: 'receipt-1', status: 'VERIFIED', version: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await reviewReceipt('receipt-1', {
      version: 1,
      action: 'VERIFY',
      challanNumber: 'C-1',
      poNumber: 'PO-1',
      materialCode: 'CEM',
      materialDescription: 'Cement',
      verifiedQuantity: 10,
      unit: 'BAG',
      notes: '',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/reviewer/receipts/receipt-1', expect.objectContaining({
      credentials: 'include',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'test-csrf-token' }),
    }));
  });
});
