import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/client/browser',
  outputDir: './artifacts/client-playwright',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: [['line'], ['html', { outputFolder: 'artifacts/client-playwright-report', open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4174', trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'off', reducedMotion: 'reduce' },
  webServer: {
    command: 'VITE_E2E_MODE=true VITE_FIREBASE_API_KEY=e2e VITE_FIREBASE_AUTH_DOMAIN=e2e.test VITE_FIREBASE_PROJECT_ID=e2e VITE_FIREBASE_APP_ID=e2e VITE_FIREBASE_APP_CHECK_SITE_KEY=e2e npm run dev --workspace @challanse/client -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } } },
    { name: 'firefox-tablet', use: { ...devices['Desktop Firefox'], viewport: { width: 768, height: 1024 } } },
    { name: 'firefox-mobile', use: { ...devices['Desktop Firefox'], viewport: { width: 390, height: 844 } } },
  ],
});
