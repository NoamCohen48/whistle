import { expect, test, type Page } from '@playwright/test';

const fixture = 'http://127.0.0.1:8792';
async function pair(page: Page) {
  await page.goto('/#pair=single-use-ticket');
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
}
async function open(page: Page) {
  await pair(page);
  await page.locator('#agent-switcher [data-pane="w1:p1"]').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
}
const messages = async (page: Page) => (await page.request.get(`${fixture}/__test/messages`)).json() as Promise<{ type: string; control?: boolean; action?: string }[]>;
test.beforeEach(async ({ request }) => { await request.post(`${fixture}/__test/reset`); });

test('compose is only offered in control, keeps its draft across release, and clear is undoable', async ({ page }) => {
  await open(page);
  await expect(page.locator('#compose-toggle')).toBeHidden();
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.locator('#compose-toggle').click();
  await page.locator('#draft').fill('A long prompt');
  await page.locator('#clear-draft').click();
  await expect(page.locator('#draft')).toHaveValue('');
  await page.locator('#undo-clear').click();
  await expect(page.locator('#draft')).toHaveValue('A long prompt');
  await page.locator('#release').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await expect(page.locator('#compose')).toBeHidden();
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await expect(page.locator('#draft')).toHaveValue('A long prompt');
  expect((await messages(page)).filter(item => item.type === 'input')).toEqual([]);
});

test('a startup outage offers connection recovery rather than pairing instructions', async ({ page }) => {
  await open(page);
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.route('**/api/panes', route => route.fulfill({ status: 503, body: 'Herdr unavailable' }));
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Cannot reach your PC' })).toBeVisible();
  await expect(page.locator('#pair .steps')).toBeHidden();
  await expect(page.locator('#pair details')).toBeHidden();
  await page.unroute('**/api/panes');
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await expect(page.locator('#pane-info')).toHaveText('w1:p1');
  await expect(page.locator('#error')).toBeHidden();
  expect((await messages(page)).filter(item => item.type === 'input')).toEqual([]);
});

test('stale inventory is labelled and a successful retry clears the error', async ({ page }) => {
  await pair(page);
  await page.route('**/api/panes', route => route.fulfill({ status: 503, body: 'Herdr unavailable' }));
  await page.locator('#refresh').click();
  await expect(page.locator('#error')).toContainText('Herdr unavailable');
  await expect(page.locator('.inventory-freshness')).toContainText('Showing saved state');
  await expect(page.locator('#pane-list .pane')).toHaveCount(2);
  await page.locator('#error').getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.locator('.inventory-freshness')).toContainText('Showing saved state');
  await page.locator('#refresh').click();
  await expect(page.locator('#error')).toBeVisible();
  await page.unroute('**/api/panes');
  await page.locator('#error').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('.inventory-freshness')).toHaveCount(0);
});

test('successful creation with a failed refresh cannot be submitted a second time', async ({ page }) => {
  await pair(page);
  await page.locator('#new').click();
  await expect(page.locator('#create-submit')).toBeEnabled();
  let created = false;
  let finish = () => {};
  const reply = new Promise<void>(resolve => { finish = resolve; });
  await page.route('**/api/actions', async route => { const response = await route.fetch(); created = true; await reply; await route.fulfill({ response }); });
  await page.route('**/api/panes', route => created ? route.fulfill({ status: 503, body: 'Inventory unavailable' }) : route.continue());
  await page.locator('#create-submit').click();
  await expect(page.locator('#create-submit')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#create-sheet')).toBeVisible();
  finish();
  await expect(page.locator('#create-sheet')).toBeHidden();
  await expect(page.locator('#error')).toContainText('Created successfully');
  expect((await messages(page)).filter(item => item.type === 'action' && item.action === 'agent')).toHaveLength(1);
  await page.unroute('**/api/panes');
  await page.locator('#error').getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.locator('#pane-list .pane')).toHaveCount(3);
  expect((await messages(page)).filter(item => item.type === 'action' && item.action === 'agent')).toHaveLength(1);
});

test('silent streams reconnect watch-only without replaying input', async ({ page }) => {
  // Installed before the app loads, so its heartbeat runs on the test clock rather than a real 5 s timer.
  await page.clock.install();
  await open(page);
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.request.post(`${fixture}/__test/silent`);
  await page.clock.runFor(31_000);
  await expect(page.locator('#connection')).toHaveText('Watching');
  const events = await messages(page);
  expect(events.filter(item => item.type === 'connect').at(-1)?.control).toBe(false);
  expect(events.filter(item => item.type === 'input')).toEqual([]);
  await expect(page.locator('#error')).toContainText('stopped responding');
});

test('dashboard supports status filters, pins, shortened paths, and persistent workspace collapse', async ({ page }) => {
  await pair(page);
  await expect(page.locator('#pane-list .cwd').first()).toHaveText('~/projects/atlas');
  await page.getByRole('button', { name: 'Pin First agent', exact: true }).click();
  await expect(page.locator('#pinned-panes .pane')).toHaveCount(1);
  await page.getByRole('group', { name: 'Filter panes' }).getByRole('button', { name: 'Working' }).click();
  await expect(page.locator('#search-results .pane')).toHaveCount(1);
  await expect(page.locator('#search-results')).toContainText('Second agent');
  await page.getByRole('group', { name: 'Filter panes' }).getByRole('button', { name: 'All' }).click();
  await page.locator('[data-workspace="w1"] > h2 button').click();
  await expect(page.locator('[data-workspace="w1"] > .pane-list')).toBeHidden();
  await page.reload();
  await expect(page.locator('#pinned-panes .pane')).toHaveCount(1);
  await expect(page.locator('[data-workspace="w1"] > h2 button')).toHaveAttribute('aria-expanded', 'false');
});

test('text sizing persists without controlling or resizing the PC, and text can be searched', async ({ page }) => {
  await open(page);
  await page.locator('#text-size').click();
  await page.getByRole('button', { name: 'Larger terminal text' }).click();
  await expect(page.locator('.font-stepper output')).toHaveText('14px');
  await page.locator('#text-size-sheet .sheet-head button').click();
  expect((await messages(page)).filter(item => item.type === 'resize')).toEqual([]);
  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await page.locator('#text-size').click();
  await expect(page.locator('.font-stepper output')).toHaveText('14px');
  await page.locator('#text-size-sheet .sheet-head button').click();
  await page.locator('#terminal-text').click();
  await page.locator('#terminal-search').fill('row');
  await expect(page.locator('#terminal-text-body mark').first()).toHaveText('row');
  await page.getByRole('button', { name: 'Next match', exact: true }).click();
  await expect(page.locator('#terminal-text-sheet')).toContainText('2 of');
  await page.locator('#terminal-search').fill('not present here');
  await expect(page.locator('#terminal-text-sheet')).toContainText('No matches');
  expect((await messages(page)).filter(item => ['input', 'resize'].includes(item.type))).toEqual([]);
});

test('recent prompts restore locally and never auto-send', async ({ page }) => {
  await open(page);
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.locator('#compose-toggle').click();
  await page.locator('#draft').fill('A reusable prompt');
  await page.locator('#submit').click();
  await expect(page.locator('#draft')).toHaveValue('A reusable prompt');
  await page.locator('#clear-draft').click();
  await page.locator('.prompt-history summary').click();
  await page.locator('.prompt-history li button').click();
  await expect(page.locator('#draft')).toHaveValue('A reusable prompt');
  expect((await messages(page)).filter(item => item.type === 'input')).toHaveLength(1);
});

test('device revocation is confirmed and current-browser revocation returns to pairing', async ({ page }) => {
  await pair(page);
  await page.locator('#settings').click();
  await expect(page.locator('.device-list li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Revoke Old phone', exact: true }).click();
  expect((await messages(page)).filter(item => item.type === 'revoke')).toHaveLength(0);
  await page.locator('#revoke-confirm').click();
  await expect(page.locator('.device-list li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Revoke Fixture browser', exact: true }).click();
  await page.locator('#revoke-confirm').click();
  await expect(page.getByRole('heading', { name: 'Pair this phone' })).toBeVisible();
  await expect(page.locator('#settings-sheet')).toBeHidden();
});

test('read timeouts recover without asking for pairing or hanging indefinitely', async ({ page }) => {
  await pair(page);
  await page.route('**/api/panes', () => { /* Simulate a PC that accepts a request but never replies. */ });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connecting to your PC' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cannot reach your PC' })).toBeVisible({ timeout: 16_000 });
  await expect(page.locator('#pair-error')).toContainText('did not reply in time');
  await page.unroute('**/api/panes');
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
  await expect(page.locator('#error')).toBeHidden();
});

test('draft storage denial keeps editing usable and reports memory-only saving honestly', async ({ page }) => {
  await page.addInitScript(() => {
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      return write.call(this, key, value);
    };
  });
  await open(page);
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.locator('#compose-toggle').click();
  await page.locator('#draft').fill('Keep this in memory');
  await expect(page.locator('.compose-meta')).toContainText('browser storage is unavailable');
  await page.locator('#compose-toggle').click();
  await page.locator('#compose-toggle').click();
  await expect(page.locator('#draft')).toHaveValue('Keep this in memory');
  expect((await messages(page)).filter(item => item.type === 'input')).toEqual([]);
});

test('empty inventory offers a project action and changes has a direct read-only shortcut', async ({ page }) => {
  await open(page);
  await page.locator('#review-changes').click();
  await expect(page.locator('#changes')).toBeVisible();
  await expect(page.locator('.change-file')).toHaveCount(5);
  expect((await messages(page)).filter(item => ['input', 'resize'].includes(item.type))).toEqual([]);
  await page.locator('#changes .sheet-head button').click();
  await page.locator('#back').click();
  await page.request.post(`${fixture}/__test/empty`);
  await page.locator('#refresh').click();
  await expect(page.getByRole('button', { name: 'Open a project', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open a project', exact: true }).click();
  await expect(page.locator('#new-folder')).toBeVisible();
});

test('while controlling, Release is in the header and view options are in the pane menu', async ({ page }) => {
  await open(page);
  await expect(page.locator('#release')).toHaveCount(0);
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await expect(page.locator('.session-bar')).toBeHidden();
  await expect(page.locator('#refresh')).toHaveCount(0);
  await page.locator('#pane-actions').click();
  await expect(page.locator('#menu-width')).toHaveText('Use the PC’s width');
  await page.locator('#menu-text-size').click();
  await expect(page.locator('#text-size-sheet')).toBeVisible();
  await page.locator('#text-size-sheet .sheet-head button').click();
  await page.locator('#release').click();
  await expect(page.locator('#connection')).toHaveText('Watching');
  await expect(page.locator('.session-bar')).toBeVisible();
  await page.locator('#pane-actions').click();
  await expect(page.locator('#menu-width')).toHaveCount(0);
});

test('Compose and Keys are never open at the same time', async ({ page }) => {
  await open(page);
  await page.locator('#control').click();
  await expect(page.locator('#connection')).toHaveText('Controlling');
  await page.locator('#compose-toggle').click();
  await expect(page.locator('#compose')).toBeVisible();
  await page.locator('#more-keys').click();
  await expect(page.locator('#more-keys')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#compose')).toBeHidden();
  await page.locator('#compose-toggle').click();
  await expect(page.locator('#compose')).toBeVisible();
  await expect(page.locator('#more-keys')).toHaveAttribute('aria-expanded', 'false');
});

test('a long press on a dashboard row opens that pane’s menu without opening the pane', async ({ page }) => {
  await pair(page);
  const row = page.locator('#pane-list .pane', { hasText: 'First agent' });
  await row.dispatchEvent('contextmenu');
  await expect(page.locator('#pane-menu')).toBeVisible();
  await expect(page.locator('#pane-menu h2')).toHaveText('First agent');
  await expect(page.locator('#menu-terminal-text')).toHaveCount(0);
  await expect(page.locator('#menu-changes')).toHaveCount(0);
  await expect(page.locator('#session')).toBeHidden();
  await page.locator('#menu-close-pane').click();
  await page.locator('#confirm-destructive').click();
  await expect(page.locator('#pane-menu')).toBeHidden();
  await expect(page.locator('#pane-list .pane', { hasText: 'First agent' })).toHaveCount(0);
  await expect(page.locator('#pane-list .pane', { hasText: 'Second agent' })).toHaveCount(1);
  expect((await messages(page)).filter(item => item.type === 'connect')).toEqual([]);
});
