import { expect, test, type Page } from '@playwright/test';

type Message = { type: string; pane?: string; control?: boolean; height?: number; rows?: number; id?: number; key?: string; text?: string };
const fixtureUrl = (path: string) => `http://127.0.0.1:8792${path}`;
async function messages(page: Page): Promise<Message[]> { return (await page.request.get(fixtureUrl('/__test/messages'))).json(); }
async function pair(page: Page) {
  await page.goto('/#pair=single-use-ticket');
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
}
async function open(page: Page) {
  await pair(page);
  await page.locator('#agent-switcher [data-pane="w1:p1"]').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
}
async function control(page: Page) {
  await open(page);
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
}

test.beforeEach(async ({ request }) => { await request.post(fixtureUrl('/__test/reset')); });
test.afterEach(async ({ page }) => {
  // Fixture UI must not generate script failures. Network errors in the explicit
  // disconnect scenario are handled by the terminal controller, not thrown.
  await expect(page.locator('#error')).not.toContainText('Could not decode terminal data');
});

test('single-use QR pairing and nested worktrees', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await pair(page);
  await expect(page).toHaveURL('/');
  expect(await (await page.request.get(fixtureUrl('/__test/pairings'))).json()).toBe(1);
  await expect(page.locator('[data-workspace="w1"] > [data-workspace="w2"] .worktree-badge')).toHaveText('Worktree');
  await expect(page.locator('#agent-switcher button')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('manual pairing reports errors and clears the token', async ({ page }) => {
  await page.goto('/');
  await page.locator('#pair summary').click();
  await page.locator('#token').fill('wrong');
  await page.getByRole('button', { name: 'Pair browser' }).click();
  await expect(page.locator('#pair-error')).toHaveText('Incorrect access token');
  await page.locator('#token').fill('test-token');
  await page.getByRole('button', { name: 'Pair browser' }).click();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#token')).toHaveValue('');
});

test('watch is read-only and control/release retains a tall PTY', async ({ page }) => {
  await open(page);
  await expect(page.locator('#focus-keyboard')).toBeDisabled();
  await expect(page.locator('#compose-toggle')).toBeDisabled();
  expect((await messages(page)).filter(message => message.type === 'input')).toEqual([]);
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  expect((await messages(page)).filter(message => message.type === 'connect' && message.control).at(-1)?.height).toBeGreaterThanOrEqual(64);
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  expect((await messages(page)).filter(message => message.type === 'connect').at(-1)?.control).toBe(false);
});

test('live text, chords and compose stay in one ordered input lane', async ({ page }) => {
  await control(page);
  await page.locator('#focus-keyboard').click();
  await page.keyboard.type('abc');
  await page.locator('.main-keys [data-key="Enter"]').click();
  await page.locator('#more-keys').click();
  await page.locator('[data-modifier="ctrl"]').click();
  await page.locator('#key-grid [data-key="p"]').click();
  await expect(page.locator('[data-modifier="ctrl"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#armed-keys')).toBeHidden();
  await page.locator('#custom-key').fill('ctrl+shift+k');
  await page.locator('#custom-key-form button').click();
  await page.locator('#compose-toggle').click();
  await page.locator('#draft').fill('line one\nline two');
  await page.locator('#paste').click();
  await page.locator('#submit').click();
  const pasted = '\x1b[200~line one\rline two\x1b[201~';
  await expect.poll(async () => (await messages(page)).filter(message => ['input', 'key'].includes(message.type)).length).toBe(8);
  const writes = (await messages(page)).filter(message => ['input', 'key'].includes(message.type));
  expect(writes.map(({ type, key, text }) => ({ type, ...(key ? { key } : { text }) }))).toEqual([
    { type: 'input', text: 'a' }, { type: 'input', text: 'b' }, { type: 'input', text: 'c' },
    { type: 'key', key: 'enter' }, { type: 'key', key: 'ctrl+p' }, { type: 'key', key: 'ctrl+shift+k' },
    { type: 'input', text: pasted }, { type: 'input', text: pasted + '\r' },
  ]);
  expect(writes.map(message => message.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  await expect(page.locator('#draft')).toHaveValue('line one\nline two');
});

test('switching agents preserves separate drafts and drops control/modifiers', async ({ page }) => {
  await control(page);
  await page.locator('#compose-toggle').click();
  await page.locator('#draft').fill('first draft');
  await page.locator('#more-keys').click();
  await page.locator('[data-modifier="ctrl"]').click();
  await page.locator('#agent-switcher [data-pane="w2:p1"]').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await expect(page.locator('#compose')).toBeHidden();
  await expect(page.locator('#keypad')).toBeHidden();
  await expect(page.locator('#armed-keys')).toBeHidden();
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.locator('#compose-toggle').click();
  await expect(page.locator('#draft')).toHaveValue('');
  await page.locator('#draft').fill('second draft');
  await page.locator('#agent-switcher [data-pane="w1:p1"]').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.locator('#compose-toggle').click();
  await expect(page.locator('#draft')).toHaveValue('first draft');
  expect((await messages(page)).filter(message => message.type === 'input')).toEqual([]);
});

test('reconnection and reload are watch-only and never replay input', async ({ page }) => {
  await control(page);
  await page.locator('#focus-keyboard').click();
  await page.keyboard.type('hello');
  await expect.poll(async () => (await messages(page)).filter(message => message.type === 'input').length).toBe(5);
  await page.request.post(fixtureUrl('/__test/disconnect'));
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  await expect(page.locator('#connection')).toHaveText('Watching');
  expect((await messages(page)).filter(message => message.type === 'input').length).toBe(5);
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Watching');
  expect((await messages(page)).filter(message => message.type === 'connect').at(-1)?.control).toBe(false);
  expect((await messages(page)).filter(message => message.type === 'input').length).toBe(5);
});

test('local scrolling stays put, edge scrolling is remote, and Keys does not resize', async ({ page }) => {
  await control(page);
  const viewport = page.locator('#terminal-viewport');
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  await page.waitForTimeout(250);
  const resized = (await messages(page)).filter(message => message.type === 'resize').length;
  const height = await viewport.evaluate(node => node.clientHeight);
  await page.locator('#more-keys').click();
  expect(await viewport.evaluate(node => node.clientHeight)).toBe(height);
  await page.waitForTimeout(300);
  expect((await messages(page)).filter(message => message.type === 'resize').length).toBe(resized);
  await page.locator('#more-keys').click();
  const top = await viewport.evaluate(node => node.scrollTop);
  await viewport.hover();
  await page.mouse.wheel(0, -100);
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeLessThan(top);
  const readingTop = await viewport.evaluate(node => node.scrollTop);
  await page.waitForTimeout(600); // Several incoming frames must not snap reading back to the cursor.
  expect(await viewport.evaluate(node => node.scrollTop)).toBeCloseTo(readingTop, 0);
  expect((await messages(page)).filter(message => message.type === 'scroll')).toEqual([]);
  await viewport.evaluate(node => { node.scrollTop = 0; });
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await messages(page)).filter(message => message.type === 'scroll').length).toBeGreaterThan(0);
  await page.locator('#jump-input').click();
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
});

test('inventory updates keep xterm mounted and replacement panes disconnect', async ({ page }) => {
  await control(page);
  const terminal = await page.locator('#terminal .xterm').elementHandle();
  await page.waitForTimeout(5500); // Inventory polling must not reconnect the active stream.
  expect(await terminal!.evaluate(node => node.isConnected)).toBe(true);
  expect((await messages(page)).filter(message => message.type === 'connect')).toHaveLength(2);
  await page.request.post(fixtureUrl('/__test/replace'));
  await page.locator('#refresh').click();
  await expect(page.locator('#session')).toBeHidden();
  await expect(page.locator('#error')).toContainText('closed or replaced');
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
});

test('switching with unconfirmed writes warns without replaying', async ({ page }) => {
  await control(page);
  await page.request.post(fixtureUrl('/__test/unconfirmed'));
  await page.locator('#compose-toggle').click();
  await page.locator('#draft').fill('pending');
  await page.locator('#paste').click();
  await expect.poll(async () => (await messages(page)).filter(message => message.type === 'input').length).toBe(1);
  await page.locator('#agent-switcher [data-pane="w2:p1"]').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await expect(page.locator('#error')).toContainText('not confirmed');
  expect((await messages(page)).filter(message => message.type === 'input')).toHaveLength(1);
});

test('short viewports and touch scrolling retain usable terminal controls', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 450 });
  await control(page);
  await expect(page.locator('html')).toHaveClass(/short-viewport/);
  const viewport = page.locator('#terminal-viewport');
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  const top = await viewport.evaluate(node => node.scrollTop);
  await viewport.evaluate(node => {
    const touch = (clientY: number) => new Touch({ identifier: 1, target: node, clientY });
    node.dispatchEvent(new TouchEvent('touchstart', { touches: [touch(200)], bubbles: true }));
    node.dispatchEvent(new TouchEvent('touchmove', { touches: [touch(300)], bubbles: true, cancelable: true }));
    node.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true }));
  });
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeLessThan(top);
  const toolbar = await page.locator('.main-keys').boundingBox();
  expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(450);
  await page.locator('#jump-input').click();
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
});
