import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/'); });

test('public demonstration remains account-free and local', async ({ page }) => {
  const apiRequests: string[] = [];
  page.on('request', (request) => { if (request.url().includes('/api/')) apiRequests.push(request.url()); });
  await page.getByRole('button', { name: 'Public Demo' }).click();
  await expect(page.getByRole('heading', { name: 'Sample demonstration' })).toBeVisible();
  await expect(page.getByText('Shree Cement Supplies')).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test('client can sign in and reach scan or upload choices', async ({ page }) => {
  await page.getByRole('button', { name: 'Client Sign Up / Sign In' }).click();
  await page.getByLabel('Email').fill('browser-test@example.com');
  await page.getByLabel('Password').fill('browser-test-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose an invoice' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan Invoice' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload Image' })).toBeVisible();
});

test('client verifies fields and receives downloadable result', async ({ page }) => {
  await page.getByRole('button', { name: 'Client Sign Up / Sign In' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.goto('/verify/browser-invoice');
  await expect(page.getByRole('heading', { name: 'Verify details' })).toBeVisible();
  await expect(page.getByLabel('Vendor')).toHaveValue('Shree Cement');
  await page.getByRole('button', { name: 'Verify Invoice' }).click();
  await expect(page.getByRole('heading', { name: 'Service result' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download CSV' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download JSON' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: 'Choose an invoice' })).toBeVisible();
});

test('history, deletion, account, and sign out are reachable', async ({ page }) => {
  await page.getByRole('button', { name: 'Client Sign Up / Sign In' }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.getByRole('button', { name: 'History' }).click();
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await page.getByRole('button', { name: /Delete Shree Cement/ }).click();
  await expect(page.getByText('No invoices yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Account' }).click();
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign Out' }).click();
  await expect(page.getByRole('button', { name: 'Public Demo' })).toBeVisible();
});

test('client flow has no serious accessibility violations', async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
});
