// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GuestApp from './GuestApp';

const api = vi.hoisted(() => ({
  resumeGuestSession: vi.fn(), createGuestWorkspace: vi.fn(), uploadGuestInvoice: vi.fn(),
  getGuestResult: vi.fn(), confirmGuestResult: vi.fn(), deleteGuestWorkspace: vi.fn(),
  guestExportUrl: vi.fn((id: string, format: string) => `/api/export/${id}.${format}`),
}));

vi.mock('./guest-api', async () => ({
  ...(await vi.importActual<typeof import('./guest-api')>('./guest-api')),
  ...api,
}));

const workspace = { workspaceId: '11111111-1111-4111-8111-111111111111', state: 'READY', expiresAt: '2026-08-10T00:00:00Z', csrfToken: 'private-csrf' };

beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset());
  api.guestExportUrl.mockImplementation((id: string, format: string) => `/api/export/${id}.${format}`);
  api.resumeGuestSession.mockResolvedValue(null);
  api.createGuestWorkspace.mockResolvedValue(workspace);
});
afterEach(cleanup);

describe('temporary guest invoice workflow', () => {
  it('requires explicit retention consent before creating a workspace', async () => {
    render(<GuestApp />);
    const continueButton = await screen.findByRole('button', { name: 'Continue' });
    expect(continueButton).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(continueButton);
    await waitFor(() => expect(api.createGuestWorkspace).toHaveBeenCalledOnce());
    expect(await screen.findByRole('heading', { name: 'Upload one invoice' })).toBeInTheDocument();
  });

  it('shows only the approved capacity message when the free gate closes', async () => {
    const { GuestApiError } = await import('./guest-api');
    api.createGuestWorkspace.mockRejectedValue(new GuestApiError('DAILY_CAPACITY_REACHED', 'Daily processing capacity reached. Please try tomorrow.', 429));
    render(<GuestApp />);
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('heading', { name: 'Daily capacity reached' })).toBeInTheDocument();
    expect(screen.getAllByText('Daily processing capacity reached. Please try tomorrow.').length).toBeGreaterThan(0);
  });

  it('prefills extracted values and requires user confirmation', async () => {
    api.resumeGuestSession.mockResolvedValue({ ...workspace, state: 'READY_TO_CONFIRM' });
    api.getGuestResult.mockResolvedValue({ state: 'READY_TO_CONFIRM', fields: { vendorName: 'Example Cement', challanNumber: 'CH-7', materialDescription: 'OPC Cement', quantity: 25, unit: 'BAG' } });
    api.confirmGuestResult.mockResolvedValue(undefined);
    render(<GuestApp />);
    expect(await screen.findByDisplayValue('Example Cement')).toBeInTheDocument();
    fireEvent.submit(screen.getByRole('button', { name: 'Complete' }).closest('form')!);
    await waitFor(() => expect(api.confirmGuestResult).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Completed' })).toBeInTheDocument();
  });
});
