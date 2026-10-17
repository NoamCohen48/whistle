import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  forbidOnly: Boolean(process.env.CI),
  testMatch: 'site.browser.ts',
  outputDir: '../test-results/site',
  workers: 1,
  use: { trace: 'retain-on-failure' },
  projects: [
    { name: 'site-desktop-root', use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:8793/' } },
    { name: 'site-mobile-project-path', use: { ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:8794/whistle/' } },
  ],
  webServer: [
    { command: 'bunx vite preview --config site/vite.config.ts --port 8793', cwd: '..', url: 'http://127.0.0.1:8793/', reuseExistingServer: false },
    { command: 'bunx vite preview --config site/vite.config.ts --port 8794 --base /whistle/', cwd: '..', url: 'http://127.0.0.1:8794/whistle/', reuseExistingServer: false },
  ],
});
