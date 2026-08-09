import { defineConfig, devices } from '@playwright/test';

const artifactRoot = process.env.CHALLANSE_ARTIFACT_ROOT ?? 'artifacts';

const viewports = [
  { suffix: 'desktop', viewport: { width: 1440, height: 900 } },
  { suffix: 'tablet', viewport: { width: 768, height: 1024 } },
  { suffix: 'mobile', viewport: { width: 390, height: 844 } },
];

export default defineConfig({
  testDir: './tests/guest/browser',
  outputDir: `${artifactRoot}/guest-playwright`,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  reporter: [['line'], ['html', { outputFolder: `${artifactRoot}/guest-playwright-report`, open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4175',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    reducedMotion: 'reduce',
  },
  webServer: {
    command: 'npm run dev --workspace @challanse/reviewer -- --host 127.0.0.1 --port 4175',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: !process.env.CI,
  },
  projects: ['chromium', 'firefox'].flatMap(browser => viewports.map(({ suffix, viewport }) => ({
    name: `${browser}-${suffix}`,
    use: { ...(browser === 'chromium' ? devices['Desktop Chrome'] : devices['Desktop Firefox']), viewport },
  }))),
});
