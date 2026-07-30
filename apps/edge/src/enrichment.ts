// ─── Enrichment Service Client (deprecated / re-purposed) ─────────────────────
//
// Phase 1.10–1.11: Removed proxyAuthoritativeRequest(), callEnrichment(), and
// HMAC helpers.  The edge worker now routes directly to D1-backed handlers.
//
// Phase 5 (Grok/xAI integration) will add Grok API client helpers here:
//   - callGrokVision(receiptImage: ArrayBuffer): Promise<GrokOcrResult>
//   - callGrokExplain(prompt: string): Promise<string>
//   - grokAnomalyDetection(orgId: string, siteId: string): Promise<AnomalyReport>
//
// See plans/challanse-production-migration-plan.md §5 for details.
export {};
