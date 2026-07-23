import type { ReceiptListItem, ReceiptReview, ReconciliationRow } from '@challanse/contracts';

const configuredBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
const configuredPublicApi = import.meta.env.VITE_PUBLIC_API_URL as string | undefined;
export const API_BASE_URL = (configuredBase || '/api').replace(/\/$/, '');
export const PUBLIC_API_URL = (configuredPublicApi || 'https://api.challanse.constrovet.com').replace(/\/$/, '');
let activeSiteId = typeof sessionStorage === 'undefined' ? '' : sessionStorage.getItem('challanse.activeSiteId') || '';

function cookieValue(name: string) {
  if (typeof document === 'undefined') return '';
  const prefix = `${encodeURIComponent(name)}=`;
  const value = document.cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return value ? decodeURIComponent(value.slice(prefix.length)) : '';
}

function csrfHeaders(method = 'GET'): Record<string, string> {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())
    ? { 'X-CSRF-Token': cookieValue('challanse_local_csrf') }
    : {};
}

export function setActiveSiteId(siteId: string) {
  activeSiteId = siteId;
  if (typeof sessionStorage !== 'undefined') {
    if (siteId) sessionStorage.setItem('challanse.activeSiteId', siteId);
    else sessionStorage.removeItem('challanse.activeSiteId');
  }
}

export function getActiveSiteId() { return activeSiteId; }

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED') {
    super(message);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method || 'GET';
  const response = await fetch(`${API_BASE_URL}${path}`, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeaders(method),
      ...(activeSiteId ? { 'X-ChallanSe-Site-Id': activeSiteId } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: { code?: string; message?: string }; detail?: string | { status?: string } } | null;
    const detail = typeof payload?.detail === 'string' ? payload.detail.replaceAll('_', ' ') : '';
    const code = payload?.error?.code || (typeof payload?.detail === 'string' ? payload.detail : 'REQUEST_FAILED');
    throw new ApiError(response.status, payload?.error?.message || detail || 'Request could not be completed.', code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function listReceipts(status: string, cursor?: string) {
  const params = new URLSearchParams({ status, limit: '25' });
  if (cursor) params.set('cursor', cursor);
  return api<{ receipts: ReceiptListItem[]; nextCursor: string | null }>(`/v1/reviewer/receipts?${params}`);
}

export type ReviewerContext = {
  user: { id: string; email: string };
  sites: Array<{ organizationId: string; siteId: string; siteName: string; role: string }>;
  providers: Record<string, 'ACTIVE' | 'DISABLED'>;
};

export function getReviewerContext() { return api<ReviewerContext>('/v1/reviewer/context'); }

export async function logoutReviewer() {
  const response = await fetch('/logout', {
    method: 'POST',
    credentials: 'include',
    headers: csrfHeaders('POST'),
  });
  if (!response.ok) throw new ApiError(response.status, 'Sign out could not be completed.');
  window.location.assign('/login');
}

export async function downloadAuditExport(format: 'csv' | 'json') {
  const response = await fetch(`${API_BASE_URL}/v1/reviewer/audit-export?format=${format}`, {
    credentials: 'include',
    headers: activeSiteId ? { 'X-ChallanSe-Site-Id': activeSiteId } : {},
  });
  if (!response.ok) throw new ApiError(response.status, 'Audit export could not be downloaded.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `challanse-audit.${format}`;
  link.click();
  URL.revokeObjectURL(url);
}

export function reviewReceipt(receiptId: string, review: ReceiptReview) {
  return api<{ receiptId: string; status: string; version: number }>(`/v1/reviewer/receipts/${receiptId}`, {
    method: 'PATCH',
    body: JSON.stringify(review),
  });
}

export function createEnrollmentCode(deviceName: string) {
  return api<{ enrollmentCode: string; expiresInSeconds: number; deviceName: string }>('/v1/admin/enrollment-codes', {
    method: 'POST',
    body: JSON.stringify({ deviceName }),
  });
}

export type AdminSummary = {
  site: { name: string; storedImageBytes: number; storageByteLimit: number; dailyReceiptLimit: number };
  counts: Record<string, number>;
  devices: Array<{ id: string; name: string; appVersion: string; active: boolean; enrolledAt: string; lastSeenAt: string | null }>;
  providers: Record<string, 'ACTIVE' | 'DISABLED'>;
};

export type AdminConfiguration = {
  organization: {
    id: string;
    slug: string;
    name: string;
    deviceLimit: number;
    deviceRequestLimitPerMinute: number;
    dailyReceiptLimit: number;
    storageByteLimit: number;
    storedImageBytes: number;
  };
  sites: Array<{
    id: string;
    name: string;
    allowedWifiSsids: string[];
    configurationVersion: number;
    dailyReceiptLimit: number;
    imageByteLimit: number;
    active: boolean;
  }>;
  vendors: Array<{
    id: string;
    siteId: string;
    name: string;
    initials: string;
    color: string;
    displayOrder: number;
    active: boolean;
  }>;
  memberships: Array<{
    userId: string;
    email: string;
    displayName: string;
    role: string;
    active: boolean;
    siteIds: string[];
  }>;
};

export function getAdminSummary() {
  return api<AdminSummary>('/v1/admin/summary');
}

export function getAdminConfiguration() {
  return api<AdminConfiguration>('/v1/admin/configuration');
}

export function saveSiteConfiguration(payload: {
  siteId?: string;
  name: string;
  allowedWifiSsids: string[];
  dailyReceiptLimit: number;
  imageByteLimit: number;
  active: boolean;
}) {
  return api<{ siteId: string; status: string }>('/v1/admin/sites', { method: 'PUT', body: JSON.stringify(payload) });
}

export function saveVendorConfiguration(payload: {
  vendorId: string;
  name: string;
  initials: string;
  color: string;
  displayOrder: number;
  active: boolean;
}) {
  return api<{ vendorId: string; status: string }>('/v1/admin/vendors', { method: 'PUT', body: JSON.stringify(payload) });
}

export function saveOrganizationQuota(payload: { deviceLimit: number; deviceRequestLimitPerMinute: number; dailyReceiptLimit: number; storageByteLimit: number }) {
  return api<{ status: string }>('/v1/admin/quotas', { method: 'PUT', body: JSON.stringify(payload) });
}

export function createMembershipInvitation(payload: {
  email: string;
  displayName: string;
  role: 'ORG_ADMIN' | 'SITE_ADMIN' | 'CONTROLLER' | 'REVIEWER' | 'AUDITOR';
  siteIds: string[];
}) {
  return api<{ invitationCode: string; expiresInSeconds: number; role: string }>('/v1/admin/membership-invitations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function acceptMembershipInvitation(invitationCode: string) {
  return api<{ status: string; organizationId: string }>('/v1/reviewer/membership-invitations/accept', {
    method: 'POST',
    body: JSON.stringify({ invitationCode }),
  });
}

export function revokeDevice(deviceId: string) {
  return api<void>(`/v1/admin/devices/${deviceId}`, { method: 'DELETE' });
}

export function importPurchaseOrders(csvContent: string) {
  return api<{ import_id: string; duplicate: boolean; row_count: number }>('/v1/reviewer/po-imports', {
    method: 'POST',
    body: JSON.stringify({ csvContent }),
  });
}

export function listReconciliation() {
  return api<{ rows: ReconciliationRow[] }>('/v1/reviewer/reconciliation');
}

export type LocalStatus = {
  syntheticMode: boolean;
  pilotMode: string;
  database: 'ready' | 'unavailable';
  objectStore: 'ready' | 'unavailable';
  ollama: 'ready' | 'unavailable';
  model: string;
  tesseract: 'ready' | 'unavailable';
  tesseractVersion: string;
  queueDepth: number;
  terminalFailures: number;
  auditChain: { valid: boolean; eventsChecked: number; chainsChecked: number };
  certificate: { status: 'ready' | 'warning' | 'unavailable'; expiresAt: string | null; daysRemaining: number | null };
  testData: { ready: boolean };
  latestTestRun: { id: string; status: string; completedAt: string | null; evidenceAvailable: boolean } | null;
  storage: {
    usedBytes: number;
    limitBytes: number;
    percent: number;
    warning: boolean;
    uploadsPaused: boolean;
  };
};

export type LocalTestRun = {
  id: string;
  status: 'QUEUED' | 'RUNNING' | 'CANCEL_REQUESTED' | 'CANCELLED' | 'PASSED' | 'FAILED';
  stage: string;
  progress: number;
  report: Record<string, unknown>;
  errorCode: string | null;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  artifactsAvailable: boolean;
};

export function getLocalStatus() {
  return api<LocalStatus>('/v1/admin/local/status');
}

export function listLocalTestRuns() {
  return api<{ runs: LocalTestRun[] }>('/v1/admin/local/test-runs?limit=20');
}

export function createLocalTestRun() {
  return api<LocalTestRun>('/v1/admin/local/test-runs', { method: 'POST', body: '{}' });
}

export function getLocalTestRun(runId: string) {
  return api<LocalTestRun>(`/v1/admin/local/test-runs/${encodeURIComponent(runId)}`);
}

export function cancelLocalTestRun(runId: string) {
  return api<LocalTestRun>(`/v1/admin/local/test-runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
    body: '{}',
  });
}

export function refreshLocalTestData() {
  return api<{ status: string; fixtureCount: number }>('/v1/admin/local/test-data/refresh', {
    method: 'POST',
    body: '{}',
  });
}

export function listLocalTestArtifacts(runId: string) {
  return api<{ artifacts: Array<{ name: string; bytes: number }> }>(
    `/v1/admin/local/test-runs/${encodeURIComponent(runId)}/artifacts`,
  );
}

export async function downloadLocalTestArtifact(runId: string, name: string) {
  const response = await fetch(
    `${API_BASE_URL}/v1/admin/local/test-runs/${encodeURIComponent(runId)}/artifacts?name=${encodeURIComponent(name)}`,
    {
      credentials: 'include',
      headers: {
        ...csrfHeaders('GET'),
        ...(activeSiteId ? { 'X-ChallanSe-Site-Id': activeSiteId } : {}),
      },
    },
  );
  if (!response.ok) throw new ApiError(response.status, 'Evidence artifact could not be downloaded.');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function explainLocalDiagnostic(code: string) {
  return api<{ code: string; guidance: string; advisory: string; modelAvailable: boolean }>(
    '/v1/admin/local/explain',
    { method: 'POST', body: JSON.stringify({ code }) },
  );
}
