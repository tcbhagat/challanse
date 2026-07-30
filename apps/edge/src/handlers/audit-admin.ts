// ─── Audit Admin Endpoints ────────────────────────────────────────────────────
// Phase 3: Merkle DAG Audit Trail verification & alert management endpoints.
// All endpoints require Cloudflare Access authentication with appropriate roles.

import { error, json } from '../responses';
import { authenticateReviewer, requireRole, ReviewerAuthError } from '../auth';
import { getChainStatus, verifyChainDag, getActiveAlerts, acknowledgeAlert, createIntegrityAlert, syncAllChainPrevEdges } from '../audit-chain';
import type { AccessIdentity, Env } from '../types';

// ─── GET /v1/admin/audit/chain/:chainId/status ───────────────────────────────
// Chain health: head hash, event count, fork count, alert count.
export async function handleChainStatus(request: Request, env: Env, identity: AccessIdentity, chainId: string): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN', 'AUDITOR']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const status = await getChainStatus(db, chainId);
  if (!status) {
    return error(request, env, 404, 'CHAIN_NOT_FOUND', 'Audit chain not found.');
  }

  return json(request, env, status);
}

// ─── POST /v1/admin/audit/chain/:chainId/verify-dag ──────────────────────────
// DAG-aware verification with fork detection and branch validation.
export async function handleChainVerifyDag(request: Request, env: Env, identity: AccessIdentity, chainId: string): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'AUDITOR']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const result = await verifyChainDag(db, chainId);

  // Create integrity alerts for any DAG issues discovered
  if (!result.valid) {
    for (const errorMsg of result.errors) {
      if (errorMsg.includes('hash mismatch')) {
        await createIntegrityAlert(db, chainId, 'HASH_MISMATCH', {
          chain_id: chainId,
          detail: errorMsg,
        }, 'CRITICAL');
      } else if (errorMsg.includes('Fork')) {
        await createIntegrityAlert(db, chainId, 'FORK_DETECTED', {
          chain_id: chainId,
          detail: errorMsg,
        }, 'WARNING');
      } else if (errorMsg.includes('orphaned') || errorMsg.includes('broken')) {
        await createIntegrityAlert(db, chainId, 'CHAIN_BROKEN', {
          chain_id: chainId,
          detail: errorMsg,
        }, 'CRITICAL');
      }
    }
  }

  return json(request, env, result);
}

// ─── GET /v1/admin/audit/alerts ──────────────────────────────────────────────
// List active integrity alerts, optionally filtered by chain.
export async function handleAlertsList(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'AUDITOR']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const url = new URL(request.url);
  const chainId = url.searchParams.get('chainId') || undefined;

  const alerts = await getActiveAlerts(db, chainId);
  return json(request, env, {
    count: alerts.length,
    alerts,
  });
}

// ─── POST /v1/admin/audit/alerts/:alertId/acknowledge ────────────────────────
// Acknowledge an integrity alert.
export async function handleAlertAcknowledge(request: Request, env: Env, identity: AccessIdentity, alertId: string): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  await acknowledgeAlert(db, alertId);
  return json(request, env, { acknowledged: true });
}

// ─── POST /v1/admin/audit/sync-graph ─────────────────────────────────────────
// One-time sync: create CHAIN_PREV edges in the property graph for all chains.
export async function handleChainSyncGraph(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const result = await syncAllChainPrevEdges(db);
  return json(request, env, result);
}
