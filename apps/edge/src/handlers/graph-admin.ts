// ─── Graph Admin & Export Endpoints ──────────────────────────────────────────
// Handlers for graph export, subgraph queries, and visualization data.
// Phase 2.4: Graph export & visualization

import { error, json } from '../responses';
import { authenticateReviewer, requireRole, ReviewerAuthError } from '../auth';
import { exportGraph, subgraphForSite, getOrganizationGraph, getReconciliationGraph, getNeighbors } from '../graph';
import type { AccessIdentity, Env } from '../types';

// ─── GET /v1/admin/graph/export ─────────────────────────────────────────────
// Export the complete graph as JSON (optionally filtered by org).
export async function handleGraphExport(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const graph = await exportGraph(db, reviewer.organizationId);
  return json(request, env, {
    organizationId: reviewer.organizationId,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodes: graph.nodes,
    edges: graph.edges,
  });
}

// ─── GET /v1/reviewer/graph/subgraph?siteId=X ────────────────────────────────
// Get the complete subgraph for a site (for reviewer dashboard visualization).
export async function handleGraphSubgraph(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN', 'CONTROLLER', 'AUDITOR']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const url = new URL(request.url);
  const siteId = url.searchParams.get('siteId') || reviewer.siteId;
  const depth = parseInt(url.searchParams.get('depth') || '5', 10);

  const graph = await subgraphForSite(db, siteId, depth);
  return json(request, env, {
    siteId,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodes: graph.nodes,
    edges: graph.edges,
  });
}

// ─── GET /v1/admin/graph/organization ────────────────────────────────────────
// Get the full organization graph with categorized nodes.
export async function handleOrganizationGraph(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const orgGraph = await getOrganizationGraph(db, reviewer.organizationId);
  return json(request, env, orgGraph);
}

// ─── GET /v1/admin/graph/reconciliation?siteId=X ─────────────────────────────
// Get the reconciliation subgraph for a site.
export async function handleGraphReconciliation(request: Request, env: Env, identity: AccessIdentity): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN', 'CONTROLLER', 'AUDITOR']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const url = new URL(request.url);
  const siteId = url.searchParams.get('siteId') || reviewer.siteId;

  const reconciliationGraph = await getReconciliationGraph(db, siteId);
  return json(request, env, reconciliationGraph);
}

// ─── GET /v1/admin/graph/neighbors/:nodeId ───────────────────────────────────
// Get neighbors of a specific graph node (for interactive exploration).
export async function handleGraphNeighbors(request: Request, env: Env, identity: AccessIdentity, nodeId: string): Promise<Response> {
  const db = env.DB;
  let reviewer;
  try {
    reviewer = await authenticateReviewer(db, identity.issuer, identity.subject, identity.email);
    requireRole(reviewer, ['ORG_ADMIN', 'SITE_ADMIN']);
  } catch (err) {
    if (err instanceof ReviewerAuthError) {
      return error(request, env, err.statusCode, err.code, err.message);
    }
    throw err;
  }

  const url = new URL(request.url);
  const depth = parseInt(url.searchParams.get('depth') || '3', 10);
  const direction = (url.searchParams.get('direction') || 'outgoing') as 'outgoing' | 'incoming' | 'both';
  const edgeType = url.searchParams.get('edgeType') || undefined;

  const neighbors = await getNeighbors(db, nodeId, { edgeType, direction, maxDepth: depth });
  return json(request, env, {
    startNodeId: nodeId,
    neighborCount: neighbors.length,
    neighbors,
  });
}
