-- Migration 0009: Property Graph Model (graph_nodes / graph_edges)
-- D1-compatible property graph tables for the knowledge graph data layer.
-- Supports multi-tenant subgraph isolation via json_extract(properties, '$.organization_id').
-- All foreign keys are logical (D1 enforces only via parent row presence).

-- Graph nodes represent domain entities as vertices in the property graph.
-- node_type: Organization, Site, Device, Reviewer, Vendor, Receipt, PurchaseOrder, AuditEvent
-- properties: JSON text with domain-specific fields (org_id, site_id, timestamps, etc.)
CREATE TABLE IF NOT EXISTS graph_nodes (
  node_id TEXT PRIMARY KEY,
  node_type TEXT NOT NULL,
  properties TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_org ON graph_nodes(
  json_extract(properties, '$.organization_id')
);

-- Graph edges represent directed relationships between nodes.
-- edge_type: BELONGS_TO, ENROLLED_AT, WORKS_AT, ASSIGNED_TO, CAPTURED_BY,
--            FROM_VENDOR, RECORDED_AT, HAS_STATUS, REVIEWED_BY, RECONCILED_WITH,
--            CHAIN_PREV
-- properties: JSON text with relationship metadata (timestamps, role, version, etc.)
CREATE TABLE IF NOT EXISTS graph_edges (
  edge_id TEXT PRIMARY KEY,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  edge_type TEXT NOT NULL,
  properties TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (source_node_id) REFERENCES graph_nodes(node_id),
  FOREIGN KEY (target_node_id) REFERENCES graph_nodes(node_id)
);

CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_type ON graph_edges(edge_type);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source_type ON graph_edges(source_node_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target_type ON graph_edges(target_node_id, edge_type);
