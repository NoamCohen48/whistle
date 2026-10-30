import { expect, test } from '@playwright/test';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('public output excludes private app and runtime assets', async () => {
  const files = await readdir(fileURLToPath(new URL('../site-dist/', import.meta.url)), { recursive: true });
  expect(files).toContain('index.html');
  expect(files.some(file => /(?:app\.js|sw\.js|manifest\.webmanifest|whistle$|\.sqlite|access-token|pair\.png)/.test(file))).toBe(false);
});

for (const colorScheme of ['light', 'dark'] as const) {
  test(`site works in ${colorScheme} mode without private connections`, async ({ page, baseURL }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    const failures: string[] = [];
    const requests: string[] = [];
    const sockets: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('requestfailed', request => failures.push(request.url()));
    page.on('request', request => requests.push(request.url()));
    page.on('websocket', socket => sockets.push(socket.url()));
    await page.goto('./');
    await expect(page).toHaveTitle('Whistle | Your coding agents, from your phone');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.locator('body').evaluate(node => getComputedStyle(node).fontSize)).toBe('16px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    expect(await skip.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.fonts.check('16px "Bricolage Grotesque"'))).toBe(true);

    // The hero illustration is local navigation and state over sample data only.
    const demo = page.getByRole('figure', { name: /with sample data\. Not a live terminal/ });
    await expect(demo).toBeVisible();
    await expect(demo.getByText('Your herd', { exact: true })).toBeVisible();
    await expect(demo.getByRole('button', { name: 'Take control' })).toBeHidden();
    await demo.getByRole('button', { name: /Checkout tests/ }).click();
    const badge = demo.locator('[data-demo-badge]');
    await expect(badge).toHaveText('Watching');
    await expect(demo.getByRole('button', { name: 'Take control' })).toBeFocused();
    await demo.getByRole('button', { name: 'Take control' }).click();
    await expect(demo.getByRole('button', { name: 'Release control' })).toBeVisible();
    await expect(badge).toHaveText('Controlling');
    expect(await badge.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await demo.getByRole('button', { name: 'Simulate a dropped connection' }).click();
    await expect(badge).toHaveText('Watching');
    await expect(demo.getByText('Reconnected, watching. Nothing was resent.', { exact: true })).toBeVisible();
    await expect(demo.getByRole('button', { name: 'Take control' })).toBeVisible();
    await demo.getByRole('button', { name: 'Back to your herd' }).click();
    await expect(demo.getByRole('button', { name: /Checkout tests/ })).toBeFocused();
    await expect(demo.getByRole('button', { name: 'Simulate a dropped connection' })).toBeHidden();

    const button = page.getByRole('link', { name: 'Download for Linux' });
    await expect(button).toBeVisible();
    expect(await button.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
    await button.click();
    await expect(page).toHaveURL(/#download$/);

    // Downloads are plain links to the latest GitHub release, fixed at build time; the processor switch rewrites them.
    const download = page.locator('#download');
    const debian = download.getByRole('link', { name: 'Download for Debian and Ubuntu' });
    await expect(debian).toHaveAttribute('href', /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/latest\/download\/whistle_amd64\.deb$/);
    await expect(download.getByText('sudo apt install ./whistle_amd64.deb')).toBeVisible();
    await expect(download.getByText(/^Version \d+\.\d+\.\d+, for Linux/)).toBeVisible();
    await download.getByRole('radio', { name: 'ARM64' }).check();
    await expect(debian).toHaveAttribute('href', /\/whistle_arm64\.deb$/);
    await expect(download.getByRole('link', { name: 'Download as a single file' })).toHaveAttribute('href', /\/whistle-linux-arm64$/);
    await expect(download.getByText('sudo pacman -U ./whistle-aarch64.pkg.tar.zst')).toBeVisible();
    await expect(download.getByText(/releases\/latest\/download\/install\.sh \| sh$/)).toBeVisible();
    const guide = download.locator('.download-guide');
    await expect(guide.getByText(/^chmod \+x whistle-linux-arm64\n\.\/whistle-linux-arm64 install --host/)).toBeVisible();
    await expect(guide.getByText(/^curl -fLO https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/latest\/download\/whistle-linux-arm64\n/)).toBeVisible();
    await expect(guide.getByText(/^tar -xzf whistle-linux-arm64\.tar\.gz\n\.\/whistle-\d+\.\d+\.\d+-linux-arm64\/whistle install/)).toBeVisible();
    expect(await download.innerHTML()).not.toContain('__WHISTLE');

    await page.getByRole('heading', { name: 'Set it up on your computer' }).scrollIntoViewIfNeeded();
    await expect(page.getByText('This website only describes Whistle.')).toBeVisible();
    expect(requests.every(url => url.startsWith(baseURL!))).toBe(true);
    expect(requests.some(url => /\/api\/|\/terminal(?:\?|$)|github\.com/.test(url))).toBe(false);
    expect(sockets).toEqual([]);
    expect(failures).toEqual([]);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  });
}
