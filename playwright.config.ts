import { defineConfig, devices } from '@playwright/test';

// A desktop browser below the wide breakpoint (1024 px), so the shared tests drive the one-column
// layout with the agent strip. The wide layout has its own test that sets a 1280 px viewport.
const desktop = { ...devices['Desktop Chrome'], viewport: { width: 900, height: 720 } };

export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: Boolean(process.env.CI),
  testMatch: '**/*.browser.ts',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:8792', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: desktop },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'development-chromium', use: { ...desktop, baseURL: 'http://127.0.0.1:5174' } },
  ],
  webServer: [
    { command: 'bun run tests/e2e/fixture-server.ts', url: 'http://127.0.0.1:8792/__test/health', reuseExistingServer: false },
    { command: 'bun run dev --port 5174', env: { WHISTLE_API_URL: 'http://127.0.0.1:8792' },
      url: 'http://127.0.0.1:5174', reuseExistingServer: false },
  ],
});
