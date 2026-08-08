# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: landing.spec.ts >> mobile menu reports state, closes with Escape, and exposes pilot link
- Location: tests/landing/browser/landing.spec.ts:44:5

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('#cv-drawer').locator('.cv-nav__cta')
Expected: "https://www.constrovet.com/pages/contact.html?interest=challanse"
Received: "https://review.challanse.constrovet.com/"
Timeout:  8000ms

Call log:
  - Expect "toHaveAttribute" with timeout 8000ms
  - waiting for locator('#cv-drawer').locator('.cv-nav__cta')
    20 × locator resolved to <a class="cv-nav__cta" href="https://review.challanse.constrovet.com/">Client Sign In</a>
       - unexpected value "https://review.challanse.constrovet.com/"

```

```yaml
- link "Client Sign In":
  - /url: https://review.challanse.constrovet.com/
```

# Test source

```ts
  1   | import AxeBuilder from '@axe-core/playwright';
  2   | import { expect, test } from '@playwright/test';
  3   | 
  4   | const contactUrl = 'https://www.constrovet.com/pages/contact.html?interest=challanse';
  5   | const clientPortalUrl = 'https://review.challanse.constrovet.com/';
  6   | const pageErrors = new WeakMap<object, { consoleErrors: string[]; failedRequests: string[] }>();
  7   | 
  8   | test.beforeEach(async ({ page }) => {
  9   |   const consoleErrors: string[] = [];
  10  |   const failedRequests: string[] = [];
  11  |   pageErrors.set(page, { consoleErrors, failedRequests });
  12  |   page.on('console', message => {
  13  |     if (message.type() === 'error') consoleErrors.push(message.text());
  14  |   });
  15  |   page.on('requestfailed', request => failedRequests.push(request.url()));
  16  |   await page.route(contactUrl, async route => {
  17  |     const interest = new URL(route.request().url()).searchParams.get('interest');
  18  |     await route.fulfill({
  19  |       contentType: 'text/html',
  20  |       body: `<label for="interest">Review interest</label><select id="interest"><option${interest === 'challanse' ? ' selected' : ''}>ChallanSe pilot</option></select>`,
  21  |     });
  22  |   });
  23  |   await page.goto('/');
  24  |   await expect(page.locator('#cv-nav-placeholder nav')).toBeVisible();
  25  | });
  26  | 
  27  | test.afterEach(async ({ page }) => {
  28  |   const { consoleErrors, failedRequests } = pageErrors.get(page) || { consoleErrors: [], failedRequests: [] };
  29  |   expect(consoleErrors).toEqual([]);
  30  |   expect(failedRequests).toEqual([]);
  31  |   await expect(page.locator('button[aria-hidden="true"]:visible, a[aria-hidden="true"]:visible, input[aria-hidden="true"]:visible')).toHaveCount(0);
  32  | });
  33  | 
  34  | test('desktop navigation exposes a real pilot destination', async ({ page, isMobile }) => {
  35  |   test.skip(isMobile, 'Desktop navigation is hidden on mobile.');
  36  |   const pilotLink = page.locator('.cv-nav__links .cv-nav__cta');
  37  |   await expect(pilotLink).toHaveAttribute('href', contactUrl);
  38  |   expect(await pilotLink.getAttribute('data-pilot-request')).toBeNull();
  39  |   await pilotLink.click();
  40  |   await expect(page).toHaveURL(contactUrl);
  41  |   await expect(page.locator('#interest')).toHaveValue('ChallanSe pilot');
  42  | });
  43  | 
  44  | test('mobile menu reports state, closes with Escape, and exposes pilot link', async ({ page, isMobile }) => {
  45  |   test.skip(!isMobile, 'Mobile drawer is hidden on desktop.');
  46  |   const menu = page.locator('#cv-hamburger');
  47  |   const drawer = page.locator('#cv-drawer');
  48  |   await expect(menu).toHaveAttribute('aria-controls', 'cv-drawer');
  49  |   await expect(menu).toHaveAttribute('aria-expanded', 'false');
  50  |   await menu.click();
  51  |   await expect(menu).toHaveAttribute('aria-expanded', 'true');
  52  |   await expect(drawer).toHaveClass(/open/);
  53  |   await page.keyboard.press('Escape');
  54  |   await expect(menu).toHaveAttribute('aria-expanded', 'false');
  55  |   await expect(menu).toBeFocused();
  56  |   await menu.click();
  57  |   const pilotLink = drawer.locator('.cv-nav__cta');
> 58  |   await expect(pilotLink).toHaveAttribute('href', contactUrl);
      |                           ^ Error: expect(locator).toHaveAttribute(expected) failed
  59  |   await pilotLink.focus();
  60  |   await expect(pilotLink).toBeFocused();
  61  |   await pilotLink.click();
  62  |   await expect(page).toHaveURL(contactUrl);
  63  |   await expect(page.locator('#interest')).toHaveValue('ChallanSe pilot');
  64  | });
  65  | 
  66  | test('workflow tabs work by click and keyboard with one visible panel', async ({ page }) => {
  67  |   const tabs = page.getByRole('tab');
  68  |   const panels = page.getByRole('tabpanel', { includeHidden: true });
  69  |   await expect(tabs).toHaveCount(4);
  70  |   await tabs.nth(1).click();
  71  |   await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  72  |   await expect(panels.nth(1)).toBeVisible();
  73  |   await expect(page.getByRole('tabpanel')).toHaveCount(1);
  74  |   await tabs.nth(1).press('ArrowRight');
  75  |   await expect(tabs.nth(2)).toHaveAttribute('aria-selected', 'true');
  76  |   await expect(tabs.nth(2)).toBeFocused();
  77  |   await expect(page.getByRole('tabpanel')).toHaveCount(1);
  78  |   await expect(tabs.nth(0)).not.toHaveAttribute('aria-hidden', 'true');
  79  | });
  80  | 
  81  | test('anonymous visitor completes the fictional invoice demonstration', async ({ page }) => {
  82  |   await page.getByRole('button', { name: 'Try sample invoice' }).first().click();
  83  |   await expect(page.getByRole('heading', { name: 'Choose a sample invoice' })).toBeVisible();
  84  |   await page.getByRole('button', { name: /OPC Cement/ }).click();
  85  |   await expect(page.getByRole('heading', { name: 'Ready for review' })).toBeVisible();
  86  |   await expect(page.locator('[data-sample-vendor]')).toHaveText('Synthetic Cement Co');
  87  |   await expect(page.locator('[data-sample-challan]')).toHaveText('CH-1001');
  88  |   await expect(page.locator('[data-sample-material]')).toHaveText('OPC Cement');
  89  |   await expect(page.locator('[data-sample-quantity]')).toHaveText('25 BAG');
  90  |   await expect(page.getByText(/stores nothing/)).toBeVisible();
  91  | });
  92  | 
  93  | test('registered-client action uses the Access-protected portal', async ({ page }) => {
  94  |   const control = page.getByRole('link', { name: 'Client Sign In' }).first();
  95  |   await expect(control).toHaveAttribute('href', clientPortalUrl);
  96  | });
  97  | 
  98  | test('landing has no serious accessibility violations', async ({ page }) => {
  99  |   const results = await new AxeBuilder({ page }).analyze();
  100 |   expect(results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact || ''))).toEqual([]);
  101 | });
  102 | 
```