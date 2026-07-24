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

const adminConfiguration = {
  organization: {
    id: 'org-1', slug: 'synthetic', name: 'Synthetic Organization',
    deviceLimit: 5, deviceRequestLimitPerMinute: 120, dailyReceiptLimit: 50,
    storageByteLimit: 20_000_000_000, storedImageBytes: 70_000_000,
  },
  sites: [{
    id: 'site-1', name: 'Synthetic Site', allowedWifiSsids: ['SYNTHETIC-SITE-WIFI'],
    configurationVersion: 1, dailyReceiptLimit: 50, imageByteLimit: 5_000_000, active: true,
  }],
  vendors: [{
    id: 'vendor-1', siteId: 'site-1', name: 'Synthetic Cement',
    initials: 'SC', color: '#f7b51b', displayOrder: 0, active: true,
  }],
  memberships: [{
    userId: 'admin-1', email: 'admin@synthetic.invalid', displayName: 'Synthetic Admin',
    role: 'ORG_ADMIN', active: true, siteIds: [],
  }],
};

async function mockShared(page: Page) {
  await page.route('**/api/v1/reviewer/context', (route) => route.fulfill({ json: context }));
  await page.route('**/api/v1/admin/local/status', (route) => route.fulfill({ json: status }));
  await page.route('**/api/v1/admin/summary', (route) => route.fulfill({ json: adminSummary }));
  await page.route('**/api/v1/admin/configuration', (route) => route.fulfill({ json: adminConfiguration }));
  await page.route('**/api/v1/admin/local/test-runs?*', (route) => route.fulfill({ json: { runs: [] } }));
}

test('operator readiness is responsive and accessible', async ({ page }) => {
  await mockShared(page);
  await page.goto('/operator');
  await expect(page.getByRole('heading', { name: 'Demo readiness' })).toBeVisible();
  await expect(page.getByText('qwen2.5:7b')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run complete synthetic test' })).toBeEnabled();
  await page.getByRole('button', { name: 'Devices', exact: true }).first().click();
  await page.getByRole('button', { name: 'Manage site and devices' }).click();
  await expect(page.getByRole('dialog', { name: 'Synthetic Site' })).toBeVisible();
  await page.getByRole('button', { name: 'Close administration' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).first().click();
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
  await page.route('**/api/v1/reviewer/receipts/receipt-1/image', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="980" viewBox="0 0 700 980">
      <rect width="700" height="980" fill="#f8f3e7"/>
      <rect x="42" y="42" width="616" height="896" rx="8" fill="none" stroke="#1f2937" stroke-width="4"/>
      <text x="70" y="110" font-family="sans-serif" font-size="30" font-weight="700" fill="#111827">SYNTHETIC CHALLAN</text>
      <text x="70" y="180" font-family="sans-serif" font-size="23" fill="#111827">Synthetic Cement</text>
      <text x="70" y="230" font-family="sans-serif" font-size="23" fill="#111827">CHALLAN CH-1001</text>
      <text x="70" y="300" font-family="sans-serif" font-size="25" font-weight="700" fill="#111827">OPC Cement</text>
      <text x="70" y="350" font-family="sans-serif" font-size="25" fill="#111827">25 BAG</text>
      <line x1="70" y1="410" x2="630" y2="410" stroke="#9ca3af" stroke-width="2"/>
      <text x="70" y="875" font-family="sans-serif" font-size="18" fill="#4b5563">SYNTHETIC TEST - NOT A REAL RECEIPT</text>
    </svg>`,
  }));
  await page.route('**/api/v1/reviewer/reconciliation', (route) => route.fulfill({
    json: {
      rows: [
        { poNumber: 'PO-SYN-001', materialCode: 'CEMENT-OPC', unit: 'BAG', poQuantity: 100, siteReceived: 25, isOver: false },
        { poNumber: 'PO-SYN-002', materialCode: 'STEEL-TMT', unit: 'KG', poQuantity: 500, siteReceived: 0, isOver: false },
      ],
    },
  }));
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
  await expect(page.getByRole('button', { name: 'Site setup' })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'PO number' })).toHaveValue('PO-SYN-001');
  await expect(page.getByRole('combobox', { name: 'Material' })).toHaveValue('CEMENT-OPC');
  await expect(page.getByRole('combobox', { name: 'Unit' })).toHaveValue('BAG');
  await expect(page.getByText('OPC Cement')).toBeVisible();
  await expect(page.getByText('More corrections')).toBeVisible();
  await expect(page.getByText('Captured details')).toBeVisible();
  await expect(page.getByText('REDACTED TEST VALUE')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Verify receipt' })).toBeVisible();
  const poSelect = page.getByRole('combobox', { name: 'PO number' });
  await poSelect.focus();
  await expect(poSelect).toBeFocused();
  expect(await poSelect.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Challan number')).toBeFocused();
  for (const control of [
    page.getByRole('combobox', { name: 'PO number' }),
    page.getByRole('combobox', { name: 'Material' }),
    page.getByRole('combobox', { name: 'Unit' }),
    page.getByRole('button', { name: 'Verify receipt' }),
  ]) {
    expect((await control.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  }
  const findings = await new AxeBuilder({ page }).analyze();
  expect(findings.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page).toHaveScreenshot('reviewer-focused-inbox.png', {
    animations: 'disabled',
    fullPage: true,
    maxDiffPixelRatio: 0.001,
  });
  await poSelect.selectOption('PO-SYN-002');
  await expect(page.getByRole('combobox', { name: 'Material' })).toHaveValue('STEEL-TMT');
  await expect(page.getByRole('combobox', { name: 'Unit' })).toHaveValue('KG');
  await expect(page.locator('.field-preview')).toHaveText('STEEL-TMT');
  await page.getByRole('button', { name: 'Delta' }).click();
  await page.unroute('**/api/v1/reviewer/reconciliation');
  await page.route('**/api/v1/reviewer/reconciliation', (route) => route.fulfill({
    json: { rows: [{ poNumber: 'PO-SYN-001', materialCode: 'CEMENT-OPC', unit: 'BAG', poQuantity: 100, siteReceived: 110, isOver: true }] },
  }));
  await page.reload();
  await page.goto('/?view=DELTA');
  await expect(page.getByText('Over PO')).toBeVisible();
  await expect(page.locator('tr.delta-over')).toContainText('110');
});
