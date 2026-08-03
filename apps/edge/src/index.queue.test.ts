import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ drainReceiptEnrichment: vi.fn() }));

vi.mock('./enrichment-drain', () => ({ drainReceiptEnrichment: mocks.drainReceiptEnrichment }));

import worker from './index';
import type { Env } from './types';

const RECEIPT_ENRICHMENT_BATCH = {
  messages: [
    {
      body: {
        type: 'receipt_enrichment',
        receiptId: '3f2c9a6e-4b1d-4f0e-9a8b-7c6d5e4f3a2b',
        organizationId: 'org-1',
        siteId: 'site-1',
      },
    },
  ],
} as unknown as MessageBatch;

function envWith(environment: string): Env {
  return { ENVIRONMENT: environment, DB: {} as D1Database } as unknown as Env;
}

describe('queue handler environment guard', () => {
  beforeEach(() => mocks.drainReceiptEnrichment.mockClear());

  it('is a no-op outside the local-pilot runtime (production never drains)', async () => {
    await worker.queue(RECEIPT_ENRICHMENT_BATCH, envWith('production'));
    expect(mocks.drainReceiptEnrichment).not.toHaveBeenCalled();
  });

  it('drains receipt-enrichment messages only when ENVIRONMENT is local-pilot', async () => {
    const env = envWith('local-pilot');
    await worker.queue(RECEIPT_ENRICHMENT_BATCH, env);
    expect(mocks.drainReceiptEnrichment).toHaveBeenCalledTimes(1);
    expect(mocks.drainReceiptEnrichment).toHaveBeenCalledWith(env.DB, {
      receiptId: '3f2c9a6e-4b1d-4f0e-9a8b-7c6d5e4f3a2b',
      organizationId: 'org-1',
      siteId: 'site-1',
    });
  });
});
