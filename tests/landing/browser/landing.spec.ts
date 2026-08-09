import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const contactUrl = 'https://www.constrovet.com/pages/contact.html?interest=challanse';
const reviewerPortalUrl = 'https://review.challanse.constrovet.com/';
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
  await page.route(reviewerPortalUrl, async route => {
    await route.fulfill({
      contentType: 'text/html',
      body: '<h1>Cloudflare Access one-time PIN</h1>',
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

test('desktop navigation exposes registered-client sign in', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Desktop navigation is hidden on mobile.');
  const pilotLink = page.locator('.cv-nav__links .cv-nav__cta');
  await expect(pilotLink).toHaveAttribute('href', reviewerPortalUrl);
  expect(await pilotLink.getAttribute('data-pilot-request')).toBeNull();
  await pilotLink.click();
  await expect(page).toHaveURL(reviewerPortalUrl);
  await expect(page.getByRole('heading', { name: 'Cloudflare Access one-time PIN' })).toBeVisible();
});

test('mobile menu reports state, closes with Escape, and exposes client sign in', async ({ page, isMobile }) => {
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
  const pilotLink = drawer.locator('.cv-nav__cta');
  await expect(pilotLink).toHaveAttribute('href', reviewerPortalUrl);
  await pilotLink.focus();
  await expect(pilotLink).toBeFocused();
  await pilotLink.click();
  await expect(page).toHaveURL(reviewerPortalUrl);
  await expect(page.getByRole('heading', { name: 'Cloudflare Access one-time PIN' })).toBeVisible();
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

test('unfinished guest processing is replaced by registered-client sign in', async ({ page }) => {
  const control = page.getByRole('link', { name: 'Client Sign In' }).first();
  await expect(control).toHaveAttribute('href', 'https://review.challanse.constrovet.com/');
  await expect(page.getByRole('link', { name: 'Process My Invoice' })).toHaveCount(0);
});

test('landing has no serious accessibility violations', async ({ page }) => {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
});
