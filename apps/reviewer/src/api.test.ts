import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_BASE_URL, PUBLIC_API_URL, createLocalTestRun, createManualInvoice, logoutReviewer, reviewReceipt, uploadInvoiceImage } from './api';

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

  it('creates a manual invoice through the same-origin reviewer route', async () => {
    vi.stubGlobal('document', { cookie: 'challanse_local_csrf=invoice-csrf-token' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ receiptId: 'receipt-2', status: 'NEEDS_REVIEW' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await createManualInvoice({
      vendorId: 'vendor-1',
      challanNumber: 'CH-2',
      poNumber: 'PO-1',
      materialCode: 'CEM',
      materialDescription: 'Cement',
      quantity: 25,
      unit: 'BAG',
      notes: '',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/reviewer/invoices', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ 'X-CSRF-Token': 'invoice-csrf-token' }),
    }));
  });

  it('uploads an invoice image with reviewer scope and essential metadata', async () => {
    vi.stubGlobal('document', { cookie: 'challanse_local_csrf=image-csrf-token' });
    const headers = new Map<string, string>();
    const progress = vi.fn();
    class MockXhr {
      status = 202;
      responseText = JSON.stringify({ receiptId: 'receipt-3', status: 'PROCESSING' });
      withCredentials = false;
      upload: { onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
      onload?: () => void;
      open = vi.fn();
      setRequestHeader(name: string, value: string) { headers.set(name, value); }
      send(fileBody: File) {
        expect(fileBody).toBe(file);
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
        this.onload?.();
      }
    }
    vi.stubGlobal('XMLHttpRequest', MockXhr);
    const file = new File(['image-bytes'], 'invoice.webp', { type: 'image/webp' });

    await uploadInvoiceImage(file, 'vendor-1', 25, 'BAG', progress);

    expect(Object.fromEntries(headers)).toMatchObject({
      'Content-Type': 'image/webp',
      'X-ChallanSe-Vendor-Id': 'vendor-1',
      'X-ChallanSe-Quantity': '25',
      'X-ChallanSe-Unit': 'BAG',
      'X-CSRF-Token': 'image-csrf-token',
    });
    expect(progress).toHaveBeenCalledWith(50);
    expect(progress).toHaveBeenLastCalledWith(100);
  });
});
