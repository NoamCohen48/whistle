import { expect, test, type Page } from '@playwright/test';

type Message = { type: string; pane?: string; control?: boolean; height?: number; rows?: number; id?: number; key?: string; text?: string; submit?: boolean;
  contentType?: string; jpeg?: boolean; size?: number; path?: string };
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

test('system Back returns to the dashboard after switching panes; Forward is watch-only', async ({ page }) => {
  await control(page);
  await page.locator('#agent-switcher [data-pane="w2:p1"]').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.locator('#compose-toggle').click();
  await page.locator('#draft').fill('keep this draft, never send it');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
  await expect(page.locator('#session')).toBeHidden();
  expect(await page.evaluate(() => sessionStorage.getItem('whistle-pane'))).toBeNull();
  await page.goForward();
  await expect(page.locator('#pane-info')).toHaveText('w2:p1');
  await expect(page.locator('#connection')).toHaveText('Watching');
  expect((await messages(page)).filter(message => message.type === 'connect').at(-1)?.control).toBe(false);
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.locator('#compose-toggle').click();
  await expect(page.locator('#draft')).toHaveValue('keep this draft, never send it');
  expect((await messages(page)).filter(message => message.type === 'input')).toEqual([]);
});

test('reloading a pane keeps a single Back step to the dashboard', async ({ page }) => {
  await control(page);
  const length = await page.evaluate(() => history.length);
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Watching');
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
  await expect(page.locator('#session')).toBeHidden();
  expect((await messages(page)).filter(message => message.type === 'input')).toEqual([]);
});

test('a cold-opened pane has a dashboard underneath it and the header Back consumes its history step', async ({ page }) => {
  await pair(page);
  await page.goto('about:blank');
  await page.goto('/#pane=w1:p1');
  await expect(page.locator('#connection')).toHaveText('Watching');
  await page.locator('#back').click();
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
  await page.goForward();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
  expect((await messages(page)).filter(message => ['input', 'resize'].includes(message.type))).toEqual([]);
});

test('Forward cannot reopen a replaced terminal from stale pane history', async ({ page }) => {
  await open(page);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
  await page.request.post(fixtureUrl('/__test/replace'));
  const refreshed = page.waitForResponse(response => response.url().endsWith('/api/panes'));
  await page.locator('#refresh').click();
  await refreshed;
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
  await expect(page.locator('#session')).toBeHidden();
  expect((await messages(page)).filter(message => message.type === 'connect')).toHaveLength(1);
});

test('single-use QR pairing and nested worktrees', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await pair(page);
  await expect(page).toHaveURL('/');
  expect(await (await page.request.get(fixtureUrl('/__test/pairings'))).json()).toBe(1);
  await expect(page.locator('[data-workspace="w1"] > [data-workspace="w2"] .worktree-badge')).toHaveText('Worktree');
  await expect(page.locator('#agent-switcher button')).toHaveCount(2);
  // Collapsing a workspace says how many panes it hides, its worktrees' included.
  await page.locator('[data-workspace="w1"] > .workspace .workspace-toggle').click();
  await expect(page.locator('[data-workspace="w1"] > .workspace .workspace-count')).toHaveText('2 hidden');
  await page.locator('[data-workspace="w1"] > .workspace .workspace-toggle').click();
  // The used QR again on a browser that is still paired: it just opens, without an error.
  // (A query string forces a real load; a hash-only change would not redeem anything.)
  await page.goto('/?again#pair=single-use-ticket');
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
  expect(await (await page.request.get(fixtureUrl('/__test/pairings'))).json()).toBe(2);
  await expect(page.locator('#error')).toBeHidden();
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
  await expect(page.locator('#keyboard')).toBeHidden();
  await expect(page.locator('#compose-toggle')).toBeDisabled();
  expect((await messages(page)).filter(message => message.type === 'input')).toEqual([]);
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  expect((await messages(page)).filter(message => message.type === 'connect' && message.control).at(-1)?.height).toBeGreaterThanOrEqual(64);
  await page.locator('#release').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  expect((await messages(page)).filter(message => message.type === 'connect').at(-1)?.control).toBe(false);
});

test('live text, chords and compose stay in one ordered input lane', async ({ page }) => {
  await control(page);
  await page.locator('#terminal-viewport').click();
  await page.keyboard.type('abc');
  await page.locator('.main-keys [data-key="Enter"]').click();
  // Keys replaces the phone keyboard rather than stacking under it. A bare click event keeps focus
  // where it was, as an Android tap does, so the terminal's textarea must be blurred explicitly.
  await expect(page.locator('.xterm-helper-textarea')).toBeFocused();
  await page.locator('#more-keys').dispatchEvent('click');
  await expect(page.locator('.xterm-helper-textarea')).not.toBeFocused();
  await page.locator('[data-modifier="ctrl"]').click();
  await page.locator('#all-keys summary').click();
  await page.locator('#key-grid [data-key="p"]').click();
  await expect(page.locator('[data-modifier="ctrl"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#armed-keys')).toBeHidden();
  await page.locator('#custom-key').fill('ctrl+shift+k');
  await page.locator('#custom-key-form button').click();
  await page.locator('#compose-toggle').click();
  // Composing swaps the toolbar's Enter for Send (Paste + Enter): never two Enter actions at once.
  await expect(page.locator('.main-keys [data-key="Enter"]')).toHaveCount(0);
  await expect(page.locator('#submit')).toBeDisabled();
  await page.locator('#draft').fill('line one\nline two');
  await page.locator('#paste').click();
  await page.locator('#submit').click();
  const pasted = '\x1b[200~line one\rline two\x1b[201~';
  await expect.poll(async () => (await messages(page)).filter(message => ['input', 'key'].includes(message.type)).length).toBe(8);
  const writes = (await messages(page)).filter(message => ['input', 'key'].includes(message.type));
  expect(writes.map(({ type, key, text, submit }) => ({ type, ...(key ? { key } : { text }), ...(submit ? { submit } : {}) }))).toEqual([
    { type: 'input', text: 'a' }, { type: 'input', text: 'b' }, { type: 'input', text: 'c' },
    { type: 'key', key: 'enter' }, { type: 'key', key: 'ctrl+p' }, { type: 'key', key: 'ctrl+shift+k' },
    { type: 'input', text: pasted }, { type: 'input', text: pasted, submit: true },
  ]);
  expect(writes.map(message => message.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  await expect(page.locator('#draft')).toHaveValue('line one\nline two');
});

test('multiline paste reaches agents even when frames never report bracketed paste', async ({ page, request }) => {
  await request.post(fixtureUrl('/__test/no-bracketed'));
  await control(page);
  await page.locator('#compose-toggle').click();
  await page.locator('#draft').fill('line one\nline two');
  await page.locator('#submit').click();
  await expect.poll(async () => (await messages(page)).filter(message => message.type === 'input').map(({ text, submit }) => ({ text, submit })))
    .toEqual([{ text: '\x1b[200~line one\rline two\x1b[201~', submit: true }]);

  // A plain terminal that never said it accepts pasted lines still refuses rather than running each line.
  await page.locator('#release').click();
  await page.locator('#pane-actions').click();
  await page.locator('#menu-new-terminal').click();
  await page.locator('#create-submit').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.locator('#compose-toggle').click();
  await page.locator('#draft').fill('ls\nrm -rf build');
  await page.locator('#submit').click();
  await expect(page.getByText('This terminal did not say it accepts pasted lines')).toBeVisible();
  expect((await messages(page)).filter(message => message.type === 'input')).toHaveLength(1);
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
  await page.locator('#terminal-viewport').click();
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
  await page.locator('#latest').click();
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
});

test('inventory updates keep xterm mounted and replacement panes disconnect', async ({ page }) => {
  await control(page);
  const terminal = await page.locator('#terminal .xterm').elementHandle();
  await page.waitForTimeout(5500); // Inventory polling must not reconnect the active stream.
  expect(await terminal!.evaluate(node => node.isConnected)).toBe(true);
  expect((await messages(page)).filter(message => message.type === 'connect')).toHaveLength(2);
  await page.request.post(fixtureUrl('/__test/replace'));
  // Refresh is not offered while controlling; the inventory poll notices the replacement.
  await expect(page.locator('#session')).toBeHidden({ timeout: 10_000 });
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
  await page.locator('#latest').click();
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
});

test('an upright small phone with the keyboard open keeps Send on screen', async ({ page }) => {
  // The keyboard leaves a viewport wider than tall while the phone is still held upright.
  await page.addInitScript(() => Object.defineProperty(screen, 'orientation', { value: { type: 'portrait-primary' } }));
  await page.setViewportSize({ width: 360, height: 261 });
  await control(page);
  await expect(page.locator('html')).toHaveClass(/tiny-viewport/);
  await expect(page.locator('html')).not.toHaveClass(/landscape/);
  await page.locator('#compose-toggle').click();
  await page.locator('#draft').fill('run the tests');
  const send = await page.locator('#submit').boundingBox();
  expect(send!.y + send!.height).toBeLessThanOrEqual(261);
  await page.locator('#submit').click();
  // Sent drafts stay editable, but the button no longer looks unsent.
  await expect(page.locator('#submit')).toHaveText('Sent');
  await page.locator('#draft').fill('run the tests again');
  await expect(page.locator('#submit')).toHaveText('Send');
});

test('errors and armed modifiers overlay the terminal without resizing the PTY', async ({ page }) => {
  await control(page);
  const viewport = page.locator('#terminal-viewport');
  await page.waitForTimeout(250);
  const resized = (await messages(page)).filter(message => message.type === 'resize').length;
  const height = await viewport.evaluate(node => node.clientHeight);
  await page.locator('#more-keys').click();
  await page.locator('[data-modifier="ctrl"]').click();
  await page.locator('#more-keys').click();
  await expect(page.locator('#armed-keys')).toBeVisible();
  await page.locator('#more-keys').click();
  await page.locator('#all-keys summary').click();
  await page.locator('#custom-key').fill('meta+x'); // Rejected locally: unsupported modifier.
  await page.locator('#custom-key-form button').click();
  await expect(page.locator('.terminal-frame > #error')).toBeVisible();
  expect(await viewport.evaluate(node => node.clientHeight)).toBe(height);
  await page.waitForTimeout(300);
  expect((await messages(page)).filter(message => message.type === 'resize').length).toBe(resized);
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('#error')).toBeHidden();
  expect((await messages(page)).filter(message => ['input', 'key'].includes(message.type))).toEqual([]);
});

type ActionMessage = Message & { action?: string; workspaceId?: string; kind?: string; cwd?: string; branch?: string; base?: string; path?: string; paneId?: string };
const actions = async (page: Page) => (await messages(page) as ActionMessage[]).filter(message => message.type === 'action')
  .map(({ type: _type, ...rest }) => rest);

test('new agents, terminals and workspaces open watch-only without desktop focus', async ({ page }) => {
  await pair(page);
  await page.locator('#new').click();
  await expect(page.locator('#create-sheet')).toBeVisible();
  await expect(page.locator('#new-workspace')).toHaveValue('w1');
  // The fixture's existing panes run pi, so it is preselected; choose another agent explicitly.
  await expect(page.locator('[data-agent="pi"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-agent="claude"]').click();
  await page.locator('#create-submit').click();
  await expect(page.locator('#create-sheet')).toBeHidden();
  await expect(page.locator('#heading')).toHaveText('claude');
  await expect(page.locator('#connection')).toHaveText('Watching');
  const opened = (await messages(page)).filter(message => message.type === 'connect');
  expect(opened.at(-1)).toMatchObject({ pane: 'w1:n1', control: false });

  await page.locator('#pane-actions').click();
  await page.locator('#menu-new-terminal').click();
  await expect(page.locator('[data-kind="terminal"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#create-submit').click();
  await expect(page.locator('#pane-info')).toHaveText('w1:n2');
  await expect(page.locator('#connection')).toHaveText('Watching');

  await page.locator('#back').click();
  await page.locator('#new').click();
  await page.locator('[data-kind="workspace"]').click();
  await page.locator('#new-folder').fill('relative');
  await page.locator('#create-submit').click();
  await expect(page.locator('#create-sheet .sheet-error')).toHaveText('Use an absolute path or ~/…');
  await page.locator('#new-folder').fill('~/projects/site');
  await page.locator('#create-submit').click();
  await expect(page.locator('#pane-info')).toHaveText('wn3:n4');
  await expect(page.locator('#heading + small')).toContainText('site');
  expect(await actions(page)).toEqual([
    { action: 'agent', workspaceId: 'w1', kind: 'claude' },
    { action: 'terminal', workspaceId: 'w1' },
    { action: 'workspace', cwd: 'relative' },
    { action: 'workspace', cwd: '~/projects/site' },
  ]);
  expect((await messages(page)).filter(message => message.type === 'connect').every(message => !message.control)).toBe(true);
});

test('worktrees can be created, opened and reached when already open', async ({ page }) => {
  await pair(page);
  await page.locator('#new').click();
  await page.locator('[data-kind="worktree"]').click();
  await expect(page.locator('#new-repository')).toHaveValue('w1');
  await page.locator('#new-branch').fill('feat/phone');
  await page.locator('#new-base').fill('main');
  await page.locator('#create-submit').click();
  await expect(page.locator('#pane-info')).toHaveText('wn1:n2');
  await expect(page.locator('#connection')).toHaveText('Watching');
  await page.locator('#back').click();
  await expect(page.locator('[data-workspace="w1"] > [data-workspace="wn1"] .worktree-badge')).toHaveText('Worktree');

  await page.locator('#new').click();
  await page.locator('[data-kind="worktree"]').click();
  await page.locator('#worktree-existing').click();
  await page.locator('.worktree-choice', { hasText: 'search' }).click();
  await expect(page.locator('#pane-info')).toHaveText('w2:p1');
  await page.locator('#back').click();
  await page.locator('#new').click();
  await page.locator('[data-kind="worktree"]').click();
  await page.locator('#worktree-existing').click();
  await page.locator('.worktree-choice', { hasText: 'docs' }).click();
  await expect(page.locator('#pane-info')).toHaveText('wn3:n4');
  await expect(page.locator('#connection')).toHaveText('Watching');
  expect(await actions(page)).toEqual([
    { action: 'worktree-create', workspaceId: 'w1', branch: 'feat/phone', base: 'main' },
    { action: 'worktree-open', workspaceId: 'w1', path: '/atlas-worktrees/docs' },
  ]);
});

test('closing a pane and removing a worktree need confirmation; failures return to watching', async ({ page, request }) => {
  await control(page);
  await page.locator('#pane-actions').click();
  await expect(page.locator('#menu-remove-worktree')).toHaveCount(0);
  await page.locator('#menu-close-pane').click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#pane-menu')).toBeHidden();
  expect(await actions(page)).toEqual([]);
  await expect(page.locator('#connection')).toHaveText('Controlling');

  await page.locator('#pane-actions').click();
  await page.locator('#menu-close-pane').click();
  await page.locator('#confirm-destructive').click();
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#agent-switcher [data-pane="w1:p1"]')).toHaveCount(0);

  await page.locator('#agent-switcher [data-pane="w2:p1"]').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await page.locator('#pane-actions').click();
  await page.locator('#menu-remove-worktree').click();
  await request.post(fixtureUrl('/__test/fail-action?message=Worktree has uncommitted changes'));
  await page.locator('#confirm-destructive').click();
  await expect(page.locator('#pane-menu .sheet-error')).toHaveText('Worktree has uncommitted changes');
  await page.locator('#pane-menu').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await page.locator('#pane-actions').click();
  await page.locator('#menu-remove-worktree').click();
  await page.locator('#confirm-destructive').click();
  await expect(page.locator('[data-workspace="w2"]')).toHaveCount(0);
  expect(await actions(page)).toEqual([
    { action: 'close-pane', paneId: 'w1:p1' },
    { action: 'remove-worktree', workspaceId: 'w2' },
    { action: 'remove-worktree', workspaceId: 'w2' },
  ]);
});

test('agents that need you are listed first and open watch-only', async ({ page, request }) => {
  await pair(page);
  await expect(page.locator('#needs-you')).toHaveCount(0);
  await request.post(fixtureUrl('/__test/status?pane=w2:p1&status=blocked'));
  await request.post(fixtureUrl('/__test/status?pane=w1:p1&status=done'));
  await page.locator('#refresh').click();
  const waiting = page.locator('#needs-you .pane');
  await expect(waiting).toHaveCount(2);
  await expect(waiting.first()).toContainText('Second agentneeds you');
  await expect(page.locator('#needs-you')).toContainText('atlas-search');
  await expect(page.locator('#needs-you')).toContainText('finished');
  await expect(page.locator('#needs-you .dot[data-tone="attention"]')).toHaveCount(1);
  await waiting.filter({ hasText: 'Second agent' }).click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  expect((await messages(page)).filter(message => message.type === 'connect')).toEqual([
    expect.objectContaining({ pane: 'w2:p1', control: false })]);
  await page.locator('#back').click();
  await request.post(fixtureUrl('/__test/status?pane=w2:p1&status=working'));
  await request.post(fixtureUrl('/__test/status?pane=w1:p1&status=idle'));
  await page.locator('#refresh').click();
  await expect(page.locator('#needs-you')).toHaveCount(0);
});

test('new workspaces pick a folder by browsing the PC', async ({ page }) => {
  await pair(page);
  await page.locator('#new').click();
  await page.locator('[data-kind="workspace"]').click();
  // Starts beside the open projects; Herdr-managed worktree checkouts are not offered.
  await expect(page.locator('.folder-chips button')).toHaveText(['~/projects/']);
  await expect(page.locator('#new-folder')).toHaveValue('~/projects/');
  await expect(page.locator('.crumbs button')).toHaveText(['~', 'projects']);
  await expect(page.locator('.folder-row')).toHaveText(['atlasGit', 'notes', 'site', 'whistleGit']);

  // Typing narrows the list; tapping goes into a folder.
  await page.locator('#new-folder').fill('~/projects/wh');
  await expect(page.locator('.folder-row')).toHaveText(['whistleGit']);
  await page.locator('.folder-row').click();
  await expect(page.locator('#new-folder')).toHaveValue('~/projects/whistle/');
  await expect(page.locator('#new-folder')).not.toBeFocused();
  await expect(page.locator('.folder-row')).toHaveText(['src', 'web']);
  await expect(page.locator('#new-label')).toHaveAttribute('placeholder', 'whistle');

  // Breadcrumbs go back up; missing and outside folders explain themselves.
  await page.locator('.crumbs button', { hasText: '~' }).click();
  await expect(page.locator('.folder-row')).toHaveText(['Documents', 'Downloads', 'projects']);
  await page.locator('#new-folder').fill('~/Nope/');
  await expect(page.locator('.folder-browser')).toContainText('This folder does not exist.');
  await page.locator('#new-folder').fill('/etc/');
  await expect(page.locator('.folder-browser')).toContainText('Only folders inside your home folder can be browsed.');

  await page.locator('.folder-chips button').click();
  await page.locator('.folder-row', { hasText: 'atlas' }).click();
  await page.locator('#create-submit').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  expect(await actions(page)).toEqual([{ action: 'workspace', cwd: '~/projects/atlas' }]);
});

test('panes and workspaces can be renamed without leaving watch mode', async ({ page }) => {
  await open(page);
  await page.locator('#pane-actions').click();
  await page.locator('#menu-rename-pane').click();
  await expect(page.locator('#rename-input')).toHaveValue('First agent');
  await expect(page.locator('#rename-input')).toBeFocused();
  await page.locator('#rename-input').fill('Reviewer');
  await page.locator('#rename-save').click();
  await expect(page.locator('#pane-menu')).toBeHidden();
  await expect(page.locator('#heading')).toHaveText('Reviewer');
  await expect(page.locator('#agent-switcher [data-pane="w1:p1"] .chip-name')).toHaveText('Reviewer');

  await page.locator('#pane-actions').click();
  await page.locator('#menu-rename-workspace').click();
  await expect(page.locator('#rename-input')).toHaveValue('atlas');
  await page.locator('#rename-input').fill('');
  await page.locator('#rename-save').click();
  await expect(page.locator('#pane-menu')).toBeVisible(); // An empty workspace name is not submitted.
  await page.locator('#rename-input').fill('Tap app');
  await page.locator('#rename-save').click();
  await expect(page.locator('#heading + small')).toContainText('Tap app');
  await expect(page.locator('#connection')).toHaveText('Watching');
  expect(await actions(page)).toEqual([
    { action: 'rename-pane', paneId: 'w1:p1', label: 'Reviewer' },
    { action: 'rename-workspace', workspaceId: 'w1', label: 'Tap app' },
  ]);
  // Renaming reconnects nothing: the one watch stream is still the only connection.
  expect((await messages(page)).filter(message => message.type === 'connect')).toHaveLength(1);
});

test('a long pane list can be searched and cleared', async ({ page, request }) => {
  await pair(page);
  await expect(page.locator('#pane-search')).toHaveCount(0);
  await request.post(fixtureUrl('/__test/add-panes'));
  await page.locator('#refresh').click();
  await page.locator('#pane-search').fill('claude runn');
  await expect(page.locator('#search-results .pane strong')).toHaveText(['Test runner']);
  await expect(page.locator('#pane-list')).toBeHidden();
  await page.locator('#pane-search').fill('search');
  await expect(page.locator('#search-results .pane strong')).toHaveText(['Second agent']);
  await page.locator('#pane-search').fill('nothing like this');
  await expect(page.locator('#search-results')).toContainText('No matches');
  await page.locator('#pane-search').press('Escape');
  await expect(page.locator('#pane-search')).toHaveValue('');
  await expect(page.locator('#pane-list .pane')).toHaveCount(6);
  await page.locator('#pane-search').fill('runner');
  await page.locator('#search-results .pane').click();
  await expect(page.locator('#heading')).toHaveText('Test runner');
  await expect(page.locator('#connection')).toHaveText('Watching');
  await page.locator('#back').click();
  await expect(page.locator('#pane-search')).toHaveValue('runner');
  await page.locator('#clear-search').click();
  await expect(page.locator('#search-results')).toHaveCount(0);
});

test('taking and losing control vibrate differently', async ({ page, request }) => {
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    // SAFETY: This fixture creates its own window.vibrations array before app startup.
    (window as unknown as { vibrations: unknown[] }).vibrations = calls;
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (pattern: unknown) => { calls.push(pattern); return true; } });
  });
  // SAFETY: addInitScript above installs this test-only array on every document.
  const vibrations = () => page.evaluate(() => (window as unknown as { vibrations: unknown[] }).vibrations);
  await open(page);
  expect(await vibrations()).toEqual([]); // Watching alone is silent.
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await expect.poll(vibrations).toEqual([18]);
  await page.locator('#release').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await expect.poll(vibrations).toEqual([18, [12, 70, 12]]);
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await request.post(fixtureUrl('/__test/disconnect'));
  await expect(page.locator('#connection')).toHaveText('Disconnected');
  await expect.poll(vibrations).toEqual([18, [12, 70, 12], 18, [12, 70, 12]]);
});

test('an alert opens its pane watch-only, from a closed app or an open one', async ({ page }) => {
  await pair(page);
  await page.goto('about:blank'); // A fresh load, as when the worker opens a new window.
  await page.goto('/#pane=w2:p1');
  await expect(page.locator('#heading')).toHaveText('Second agent');
  await expect(page.locator('#connection')).toHaveText('Watching');
  await expect(page).toHaveURL('/');
  await page.locator('#back').click();
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'open-pane', paneId: 'w1:p1' } })));
  await expect(page.locator('#heading')).toHaveText('First agent');
  await expect(page.locator('#connection')).toHaveText('Watching');
  expect((await messages(page)).filter(message => message.type === 'connect').map(({ pane, control }) => ({ pane, control })))
    .toEqual([{ pane: 'w2:p1', control: false }, { pane: 'w1:p1', control: false }]);
});

test('pictures upload into the draft as paths and are only sent with it', async ({ page }) => {
  const upload = (message: Message) => message.type === 'upload';
  await control(page);
  await page.locator('#compose-toggle').click();
  await page.locator('#draft').fill('what is wrong here?');

  // A large camera photo is shrunk and re-encoded as JPEG on the phone before it is sent.
  const photo = Buffer.from(await page.evaluate(() => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 4000, height: 3000 });
    const context = canvas.getContext('2d')!;
    for (let i = 0; i < 400; i++) { context.fillStyle = `hsl(${i * 37} 70% 50%)`; context.fillRect((i * 97) % 4000, (i * 53) % 3000, 300, 200); }
    return canvas.toDataURL('image/jpeg', 1).split(',')[1];
  }), 'base64');
  await page.locator('#picture-input').setInputFiles({ name: 'IMG_2041.jpg', mimeType: 'image/jpeg', buffer: photo });
  await expect(page.locator('#draft')).toHaveValue('what is wrong here? /home/sam/.local/state/whistle/uploads/20261017-143210-00000001.jpg ');
  await expect(page.locator('#attachments li')).toHaveCount(1);
  await expect(page.locator('#attachments img')).toHaveAttribute('src', /^data:image\/jpeg/);
  const [sent] = (await messages(page)).filter(upload);
  expect(sent).toMatchObject({ contentType: 'image/jpeg', jpeg: true });
  expect(sent.size).toBeLessThan(photo.length);

  // A pasted screenshot stays PNG. Attaching never types anything into the terminal.
  await page.locator('#draft').evaluate(async (textarea: HTMLTextAreaElement) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 300, height: 200 });
    canvas.getContext('2d')!.fillRect(10, 10, 100, 50);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'));
    const data = new DataTransfer();
    data.items.add(new File([blob], 'screenshot.png', { type: 'image/png' }));
    textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#attachments li')).toHaveCount(2);
  expect((await messages(page)).filter(upload).map(message => message.contentType)).toEqual(['image/jpeg', 'image/png']);
  expect((await messages(page)).filter(message => message.type === 'input')).toHaveLength(0);

  await page.getByRole('button', { name: 'Remove picture 1' }).click();
  await expect(page.locator('#draft')).toHaveValue('what is wrong here? /home/sam/.local/state/whistle/uploads/20261017-143210-00000002.png ');
  await expect(page.locator('#attachments li')).toHaveCount(1);
  await page.locator('#submit').click();
  await expect.poll(async () => (await messages(page)).filter(message => message.type === 'input').map(({ text, submit }) => ({ text, submit })))
    .toEqual([{ text: '\x1b[200~what is wrong here? /home/sam/.local/state/whistle/uploads/20261017-143210-00000002.png \x1b[201~', submit: true }]);

  // Files that are not readable pictures are refused on the phone with a reason.
  await page.locator('#picture-input').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') });
  await expect(page.locator('#attach-error')).toHaveText('This file is not a picture Whistle can read.');
  expect((await messages(page)).filter(upload)).toHaveLength(2);
});

test('several pictures picked at once are all sent in one message, even if one of them cannot be read', async ({ page }) => {
  const uploads = '/home/sam/.local/state/whistle/uploads/20261017-143210-';
  await control(page);
  await page.locator('#compose-toggle').click();
  await page.locator('#draft').fill('compare these screens');

  const picture = (type: 'image/png' | 'image/jpeg', color: string) => page.evaluate(async ([type, color]) => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });
    const context = canvas.getContext('2d')!;
    context.fillStyle = color; context.fillRect(0, 0, 320, 240);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), type));
    return [...new Uint8Array(await blob.arrayBuffer())];
  }, [type, color] as const).then(bytes => Buffer.from(bytes));
  await page.locator('#picture-input').setInputFiles([
    { name: 'before.png', mimeType: 'image/png', buffer: await picture('image/png', '#c33') },
    { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') },
    { name: 'after.jpg', mimeType: 'image/jpeg', buffer: await picture('image/jpeg', '#3c3') },
    { name: 'diff.png', mimeType: 'image/png', buffer: await picture('image/png', '#33c') },
  ]);

  // The readable pictures upload in the order they were picked; the broken one is reported, not fatal.
  await expect(page.locator('#attachments li')).toHaveCount(3);
  await expect(page.locator('#attach-error')).toHaveText('This file is not a picture Whistle can read.');
  await expect(page.locator('#attach')).toBeEnabled();
  expect((await messages(page)).filter(message => message.type === 'upload').map(message => message.contentType))
    .toEqual(['image/png', 'image/jpeg', 'image/png']);
  const draft = `compare these screens ${uploads}00000001.png ${uploads}00000002.jpg ${uploads}00000003.png `;
  await expect(page.locator('#draft')).toHaveValue(draft);
  expect((await messages(page)).filter(message => message.type === 'input')).toHaveLength(0);

  // One Send delivers the prompt with every picture path, as a single bracketed paste plus Enter.
  await page.locator('#submit').click();
  await expect.poll(async () => (await messages(page)).filter(message => message.type === 'input').map(({ text, submit }) => ({ text, submit })))
    .toEqual([{ text: `\x1b[200~${draft}\x1b[201~`, submit: true }]);
});

test('changes can be reviewed read-only without touching the terminal', async ({ page }) => {
  await open(page);
  await page.locator('#pane-actions').click();
  await page.locator('#menu-changes').click();
  const sheet = page.locator('#changes');
  await expect(sheet.locator('.changes-summary [role=status]')).toHaveText(/feature\/review\s*5 files\s*\+52 −11/);
  await expect(sheet.locator('.change-path')).toHaveText(['assets/logo.png', 'docs/home-screen.png', 'src/old.ts', 'web/App.tsx', 'web/components/Changes.tsx']);
  await expect(sheet.locator('.change-status')).toHaveText(['M', 'U', 'D', 'M', 'U']);

  await sheet.locator('.change-file', { hasText: 'App.tsx' }).click();
  await expect(sheet.locator('.diff [data-line=add]')).toHaveText(['+  const [changesFor, setChangesFor] = useState<string>();', '+  const [review, setReview] = useState(false);']);
  await expect(sheet.locator('.diff [data-line=del]')).toHaveText(['-  const [old, setOld] = useState();']);
  await sheet.locator('.change-file', { hasText: 'old.ts' }).click();
  await expect(sheet.locator('.diff')).toHaveCount(1);

  // Changed pictures show as pictures and open full screen; closing returns to the list.
  await sheet.locator('.change-file', { hasText: 'home-screen.png' }).click();
  const thumbnail = sheet.locator('.change-picture img');
  await expect(thumbnail).toHaveJSProperty('naturalWidth', 360);
  await sheet.locator('.change-picture').click();
  const viewer = page.locator('#picture-viewer');
  await expect(viewer.locator('.viewer-head strong')).toHaveText('home-screen.png');
  await expect(viewer.locator('img')).toHaveJSProperty('naturalWidth', 360);
  await expect(viewer.getByRole('link', { name: 'Save to phone' })).toHaveAttribute('download', 'home-screen.png');
  expect((await messages(page)).filter(message => message.type === 'picture').map(message => message.path))
    .toContain('/home/sam/projects/atlas/docs/home-screen.png');
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toBeHidden();
  await expect(sheet).toBeVisible();

  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('#connection')).toHaveText('Watching');
  const log = await messages(page);
  expect(log.filter(message => message.type === 'connect')).toHaveLength(1);
  expect(log.filter(message => ['resize', 'input', 'key'].includes(message.type))).toHaveLength(0);

  // A folder outside Git says so.
  await page.locator('#agent-switcher [data-pane="w2:p1"]').click();
  await page.locator('#pane-actions').click();
  await page.locator('#menu-changes').click();
  await expect(page.locator('#changes .sheet-error')).toHaveText('This folder is not a Git repository.');
});

test('home-screen shortcuts open the last pane, the agent that needs you, or New agent', async ({ page, request }) => {
  const launch = async (shortcut: string) => {
    await page.goto('about:blank'); // A fresh launch from the home screen.
    await page.goto(`/#open=${shortcut}`);
    await expect(page).toHaveURL('/');
  };
  await pair(page);
  await page.locator('#agent-switcher [data-pane="w2:p1"]').click();
  await expect(page.locator('#connection')).toHaveText('Watching');

  await launch('last');
  await expect(page.locator('#heading')).toHaveText('Second agent');
  await expect(page.locator('#connection')).toHaveText('Watching');

  // "Needs you" prefers an agent asking for input over one that finished.
  await request.post(fixtureUrl('/__test/status?pane=w2:p1&status=done'));
  await request.post(fixtureUrl('/__test/status?pane=w1:p1&status=blocked'));
  await launch('needs-you');
  await expect(page.locator('#heading')).toHaveText('First agent');
  await expect(page.locator('#connection')).toHaveText('Watching');
  await request.post(fixtureUrl('/__test/status?pane=w1:p1&status=idle'));
  await request.post(fixtureUrl('/__test/status?pane=w2:p1&status=working'));
  await launch('needs-you');
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();

  await launch('new-agent');
  await expect(page.locator('#create-sheet')).toBeVisible();
  await expect(page.locator('#new-workspace')).toHaveValue('w1');
  await page.keyboard.press('Escape');

  // An unknown shortcut is a plain launch: this tab's pane comes back watch-only, nothing more.
  await launch('control');
  await expect(page.locator('#heading')).toHaveText('First agent');
  await expect(page.locator('#connection')).toHaveText('Watching');
  await expect(page.locator('#control')).toHaveAccessibleName('Take control');
  expect((await messages(page)).filter(message => message.type === 'connect').every(message => message.control === false)).toBe(true);
});

test('terminal text can be read, copied and its picture paths opened, without touching the terminal', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page);
  await page.locator('#terminal-text').click();
  const text = page.locator('#terminal-text-sheet pre');
  await expect(text).toContainText('Whistle fixture w1:p1');
  await expect(text).toContainText('input>');

  await text.getByRole('button', { name: 'docs/home-screen.png' }).click();
  const viewer = page.locator('#picture-viewer');
  await expect(viewer.locator('img')).toHaveJSProperty('naturalWidth', 360);
  expect((await messages(page)).filter(message => message.type === 'picture').map(({ pane, path }) => ({ pane, path })))
    .toEqual([{ pane: 'w1:p1', path: 'docs/home-screen.png' }]);
  await viewer.getByRole('button', { name: 'Close' }).click();

  await page.locator('#copy-text').click();
  await expect(page.locator('#terminal-text-sheet [role=status]')).toHaveText('Copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split('\n').slice(0, 2)).toEqual(['Whistle fixture w1:p1', 'Saved screenshot to docs/home-screen.png']);
  expect(copied).toContain('\ninput>');
  expect(copied).not.toMatch(/ +\n/); // Trailing blanks are trimmed.

  await page.locator('#terminal-text-sheet').getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  const log = await messages(page);
  expect(log.filter(message => message.type === 'connect')).toHaveLength(1);
  expect(log.filter(message => ['resize', 'input', 'key'].includes(message.type))).toHaveLength(0);
});


test('drafts survive reload without input and are erased on pairing loss', async ({ page, context }) => {
  await control(page);
  await page.locator('#compose-toggle').click();
  await page.locator('#draft').fill('keep this /tmp/whistle-picture.png');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('whistle-draft:w1:p1'))).toContain('keep this');
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Watching');
  expect((await messages(page)).filter(message => message.type === 'input')).toEqual([]);
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.locator('#compose-toggle').click();
  await expect(page.locator('#draft')).toHaveValue('keep this /tmp/whistle-picture.png');
  await page.locator('#release').click();
  await context.clearCookies();
  await page.locator('#refresh').click();
  await expect(page.locator('#pair')).toBeVisible();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('whistle-draft:')))).toEqual([]);
});

test('expired drafts are removed and clearing a restored draft removes its key', async ({ page }) => {
  await pair(page);
  await page.evaluate(() => {
    localStorage.setItem('whistle-draft:w1:p1', JSON.stringify({ text: 'expired', savedAt: Date.now() - 8 * 86400000 }));
    localStorage.setItem('whistle-draft:w2:p1', JSON.stringify({ text: 'still here', savedAt: Date.now() }));
  });
  await page.reload();
  await expect(page.locator('#app')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('whistle-draft:w1:p1'))).toBeNull();
  await page.locator('#agent-switcher [data-pane="w2:p1"]').click();
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.locator('#compose-toggle').click();
  await expect(page.locator('#draft')).toHaveValue('still here');
  await page.locator('#clear-draft').click();
  expect(await page.evaluate(() => localStorage.getItem('whistle-draft:w2:p1'))).toBeNull();
});


test('pane previews render, truncate, update and poll only in the list', async ({ page }) => {
  let reads = 0;
  let line = 'Reading the fixture ' + 'x'.repeat(150);
  await page.route('**/api/previews', route => { reads++; return route.fulfill({ json: { 'w1:p1': line } }); });
  await pair(page);
  await expect(page.locator('#pane-list .pane-preview').first()).toHaveText(line.slice(0, 120));
  await openFromList();
  const previous = reads;
  await page.waitForTimeout(10500);
  expect(reads).toBe(previous);
  line = 'Finished fixture checks';
  await page.locator('#back').click();
  await expect(page.locator('#pane-list .pane-preview').first()).toHaveText(line);
  async function openFromList() {
    await page.locator('#agent-switcher [data-pane="w1:p1"]').click();
    await expect(page.locator('#connection')).toHaveText('Watching');
  }
});


async function terminalTouch(page: Page, type: string, y: number) {
  await page.locator('#terminal-viewport').evaluate((node, { type, y }) => {
    const touch = new Touch({ identifier: 1, target: node, clientY: y });
    node.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [touch], changedTouches: [touch], bubbles: true, cancelable: true }));
  }, { type, y });
}
async function flingUp(page: Page, advance = (ms: number) => page.waitForTimeout(ms)) {
  await terminalTouch(page, 'touchstart', 200);
  await advance(20);
  await terminalTouch(page, 'touchmove', 230);
  await advance(20);
  await terminalTouch(page, 'touchmove', 260);
  await terminalTouch(page, 'touchend', 260);
}

test('quick swipes glide locally, stop on touch and stop at the edge without PC history', async ({ page }) => {
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await control(page);
  const viewport = page.locator('#terminal-viewport');
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  await page.waitForTimeout(250);
  // Gesture speed must not depend on CI's browser/driver round-trip latency.
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const advance = (ms: number) => page.clock.runFor(ms);
  await flingUp(page, advance);
  const lifted = await viewport.evaluate(node => node.scrollTop);
  await advance(32);
  expect(await viewport.evaluate(node => node.scrollTop)).toBeLessThan(lifted - 10);
  await terminalTouch(page, 'touchstart', 260);
  const caught = await viewport.evaluate(node => node.scrollTop);
  await advance(120);
  expect(await viewport.evaluate(node => node.scrollTop)).toBeCloseTo(caught, 0);
  await terminalTouch(page, 'touchend', 260);
  await page.locator('#latest').click();
  await flingUp(page, advance);
  await advance(2000);
  expect(await viewport.evaluate(node => node.scrollTop)).toBe(0);
  expect((await messages(page)).filter(message => message.type === 'scroll')).toEqual([]);
  await terminalTouch(page, 'touchstart', 200);
  await terminalTouch(page, 'touchmove', 240);
  await terminalTouch(page, 'touchend', 240);
  await expect.poll(async () => (await messages(page)).filter(message => message.type === 'scroll').length).toBeGreaterThan(0);
});

test('slow drags stay one-to-one; reduced-motion swipes never glide or resize watch', async ({ page }) => {
  await open(page);
  const viewport = page.locator('#terminal-viewport');
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  const top = await viewport.evaluate(node => node.scrollTop);
  await terminalTouch(page, 'touchstart', 200);
  await page.waitForTimeout(150);
  await terminalTouch(page, 'touchmove', 220);
  await terminalTouch(page, 'touchend', 220);
  await page.waitForTimeout(150);
  expect(await viewport.evaluate(node => node.scrollTop)).toBeCloseTo(top - 20, 0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await flingUp(page);
  const lifted = await viewport.evaluate(node => node.scrollTop);
  await page.waitForTimeout(150);
  expect(await viewport.evaluate(node => node.scrollTop)).toBeCloseTo(lifted, 0);
  expect((await messages(page)).filter(message => ['resize', 'input', 'scroll'].includes(message.type))).toEqual([]);
});


test('history handle traverses all local scrollback, fades and never controls the PC', async ({ page }) => {
  await open(page);
  const viewport = page.locator('#terminal-viewport');
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  await page.request.post(fixtureUrl('/__test/history'));
  const handle = page.locator('#terminal-history');
  await expect(handle).toHaveAttribute('data-visible', 'true');
  const box = await handle.boundingBox();
  if (!box) throw new Error('No history track');
  await page.mouse.move(box.x + 22, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 22, box.y);
  await expect(handle).toHaveAttribute('aria-valuenow', '0');
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBe(0);
  await expect(page.locator('#terminal .xterm-rows')).toContainText('history 1');
  await page.mouse.move(box.x + 22, box.y + box.height);
  await expect(handle).toHaveAttribute('aria-valuenow', '100');
  await page.mouse.up();
  await expect(handle).toHaveAttribute('data-visible', 'false', { timeout: 3000 });
  expect((await messages(page)).filter(message => ['resize', 'input', 'scroll'].includes(message.type))).toEqual([]);
});


test('Latest appears while reading, returns to the input without focus or resize, and clears on switching', async ({ page }) => {
  await open(page);
  const viewport = page.locator('#terminal-viewport');
  const latest = page.locator('#latest');
  await expect.poll(() => viewport.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  await expect(latest).toBeHidden();
  const inputTop = await viewport.evaluate(node => node.scrollTop);
  const height = await viewport.evaluate(node => node.clientHeight);
  await viewport.hover();
  await page.mouse.wheel(0, -150);
  await expect(latest).toBeVisible();
  await latest.click();
  await expect(latest).toBeHidden();
  expect(await viewport.evaluate(node => node.scrollTop)).toBeCloseTo(inputTop, 0);
  expect(await viewport.evaluate(node => node.clientHeight)).toBe(height);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await flingUp(page);
  await expect(latest).toBeVisible();
  await latest.click();
  const caught = await viewport.evaluate(node => node.scrollTop);
  await page.waitForTimeout(150);
  expect(await viewport.evaluate(node => node.scrollTop)).toBeCloseTo(caught, 0);
  await flingUp(page);
  await page.locator('#agent-switcher [data-pane="w2:p1"]').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await expect(latest).toBeHidden();
  const switched = await viewport.evaluate(node => node.scrollTop);
  await page.waitForTimeout(200);
  expect(await viewport.evaluate(node => node.scrollTop)).toBeCloseTo(switched, 0);
  expect((await messages(page)).filter(message => ['resize', 'input', 'scroll'].includes(message.type))).toEqual([]);
});
