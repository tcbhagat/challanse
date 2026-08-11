// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Invoice } from './api';

const auth = vi.hoisted(() => ({
  current: null as null | { email: string; emailVerified: boolean },
  emailRegister: vi.fn(),
  emailSignIn: vi.fn(),
  googleSignIn: vi.fn(),
  logout: vi.fn(),
  resetPassword: vi.fn(),
}));

const api = vi.hoisted(() => ({
  acceptTerms: vi.fn(),
  cancelSubscription: vi.fn(),
  confirmInvoice: vi.fn(),
  deleteInvoice: vi.fn(),
  downloadExport: vi.fn(),
  getInvoice: vi.fn(),
  getUsage: vi.fn(),
  listInvoices: vi.fn(),
  openPaidCheckout: vi.fn(),
  uploadInvoice: vi.fn(),
}));

vi.mock('./auth', () => ({
  observeUser: (callback: (user: typeof auth.current) => void) => { callback(auth.current); return () => undefined; },
  emailRegister: auth.emailRegister,
  emailSignIn: auth.emailSignIn,
  googleSignIn: auth.googleSignIn,
  logout: auth.logout,
  resetPassword: auth.resetPassword,
}));

vi.mock('./api', () => api);

import { App } from './App';

const readyInvoice: Invoice = {
  id: 'invoice-1',
  state: 'NEEDS_CORRECTION',
  filename: 'invoice.webp',
  createdAt: '2026-08-10T10:00:00Z',
  expiresAt: '2026-08-17T10:00:00Z',
  version: 2,
  fields: { vendor: 'Shree Cement', invoiceNumber: 'CH-1001', invoiceDate: '2026-08-10', material: 'OPC Cement', quantity: 25, unit: 'BAG' },
};

describe('four-step client workflow', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    auth.current = null;
    window.history.replaceState({}, '', '/');
    window.scrollTo = vi.fn();
    api.getUsage.mockResolvedValue({ plan: 'FREE', usedToday: 1, dailyLimit: 3, retentionDays: 7, consentRequired: false, consentVersion: 'v1' });
    api.listInvoices.mockResolvedValue({ invoices: [] });
    api.getInvoice.mockResolvedValue(readyInvoice);
  });

  it('runs the public demo locally without calling an invoice API', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Public Demo' }));
    expect(screen.getByRole('heading', { name: 'Sample demonstration' })).toBeInTheDocument();
    expect(screen.getByText('Shree Cement Supplies')).toBeInTheDocument();
    expect(api.getUsage).not.toHaveBeenCalled();
    expect(api.listInvoices).not.toHaveBeenCalled();
    expect(api.uploadInvoice).not.toHaveBeenCalled();
  });

  it('opens focused client authentication from the entry screen', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Client Sign Up / Sign In' }));
    expect(screen.getByRole('heading', { name: 'Client sign in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
  });

  it('shows capture first and keeps history and account on separate screens', async () => {
    auth.current = { email: 'client@example.com', emailVerified: true };
    api.listInvoices.mockResolvedValue({ invoices: [readyInvoice] });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Choose an invoice' })).toBeInTheDocument();
    expect(screen.getByText('2 invoices remaining today')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scan Invoice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload Image' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByRole('heading', { name: 'History' })).toBeInTheDocument();
    expect(screen.getByText('Shree Cement')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByText('client@example.com')).toBeInTheDocument();
  });

  it('prefills verification and transitions to a service result', async () => {
    auth.current = { email: 'client@example.com', emailVerified: true };
    window.history.replaceState({}, '', '/verify/invoice-1');
    api.listInvoices.mockResolvedValue({ invoices: [readyInvoice] });
    api.confirmInvoice.mockResolvedValue({ ...readyInvoice, state: 'COMPLETED', version: 3 });
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Verify details' })).toBeInTheDocument();
    expect(screen.getByLabelText('Vendor')).toHaveValue('Shree Cement');
    expect(screen.getByLabelText('Unit')).toHaveValue('BAG');
    fireEvent.click(screen.getByRole('button', { name: 'Verify Invoice' }));

    await waitFor(() => expect(api.confirmInvoice).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Service result' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download JSON' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });
});
