import { expect, test } from '@playwright/test';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('public output excludes private app and runtime assets', async () => {
  const files = await readdir(fileURLToPath(new URL('../site-dist/', import.meta.url)), { recursive: true });
  expect(files).toContain('index.html');
  expect(files.some(file => /(?:app\.js|sw\.js|manifest\.webmanifest|whistle$|\.sqlite|access-token|pair\.png)/.test(file))).toBe(false);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`mock works in ${colorScheme} mode without private connections`, async ({ page, baseURL }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const failures: string[] = [];
    const requests: string[] = [];
    const sockets: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('requestfailed', request => failures.push(request.url()));
    page.on('request', request => requests.push(request.url()));
    page.on('websocket', socket => sockets.push(socket.url()));
    await page.goto('./');
    await expect(page).toHaveTitle('Whistle | Your terminals, within reach');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('figure', { name: 'Product image placeholder' })).toBeVisible();
    const button = page.getByRole('link', { name: 'Get started' });
    await expect(button).toBeVisible();
    expect(await page.locator('body').evaluate(node => getComputedStyle(node).fontSize)).toBe('16px');
    expect(await button.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await button.click();
    await expect(page).toHaveURL(/#setup$/);
    await expect(page.getByText('This website is a mock landing page.')).toBeVisible();
    expect(requests.every(url => url.startsWith(baseURL!))).toBe(true);
    expect(requests.some(url => /\/api\/|\/terminal(?:\?|$)|tailf888b6/.test(url))).toBe(false);
    expect(sockets).toEqual([]);
    expect(failures).toEqual([]);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  });
}
