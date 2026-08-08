import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  first: vi.fn(),
  ensureDeviceInGraph: vi.fn(),
  ensureReceiptInGraph: vi.fn(),
  ensureSiteInGraph: vi.fn(),
  ensureVendorInGraph: vi.fn(),
  upsertGraphNode: vi.fn(),
}));

vi.mock('../db', async (importOriginal) => ({
  ...await importOriginal<typeof import('../db')>(),
  first: mocks.first,
}));

vi.mock('../graph', () => ({
  ensureDeviceInGraph: mocks.ensureDeviceInGraph,
  ensureReceiptInGraph: mocks.ensureReceiptInGraph,
  ensureSiteInGraph: mocks.ensureSiteInGraph,
  ensureVendorInGraph: mocks.ensureVendorInGraph,
  upsertGraphNode: mocks.upsertGraphNode,
}));

import { ensureCompletedReceiptGraph } from './uploads';

describe('completed upload graph projection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('self-heals graph parents and uses the authoritative receipt vendor', async () => {
    const db = {} as D1Database;
    const device = { id: 'device-1', siteId: 'site-1', organizationId: 'org-1' };
    mocks.first.mockResolvedValue({ vendor_id: 'vendor-1', captured_at_unix: 1_700_000_000 });

    await ensureCompletedReceiptGraph(db, device, 'receipt-1', 512_000, 'sha256');

    expect(mocks.upsertGraphNode).toHaveBeenCalledWith(db, 'org-1', 'Organization', { id: 'org-1' });
    expect(mocks.ensureSiteInGraph).toHaveBeenCalledWith(db, 'site-1', 'org-1', { id: 'site-1' });
    expect(mocks.ensureDeviceInGraph).toHaveBeenCalledWith(db, 'device-1', 'site-1', 'org-1', { id: 'device-1' });
    expect(mocks.ensureVendorInGraph).toHaveBeenCalledWith(db, 'vendor-1', 'site-1', {
      id: 'vendor-1',
      organization_id: 'org-1',
    });
    expect(mocks.ensureReceiptInGraph).toHaveBeenCalledWith(
      db,
      'receipt-1',
      'device-1',
      'vendor-1',
      'site-1',
      'org-1',
      {
        image_bytes: 512_000,
        image_sha256: 'sha256',
        status: 'RECEIVED',
        captured_at: 1_700_000_000,
        vendor_id: 'vendor-1',
      },
    );
  });

  it('fails closed when the authoritative receipt row is missing', async () => {
    mocks.first.mockResolvedValue(null);

    await expect(ensureCompletedReceiptGraph(
      {} as D1Database,
      { id: 'device-1', siteId: 'site-1', organizationId: 'org-1' },
      'receipt-1',
      1,
      'sha256',
    )).rejects.toThrow('Completed receipt record is missing.');

    expect(mocks.ensureReceiptInGraph).not.toHaveBeenCalled();
  });
});
