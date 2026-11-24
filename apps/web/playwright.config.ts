import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    reducedMotion: 'reduce',
    // The screenshot harness injects a no-transition <style>; the strict CSP
    // (style-src 'self') would block it. Production pages keep the CSP.
    bypassCSP: true
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    {
      name: 'phone',
      use: { ...devices['iPhone 13'], browserName: 'chromium', viewport: { width: 390, height: 844 } }
    }
  ],
  webServer: {
    command: 'npm run preview',
    url: `${BASE_URL}/s/`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
