import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const context = {
  user: { id: 'admin-1', email: 'admin@synthetic.invalid' },
  sites: [{ organizationId: 'org-1', siteId: 'site-1', siteName: 'Synthetic Site', role: 'ORG_ADMIN' }],
  providers: { OCR: 'ACTIVE', GST: 'DISABLED', CREDIT: 'DISABLED' },
};

const status = {
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

const adminSummary = {
  site: { name: 'Synthetic Site', storedImageBytes: 70_000_000, storageByteLimit: 20_000_000_000, dailyReceiptLimit: 50 },
  counts: { NEEDS_REVIEW: 1 },
  devices: [],
  providers: { OCR: 'ACTIVE' },
};

async function mockShared(page: Page) {
  await page.route('**/api/v1/reviewer/context', (route) => route.fulfill({ json: context }));
  await page.route('**/api/v1/admin/local/status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/v1/admin/summary', (route) => route.fulfill({ json: adminSummary }));
  await page.route('**/api/v1/admin/local/test-runs?*', (route) => route.fulfill({ json: { runs: [] } }));
}

test('operator readiness is responsive and accessible', async ({ page }) => {
  await mockShared(page);
  await page.goto('/operator');
  await expect(page.getByRole('heading', { name: 'Demo readiness' })).toBeVisible();
  await expect(page.getByText('qwen2.5:7b')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run complete synthetic test' })).toBeEnabled();
  const findings = await new AxeBuilder({ page }).analyze();
  expect(findings.violations).toEqual([]);
  await expect(page).toHaveScreenshot('operator-readiness.png', {
    animations: 'disabled',
    fullPage: true,
    maxDiffPixelRatio: 0.01,
  });
});

test('operator run persists across refresh and rejects a duplicate', async ({ page }) => {
  let created = false;
  let run = {
    id: 'run-1', status: 'QUEUED', stage: 'QUEUED', progress: 0, report: {}, errorCode: null,
    requestedAt: '2026-07-23T00:00:00Z', startedAt: null, completedAt: null, artifactsAvailable: false,
  };
  await mockShared(page);
  await page.route('**/api/v1/admin/local/test-runs**', async (route) => {
    if (route.request().method() === 'POST') {
      if (created) return route.fulfill({ status: 409, json: { detail: 'local_test_run_already_active' } });
      created = true;
      run = { ...run, status: 'RUNNING', stage: 'UPLOAD', progress: 35 };
      return route.fulfill({ status: 202, json: run });
    }
    return route.fulfill({ json: { runs: created ? [run] : [] } });
  });
  await page.goto('/operator');
  await page.getByRole('button', { name: 'Run complete synthetic test' }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '35');
  await page.reload();
  await page.getByRole('button', { name: 'Test Run', exact: true }).first().click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '35');
  await page.getByRole('button', { name: 'Overview', exact: true }).first().click();
  await expect(page.getByRole('button', { name: /UPLOAD/ })).toBeDisabled();
});

test('reviewer inbox and delta retain focused workflows', async ({ page }) => {
  await page.route('**/api/v1/reviewer/context', (route) => route.fulfill({ json: context }));
  await page.route('**/api/v1/reviewer/receipts?*', (route) => route.fulfill({
    json: {
      receipts: [{
        id: 'receipt-1', vendorName: 'Synthetic Cement', capturedAtUnix: 1784764800,
        capturedQuantity: 25, verifiedQuantity: null, challanNumber: 'CH-1001', poNumber: 'PO-SYN-001',
        materialCode: 'CEMENT-OPC', materialDescription: 'OPC Cement', unit: 'BAG', notes: '',
        status: 'NEEDS_REVIEW', version: 1, imageUrl: '/v1/reviewer/receipts/receipt-1/image',
        ocrConfidence: 92.5, rawOcrJson: { synthetic: true, text: 'REDACTED TEST VALUE' },
      }],
      nextCursor: null,
    },
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Needs review' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Verify receipt' })).toBeVisible();
  await page.getByRole('button', { name: 'Delta' }).click();
  await page.route('**/api/v1/reviewer/reconciliation', (route) => route.fulfill({
    json: { rows: [{ poNumber: 'PO-SYN-001', materialCode: 'CEMENT-OPC', unit: 'BAG', poQuantity: 100, siteReceived: 110, isOver: true }] },
  }));
  await page.reload();
  await page.goto('/?view=DELTA');
  await expect(page.getByText('Over PO')).toBeVisible();
  await expect(page.locator('tr.delta-over')).toContainText('110');
});
