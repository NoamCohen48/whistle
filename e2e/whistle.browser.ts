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
  await page.locator('#new-folder').fill('~/Work/site');
  await page.locator('#create-submit').click();
  await expect(page.locator('#pane-info')).toHaveText('wn3:n4');
  await expect(page.locator('#heading + small')).toContainText('site');
  expect(await actions(page)).toEqual([
    { action: 'agent', workspaceId: 'w1', kind: 'claude' },
    { action: 'terminal', workspaceId: 'w1' },
    { action: 'workspace', cwd: 'relative' },
    { action: 'workspace', cwd: '~/Work/site' },
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
  await page.locator('.worktree-choice', { hasText: 'explorer' }).click();
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
    { action: 'worktree-open', workspaceId: 'w1', path: '/tap-worktrees/docs' },
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
  await expect(page.locator('#needs-you')).toContainText('app-explorer');
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

test('new workspaces can start from the folder beside open projects', async ({ page }) => {
  await pair(page);
  await page.locator('#new').click();
  await page.locator('[data-kind="workspace"]').click();
  // Herdr-managed worktree checkouts are not offered as project folders.
  await expect(page.locator('.folder-chips button')).toHaveText(['~/Work/']);
  await page.locator('.folder-chips button').click();
  await expect(page.locator('#new-folder')).toHaveValue('/home/dev/Work/');
  await expect(page.locator('#new-folder')).toBeFocused();
  await page.keyboard.type('site');
  await page.locator('#create-submit').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  expect(await actions(page)).toEqual([{ action: 'workspace', cwd: '/home/dev/Work/site' }]);
});
