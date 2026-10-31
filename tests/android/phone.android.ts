// Runs in the real Chrome app on an Android emulator or USB phone, with real taps and the real
// Android keyboard. Opt-in (`bun run test:android`); skipped when adb has no device.
// Playwright's own Android mode needs Chrome to read command-line flags, which Google Play
// images ignore, so this attaches to Chrome's built-in DevTools socket instead.
import { test as base, expect, chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const fixture = 'http://127.0.0.1:8793';
const devtools = 9333;
const adb = (...args: string[]) => execFileSync('adb', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const keyboardShown = () => /mInputShown=true/.test(adb('shell', 'dumpsys', 'input_method'));
type Message = { type: string; text?: string; pane?: string };
const messages = async (): Promise<Message[]> => (await fetch(`${fixture}/__test/messages`)).json();
function hasDevice() { try { return adb('get-state').trim() === 'device'; } catch { return false; } }

const test = base.extend<{ phone: Page }>({
  phone: async ({}, use) => {
    // On CI the emulator job must actually test something, so a missing device fails there.
    if (!hasDevice()) { if (process.env.CI) throw new Error('No Android emulator is connected'); test.skip(true, 'No Android device or emulator is connected'); }
    await fetch(`${fixture}/__test/reset`, { method: 'POST' });
    adb('shell', 'am', 'force-stop', 'com.android.chrome');
    // A fresh device opens Chrome on its welcome screens. Chrome reads these flags when it is the
    // debug app (until reboot) or the image is a userdebug build; a Play image ignores them.
    adb('shell', `echo '_ --disable-fre --no-first-run --no-default-browser-check' > /data/local/tmp/chrome-command-line`);
    adb('shell', 'am', 'set-debug-app', 'com.android.chrome');
    adb('reverse', `tcp:${new URL(fixture).port}`, `tcp:${new URL(fixture).port}`);
    adb('forward', `tcp:${devtools}`, 'localabstract:chrome_devtools_remote');
    // Android opens the pairing link in a new foreground tab, as tapping a link would. Playwright
    // then attaches to that tab, found by a marker in its URL; older Chrome cannot make tabs over CDP.
    const marker = crypto.randomUUID();
    adb('shell', `am start -a android.intent.action.VIEW -d '${fixture.replace('127.0.0.1', 'localhost')}/?run=${marker}#pair=single-use-ticket' com.android.chrome`);
    await expect.poll(() => fetch(`http://127.0.0.1:${devtools}/json/version`).then(response => response.ok, () => false), { timeout: 60_000 }).toBe(true);
    let browser: Browser | undefined;
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${devtools}`);
      const context = browser.contexts()[0];
      let page: Page | undefined;
      await expect.poll(() => (page = context.pages().find(item => item.url().includes(marker))) !== undefined, { timeout: 30_000 }).toBe(true);
      await use(page!);
      await page!.close();
    } finally {
      await browser?.close();
      // A Chrome tab left on the fixture would keep talking to it after the run.
      adb('shell', 'am', 'force-stop', 'com.android.chrome');
      adb('shell', 'am', 'clear-debug-app');
      adb('forward', '--remove', `tcp:${devtools}`);
      adb('reverse', '--remove', `tcp:${new URL(fixture).port}`);
    }
  },
});

// Where the page starts on screen, below the status bar and Chrome's toolbar. Measured while the
// Android keyboard is down: the keyboard shrinks innerHeight, not the toolbar.
const screens = new WeakMap<Page, { scale: number; top: number }>();
// A real finger tap through Android's input system, at the element's centre on screen.
async function tap(page: Page, locator: Locator) {
  const box = (await locator.boundingBox())!;
  const { scale, top } = screens.get(page)!;
  adb('shell', 'input', 'tap', String(Math.round((box.x + box.width / 2) * scale)), String(Math.round((box.y + box.height / 2 + top) * scale)));
}
const connection = (page: Page, text: string) => page.waitForFunction(text => document.querySelector('#connection')?.textContent === text, text, { timeout: 15_000 });
async function open(page: Page) {
  await page.locator('#agent-switcher [data-pane="w1:p1"]').waitFor();
  // The new tab slides in; taps and the screen offset are only right once it is on screen and still.
  await page.waitForFunction(() => document.visibilityState === 'visible' && document.hasFocus());
  await page.waitForTimeout(1000);
  screens.set(page, await page.evaluate(() => ({ scale: devicePixelRatio, top: outerHeight - innerHeight })));
  await tap(page, page.locator('#agent-switcher [data-pane="w1:p1"]'));
  await connection(page, 'Watching');
}

test('tapping the terminal raises the Android keyboard only while controlling, and it types live', async ({ phone: page }) => {
  await open(page);
  await tap(page, page.locator('#terminal-viewport'));
  await page.waitForTimeout(1000); // The keyboard animates in; give it time to appear if it were going to.
  expect(keyboardShown()).toBe(false);

  await tap(page, page.locator('#control'));
  await connection(page, 'Controlling');
  await tap(page, page.locator('#terminal-viewport'));
  await expect.poll(keyboardShown).toBe(true);
  adb('shell', 'input', 'text', 'hi');
  await expect.poll(async () => (await messages()).filter(message => message.type === 'input').map(message => message.text).join('')).toBe('hi');

  // Keys replaces the Android keyboard rather than stacking under it.
  await tap(page, page.locator('#more-keys'));
  await expect.poll(keyboardShown).toBe(false);
  await expect(page.locator('#keypad')).toBeVisible();
});

test('releasing control puts the Android keyboard away', async ({ phone: page }) => {
  await open(page);
  await tap(page, page.locator('#control'));
  await connection(page, 'Controlling');
  await tap(page, page.locator('#terminal-viewport'));
  await expect.poll(keyboardShown).toBe(true);
  await tap(page, page.locator('#release'));
  await connection(page, 'Watching');
  await expect.poll(keyboardShown).toBe(false);
  adb('shell', 'input', 'text', 'x');
  await page.waitForTimeout(500);
  expect((await messages()).filter(message => message.type === 'input')).toEqual([]);
});
