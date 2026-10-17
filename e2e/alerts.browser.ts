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
  await page.locator('#alerts').click();
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
  await cdp.send('ServiceWorker.deliverPushMessage', {
    origin: new URL(page.url()).origin, registrationId: await registration,
    data: JSON.stringify({ title: 'Reviewer needs you', body: 'tap · claude', paneId: 'w1:p1' }),
  });
  await expect.poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications())
    .map(item => ({ title: item.title, body: item.body, tag: item.tag, data: item.data })))).toEqual([
    { title: 'Reviewer needs you', body: 'tap · claude', tag: 'pane:w1:p1', data: { paneId: 'w1:p1' } }]);
  await cdp.detach();
});
