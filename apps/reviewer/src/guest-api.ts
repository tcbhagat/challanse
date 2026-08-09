export type GuestFields = {
  vendorName: string | null;
  challanNumber: string | null;
  materialDescription: string | null;
  quantity: number | null;
  unit: string | null;
};

export type GuestWorkspace = { workspaceId: string; state: string; expiresAt: string; csrfToken: string };

type ErrorBody = { error?: { code?: string; message?: string } };

export class GuestApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as ErrorBody & T;
  if (!response.ok) throw new GuestApiError(body.error?.code ?? 'REQUEST_FAILED', body.error?.message ?? 'Please try again.', response.status);
  return body;
}

async function api<T>(path: string, init: RequestInit = {}, csrfToken?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof ArrayBuffer) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (csrfToken) headers.set('X-ChallanSe-CSRF', csrfToken);
  return responseJson<T>(await fetch(`/api${path}`, { ...init, headers, credentials: 'same-origin', cache: 'no-store' }));
}

export async function resumeGuestSession(): Promise<GuestWorkspace | null> {
  return (await api<{ workspace: GuestWorkspace | null }>('/v1/guest/session', { method: 'POST' })).workspace;
}

export async function createGuestWorkspace(): Promise<GuestWorkspace> {
  return (await api<{ workspace: GuestWorkspace }>('/v1/guest/workspaces', {
    method: 'POST', body: JSON.stringify({ accepted: true, consentVersion: 'guest-privacy-2026-08-09' }),
  })).workspace;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function putPart(path: string, bytes: ArrayBuffer, offset: number, checksum: string, csrfToken: string, onProgress: (value: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api${path}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-Part-Offset', String(offset));
    xhr.setRequestHeader('X-Part-Sha256', checksum);
    xhr.setRequestHeader('X-ChallanSe-CSRF', csrfToken);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new GuestApiError('UPLOAD_PART_FAILED', 'Upload paused. Please retry.', xhr.status));
    xhr.onerror = () => reject(new GuestApiError('NETWORK_INTERRUPTED', 'Upload paused. Check your connection and retry.', 0));
    xhr.send(bytes);
  });
}

export async function uploadGuestInvoice(workspace: GuestWorkspace, file: File, onProgress: (percent: number) => void): Promise<void> {
  const bytes = await file.arrayBuffer();
  const imageSha = await sha256(bytes);
  const session = await api<{ uploadId: string; partSize: number; nextOffset: number }>(`/v1/guest/workspaces/${workspace.workspaceId}/uploads`, {
    method: 'POST', body: JSON.stringify({ filename: file.name, mimeType: file.type, totalBytes: file.size, sha256: imageSha }),
  }, workspace.csrfToken);
  let offset = session.nextOffset;
  let partNumber = Math.floor(offset / session.partSize);
  while (offset < file.size) {
    const part = bytes.slice(offset, Math.min(offset + session.partSize, file.size));
    const checksum = await sha256(part);
    await putPart(`/v1/guest/workspaces/${workspace.workspaceId}/uploads/${session.uploadId}/parts/${partNumber}`, part, offset, checksum, workspace.csrfToken,
      fraction => onProgress(Math.round(((offset + part.byteLength * fraction) / file.size) * 100)));
    offset += part.byteLength; partNumber += 1;
  }
  await api(`/v1/guest/workspaces/${workspace.workspaceId}/uploads/${session.uploadId}/complete`, { method: 'POST' }, workspace.csrfToken);
  onProgress(100);
}

export async function getGuestResult(workspaceId: string): Promise<{ state: string; fields: GuestFields | null }> {
  return api(`/v1/guest/workspaces/${workspaceId}/result`);
}

export async function confirmGuestResult(workspace: GuestWorkspace, fields: GuestFields): Promise<void> {
  await api(`/v1/guest/workspaces/${workspace.workspaceId}/result`, { method: 'PATCH', body: JSON.stringify(fields) }, workspace.csrfToken);
}

export function guestExportUrl(workspaceId: string, format: 'json' | 'csv'): string {
  return `/api/v1/guest/workspaces/${workspaceId}/export?format=${format}`;
}

export async function deleteGuestWorkspace(workspace: GuestWorkspace): Promise<void> {
  await api(`/v1/guest/workspaces/${workspace.workspaceId}`, { method: 'DELETE' }, workspace.csrfToken);
}
