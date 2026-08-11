import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const contactUrl = 'https://www.constrovet.com/pages/contact.html?interest=challanse';
const pageErrors = new WeakMap<object, { consoleErrors: string[]; failedRequests: string[] }>();

test.beforeEach(async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  pageErrors.set(page, { consoleErrors, failedRequests });
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', request => failedRequests.push(request.url()));
  await page.route(contactUrl, async route => {
    const interest = new URL(route.request().url()).searchParams.get('interest');
    await route.fulfill({
      contentType: 'text/html',
      body: `<label for="interest">Review interest</label><select id="interest"><option${interest === 'challanse' ? ' selected' : ''}>ChallanSe pilot</option></select>`,
    });
  });
  await page.goto('/');
  await expect(page.locator('#cv-nav-placeholder nav')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  const { consoleErrors, failedRequests } = pageErrors.get(page) || { consoleErrors: [], failedRequests: [] };
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
  await expect(page.locator('button[aria-hidden="true"]:visible, a[aria-hidden="true"]:visible, input[aria-hidden="true"]:visible')).toHaveCount(0);
});

test('desktop navigation reports that the client service is not yet live', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop navigation is hidden on mobile.');
  await expect(page.locator('.cv-nav__links .cv-nav__cta')).toHaveText('Client service launching soon');
});

test('mobile menu reports state, closes with Escape, and reports client launch status', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Mobile drawer is hidden on desktop.');
  const menu = page.locator('#cv-hamburger');
  const drawer = page.locator('#cv-drawer');
  await expect(menu).toHaveAttribute('aria-controls', 'cv-drawer');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(drawer).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
  await menu.click();
  await expect(drawer.locator('.cv-nav__cta')).toHaveText('Client service launching soon');
});

test('workflow tabs work by click and keyboard with one visible panel', async ({ page }) => {
  const tabs = page.getByRole('tab');
  const panels = page.getByRole('tabpanel', { includeHidden: true });
  await expect(tabs).toHaveCount(4);
  await tabs.nth(1).click();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(panels.nth(1)).toBeVisible();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await tabs.nth(1).press('ArrowRight');
  await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  await expect(tabs.nth(2)).toBeFocused();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expect(tabs.nth(0)).not.toHaveAttribute('aria-hidden', 'true');
});

test('anonymous visitor completes the fictional invoice demonstration', async ({ page }) => {
  await page.getByRole('button', { name: 'Try Sample Invoice' }).first().click();
  await expect(page.getByRole('heading', { name: 'Choose a sample invoice' })).toBeVisible();
  await page.getByRole('button', { name: /OPC Cement/ }).click();
  await expect(page.getByRole('button', { name: 'View Sample Result' })).toBeEnabled();
  await page.getByRole('button', { name: 'View Sample Result' }).click();
  await expect(page.getByRole('heading', { name: 'Ready for review' })).toBeVisible();
  await expect(page.locator('[data-sample-vendor]')).toHaveText('Synthetic Cement Co');
  await expect(page.locator('[data-sample-challan]')).toHaveText('CH-1001');
  await expect(page.locator('[data-sample-material]')).toHaveText('OPC Cement');
  await expect(page.locator('[data-sample-quantity]')).toHaveText('25 BAG');
  await expect(page.locator('.cs-sample__notice')).toContainText('stores nothing');
});

test('unreleased client processing has no dead public link', async ({ page }) => {
  await expect(page.locator('.cs-hero__actions').getByText('Client service launching soon')).toBeVisible();
  await expect(page.getByRole('link', { name: /Client/ })).toHaveCount(0);
});

test('landing has no serious accessibility violations', async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
});
