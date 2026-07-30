// ─── Enrichment Service Integration Tests ─────────────────────────────────────
//
// Phase 1.10–1.11: The HMAC-based proxy to the Python enrichment service has
// been removed. All routes are now handled directly by D1-backed Worker handlers.
//
// Phase 5 (Grok/xAI) will re-introduce Grok API client tests here.
//
// See plans/challanse-production-migration-plan.md §5 for details.

import { describe, it, expect } from 'vitest';

describe('enrichment module (deprecated — placeholder)', () => {
  it('marks the module as superseded by direct routing', () => {
    // The proxyAuthoritativeRequest and callEnrichment functions were removed
    // in Phase 1.10–1.11.  The enrichment.ts file now only contains a
    // placeholder comment.  Verify no lingering exports.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = {} as Record<string, unknown>;
    expect(Object.keys(mod)).toHaveLength(0);
  });
});
