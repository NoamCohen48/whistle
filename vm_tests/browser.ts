// Optional host-side browser probe of the disposable guest. No traces, storage
// snapshots, screenshots or credentials are written; stdin contains guest-only auth.
import { chromium, devices } from '@playwright/test';

const input = await Bun.stdin.json() as { url: string; token: string };
// Synthetic test certificate only. Never install a CA or use a persistent profile.
const browser = await chromium.launch({ args: ['--ignore-certificate-errors'] });
try {
  const context = await browser.newContext({ ...devices['Pixel 7'], ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(input.url);
  await page.locator('#pair summary').click();
  await page.locator('#token').fill(input.token);
  await page.getByRole('button', { name: 'Pair browser' }).click();
  await page.locator('#app').waitFor({ state: 'visible' });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const session = await context.newCDPSession(page);
  const manifest = await session.send('Page.getAppManifest');
  const install = await session.send('Page.getInstallabilityErrors');
  if (manifest.errors.length || install.installabilityErrors.length) throw new Error('Guest installability failed');
  const cookies = await context.cookies();
  if (!cookies.some(cookie => cookie.name === 'whistle_session' && cookie.secure && cookie.httpOnly && cookie.sameSite === 'Strict')) throw new Error('Guest secure cookie missing');
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.locator('#agent-switcher [data-pane="vm:p1"]').click();
  await page.waitForFunction(() => document.querySelector('#connection')?.textContent === 'Watching');
  if (await page.locator('#token').count() && await page.locator('#token').inputValue()) throw new Error('Guest token not cleared');
  if ((await page.evaluate(() => caches.keys())).length || (await page.evaluate(() => indexedDB.databases())).length) throw new Error('Unexpected browser persistence');
  await context.setOffline(true);
  const reachable = await page.evaluate(() => fetch('/api/panes', { cache: 'no-store' }).then(() => true, () => false));
  if (reachable) throw new Error('Guest offline API unexpectedly available');
  await session.detach();
  await context.close();
  console.log('Guest Android-emulated HTTPS installability, Secure cookie, WSS watch and no-cache/offline checks passed.');
} catch {
  console.error('Guest browser verification failed (sensitive diagnostics deliberately omitted).');
  process.exitCode = 1;
} finally {
  await browser.close();
}
