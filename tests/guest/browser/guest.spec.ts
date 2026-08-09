import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Route } from '@playwright/test';

const workspace = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  state: 'READY',
  expiresAt: '2026-08-10T00:00:00Z',
  csrfToken: 'test-csrf',
};

async function reply(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('guest can consent, upload, confirm, export and delete privately', async ({ page }) => {
  let resultPolls = 0;
  const consoleErrors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => consoleErrors.push(error.message));

  await page.route('**/api/v1/guest/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (path.endsWith('/session')) return reply(route, { workspace: null });
    if (request.method() === 'POST' && path.endsWith('/workspaces')) return reply(route, { workspace }, 201);
    if (request.method() === 'POST' && path.endsWith('/uploads')) return reply(route, { uploadId: 'upload-1', partSize: 262144, nextOffset: 0 }, 201);
    if (request.method() === 'PUT' && path.includes('/parts/')) return reply(route, { accepted: true, nextOffset: Number(request.headers()['x-part-offset'] ?? 0) + request.postDataBuffer()!.length });
    if (request.method() === 'POST' && path.endsWith('/complete')) return reply(route, { receiptId: 'receipt-1', state: 'PROCESSING' }, 202);
    if (request.method() === 'GET' && path.endsWith('/result')) {
      resultPolls += 1;
      return reply(route, resultPolls === 1
        ? { state: 'PROCESSING', fields: null }
        : { state: 'READY_TO_CONFIRM', fields: { vendorName: 'Example Cement', challanNumber: 'CH-7', materialDescription: 'OPC Cement', quantity: 25, unit: 'BAG' } });
    }
    if (request.method() === 'PATCH' && path.endsWith('/result')) return reply(route, { state: 'COMPLETED' });
    if (request.method() === 'DELETE') return reply(route, { state: 'DELETED' });
    if (request.method() === 'GET' && path.endsWith('/export')) return route.fulfill({ status: 200, contentType: 'text/csv', body: 'vendorName\nExample Cement\n' });
    return reply(route, { error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  });

  await page.goto('/?surface=guest');
  await expect(page).toHaveTitle('ChallanSe Private Invoice');
  const continueButton = page.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toBeDisabled();
  await page.getByRole('checkbox').check();
  await continueButton.click();
  await expect(page.getByRole('heading', { name: 'Upload one invoice' })).toBeVisible();

  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic-invoice.png', mimeType: 'image/png', buffer: Buffer.from('synthetic image bytes') });
  await page.getByRole('button', { name: 'Upload invoice' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm the details' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('Vendor')).toHaveValue('Example Cement');
  await expect(page.getByLabel('Unit')).toHaveValue('BAG');
  await page.getByRole('button', { name: 'Complete' }).click();
  await expect(page.getByRole('heading', { name: 'Completed' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download CSV' })).toHaveAttribute('href', /format=csv/);
  await expect(page.getByRole('link', { name: 'Download JSON' })).toHaveAttribute('href', /format=json/);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Delete now' }).click();
  await expect(page.getByRole('heading', { name: 'Deleted' })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('capacity exhaustion exposes only the approved recovery message', async ({ page }) => {
  await page.route('**/api/v1/guest/**', async route => {
    if (route.request().url().endsWith('/session')) return reply(route, { workspace: null });
    return reply(route, { error: { code: 'DAILY_CAPACITY_REACHED', message: 'Daily processing capacity reached. Please try tomorrow.' } }, 429);
  });
  await page.goto('/?surface=guest');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Daily capacity reached' })).toBeVisible();
  await expect(page.getByRole('paragraph').filter({ hasText: 'Daily processing capacity reached. Please try tomorrow.' })).toBeVisible();
});
