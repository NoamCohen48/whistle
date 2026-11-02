import { expect, test, type Page } from '@playwright/test';

// Fixture only: no real push service, agents or panes.
const fixtureUrl = (path: string) => `http://127.0.0.1:8792${path}`;
async function pair(page: Page) {
  await page.goto('/#pair=single-use-ticket');
  await expect(page.getByRole('heading', { name: 'Your herd' })).toBeVisible();
}

// Headless Chromium has no push service, so the page-side PushManager is replaced; the
// worker's own push handler is exercised separately through DevTools. The old headless shell
// reports granted notifications as denied, so this file runs on the full Chromium build.
test.use({ channel: 'chromium' });
test.beforeEach(async ({ request }) => { await request.post(fixtureUrl('/__test/reset')); });
test.skip(({ baseURL }) => baseURL?.includes(':5174') ?? false, 'Alerts need the production service worker');
// What the tests use of the service worker's global scope, which the page's types do not describe.
type Shown = { title: string; body: string; data: unknown; actions: { action: string; title: string }[]; close(): void };
type WorkerScope = { dispatchEvent(event: Event): boolean; registration: { getNotifications(filter?: { tag: string }): Promise<Shown[]> } };
async function fakePush(page: Page) {
  await page.context().grantPermissions(['notifications']);
  await page.addInitScript(() => {
    // Survives reloads like a real subscription; the key is kept to answer applicationServerKey.
    const saved = () => localStorage.getItem('fake-push-key');
    const fake = (key: number[]) => ({
      endpoint: 'https://fcm.googleapis.com/fcm/send/fixture', options: { applicationServerKey: new Uint8Array(key).buffer },
      toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/fixture', keys: { p256dh: 'BA', auth: 'AA' } }),
      unsubscribe: async () => { localStorage.removeItem('fake-push-key'); return true; },
    });
    PushManager.prototype.getSubscription = async function () {
      return (saved() ? fake(JSON.parse(saved()!)) : null) as PushSubscription | null;
    };
    PushManager.prototype.subscribe = async function (options?: PushSubscriptionOptionsInit) {
      localStorage.setItem('fake-push-key', JSON.stringify([...options!.applicationServerKey as Uint8Array]));
      return fake(JSON.parse(saved()!)) as unknown as PushSubscription;
    };
  });
}
const pushCalls = async (page: Page) => (await (await page.request.get(fixtureUrl('/__test/messages'))).json() as { type: string; method: string; path: string }[])
  .filter(message => message.type === 'push').map(({ method, path }) => `${method} ${path}`);

test('alerts can be turned on with a delivery check and turned off', async ({ page, request }) => {
  await fakePush(page);
  await pair(page);
  const bell = page.locator('#alerts');
  await expect(bell).toHaveAttribute('aria-label', 'Turn on alerts');
  await bell.click();
  await expect(bell).toHaveAttribute('aria-pressed', 'true');
  await expect(bell).toHaveAttribute('aria-label', 'Alerts on');
  expect(await pushCalls(page)).toEqual(['PUT /api/push', 'POST /api/push/test']);
  await page.reload();
  await expect(page.locator('#alerts')).toHaveAttribute('aria-pressed', 'true');

  // Once on, the bell opens this phone's alert settings, saved on the PC as they change.
  await page.locator('#alerts').click();
  const sheet = page.locator('#alerts-sheet');
  await expect(sheet.locator('#alert-finished')).toBeChecked();
  await sheet.locator('#alert-finished').uncheck();
  await sheet.locator('#alert-quiet').check();
  await sheet.locator('#quiet-start').fill('23:15');
  await expect(sheet.locator('#alerts-status')).toHaveText('Saved');
  const saved = async () => (await (await page.request.get(fixtureUrl('/__test/messages'))).json() as { type: string; settings: unknown }[])
    .filter(message => message.type === 'push-settings').map(message => message.settings);
  const timeZone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await expect.poll(async () => (await saved()).at(-1)).toEqual({ finished: false, quiet: { start: '23:15', end: '07:00', timeZone } });
  await sheet.getByRole('button', { name: 'Close' }).click();
  await page.locator('#alerts').click();
  await expect(sheet.locator('#alert-finished')).not.toBeChecked();
  await expect(sheet.locator('#quiet-start')).toHaveValue('23:15');
  await sheet.locator('#alert-quiet').uncheck();
  await expect.poll(async () => (await saved()).at(-1)).toEqual({ finished: false });

  await sheet.locator('#alerts-off').click();
  await expect(sheet).toBeHidden();
  await expect(page.locator('#alerts')).toHaveAttribute('aria-pressed', 'false');
  expect(await pushCalls(page)).toEqual(['PUT /api/push', 'POST /api/push/test', 'DELETE /api/push']);

  await request.post(fixtureUrl('/__test/fail-push'));
  await page.locator('#alerts').click();
  await expect(page.locator('#error')).toContainText('Could not reach the push service');
  // The bell is not hidden by the failure.
  await expect(page.locator('#alerts')).toBeVisible();
  // Alerts are offered on the pane list only, not over a terminal.
  await page.locator('#agent-switcher [data-pane="w1:p1"]').click();
  await expect(page.locator('#alerts')).toHaveCount(0);
});

test('the worker shows a pushed alert as a notification tagged by pane', async ({ page, context }) => {
  await context.grantPermissions(['notifications']);
  await pair(page);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  const cdp = await context.newCDPSession(page);
  const registration = new Promise<string>(resolve => cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
    const found = registrations.find(item => !item.isDeleted);
    if (found) resolve(found.registrationId);
  }));
  await cdp.send('ServiceWorker.enable');
  // On slow CI, DevTools occasionally drops a push to the worker. A repeat replaces the
  // notification with the same tag, so resending until it shows is safe.
  const shown = () => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications())
    .map(item => ({ title: item.title, body: item.body, tag: item.tag, silent: item.silent, data: item.data })));
  const pushUntilShown = (data: object, expected: object[]) => expect(async () => {
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(page.url()).origin, registrationId: await registration, data: JSON.stringify(data) });
    await expect.poll(shown, { timeout: 3000 }).toEqual(expected);
  }).toPass({ timeout: 15_000 });
  const reviewer = { title: 'Reviewer needs you', body: 'atlas · claude', tag: 'pane:w1:p1', silent: false, data: { paneId: 'w1:p1' } };
  await pushUntilShown({ title: 'Reviewer needs you', body: 'atlas · claude', paneId: 'w1:p1' }, [reviewer]);
  // During quiet hours the PC marks alerts quiet: shown, but silent.
  await pushUntilShown({ title: 'Builder finished', body: 'atlas · codex', paneId: 'w2:p1', quiet: true }, [
    reviewer, { title: 'Builder finished', body: 'atlas · codex', tag: 'pane:w2:p1', silent: true, data: { paneId: 'w2:p1' } }]);
  // Real notifications reach the desktop running the tests; close them rather than leave them behind.
  await page.evaluate(async () => { for (const item of await (await navigator.serviceWorker.ready).getNotifications()) item.close(); });
  await cdp.detach();
});

test('alerts carry quick replies as buttons that answer the agent without opening it', async ({ page, context, request }) => {
  await fakePush(page);
  await pair(page);
  const sent = async (type: string) => (await (await page.request.get(fixtureUrl('/__test/messages'))).json() as Record<string, unknown>[])
    .filter(message => message.type === type);
  // Turning alerts on gives the PC this phone's quick replies, and every change after that.
  await page.locator('#alerts').click();
  await expect(page.locator('#alerts')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await sent('push-replies')).at(-1)?.replies).toEqual(['Continue', 'Yes, go ahead', 'Run the tests and fix any failures']);
  await page.locator('#settings').click();
  await page.locator('#new-reply').fill('Ship it');
  await page.locator('#reply-form button[type=submit]').click();
  await expect.poll(async () => (await sent('push-replies')).at(-1)?.replies).toContain('Ship it');
  await page.locator('#settings-sheet').getByRole('button', { name: 'Close' }).click();

  // The buttons can be turned off; "off" is the only thing stored.
  await page.locator('#alerts').click();
  const sheet = page.locator('#alerts-sheet');
  await expect(sheet.locator('#alert-replies')).toBeChecked();
  await sheet.locator('#alert-replies').uncheck();
  await expect.poll(async () => (await sent('push-settings')).at(-1)?.settings).toEqual({ finished: true, replies: false });
  await sheet.locator('#alert-quiet').check();
  await expect.poll(async () => ((await sent('push-settings')).at(-1)?.settings as { replies?: boolean }).replies).toBe(false);
  await sheet.locator('#alert-replies').check();
  await expect.poll(async () => ((await sent('push-settings')).at(-1)?.settings as { replies?: boolean }).replies).toBeUndefined();
  await sheet.getByRole('button', { name: 'Close' }).click();

  // The worker shows the replies as buttons, and a tapped one is sent for that wait only.
  await request.get(fixtureUrl('/__test/status?pane=w1:p1&status=blocked'));
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const push = { title: 'Reviewer needs you', body: 'Apply the migration now?\natlas · claude', paneId: 'w1:p1', since: 5000, replies: ['Continue', 'Yes, go ahead', 'Ship it'] };
  const notification = await worker.evaluate(async alert => {
    const target = self as unknown as WorkerScope;
    // A push as the browser delivers it, with waitUntil telling when the alert is shown.
    await new Promise<void>(resolve => {
      target.dispatchEvent(Object.assign(new Event('push'), { data: { json: () => alert }, waitUntil: (promise: Promise<unknown>) => { void promise.then(() => resolve()); } }));
    });
    const [shown] = await target.registration.getNotifications({ tag: 'pane:w1:p1' });
    return { actions: shown.actions.map(action => [action.action, action.title]), data: shown.data };
  }, push);
  expect(notification.actions).toEqual([['reply:0', 'Continue'], ['reply:1', 'Yes, go ahead']]);
  expect(notification.data).toEqual({ paneId: 'w1:p1', since: 5000, replies: ['Continue', 'Yes, go ahead'] });
  const tap = (data: unknown, action: string) => worker.evaluate(({ data, action }) =>
    (self as unknown as { clicked(data: unknown, action: string): Promise<void> }).clicked(data, action), { data, action });
  await tap(notification.data, 'reply:1');
  expect(await sent('reply')).toEqual([{ type: 'reply', paneId: 'w1:p1', since: 5000, text: 'Yes, go ahead' }]);

  // Once the agent moved on, the PC refuses, and the phone says nothing was sent.
  await request.get(fixtureUrl('/__test/status?pane=w1:p1&status=working'));
  await tap(notification.data, 'reply:0');
  const refused = await worker.evaluate(async () => (await (self as unknown as WorkerScope).registration.getNotifications({ tag: 'pane:w1:p1' }))
    .map(item => ({ title: item.title, body: item.body, data: item.data })));
  expect(refused).toEqual([{ title: 'Not sent: Continue', body: 'The agent moved on since this alert. Nothing was sent. Tap to open the agent.', data: { paneId: 'w1:p1' } }]);
  expect(await sent('reply')).toHaveLength(1);
  await worker.evaluate(async () => { for (const item of await (self as unknown as WorkerScope).registration.getNotifications()) item.close(); });
});
