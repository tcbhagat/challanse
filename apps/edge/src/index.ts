// ─── Edge Worker Entry Point ───────────────────────────────────────────────────
// Direct Request → Handler routing (no proxy to external enrichment service).
// Phase 1.10 rewrite: replaces proxyAuthoritativeRequest with direct calls.
// Phase 1.11: enrichment.ts removed — HMAC/Grok utilities deferred to Phase 5.

import { error, json } from './responses';
import { corsHeaders, authenticateAccessIdentity } from './security';
import { uuid, exec, first } from './db';
import type { Env } from './types';

// ─── Handler Imports ───────────────────────────────────────────────────────────

// Device endpoints
import { handleEnroll, handleBootstrap, handleTelemetry } from './handlers/devices';

// Upload endpoints
import { handleCreateUpload, handleUploadStatus, handleUploadPart, handleCompleteUpload } from './handlers/uploads';

// Reviewer endpoints
import { handleReviewerContext, handleListReceipts, handleReceiptImage, handleReview } from './handlers/reviewers';
import { handleCreateInvoice, handleInvoiceImage, handleTallyImport } from './handlers/reviewers';
import { handleReconciliation, handleAuditExport, handleReconciliationQuery } from './handlers/reviewers';
import { handleDigestQuery, handleEnrichmentStatusQuery, handleAcceptMembership } from './handlers/reviewers';

// Admin endpoints
import { handleAdminSummary, handleCreateEnrollmentCode, handleAdminConfiguration } from './handlers/admin';
import { handleUpsertSite, handleUpsertVendor, handleUpsertMembership } from './handlers/admin';
import { handleCreateInvitation, handleUpdateQuota, handleRevokeAllDevices, handleRevokeDevice } from './handlers/admin';
import { handleSiteManager, handleVerifyChain, handleVerifyAllChains, handleChainEvents } from './handlers/admin';

// Graph export / visualization endpoints
import { handleGraphExport, handleGraphSubgraph, handleOrganizationGraph, handleGraphReconciliation, handleGraphNeighbors } from './handlers/graph-admin';

// Audit admin endpoints (Phase 3: Merkle DAG)
import { handleChainStatus, handleChainVerifyDag, handleAlertsList, handleAlertAcknowledge, handleChainSyncGraph } from './handlers/audit-admin';

// Local pilot bridge endpoints (ENVIRONMENT=local-pilot only)
import { handleLocalStatus, handleLocalEnrollmentCodes } from './handlers/local';
import { drainReceiptEnrichment } from './enrichment-drain';
import { isReceiptMessage, processReceiptWithWorkersAi } from './receipt-enrichment';

// ─── Route Table ──────────────────────────────────────────────────────────────

interface RouteDef {
  method: string;
  pattern: string;       // static path or /v1/resource/:param/:param2
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => Promise<Response>;
  auth: 'access' | 'none';
  /** Zero-based indices among captured params that should be parsed as numbers */
  numberParams?: number[];
}

const routes: RouteDef[] = [
  // ── Device routes (auth handled internally) ─────────────────────────
  { method: 'POST',   pattern: '/v1/devices/enroll',              handler: handleEnroll,            auth: 'none' },
  { method: 'GET',    pattern: '/v1/mobile/bootstrap',            handler: handleBootstrap,         auth: 'none' },
  { method: 'POST',   pattern: '/v1/mobile/telemetry',            handler: handleTelemetry,         auth: 'none' },

  // ── Upload routes (auth handled internally) ─────────────────────────
  { method: 'POST',   pattern: '/v1/uploads',                     handler: handleCreateUpload,      auth: 'none' },
  { method: 'GET',    pattern: '/v1/uploads/:uploadId',           handler: handleUploadStatus,      auth: 'none' },
  { method: 'PUT',    pattern: '/v1/uploads/:uploadId/parts/:partNumber', handler: handleUploadPart, auth: 'none', numberParams: [1] },
  { method: 'POST',   pattern: '/v1/uploads/:uploadId/complete',  handler: handleCompleteUpload,    auth: 'none' },

  // ── Reviewer routes (Cloudflare Access) ─────────────────────────────
  { method: 'GET',    pattern: '/v1/reviewer/context',                       handler: handleReviewerContext,           auth: 'access' },
  { method: 'GET',    pattern: '/v1/reviewer/receipts',                      handler: handleListReceipts,              auth: 'access' },
  { method: 'GET',    pattern: '/v1/reviewer/receipts/:receiptId/image',     handler: handleReceiptImage,              auth: 'access' },
  { method: 'PATCH',  pattern: '/v1/reviewer/receipts/:receiptId',           handler: handleReview,                    auth: 'access' },
  { method: 'POST',   pattern: '/v1/reviewer/invoices',                      handler: handleCreateInvoice,             auth: 'access' },
  { method: 'POST',   pattern: '/v1/reviewer/invoice-images',                handler: handleInvoiceImage,              auth: 'access' },
  { method: 'POST',   pattern: '/v1/reviewer/po-imports',                    handler: handleTallyImport,               auth: 'access' },
  { method: 'GET',    pattern: '/v1/reviewer/reconciliation',                handler: handleReconciliation,            auth: 'access' },
  { method: 'GET',    pattern: '/v1/reviewer/audit-export',                  handler: handleAuditExport,               auth: 'access' },
  { method: 'POST',   pattern: '/v1/reviewer/reconciliation/query',          handler: handleReconciliationQuery,       auth: 'access' },
  { method: 'POST',   pattern: '/v1/reviewer/digests/query',                 handler: handleDigestQuery,               auth: 'access' },
  { method: 'POST',   pattern: '/v1/reviewer/enrichment-status/query',       handler: handleEnrichmentStatusQuery,     auth: 'access' },
  { method: 'POST',   pattern: '/v1/reviewer/membership-invitations/accept', handler: handleAcceptMembership,          auth: 'access' },

  // ── Admin routes (Cloudflare Access) ────────────────────────────────
  { method: 'GET',    pattern: '/v1/admin/summary',                      handler: handleAdminSummary,           auth: 'access' },
  { method: 'POST',   pattern: '/v1/admin/enrollment-codes',             handler: handleCreateEnrollmentCode,   auth: 'access' },
  { method: 'GET',    pattern: '/v1/admin/configuration',                handler: handleAdminConfiguration,     auth: 'access' },
  { method: 'PUT',    pattern: '/v1/admin/sites',                        handler: handleUpsertSite,             auth: 'access' },
  { method: 'PUT',    pattern: '/v1/admin/vendors',                      handler: handleUpsertVendor,           auth: 'access' },
  { method: 'PUT',    pattern: '/v1/admin/memberships',                  handler: handleUpsertMembership,       auth: 'access' },
  { method: 'POST',   pattern: '/v1/admin/membership-invitations',       handler: handleCreateInvitation,       auth: 'access' },
  { method: 'PUT',    pattern: '/v1/admin/quotas',                       handler: handleUpdateQuota,            auth: 'access' },
  { method: 'POST',   pattern: '/v1/admin/devices/revoke-all',           handler: handleRevokeAllDevices,       auth: 'access' },
  { method: 'DELETE', pattern: '/v1/admin/devices/:deviceId',            handler: handleRevokeDevice,           auth: 'access' },
  { method: 'POST',   pattern: '/v1/admin/site-managers',                handler: handleSiteManager,            auth: 'access' },
  { method: 'GET',    pattern: '/v1/admin/audit/chains/verify-all',      handler: handleVerifyAllChains,        auth: 'access' },
  { method: 'GET',    pattern: '/v1/admin/audit/chains/:chainId/verify', handler: handleVerifyChain,            auth: 'access' },
  { method: 'GET',    pattern: '/v1/admin/audit/chains/:chainId/events', handler: handleChainEvents,            auth: 'access' },

  // ── Audit merkle-dag routes (Phase 3.3) ─────────────────────────────
  { method: 'GET',    pattern: '/v1/admin/audit/chain/:chainId/status',     handler: handleChainStatus,        auth: 'access' },
  { method: 'POST',   pattern: '/v1/admin/audit/chain/:chainId/verify-dag', handler: handleChainVerifyDag,     auth: 'access' },
  { method: 'GET',    pattern: '/v1/admin/audit/alerts',                    handler: handleAlertsList,          auth: 'access' },
  { method: 'POST',   pattern: '/v1/admin/audit/alerts/:alertId/acknowledge', handler: handleAlertAcknowledge,auth: 'access' },
  { method: 'POST',   pattern: '/v1/admin/audit/sync-graph',               handler: handleChainSyncGraph,      auth: 'access' },

  // ── Graph export / visualization routes (Phase 2.4) ─────────────────
  { method: 'GET',    pattern: '/v1/admin/graph/export',              handler: handleGraphExport,           auth: 'access' },
  { method: 'GET',    pattern: '/v1/admin/graph/organization',        handler: handleOrganizationGraph,     auth: 'access' },
  { method: 'GET',    pattern: '/v1/admin/graph/reconciliation',      handler: handleGraphReconciliation,   auth: 'access' },
  { method: 'GET',    pattern: '/v1/admin/graph/neighbors/:nodeId',   handler: handleGraphNeighbors,        auth: 'access' },
  { method: 'GET',    pattern: '/v1/reviewer/graph/subgraph',         handler: handleGraphSubgraph,         auth: 'access' },

  // ── Event/ingest routes are local-only until signed service auth exists ──

  // ── Local pilot bridge routes (ENVIRONMENT=local-pilot only) ────────
  { method: 'GET',    pattern: '/v1/local/status',           handler: handleLocalStatus,          auth: 'none' },
  { method: 'POST',   pattern: '/v1/local/enrollment-codes', handler: handleLocalEnrollmentCodes, auth: 'none' },
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function requestPath(request: Request): string {
  return new URL(request.url).pathname.replace(/\/+$/, '') || '/';
}

async function verifyTurnstile(token: string, request: Request, env: Env): Promise<boolean> {
  if (!env.TURNSTILE_SECRET) return env.ENVIRONMENT !== 'production';
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token });
  const remoteIp = request.headers.get('CF-Connecting-IP');
  if (remoteIp) body.set('remoteip', remoteIp);
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  if (!response.ok) return false;
  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

interface MatchResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (...args: any[]) => Promise<Response>;
  params: any[];
  auth: 'access' | 'none';
}

/** Match a request method+path against the route table. Returns null on miss. */
function matchRoute(method: string, pathname: string): MatchResult | null {
  const clean = pathname.replace(/\/+$/, '') || '/';
  const pathSegs = clean.split('/').filter(Boolean);

  for (const route of routes) {
    if (route.method !== method) continue;
    const patSegs = route.pattern.split('/').filter(Boolean);
    if (patSegs.length !== pathSegs.length) continue;

    const captured: string[] = [];
    let ok = true;
    for (let i = 0; i < patSegs.length; i++) {
      if (patSegs[i].startsWith(':')) {
        captured.push(pathSegs[i]);
      } else if (patSegs[i] !== pathSegs[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const params: any[] = route.numberParams
      ? captured.map((raw, idx) =>
          (route.numberParams as number[]).includes(idx) ? parseInt(raw, 10) : raw,
        )
      : captured;
    return { handler: route.handler, params, auth: route.auth };
  }

  return null;
}

// ─── Request Handler ───────────────────────────────────────────────────────────

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const path = requestPath(request);

  // ── CORS preflight ──────────────────────────────────────────────────
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  // ── Health & readiness ──────────────────────────────────────────────
  if (request.method === 'GET' && path === '/health') {
    return json(request, env, { status: 'ok', mode: env.ENVIRONMENT ?? 'production' });
  }

  if (request.method === 'GET' && path === '/ready') {
    return json(request, env, { ready: true, mode: env.ENVIRONMENT ?? 'production', db: 'd1' });
  }

  // ── Pilot requests (Turnstile-gated contact form) ───────────────────
  if (request.method === 'POST' && path === '/v1/pilot-requests') {
    let payload: { turnstileToken?: unknown; website?: unknown; email?: unknown };
    try {
      payload = await request.clone().json();
    } catch {
      return error(request, env, 400, 'INVALID_PILOT_REQUEST', 'Required pilot-request fields are invalid.');
    }

    // If a website is already provided, accept without Turnstile
    if (typeof payload.website === 'string' && payload.website) {
      return json(request, env, { status: 'received' }, 201);
    }

    // Otherwise verify Turnstile
    if (typeof payload.turnstileToken !== 'string' || !(await verifyTurnstile(payload.turnstileToken, request, env))) {
      return error(request, env, 400, 'TURNSTILE_FAILED', 'Please retry the verification challenge.');
    }

    return json(request, env, { status: 'received' }, 201);
  }

  // ── Static-page / UI routes ─────────────────────────────────────────
  // In a future phase these will serve the reviewer SPA or landing page.
  // For now, surface 404 for anything that doesn't match the API routes.

  // ── Route-table dispatch ────────────────────────────────────────────
  const matched = matchRoute(request.method, path);
  if (!matched) {
    return error(request, env, 404, 'NOT_FOUND', 'The requested route does not exist.');
  }

  // Build argument list: (request, env, [identity?], ...params)
  const args: any[] = [request, env];

  if (matched.auth === 'access') {
    const identity = await authenticateAccessIdentity(request, env);
    if (!identity) {
      return error(request, env, 401, 'REVIEWER_UNAUTHORIZED', 'Reviewer authentication is required.');
    }
    args.push(identity);
  }

  args.push(...matched.params);

  try {
    return await matched.handler(...args);
  } catch (err) {
    console.error('Handler error:', err);
    return error(request, env, 500, 'HANDLER_ERROR', 'An unexpected error occurred processing the request.');
  }
}

// ─── Worker Entry Point ────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error('Unhandled worker error:', err);
      const isUpstream = err instanceof TypeError && (err as Error).message.includes('fetch');
      return error(
        request, env,
        isUpstream ? 502 : 500,
        isUpstream ? 'UPSTREAM_FAILURE' : 'INTERNAL_ERROR',
        isUpstream
          ? 'The data service could not complete the request.'
          : 'An internal error occurred processing the request.',
      );
    }
  },
  // ── Queue consumer: receipt-enrichment ──────────────────────────────
  // Drains receipts out of the enrichment queue by marking them
  // enrichment-complete (RECEIVED → NEEDS_REVIEW). The consumer binding is
  // intentionally NOT declared in wrangler.toml: production enrichment runs on
  // the AWS SQS pipeline in services/enrichment, so this handler is a no-op
  // outside the local-pilot runtime. handleCompleteUpload also drains inline
  // for local-pilot because `wrangler dev --local` does not guarantee queue
  // delivery.
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    for (const message of batch.messages) {
      if (!isReceiptMessage(message.body)) { message.ack(); continue; }
      try {
        if (env.ENVIRONMENT === 'local-pilot') {
          await drainReceiptEnrichment(env.DB, message.body);
        } else {
          await processReceiptWithWorkersAi(env, message.body);
        }
        message.ack();
      } catch {
        message.retry();
      }
    }
  },
} satisfies ExportedHandler<Env>;
