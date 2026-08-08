import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ drainReceiptEnrichment: vi.fn(), processReceiptWithWorkersAi: vi.fn() }));

vi.mock('./enrichment-drain', () => ({ drainReceiptEnrichment: mocks.drainReceiptEnrichment }));
vi.mock('./receipt-enrichment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./receipt-enrichment')>();
  return { ...actual, processReceiptWithWorkersAi: mocks.processReceiptWithWorkersAi };
});

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
        imageKey: 'receipts/org-1/site-1/receipt.webp',
      },
      ack: vi.fn(),
      retry: vi.fn(),
    },
  ],
} as unknown as MessageBatch;

function envWith(environment: string): Env {
  return { ENVIRONMENT: environment, DB: {} as D1Database } as unknown as Env;
}

describe('queue handler environment routing', () => {
  beforeEach(() => {
    mocks.drainReceiptEnrichment.mockClear();
    mocks.processReceiptWithWorkersAi.mockClear();
  });

  it('routes production messages to Workers AI enrichment', async () => {
    const env = envWith('production');
    await worker.queue(RECEIPT_ENRICHMENT_BATCH, env);
    expect(mocks.processReceiptWithWorkersAi).toHaveBeenCalledWith(env, RECEIPT_ENRICHMENT_BATCH.messages[0].body);
  });

  it('drains receipt-enrichment messages only when ENVIRONMENT is local-pilot', async () => {
    const env = envWith('local-pilot');
    await worker.queue(RECEIPT_ENRICHMENT_BATCH, env);
    expect(mocks.drainReceiptEnrichment).toHaveBeenCalledTimes(1);
    expect(mocks.drainReceiptEnrichment).toHaveBeenCalledWith(env.DB, {
      type: 'receipt_enrichment',
      receiptId: '3f2c9a6e-4b1d-4f0e-9a8b-7c6d5e4f3a2b',
      organizationId: 'org-1',
      siteId: 'site-1',
      imageKey: 'receipts/org-1/site-1/receipt.webp',
    });
  });
});
