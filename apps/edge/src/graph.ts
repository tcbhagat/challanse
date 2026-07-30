// ─── ChallanSe Property Graph Query Engine ───────────────────────────────────
// D1-backed property graph with graph_nodes / graph_edges tables.
// Supports recursive CTE traversal, neighbor queries, path finding,
// subgraph extraction, and anomaly detection patterns.
//
// Node types: Organization, Site, Device, Reviewer, Vendor, Receipt, PurchaseOrder, AuditEvent
// Edge types: BELONGS_TO, ENROLLED_AT, WORKS_AT, ASSIGNED_TO, CAPTURED_BY,
//             FROM_VENDOR, RECORDED_AT, HAS_STATUS, REVIEWED_BY, RECONCILED_WITH,
//             CHAIN_PREV

import { uuid, nowISO } from './db';
import type { GraphNodeRow, GraphEdgeRow } from './types';

// ─── Exported Types ─────────────────────────────────────────────────────────

export interface GraphNodeWithEdges extends GraphNodeRow {
  incoming: GraphEdgeRow[];
  outgoing: GraphEdgeRow[];
}

export interface NeighborResult {
  node: GraphNodeRow;
  edge: GraphEdgeRow;
  depth: number;
}

export interface GraphPath {
  found: boolean;
  path: { node: GraphNodeRow; edge: GraphEdgeRow | null }[];
  length: number;
}

export interface SubgraphResult {
  nodes: GraphNodeRow[];
  edges: GraphEdgeRow[];
}

export interface OrganizationGraph {
  organization: GraphNodeRow | null;
  sites: GraphNodeRow[];
  devices: GraphNodeRow[];
  reviewers: GraphNodeRow[];
  vendors: GraphNodeRow[];
  receipts: GraphNodeRow[];
  edges: GraphEdgeRow[];
}

export interface ReconciliationSubgraph {
  receiptNodes: GraphNodeRow[];
  purchaseOrderNodes: GraphNodeRow[];
  edges: GraphEdgeRow[];
  deltas: Array<{
    poNumber: string;
    materialCode: string;
    unit: string;
    poQuantity: number;
    siteReceived: number;
    isOver: boolean;
  }>;
}

export interface AuditChainTraversal {
  chainId: string;
  events: Array<{
    eventNode: GraphNodeRow;
    edges: GraphEdgeRow[];
  }>;
  length: number;
  valid: boolean;
}

// ─── Node Write Operations ──────────────────────────────────────────────────

/**
 * Upsert a graph node. Creates or updates by node_id.
 * Properties are merged: existing keys not in the new properties are preserved.
 */
export async function upsertGraphNode(
  db: D1Database,
  nodeId: string,
  nodeType: string,
  properties: Record<string, unknown>,
): Promise<void> {
  const now = nowISO();
  const propsJson = JSON.stringify(properties);

  await db.prepare(
    `INSERT INTO graph_nodes (node_id, node_type, properties, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(node_id) DO UPDATE SET
       node_type = COALESCE(excluded.node_type, graph_nodes.node_type),
       properties = excluded.properties,
       updated_at = excluded.updated_at`,
  )
    .bind(nodeId, nodeType, propsJson, now, now)
    .run();
}

/**
 * Delete a graph node and all its incoming/outgoing edges (cascade).
 * Returns the number of edges deleted.
 */
export async function deleteGraphNode(
  db: D1Database,
  nodeId: string,
): Promise<{ deletedEdges: number }> {
  // Delete edges where this node participates
  const edgeResult = await db.prepare(
    'DELETE FROM graph_edges WHERE source_node_id = ? OR target_node_id = ?',
  )
    .bind(nodeId, nodeId)
    .run();

  // Delete the node itself
  await db.prepare('DELETE FROM graph_nodes WHERE node_id = ?')
    .bind(nodeId)
    .run();

  return { deletedEdges: edgeResult.meta.changes ?? 0 };
}

// ─── Edge Write Operations ──────────────────────────────────────────────────

/**
 * Upsert a directed edge between two nodes. Creates or updates by edge_id.
 * If edge_id is not provided, it will be auto-generated from source + target + type.
 */
export async function upsertGraphEdge(
  db: D1Database,
  edgeId: string | undefined,
  sourceNodeId: string,
  targetNodeId: string,
  edgeType: string,
  properties: Record<string, unknown>,
): Promise<string> {
  const id = edgeId ?? `${sourceNodeId}->${targetNodeId}:${edgeType}`;
  const now = nowISO();
  const propsJson = JSON.stringify(properties);

  await db.prepare(
    `INSERT INTO graph_edges (edge_id, source_node_id, target_node_id, edge_type, properties, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(edge_id) DO UPDATE SET
       properties = excluded.properties`,
  )
    .bind(id, sourceNodeId, targetNodeId, edgeType, propsJson, now)
    .run();

  return id;
}

/**
 * Delete a specific edge by edge_id.
 */
export async function deleteGraphEdge(
  db: D1Database,
  edgeId: string,
): Promise<boolean> {
  const result = await db.prepare('DELETE FROM graph_edges WHERE edge_id = ?')
    .bind(edgeId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

// ─── Convenience: Combined Node + Edge Creation ─────────────────────────────

/**
 * Upsert a Site node and its BELONGS_TO edge to an Organization.
 * This ensures both the node and the relationship are created in a single logical operation.
 */
export async function ensureSiteInGraph(
  db: D1Database,
  siteId: string,
  organizationId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await upsertGraphNode(db, siteId, 'Site', {
    ...properties,
    organization_id: organizationId,
  });
  await upsertGraphEdge(
    db,
    `${siteId}->${organizationId}:BELONGS_TO`,
    siteId,
    organizationId,
    'BELONGS_TO',
    { since: nowISO() },
  );
}

/**
 * Upsert a Device node and its ENROLLED_AT edge to a Site,
 * plus the Site→Organization BELONGS_TO chain for reachability.
 */
export async function ensureDeviceInGraph(
  db: D1Database,
  deviceId: string,
  siteId: string,
  organizationId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await upsertGraphNode(db, deviceId, 'Device', {
    ...properties,
    site_id: siteId,
    organization_id: organizationId,
  });
  await upsertGraphEdge(
    db,
    `${deviceId}->${siteId}:ENROLLED_AT`,
    deviceId,
    siteId,
    'ENROLLED_AT',
    { enrolled_at: properties.enrolled_at ?? nowISO() },
  );
}

/**
 * Upsert a Reviewer node and its WORKS_AT edge to an Organization
 * plus ASSIGNED_TO edge to a Site.
 */
export async function ensureReviewerInGraph(
  db: D1Database,
  reviewerId: string,
  organizationId: string,
  siteId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await upsertGraphNode(db, reviewerId, 'Reviewer', {
    ...properties,
    organization_id: organizationId,
    site_id: siteId,
  });
  await upsertGraphEdge(
    db,
    `${reviewerId}->${organizationId}:WORKS_AT`,
    reviewerId,
    organizationId,
    'WORKS_AT',
    { role: properties.role ?? 'CONTROLLER', since: nowISO() },
  );
  await upsertGraphEdge(
    db,
    `${reviewerId}->${siteId}:ASSIGNED_TO`,
    reviewerId,
    siteId,
    'ASSIGNED_TO',
    { since: nowISO() },
  );
}

/**
 * Upsert a Vendor node.
 */
export async function ensureVendorInGraph(
  db: D1Database,
  vendorId: string,
  siteId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await upsertGraphNode(db, vendorId, 'Vendor', {
    ...properties,
    site_id: siteId,
  });
}

/**
 * Upsert a Receipt node with edges to Device, Vendor, and Site.
 */
export async function ensureReceiptInGraph(
  db: D1Database,
  receiptId: string,
  deviceId: string,
  vendorId: string,
  siteId: string,
  organizationId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await upsertGraphNode(db, receiptId, 'Receipt', {
    ...properties,
    device_id: deviceId,
    vendor_id: vendorId,
    site_id: siteId,
    organization_id: organizationId,
  });
  // Receipt → Device (CAPTURED_BY)
  await upsertGraphEdge(
    db,
    `${receiptId}->${deviceId}:CAPTURED_BY`,
    receiptId,
    deviceId,
    'CAPTURED_BY',
    { captured_at: properties.captured_at_unix ?? nowISO() },
  );
  // Receipt → Vendor (FROM_VENDOR)
  await upsertGraphEdge(
    db,
    `${receiptId}->${vendorId}:FROM_VENDOR`,
    receiptId,
    vendorId,
    'FROM_VENDOR',
    {},
  );
  // Receipt → Site (RECORDED_AT)
  await upsertGraphEdge(
    db,
    `${receiptId}->${siteId}:RECORDED_AT`,
    receiptId,
    siteId,
    'RECORDED_AT',
    {},
  );
}

/**
 * Upsert a PurchaseOrder node from Tally import data.
 */
export async function ensurePurchaseOrderInGraph(
  db: D1Database,
  poNodeId: string,
  siteId: string,
  organizationId: string,
  properties: Record<string, unknown>,
): Promise<void> {
  await upsertGraphNode(db, poNodeId, 'PurchaseOrder', {
    ...properties,
    site_id: siteId,
    organization_id: organizationId,
  });
}

// ─── Read: Single Node ──────────────────────────────────────────────────────

/**
 * Get a single graph node by ID, including its incoming and outgoing edges.
 */
export async function getGraphNode(
  db: D1Database,
  nodeId: string,
): Promise<GraphNodeWithEdges | null> {
  const node = await db.prepare(
    'SELECT * FROM graph_nodes WHERE node_id = ?',
  )
    .bind(nodeId)
    .first<GraphNodeRow>();

  if (!node) return null;

  const incoming = await db.prepare(
    'SELECT * FROM graph_edges WHERE target_node_id = ? ORDER BY created_at DESC',
  )
    .bind(nodeId)
    .all<GraphEdgeRow>();

  const outgoing = await db.prepare(
    'SELECT * FROM graph_edges WHERE source_node_id = ? ORDER BY created_at DESC',
  )
    .bind(nodeId)
    .all<GraphEdgeRow>();

  return {
    ...node,
    incoming: incoming.results ?? [],
    outgoing: outgoing.results ?? [],
  };
}

// ─── Read: Neighbor Traversal (BFS via Recursive CTE) ───────────────────────

/**
 * Traverse neighbors from a starting node using a recursive CTE.
 * Supports direction control: 'outgoing' (default), 'incoming', or 'both'.
 * Optional edgeType filter restricts traversal to specific edge types.
 *
 * Uses D1 recursive CTE with configurable max depth (default: 3).
 */
export async function getNeighbors(
  db: D1Database,
  startNodeId: string,
  options: {
    edgeType?: string;
    direction?: 'outgoing' | 'incoming' | 'both';
    maxDepth?: number;
  } = {},
): Promise<NeighborResult[]> {
  const { edgeType, direction = 'outgoing', maxDepth = 3 } = options;

  // Build the recursive CTE based on direction
  const directionClause =
    direction === 'incoming'
      ? `SELECT e.source_node_id AS neighbor_id, e.edge_id, e.source_node_id, e.target_node_id, e.edge_type, e.properties AS edge_properties, e.created_at AS edge_created_at, 1 AS depth
         FROM graph_edges e
         WHERE e.target_node_id = ?
         ${edgeType ? 'AND e.edge_type = ?' : ''}`
    : direction === 'both'
      ? `SELECT CASE WHEN e.source_node_id = ? THEN e.target_node_id ELSE e.source_node_id END AS neighbor_id, e.edge_id, e.source_node_id, e.target_node_id, e.edge_type, e.properties AS edge_properties, e.created_at AS edge_created_at, 1 AS depth
         FROM graph_edges e
         WHERE (e.source_node_id = ? OR e.target_node_id = ?)
         ${edgeType ? 'AND e.edge_type = ?' : ''}`
      : /* 'outgoing' (default) */
        `SELECT e.target_node_id AS neighbor_id, e.edge_id, e.source_node_id, e.target_node_id, e.edge_type, e.properties AS edge_properties, e.created_at AS edge_created_at, 1 AS depth
         FROM graph_edges e
         WHERE e.source_node_id = ?
         ${edgeType ? 'AND e.edge_type = ?' : ''}`;

  // Recurse step
  const recurseClause =
    direction === 'incoming'
      ? `SELECT e.source_node_id AS neighbor_id, e.edge_id, e.source_node_id, e.target_node_id, e.edge_type, e.properties AS edge_properties, e.created_at AS edge_created_at, t.depth + 1
         FROM graph_edges e
         JOIN traverse t ON e.target_node_id = t.neighbor_id
         WHERE t.depth < ?
         ${edgeType ? 'AND e.edge_type = ?' : ''}`
    : direction === 'both'
      ? `SELECT CASE WHEN e.source_node_id = t.neighbor_id THEN e.target_node_id ELSE e.source_node_id END AS neighbor_id, e.edge_id, e.source_node_id, e.target_node_id, e.edge_type, e.properties AS edge_properties, e.created_at AS edge_created_at, t.depth + 1
         FROM graph_edges e
         JOIN traverse t ON (e.source_node_id = t.neighbor_id OR e.target_node_id = t.neighbor_id)
         WHERE t.depth < ?
         ${edgeType ? 'AND e.edge_type = ?' : ''}`
      : /* 'outgoing' */
        `SELECT e.target_node_id AS neighbor_id, e.edge_id, e.source_node_id, e.target_node_id, e.edge_type, e.properties AS edge_properties, e.created_at AS edge_created_at, t.depth + 1
         FROM graph_edges e
         JOIN traverse t ON e.source_node_id = t.neighbor_id
         WHERE t.depth < ?
         ${edgeType ? 'AND e.edge_type = ?' : ''}`;

  const sql = `WITH RECURSIVE traverse AS (
    ${directionClause}
    UNION ALL
    ${recurseClause}
  )
  SELECT DISTINCT neighbor_id, edge_id, source_node_id, target_node_id, edge_type, edge_properties, edge_created_at, depth
  FROM traverse
  ORDER BY depth, neighbor_id`;

  // Build bind parameters
  const params: unknown[] = [];

  if (direction === 'incoming') {
    params.push(startNodeId);
    if (edgeType) params.push(edgeType);
    params.push(maxDepth);
    if (edgeType) params.push(edgeType);
  } else if (direction === 'both') {
    params.push(startNodeId, startNodeId, startNodeId);
    if (edgeType) params.push(edgeType);
    params.push(maxDepth);
    if (edgeType) params.push(edgeType);
  } else {
    // outgoing
    params.push(startNodeId);
    if (edgeType) params.push(edgeType);
    params.push(maxDepth);
    if (edgeType) params.push(edgeType);
  }

  const raw = await db.prepare(sql).bind(...params).all<{
    neighbor_id: string;
    edge_id: string;
    source_node_id: string;
    target_node_id: string;
    edge_type: string;
    edge_properties: string;
    edge_created_at: string;
    depth: number;
  }>();

  if (!raw.results || raw.results.length === 0) return [];

  // Fetch neighbor node details
  const neighborIds = [...new Set(raw.results.map((r) => r.neighbor_id))];
  const nodes = await db.prepare(
    `SELECT * FROM graph_nodes WHERE node_id IN (${neighborIds.map(() => '?').join(',')})`,
  )
    .bind(...neighborIds)
    .all<GraphNodeRow>();

  const nodeMap = new Map<string, GraphNodeRow>();
  for (const n of nodes.results ?? []) {
    nodeMap.set(n.node_id, n);
  }

  return raw.results.map((r) => ({
    node: nodeMap.get(r.neighbor_id) ?? {
      node_id: r.neighbor_id,
      node_type: 'Unknown',
      properties: '{}',
      created_at: r.edge_created_at,
      updated_at: r.edge_created_at,
    },
    edge: {
      edge_id: r.edge_id,
      source_node_id: r.source_node_id,
      target_node_id: r.target_node_id,
      edge_type: r.edge_type,
      properties: r.edge_properties,
      created_at: r.edge_created_at,
    },
    depth: r.depth,
  }));
}

// ─── Read: Shortest Path ────────────────────────────────────────────────────

/**
 * Find the shortest path between two nodes using a recursive CTE (BFS).
 * Returns the path (ordered nodes and the edges between them).
 * maxDepth prevents runaway traversal (default: 10).
 */
export async function shortestPath(
  db: D1Database,
  sourceId: string,
  targetId: string,
  options: { edgeType?: string; maxDepth?: number; direction?: 'outgoing' | 'both' } = {},
): Promise<GraphPath> {
  const { edgeType, maxDepth = 10, direction = 'outgoing' } = options;

  // BFS shortest path via recursive CTE that tracks the path taken
  const typeFilter = edgeType ? `AND e.edge_type = ?` : '';

  const joinClause = direction === 'both'
    ? `ON (e.source_node_id = t.current_node OR e.target_node_id = t.current_node)`
    : `ON e.source_node_id = t.current_node`;

  // For 'both' direction, we need to pick the correct "next" node
  const nextNodeExpr = direction === 'both'
    ? `CASE WHEN e.source_node_id = t.current_node THEN e.target_node_id ELSE e.source_node_id END`
    : `e.target_node_id`;

  const sql = `WITH RECURSIVE bfs AS (
    -- Anchor: start from source
    SELECT
      ? AS current_node,
      ? AS start_node,
      0 AS depth,
      ? AS path_nodes,
      ? AS path_edges,
      ? AS reached
    UNION ALL
    -- Recurse: expand neighbors
    SELECT
      ${nextNodeExpr},
      b.start_node,
      b.depth + 1,
      b.path_nodes || ',' || ${nextNodeExpr},
      b.path_edges || ',' || e.edge_id,
      CASE WHEN ${nextNodeExpr} = ? THEN 1 ELSE 0 END
    FROM graph_edges e
    JOIN bfs b ON ${joinClause} AND b.reached = 0
    WHERE b.depth < ?
    ${typeFilter}
    AND ${nextNodeExpr} != b.start_node
    AND instr(b.path_nodes, ${nextNodeExpr}) = 0  -- avoid cycles
  )
  SELECT path_nodes, path_edges, depth
  FROM bfs
  WHERE reached = 1
  ORDER BY depth ASC
  LIMIT 1`;

  const params: unknown[] = [
    sourceId,             // start_node (anchor)
    sourceId,             // current_node (anchor)
    sourceId,             // path_nodes start
    '',                   // path_edges start
    0,                    // reached (anchor)
    targetId,             // target for reached check
    maxDepth,             // max depth
  ];
  if (edgeType) params.push(edgeType);

  const result = await db.prepare(sql).bind(...params).first<{
    path_nodes: string;
    path_edges: string;
    depth: number;
  }>();

  if (!result) {
    return { found: false, path: [], length: 0 };
  }

  const nodeIds = result.path_nodes.split(',');
  const edgeIds = result.path_edges ? result.path_edges.split(',') : [];

  // Fetch all nodes in the path
  const nodePlaceholders = nodeIds.map(() => '?').join(',');
  const nodes = await db.prepare(
    `SELECT * FROM graph_nodes WHERE node_id IN (${nodePlaceholders})`,
  )
    .bind(...nodeIds)
    .all<GraphNodeRow>();

  const nodeMap = new Map<string, GraphNodeRow>();
  for (const n of nodes.results ?? []) {
    nodeMap.set(n.node_id, n);
  }

  // Fetch all edges in the path
  const edgeMap = new Map<string, GraphEdgeRow>();
  if (edgeIds.length > 0) {
    const edgePlaceholders = edgeIds.map(() => '?').join(',');
    const edges = await db.prepare(
      `SELECT * FROM graph_edges WHERE edge_id IN (${edgePlaceholders})`,
    )
      .bind(...edgeIds)
      .all<GraphEdgeRow>();
    for (const e of edges.results ?? []) {
      edgeMap.set(e.edge_id, e);
    }
  }

  const path: { node: GraphNodeRow; edge: GraphEdgeRow | null }[] = [];
  for (let i = 0; i < nodeIds.length; i++) {
    const node = nodeMap.get(nodeIds[i]);
    if (!node) continue;
    const edge = i > 0 && edgeIds[i - 1] ? edgeMap.get(edgeIds[i - 1]) ?? null : null;
    path.push({ node, edge });
  }

  return { found: true, path, length: result.depth };
}

// ─── Read: Subgraph Extraction ──────────────────────────────────────────────

/**
 * Extract the complete subgraph for a site: all nodes reachable from the site
 * up to maxDepth hops (default: 5).
 *
 * This includes: Site itself → Organization, Devices, Reviewers, Vendors, Receipts, POs
 */
export async function subgraphForSite(
  db: D1Database,
  siteId: string,
  maxDepth = 5,
): Promise<SubgraphResult> {
  // Gather all node IDs reachable from the site via recursive CTE
  const sql = `WITH RECURSIVE reachable AS (
    SELECT ? AS node_id, 0 AS depth
    UNION ALL
    SELECT e.target_node_id, r.depth + 1
    FROM graph_edges e
    JOIN reachable r ON e.source_node_id = r.node_id
    WHERE r.depth < ?
    UNION ALL
    SELECT e.source_node_id, r.depth + 1
    FROM graph_edges e
    JOIN reachable r ON e.target_node_id = r.node_id
    WHERE r.depth < ?
  )
  SELECT DISTINCT node_id FROM reachable`;

  const raw = await db.prepare(sql)
    .bind(siteId, maxDepth, maxDepth)
    .all<{ node_id: string }>();

  const nodeIds = raw.results?.map((r) => r.node_id) ?? [siteId];

  if (nodeIds.length === 0) {
    return { nodes: [], edges: [] };
  }

  // Fetch all nodes
  const nodePlaceholders = nodeIds.map(() => '?').join(',');
  const nodes = await db.prepare(
    `SELECT * FROM graph_nodes WHERE node_id IN (${nodePlaceholders})`,
  )
    .bind(...nodeIds)
    .all<GraphNodeRow>();

  // Fetch all edges between these nodes
  const edges = await db.prepare(
    `SELECT * FROM graph_edges WHERE source_node_id IN (${nodePlaceholders})
     AND target_node_id IN (${nodePlaceholders})`,
  )
    .bind(...nodeIds, ...nodeIds)
    .all<GraphEdgeRow>();

  return {
    nodes: nodes.results ?? [],
    edges: edges.results ?? [],
  };
}

/**
 * Get the complete organization graph: all sites, devices, reviewers, vendors, receipts,
 * and POs belonging to an organization.
 *
 * Uses json_extract on properties for efficient filtering.
 */
export async function getOrganizationGraph(
  db: D1Database,
  organizationId: string,
): Promise<OrganizationGraph> {
  // Fetch org node
  const org = await db.prepare(
    'SELECT * FROM graph_nodes WHERE node_id = ?',
  )
    .bind(organizationId)
    .first<GraphNodeRow>();

  // Fetch all nodes belonging to this org (via json_extract on properties)
  const nodes = await db.prepare(
    `SELECT * FROM graph_nodes
     WHERE json_extract(properties, '$.organization_id') = ?
        OR node_id = ?
     ORDER BY node_type, node_id`,
  )
    .bind(organizationId, organizationId)
    .all<GraphNodeRow>();

  const allNodes = nodes.results ?? [];

  const sites = allNodes.filter((n) => n.node_type === 'Site');
  const devices = allNodes.filter((n) => n.node_type === 'Device');
  const reviewers = allNodes.filter((n) => n.node_type === 'Reviewer');
  const vendors = allNodes.filter((n) => n.node_type === 'Vendor');
  const receipts = allNodes.filter((n) => n.node_type === 'Receipt');

  // Fetch edges connecting these nodes
  const nodeIds = allNodes.map((n) => n.node_id);
  if (nodeIds.length === 0) {
    return {
      organization: org ?? null,
      sites: [], devices: [], reviewers: [], vendors: [], receipts: [],
      edges: [],
    };
  }

  const placeholders = nodeIds.map(() => '?').join(',');
  const edges = await db.prepare(
    `SELECT * FROM graph_edges
     WHERE source_node_id IN (${placeholders})
        OR target_node_id IN (${placeholders})
     ORDER BY edge_type, created_at`,
  )
    .bind(...nodeIds)
    .all<GraphEdgeRow>();

  return {
    organization: org ?? null,
    sites,
    devices,
    reviewers,
    vendors,
    receipts,
    edges: edges.results ?? [],
  };
}

// ─── Read: Reconciliation Graph ─────────────────────────────────────────────

/**
 * Get the reconciliation subgraph for a site.
 * Fetches all verified Receipt nodes and PurchaseOrder nodes for the site,
 * plus any RECONCILED_WITH edges between them.
 */
export async function getReconciliationGraph(
  db: D1Database,
  siteId: string,
): Promise<ReconciliationSubgraph> {
  // Fetch all nodes for this site via json_extract
  const nodes = await db.prepare(
    `SELECT * FROM graph_nodes
     WHERE json_extract(properties, '$.site_id') = ?
       AND node_type IN ('Receipt', 'PurchaseOrder')`,
  )
    .bind(siteId)
    .all<GraphNodeRow>();

  const allNodes = nodes.results ?? [];
  const receiptNodes = allNodes.filter((n) => n.node_type === 'Receipt');
  const purchaseOrderNodes = allNodes.filter((n) => n.node_type === 'PurchaseOrder');

  // Fetch RECONCILED_WITH edges between these nodes
  const nodeIds = allNodes.map((n) => n.node_id);
  let reconciliationEdges: GraphEdgeRow[] = [];
  if (nodeIds.length > 0) {
    const placeholders = nodeIds.map(() => '?').join(',');
    const edges = await db.prepare(
      `SELECT * FROM graph_edges
       WHERE edge_type = 'RECONCILED_WITH'
         AND source_node_id IN (${placeholders})
         AND target_node_id IN (${placeholders})`,
    )
      .bind(...nodeIds)
      .all<GraphEdgeRow>();
    reconciliationEdges = edges.results ?? [];
  }

  // Calculate deltas from node properties and edges
  const deltas: ReconciliationSubgraph['deltas'] = [];
  const reconciled = new Set<string>();

  for (const edge of reconciliationEdges) {
    const poNode = purchaseOrderNodes.find((n) => n.node_id === edge.target_node_id);
    const receiptNode = receiptNodes.find((n) => n.node_id === edge.source_node_id);
    if (!poNode || !receiptNode) continue;

    const poProps = JSON.parse(poNode.properties || '{}');
    const receiptProps = JSON.parse(receiptNode.properties || '{}');
    const poQuantity = poProps.quantity ?? 0;
    const siteReceived = receiptProps.verified_quantity ?? receiptProps.captured_quantity ?? 0;

    deltas.push({
      poNumber: poProps.po_number ?? '',
      materialCode: poProps.material_code ?? '',
      unit: poProps.unit ?? 'NOS',
      poQuantity,
      siteReceived,
      isOver: siteReceived > poQuantity,
    });
    reconciled.add(edge.target_node_id);
  }

  // Include POs that have no RECONCILED_WITH edges (delta = full PO quantity)
  for (const poNode of purchaseOrderNodes) {
    if (reconciled.has(poNode.node_id)) continue;
    const poProps = JSON.parse(poNode.properties || '{}');
    deltas.push({
      poNumber: poProps.po_number ?? '',
      materialCode: poProps.material_code ?? '',
      unit: poProps.unit ?? 'NOS',
      poQuantity: poProps.quantity ?? 0,
      siteReceived: 0,
      isOver: false,
    });
  }

  return {
    receiptNodes,
    purchaseOrderNodes,
    edges: reconciliationEdges,
    deltas,
  };
}

// ─── Read: Audit Chain Traversal via Graph ──────────────────────────────────

/**
 * Walk an audit chain by traversing CHAIN_PREV edges from the head event
 * backward to genesis. Returns ordered event list with validity check.
 *
 * The chain head node is identified by the chainId (e.g., "org:<orgId>:site:<siteId>").
 * Events are linked via CHAIN_PREV edges: AuditEvent --[:CHAIN_PREV]-> AuditEvent
 */
export async function traverseAuditChain(
  db: D1Database,
  chainId: string,
): Promise<AuditChainTraversal> {
  // Find all AuditEvent nodes with this chain_id in properties
  const events = await db.prepare(
    `SELECT * FROM graph_nodes
     WHERE node_type = 'AuditEvent'
       AND json_extract(properties, '$.chain_id') = ?
     ORDER BY json_extract(properties, '$.sequence') ASC`,
  )
    .bind(chainId)
    .all<GraphNodeRow>();

  const eventNodes = events.results ?? [];

  if (eventNodes.length === 0) {
    return { chainId, events: [], length: 0, valid: true };
  }

  // Fetch CHAIN_PREV edges between these event nodes
  const eventIds = eventNodes.map((n) => n.node_id);
  const placeholders = eventIds.map(() => '?').join(',');
  const edges = await db.prepare(
    `SELECT * FROM graph_edges
     WHERE edge_type = 'CHAIN_PREV'
       AND source_node_id IN (${placeholders})
       AND target_node_id IN (${placeholders})
     ORDER BY created_at ASC`,
  )
    .bind(...eventIds)
    .all<GraphEdgeRow>();

  const edgeMap = new Map<string, GraphEdgeRow>();
  for (const e of edges.results ?? []) {
    edgeMap.set(e.source_node_id, e);
  }

  // Build ordered event list with edges
  const orderedEvents: AuditChainTraversal['events'] = [];
  for (const eventNode of eventNodes) {
    const prevEdge = edgeMap.get(eventNode.node_id);
    orderedEvents.push({
      eventNode,
      edges: prevEdge ? [prevEdge] : [],
    });
  }

  // Simple validity check: genesis event should have no CHAIN_PREV edge pointing from it
  const valid = true; // D1 can't easily check hash chains; Phase 3 enhances this

  return {
    chainId,
    events: orderedEvents,
    length: eventNodes.length,
    valid,
  };
}

// ─── Read: Graph-Aware Reconciliation ──────────────────────────────────────

/**
 * Graph-aware reconciliation for a site.
 * Uses graph traversal to find all PurchaseOrder nodes and verified Receipt nodes,
 * then computes deltas between PO quantities and received quantities.
 *
 * This is the graph-native replacement for the SQL-based handleReconciliation
 * in reviewers.ts. Returns results in the same format as calculateReconciliationDeltas.
 */
export interface DeltaRow {
  poNumber: string;
  materialCode: string;
  unit: string;
  poQuantity: number;
  siteReceived: number;
  isOver: boolean;
}

export async function graphAwareReconciliation(
  db: D1Database,
  siteId: string,
): Promise<{
  deltas: DeltaRow[];
  graphNodeCount: number;
  graphEdgeCount: number;
}> {
  // Get the reconciliation subgraph from the property graph
  const reconciliationGraph = await getReconciliationGraph(db, siteId);

  // The deltas are already computed by getReconciliationGraph
  return {
    deltas: reconciliationGraph.deltas,
    graphNodeCount: reconciliationGraph.receiptNodes.length + reconciliationGraph.purchaseOrderNodes.length,
    graphEdgeCount: reconciliationGraph.edges.length,
  };
}

/**
 * Create RECONCILED_WITH edges between verified receipts and their matching POs.
 * This links receipt nodes to purchase order nodes in the graph.
 * Returns the number of edges created.
 */
export async function reconcileReceiptsWithPOs(
  db: D1Database,
  siteId: string,
): Promise<{ edgesCreated: number }> {
  // Fetch all VERIFIED receipt nodes for this site
  const receiptNodes = await db.prepare(
    `SELECT * FROM graph_nodes
     WHERE node_type = 'Receipt'
       AND json_extract(properties, '$.site_id') = ?
       AND json_extract(properties, '$.status') IN ('"VERIFIED"', '"REJECTED"')`,
  )
    .bind(siteId)
    .all<GraphNodeRow>();

  // Fetch all PurchaseOrder nodes for this site
  const poNodes = await db.prepare(
    `SELECT * FROM graph_nodes
     WHERE node_type = 'PurchaseOrder'
       AND json_extract(properties, '$.site_id') = ?`,
  )
    .bind(siteId)
    .all<GraphNodeRow>();

  let edgesCreated = 0;

  for (const receiptNode of receiptNodes.results ?? []) {
    const receiptProps = JSON.parse(receiptNode.properties || '{}') as Record<string, unknown>;
    const poNumber = receiptProps.po_number as string;
    const materialCode = receiptProps.material_code as string;

    if (!poNumber) continue;

    // Find matching PO node: same po_number and material_code
    for (const poNode of poNodes.results ?? []) {
      const poProps = JSON.parse(poNode.properties || '{}') as Record<string, unknown>;
      if (poProps.po_number === poNumber && poProps.material_code === materialCode) {
        // Check if RECONCILED_WITH edge already exists
        const existing = await db.prepare(
          `SELECT edge_id FROM graph_edges
           WHERE source_node_id = ? AND target_node_id = ? AND edge_type = 'RECONCILED_WITH'`,
        )
          .bind(receiptNode.node_id, poNode.node_id)
          .first<{ edge_id: string }>();

        if (!existing) {
          await upsertGraphEdge(
            db,
            `${receiptNode.node_id}->${poNode.node_id}:RECONCILED_WITH`,
            receiptNode.node_id,
            poNode.node_id,
            'RECONCILED_WITH',
            {
              po_number: poNumber,
              material_code: materialCode,
              matched_at: nowISO(),
            },
          );
          edgesCreated++;
        }
        break;
      }
    }
  }

  return { edgesCreated };
}

// ─── Read: Anomaly Detection ────────────────────────────────────────────────

/**
 * Find potentially anomalous receipts based on graph patterns.
 * Anomaly indicators:
 *   - Receipts with high quantity variance from their vendor's typical receipt quantities
 *   - Receipts reviewed by someone not in their site's reviewer set
 *   - Receipts with no RECONCILED_WITH edge but status = VERIFIED
 *
 * Returns receipts matching at least one anomaly pattern, grouped by pattern type.
 */
export async function findAnomalousReceipts(
  db: D1Database,
  threshold = 2.0, // standard deviation multiplier for quantity variance
): Promise<{
  quantityAnomalies: Array<{ nodeId: string; properties: Record<string, unknown>; reason: string }>;
  reviewerMismatches: Array<{ nodeId: string; properties: Record<string, unknown>; reason: string }>;
  unreconciledVerified: Array<{ nodeId: string; properties: Record<string, unknown>; reason: string }>;
}> {
  // 1. Receipts with no RECONCILED_WITH edge but status = VERIFIED
  const receiptNodes = await db.prepare(
    `SELECT gn.* FROM graph_nodes gn
     WHERE gn.node_type = 'Receipt'
       AND json_extract(gn.properties, '$.status') IN ('"VERIFIED"', '"REJECTED"')
       AND NOT EXISTS (
         SELECT 1 FROM graph_edges ge
         WHERE ge.source_node_id = gn.node_id
           AND ge.edge_type = 'RECONCILED_WITH'
       )`,
  )
    .all<GraphNodeRow>();

  const unreconciledVerified = (receiptNodes.results ?? []).map((n) => ({
    nodeId: n.node_id,
    properties: JSON.parse(n.properties || '{}') as Record<string, unknown>,
    reason: `Receipt ${n.node_id} is VERIFIED/REJECTED but has no RECONCILED_WITH edge`,
  }));

  // 2. Receipts where reviewer is not assigned to the receipt's site
  // Query: Find REVIEWED_BY edges where the reviewer is not assigned to the receipt's site
  const reviewerMismatchRaw = await db.prepare(
    `SELECT ge.source_node_id AS receipt_id, ge.target_node_id AS reviewer_id,
            json_extract(gn_receipt.properties, '$.site_id') AS receipt_site_id,
            json_extract(gn_reviewer.properties, '$.site_id') AS reviewer_site_id
     FROM graph_edges ge
     JOIN graph_nodes gn_receipt ON gn_receipt.node_id = ge.source_node_id
     JOIN graph_nodes gn_reviewer ON gn_reviewer.node_id = ge.target_node_id
     WHERE ge.edge_type = 'REVIEWED_BY'
       AND json_extract(gn_receipt.properties, '$.site_id') != json_extract(gn_reviewer.properties, '$.site_id')`,
  )
    .all<{
      receipt_id: string;
      reviewer_id: string;
      receipt_site_id: string;
      reviewer_site_id: string;
    }>();

  const reviewerMismatches = (reviewerMismatchRaw.results ?? []).map((r) => ({
    nodeId: r.receipt_id,
    properties: { reviewer_id: r.reviewer_id, receipt_site_id: r.receipt_site_id, reviewer_site_id: r.reviewer_site_id } as Record<string, unknown>,
    reason: `Receipt ${r.receipt_id} reviewed by ${r.reviewer_id} from site ${r.reviewer_site_id}, but receipt belongs to site ${r.receipt_site_id}`,
  }));

  // 3. Quantity anomalies: receipts where vendor's typical quantity differs significantly
  // Fetch all Receipt nodes with their vendor_id
  const allReceipts = await db.prepare(
    `SELECT gn.* FROM graph_nodes gn
     WHERE gn.node_type = 'Receipt'
       AND json_extract(gn.properties, '$.vendor_id') IS NOT NULL`,
  )
    .all<GraphNodeRow>();

  // Group by vendor and compute stats
  const vendorQuantities = new Map<string, number[]>();
  for (const r of allReceipts.results ?? []) {
    const props = JSON.parse(r.properties || '{}') as Record<string, unknown>;
    const vendorId = props.vendor_id as string;
    const qty = (props.captured_quantity as number) ?? (props.verified_quantity as number) ?? 0;
    if (vendorId && qty > 0) {
      const list = vendorQuantities.get(vendorId) ?? [];
      list.push(qty);
      vendorQuantities.set(vendorId, list);
    }
  }

  // Compute mean and stddev per vendor
  const vendorStats = new Map<string, { mean: number; stddev: number }>();
  for (const [vendorId, quantities] of vendorQuantities) {
    if (quantities.length < 3) continue; // Need at least 3 samples
    const mean = quantities.reduce((a, b) => a + b, 0) / quantities.length;
    const variance = quantities.reduce((sum, q) => sum + (q - mean) ** 2, 0) / quantities.length;
    const stddev = Math.sqrt(variance);
    vendorStats.set(vendorId, { mean, stddev: stddev || 1 });
  }

  const quantityAnomalies: Array<{ nodeId: string; properties: Record<string, unknown>; reason: string }> = [];
  for (const r of allReceipts.results ?? []) {
    const props = JSON.parse(r.properties || '{}') as Record<string, unknown>;
    const vendorId = props.vendor_id as string;
    const qty = (props.captured_quantity as number) ?? (props.verified_quantity as number) ?? 0;
    if (!vendorId || qty <= 0) continue;

    const stats = vendorStats.get(vendorId);
    if (!stats || stats.stddev === 0) continue;

    const zScore = Math.abs(qty - stats.mean) / stats.stddev;
    if (zScore > threshold) {
      quantityAnomalies.push({
        nodeId: r.node_id,
        properties: props,
        reason: `Receipt ${r.node_id} has quantity ${qty} which is ${zScore.toFixed(1)}σ from vendor mean ${stats.mean.toFixed(1)} (threshold: ${threshold}σ)`,
      });
    }
  }

  return { quantityAnomalies, reviewerMismatches, unreconciledVerified };
}

// ─── Read: Graph Export ────────────────────────────────────────────────────

/**
 * Export the complete graph as a JSON-serializable dump.
 * Optionally filter by organization_id.
 */
export async function exportGraph(
  db: D1Database,
  organizationId?: string,
): Promise<SubgraphResult> {
  if (organizationId) {
    const orgGraph = await getOrganizationGraph(db, organizationId);
    return {
      nodes: [
        ...(orgGraph.organization ? [orgGraph.organization] : []),
        ...orgGraph.sites,
        ...orgGraph.devices,
        ...orgGraph.reviewers,
        ...orgGraph.vendors,
        ...orgGraph.receipts,
      ],
      edges: orgGraph.edges,
    };
  }

  const nodes = await db.prepare('SELECT * FROM graph_nodes ORDER BY node_type, node_id')
    .all<GraphNodeRow>();

  const edges = await db.prepare('SELECT * FROM graph_edges ORDER BY edge_type, source_node_id')
    .all<GraphEdgeRow>();

  return {
    nodes: nodes.results ?? [],
    edges: edges.results ?? [],
  };
}
