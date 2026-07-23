// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OperatorApp from './OperatorApp';

const api = vi.hoisted(() => ({
  getReviewerContext: vi.fn(),
  getLocalStatus: vi.fn(),
  listLocalTestRuns: vi.fn(),
  getAdminSummary: vi.fn(),
  createLocalTestRun: vi.fn(),
  cancelLocalTestRun: vi.fn(),
  refreshLocalTestData: vi.fn(),
  listLocalTestArtifacts: vi.fn(),
  downloadLocalTestArtifact: vi.fn(),
  explainLocalDiagnostic: vi.fn(),
  revokeDevice: vi.fn(),
  setActiveSiteId: vi.fn(),
  logoutReviewer: vi.fn(),
}));

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof import('./api')>('./api');
  return { ...actual, ...api };
});

const readyStatus = {
  syntheticMode: true,
  pilotMode: 'synthetic-demo',
  database: 'ready',
  objectStore: 'ready',
  ollama: 'ready',
  model: 'qwen2.5:7b',
  tesseract: 'ready',
  tesseractVersion: 'tesseract 5.5.0',
  queueDepth: 0,
  terminalFailures: 0,
  auditChain: { valid: true, eventsChecked: 14, chainsChecked: 1 },
  certificate: { status: 'ready', expiresAt: '2027-07-01T00:00:00Z', daysRemaining: 340 },
  testData: { ready: true },
  latestTestRun: null,
  storage: { usedBytes: 70_000_000, limitBytes: 20_000_000_000, percent: 0.4, warning: false, uploadsPaused: false },
};

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.getReviewerContext.mockResolvedValue({
    user: { id: 'admin-1', email: 'admin@synthetic.invalid' },
    sites: [{ organizationId: 'org-1', siteId: 'site-1', siteName: 'Synthetic Site', role: 'ORG_ADMIN' }],
    providers: { OCR: 'ACTIVE' },
  });
  api.getLocalStatus.mockResolvedValue(readyStatus);
  api.listLocalTestRuns.mockResolvedValue({ runs: [] });
  api.getAdminSummary.mockResolvedValue({ site: { name: 'Synthetic Site', storedImageBytes: 0, storageByteLimit: 1_000_000, dailyReceiptLimit: 50 }, counts: {}, devices: [], providers: {} });
});
afterEach(cleanup);

describe('operator console', () => {
  it('shows only real readiness values returned by the local API', async () => {
    render(<OperatorApp />);
    expect(await screen.findByRole('heading', { name: 'Demo readiness' })).toBeInTheDocument();
    expect(screen.getByText('qwen2.5:7b')).toBeInTheDocument();
    expect(screen.getByText('0.4%')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run complete synthetic test' })).toBeEnabled();
  });

  it('starts one persisted acceptance run and announces progress', async () => {
    const queuedRun = {
      id: 'run-1', status: 'QUEUED', stage: 'QUEUED', progress: 0, report: {}, errorCode: null,
      requestedAt: '2026-07-23T00:00:00Z', startedAt: null, completedAt: null, artifactsAvailable: false,
    };
    api.createLocalTestRun.mockResolvedValue(queuedRun);
    api.listLocalTestRuns
      .mockResolvedValueOnce({ runs: [] })
      .mockResolvedValue({ runs: [queuedRun] });
    render(<OperatorApp />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run complete synthetic test' }));
    await waitFor(() => expect(api.createLocalTestRun).toHaveBeenCalledOnce());
    expect(await screen.findByText(/Synthetic acceptance queued/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '0');
  });

  it('denies the operator route to reviewer-only identities', async () => {
    api.getReviewerContext.mockResolvedValue({
      user: { id: 'reviewer-1', email: 'reviewer@synthetic.invalid' },
      sites: [{ organizationId: 'org-1', siteId: 'site-1', siteName: 'Synthetic Site', role: 'REVIEWER' }],
      providers: {},
    });
    render(<OperatorApp />);
    expect(await screen.findByRole('heading', { name: 'Administrator access required' })).toBeInTheDocument();
    expect(api.getLocalStatus).not.toHaveBeenCalled();
  });
});
