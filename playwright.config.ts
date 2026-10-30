import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  forbidOnly: Boolean(process.env.CI),
  testMatch: '**/*.browser.ts',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8792', trace: 'retain-on-failure',
    // Test notifications stay inside the browser instead of reaching the developer's desktop.
    launchOptions: { args: ['--disable-features=NativeNotifications,SystemNotifications'] },
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'android-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'development-chromium', use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:5174' } },
  ],
  webServer: [
    { command: 'bun run tests/e2e/fixture-server.ts', url: 'http://127.0.0.1:8792/__test/health', reuseExistingServer: false },
    { command: 'bun run dev --port 5174', env: { WHISTLE_API_URL: 'http://127.0.0.1:8792' },
      url: 'http://127.0.0.1:5174', reuseExistingServer: false },
  ],
});
