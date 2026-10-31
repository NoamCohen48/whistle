import { defineConfig } from '@playwright/test';

// Drives the real Chrome app on a running Android emulator or USB phone over adb. Opt-in:
// `bun run test:android`. The phone reaches the fixture through `adb reverse`.
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.android.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  outputDir: '../../test-results/android',
  use: { trace: 'retain-on-failure' },
  // Its own port, so it never shares a fixture with the browser projects or a stray emulator tab.
  webServer: { command: 'bun run tests/e2e/fixture-server.ts', cwd: '../..', env: { FIXTURE_PORT: '8793' }, url: 'http://127.0.0.1:8793/__test/health', reuseExistingServer: false },
});
