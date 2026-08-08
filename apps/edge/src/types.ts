// ─── ChallanSe Edge Worker Type Definitions ─────────────────────────────────

export interface Env {
  // D1 Database
  DB: D1Database;

  // R2 Buckets
  RECEIPTS: R2Bucket;
  AUDIT_EXPORTS: R2Bucket;
  SESSIONS_BUCKET?: R2Bucket;

  // KV Namespaces
  SESSIONS: KVNamespace;
  CONFIG: KVNamespace;
  RATE_LIMITS: KVNamespace;

  // Queues
  RECEIPT_QUEUE: Queue;
  AUDIT_QUEUE: Queue;
  AI?: { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };

  // Environment variables
  ALLOWED_ORIGINS: string;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ENVIRONMENT: string;
  TURNSTILE_SITE_KEY: string;
  PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER: string;
  AI_MODEL: string;
  AI_DAILY_REQUEST_LIMIT: string;
  GROK_API_BASE_URL: string;
  AGENTMEMORY_URL: string;

  // Deprecated enrichment-service vars (Phase 0/1 proxy — no longer used)
  EDGE_TO_ENRICHMENT_HMAC_KEY_ID?: string;
  EDGE_TO_ENRICHMENT_NEXT_HMAC_KEY_ID?: string;
  ENRICHMENT_URL?: string;
  ENRICHMENT_ACCESS_CLIENT_ID?: string;
  ENRICHMENT_ACCESS_CLIENT_SECRET?: string;

  // Secrets
  TURNSTILE_SECRET?: string;
  EDGE_TO_ENRICHMENT_HMAC_KEY?: string;
  EDGE_TO_ENRICHMENT_NEXT_HMAC_KEY?: string;
  DEVICE_TOKEN_PEPPER?: string;
  TENANT_CONTEXT_HMAC_KEY?: string;
  PLAY_INTEGRITY_CREDENTIALS_JSON?: string;
  XAI_API_KEY?: string;
  AGENTMEMORY_API_KEY?: string;
  SESSION_ENCRYPTION_KEY?: string;
  LOCAL_REVIEWER_GATEWAY_SECRET?: string;
  LOCAL_REVIEWER_EMAILS?: string;
}

export interface AccessIdentity {
  issuer: string;
  subject: string;
  email: string;
}

// ─── Database Row Types ─────────────────────────────────────────────────────

export interface OrganizationRow {
  id: string;
  name: string;
  active: number;
  device_limit: number;
  daily_receipt_limit: number;
  storage_byte_limit: number;
  created_at: string;
  updated_at: string;
}

export interface SiteRow {
  id: string;
  organization_id: string;
  name: string;
  active: number;
  allowed_wifi_ssids_json: string;
  configuration_version: number;
  daily_receipt_limit: number;
  image_byte_limit: number;
  storage_byte_limit: number;
  created_at: string;
  updated_at: string;
}

export interface DeviceRow {
  id: string;
  site_id: string;
  organization_id: string;
  name: string;
  token_hash: string;
  app_version: string;
  active: number;
  enrolled_at: string;
  last_seen_at: string | null;
}

export interface ReviewerRow {
  email: string;
  site_id: string;
  organization_id: string;
  role: string;
  active: number;
  subject: string;
  issuer: string;
  created_at: string;
}

export interface VendorRow {
  id: string;
  site_id: string;
  name: string;
  initials: string;
  color: string;
  display_order: number;
  active: number;
  created_at: string;
}

export interface ReceiptRow {
  id: string;
  site_id: string;
  device_id: string;
  vendor_id: string;
  captured_at_unix: number;
  captured_quantity: number;
  image_key: string;
  image_bytes: number;
  image_sha256: string;
  mime_type: string;
  status: string;
  version: number;
  enrichment_status: string;
  ocr_confidence: number | null;
  raw_ocr_json: string;
  gst_status: string;
  challan_number: string;
  material_description: string;
  verified_quantity: number | null;
  unit: string;
  notes: string;
  po_number: string;
  material_code: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnrichmentReceiptRow {
  receipt_id: string;
  site_id: string;
  vendor_id: string;
  captured_at_unix: number;
  site_captured_quantity: number;
  status: string;
  raw_ocr_json: string;
  raw_text: string;
  ocr_confidence: number | null;
  gst_status: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TallyImportRow {
  id: string;
  import_id: string;
  organization_id: string;
  site_id: string;
  po_number: string;
  material_code: string;
  quantity: number;
  unit: string;
}

export interface VerifiedReceiptRow {
  receipt_id: string;
  organization_id: string;
  site_id: string;
  po_number: string;
  material_code: string;
  verified_quantity: number;
  unit: string;
  reviewer_id: string;
  review_version: number;
  reviewed_at: string;
}

export interface AuditEventRow {
  event_id: string;
  chain_id: string;
  event_type: string;
  event_json: string;
  previous_hash: string;
  event_hash: string;
  created_at: string;
}

export interface GraphNodeRow {
  node_id: string;
  node_type: string;
  properties: string;
  created_at: string;
  updated_at: string;
}

export interface GraphEdgeRow {
  edge_id: string;
  source_node_id: string;
  target_node_id: string;
  edge_type: string;
  properties: string;
  created_at: string;
}

// ─── API Types ──────────────────────────────────────────────────────────────

export interface ApiError {
  code: string;
  message: string;
}

export interface PilotRequest {
  name: string;
  company: string;
  email: string;
  phone?: string;
  message?: string;
}

export interface UploadSessionRequest {
  receiptId: string;
  vendorId: string;
  capturedAtUnix: number;
  capturedQuantity: number;
  imageSha256: string;
  appVersion: string;
  configurationVersion: number;
  totalBytes: number;
  mimeType: 'image/webp';
}

export interface ReceiptReviewRequest {
  action: 'VERIFY' | 'REJECT';
  version: number;
  challanNumber?: string;
  poNumber: string;
  materialCode: string;
  materialDescription: string;
  verifiedQuantity: number;
  unit: string;
  notes?: string;
}

export interface GrokOcrResult {
  challan_number?: string;
  vendor_name?: string;
  material_description?: string;
  quantity?: number;
  unit?: string;
  date?: string;
  confidence: number;
  raw: string;
}

export interface ReconciliationRow {
  po_number: string;
  material_code: string;
  unit: string;
  po_quantity: number;
  site_received: number;
  is_over: boolean;
}
