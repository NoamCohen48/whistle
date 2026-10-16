import { expect, test } from '@playwright/test';

test.beforeEach(async ({ request }) => { await request.post('http://127.0.0.1:8792/__test/reset'); });

test('install manifest has a stable clean launch URL and real any/maskable PNGs', async ({ page }, info) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  const response = await page.request.get('/manifest.webmanifest');
  const manifest = await response.json();
  expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone', short_name: 'Whistle' });
  for (const icon of manifest.icons) {
    const image = await page.request.get(icon.src);
    expect(image.headers()['content-type']).toContain('image/png');
    const bytes = await image.body();
    expect([...bytes.subarray(0, 8)]).toEqual([137,80,78,71,13,10,26,10]);
    expect(icon.sizes).toBe(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`);
  }
  const session = await page.context().newCDPSession(page);
  const result = await session.send('Page.getAppManifest');
  expect(result.errors).toEqual([]);
  if (info.project.name !== 'development-chromium') {
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    expect((await session.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
  }
  await session.detach();
});

test('worker update waits without reloading control and caches no private or offline content', async ({ page }, info) => {
  test.skip(info.project.name === 'development-chromium', 'Vite development deliberately registers no worker');
  await page.goto('/#pair=single-use-ticket');
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // No clients.claim: only an explicit navigation gains a controller.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.locator('#agent-switcher [data-pane="w1:p1"]').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.request.post('http://127.0.0.1:8792/__test/worker-update');
  await page.evaluate(async () => { await (await navigator.serviceWorker.ready).update(); });
  await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
  await expect(page.locator('#connection')).toHaveText('Controlling');
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  expect(await page.evaluate(() => document.cookie)).toBe('');
  await page.context().setOffline(true);
  const available = await page.evaluate(async () => Promise.all(['/', '/app.js', '/api/panes'].map(path =>
    fetch(path, { cache: 'no-store' }).then(() => true, () => false))));
  expect(available).toEqual([false, false, false]);
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  await page.context().setOffline(false);
});

test('Vite development does not install a production worker', async ({ page }, info) => {
  test.skip(info.project.name !== 'development-chromium', 'Development-only boundary');
  await page.goto('/');
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(registrations => registrations.length))).toBe(0);
});
