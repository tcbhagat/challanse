import type { ConfirmInvoice, CreateWebUpload, InvoiceFields, InvoiceState } from '@challanse/contracts';
import { appCheckToken, idToken } from './auth';
export type Usage = { plan: string; usedToday: number; dailyLimit: number; retentionDays: number; consentRequired: boolean; consentVersion: string };
export type Invoice = { id: string; state: InvoiceState; filename: string; createdAt: string; expiresAt: string; version: number; fields: InvoiceFields };
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const [token, checkToken] = await Promise.all([idToken(), appCheckToken()]);
  const response = await fetch(`/api${path}`, { ...init, headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'X-Firebase-AppCheck': checkToken, ...init.headers } });
  if (!response.ok) { const body = await response.json().catch(() => ({})) as { detail?: string }; throw new Error(body.detail || 'Request could not be completed.'); }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
export const getUsage = () => request<Usage>('/v1/me/usage');
export const acceptTerms = (version: string) => request<void>('/v1/me/consent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }) });
export const cancelSubscription = () => request<void>('/v1/billing/cancel', { method: 'POST' });
export const listInvoices = () => request<{ invoices: Invoice[] }>('/v1/invoices');
export const getInvoice = (id: string) => request<Invoice>(`/v1/invoices/${id}`);
export const deleteInvoice = (id: string) => request<void>(`/v1/invoices/${id}`, { method: 'DELETE' });
export const createCheckout = () => request<{ keyId: string; subscriptionId: string; amountInr: number }>('/v1/billing/checkout', { method: 'POST' });
export async function downloadExport(id: string, format: 'csv' | 'json') {
  const [token, checkToken] = await Promise.all([idToken(), appCheckToken()]); const response = await fetch(`/api/v1/invoices/${id}/exports/${format}`, { headers: { Authorization: `Bearer ${token}`, 'X-Firebase-AppCheck': checkToken } });
  if (!response.ok) throw new Error('Export could not be downloaded.');
  const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `challanse-${id}.${format}`; link.click(); URL.revokeObjectURL(url);
}

export async function openPaidCheckout() {
  const checkout = await createCheckout();
  if (!document.querySelector('script[data-razorpay]')) await new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.dataset.razorpay = 'true'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Secure checkout could not be loaded.')); document.head.append(script); });
  const Razorpay = (window as unknown as { Razorpay?: new (options: Record<string, unknown>) => { open(): void } }).Razorpay;
  if (!Razorpay) throw new Error('Secure checkout is unavailable.');
  new Razorpay({ key: checkout.keyId, subscription_id: checkout.subscriptionId, name: 'ChallanSe', description: '25 invoices daily', theme: { color: '#ffad0a' } }).open();
}
export const confirmInvoice = (id: string, value: ConfirmInvoice) => request<Invoice>(`/v1/invoices/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
export async function uploadInvoice(file: File, onProgress: (percent: number) => void): Promise<Invoice> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const upload: CreateWebUpload = { filename: file.name, mimeType: file.type as CreateWebUpload['mimeType'], totalBytes: file.size, sha256 };
  const session = await request<{ uploadId: string; uploadUrl: string }>('/v1/uploads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(upload) });
  await new Promise<void>((resolve, reject) => { const xhr = new XMLHttpRequest(); xhr.open('PUT', session.uploadUrl); xhr.setRequestHeader('Content-Type', file.type); xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100)); xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed.')); xhr.onerror = () => reject(new Error('Upload interrupted.')); xhr.send(file); });
  return request<Invoice>(`/v1/uploads/${session.uploadId}/complete`, { method: 'POST' });
}
