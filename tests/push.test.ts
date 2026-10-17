import { expect, test } from 'bun:test';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, verify } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Snapshot } from '../src/herdr.ts';
import { startHost, testToken } from './helpers/host.ts';
import { AgentWatcher, PushGone, PushStore, VapidKeys, encrypt, isQuiet, parseSettings, parseSubscription, webPushSender, type Alert } from '../src/push.ts';

const unb64 = (value: string) => Buffer.from(value.replace(/\s+/g, ''), 'base64url');

test('encryption matches the RFC 8291 example message byte for byte', () => {
  const body = encrypt(Buffer.from('When I grow up, I want to be a watermelon'), {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  }, { salt: unb64('DGv6ra1nlYgDCS1FRnbzlw'), senderPrivate: unb64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw') });
  expect(body.toString('base64url')).toBe(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
    mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
    pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`.replace(/\s+/g, ''));
});

test('subscriptions are limited to browser push services with well-formed keys', () => {
  const keys = { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') };
  expect(parseSubscription({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys, extra: 1 }))
    .toEqual({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys });
  expect(parseSubscription({ endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/x', keys }).endpoint).toContain('mozilla');
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://fcm.googleapis.com.evil.test/x',
    'https://evil.test/fcm.googleapis.com', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'file:///etc/passwd']) {
    expect(() => parseSubscription({ endpoint, keys })).toThrow();
  }
  expect(() => parseSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { ...keys, auth: 'AAAA' } })).toThrow('keys');
  expect(() => parseSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { ...keys, p256dh: keys.auth } })).toThrow('keys');
  expect(() => parseSubscription(null)).toThrow();
});

test('sender signs VAPID, encrypts for the receiver and reports expired subscriptions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-push-'));
  try {
    const keys = new VapidKeys(join(directory, 'push-vapid.json'), 'https://pc.example.ts.net');
    expect((await stat(join(directory, 'push-vapid.json'))).mode & 0o777).toBe(0o600);
    expect(new VapidKeys(join(directory, 'push-vapid.json'), 'x').publicKey).toBe(keys.publicKey); // Stable across restarts.
    const store = new PushStore(join(directory, 'push.sqlite'));
    const receiver = createECDH('prime256v1'); receiver.generateKeys();
    const auth = Buffer.alloc(16, 7);
    store.save('device-1', { endpoint: 'https://fcm.googleapis.com/fcm/send/token', keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } });
    const requests: { url: string; init: RequestInit }[] = [];
    let status = 201;
    const send = webPushSender(store, keys, (async (url: string, init: RequestInit) => { requests.push({ url, init }); return new Response(null, { status }); }) as typeof fetch);
    const alert: Alert = { title: 'Reviewer needs you', body: 'tap · claude', paneId: 'w1:p1' };
    await send('device-1', alert);

    const { url, init } = requests[0];
    expect(url).toBe('https://fcm.googleapis.com/fcm/send/token');
    const headers = init.headers as Record<string, string>;
    expect(headers).toMatchObject({ 'Content-Encoding': 'aes128gcm', TTL: '3600', Urgency: 'high' });
    expect(headers.Topic).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const [, jwt, publicKey] = /^vapid t=([^,]+), k=(.+)$/.exec(headers.Authorization)!;
    expect(publicKey).toBe(keys.publicKey);
    const [header, claims, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'https://pc.example.ts.net' });
    const raw = Buffer.from(publicKey, 'base64url');
    const jwk = { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') };
    expect(verify('sha256', Buffer.from(`${header}.${claims}`), { key: createPublicKey({ key: jwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'))).toBe(true);

    // Decrypt as the browser would (RFC 8291 receiver side).
    const body = Buffer.from(init.body as Uint8Array);
    const salt = body.subarray(0, 16), sender = body.subarray(21, 21 + body[20]), sealed = body.subarray(21 + body[20]);
    const secret = receiver.computeSecret(sender);
    const ikm = Buffer.from(hkdfSync('sha256', secret, auth, Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), sender]), 32));
    const decipher = createDecipheriv('aes-128-gcm', Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)),
      Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)));
    decipher.setAuthTag(sealed.subarray(-16));
    const plain = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
    expect(plain.at(-1)).toBe(2);
    expect(JSON.parse(plain.subarray(0, -1).toString())).toEqual(alert);

    status = 410;
    await expect(send('device-1', alert)).rejects.toBeInstanceOf(PushGone);
    status = 500;
    await expect(send('device-1', alert)).rejects.toThrow('500');
    await expect(send('device-2', alert)).rejects.toBeInstanceOf(PushGone);
    store.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('watcher alerts once per change into blocked/done and skips watchers, revoked and gone devices', async () => {
  const pane = (pane_id: string, agent_status: string, extra = {}) =>
    ({ pane_id, terminal_id: `t-${pane_id}`, workspace_id: 'w1', tab_id: 't', agent: 'claude', agent_status, ...extra });
  let state: Snapshot = { workspaces: [{ workspace_id: 'w1', label: 'tap' }], tabs: [], panes: [
    pane('w1:p1', 'working', { label: 'Reviewer' }), pane('w1:p2', 'blocked'), pane('w1:p3', 'working'), { ...pane('w1:p4', 'working'), agent: undefined },
  ] };
  const sent: [string, Alert][] = [];
  const gone: string[] = [];
  let subscribers = ['phone', 'tablet', 'revoked'];
  const watcher = new AgentWatcher({
    snapshot: async () => state, subscribers: () => subscribers,
    send: async (deviceId, alert) => { if (deviceId === 'tablet' && alert.paneId === 'w1:p3') throw new PushGone('gone'); sent.push([deviceId, alert]); },
    isActive: deviceId => deviceId !== 'revoked', isWatching: (deviceId, paneId) => deviceId === 'tablet' && paneId === 'w1:p1',
    onGone: deviceId => { gone.push(deviceId); subscribers = subscribers.filter(item => item !== deviceId); },
  });
  await watcher.tick(); // Baseline: p2 was already blocked, so nothing fires.
  expect(sent).toEqual([]);
  state = { ...state, panes: [pane('w1:p1', 'blocked', { label: 'Reviewer' }), pane('w1:p2', 'blocked'), pane('w1:p3', 'done'),
    { ...pane('w1:p4', 'done'), agent: undefined }, pane('w1:p5', 'blocked')] };
  await watcher.tick();
  expect(sent).toEqual([
    ['phone', { title: 'Reviewer needs you', body: 'tap · claude', paneId: 'w1:p1' }],
    ['phone', { title: 'claude finished', body: 'tap · claude', paneId: 'w1:p3' }],
  ]); // The tablet is watching p1, its p3 push expired; new pane p5 and shell p4 never alert.
  expect(gone.sort()).toEqual(['revoked', 'tablet']);
  await watcher.tick();
  expect(sent).toHaveLength(2); // Still waiting: no repeat.
  state = { ...state, panes: state.panes.map(item => item.pane_id === 'w1:p1' ? { ...item, agent_status: 'working' } : item) };
  await watcher.tick();
  state = { ...state, panes: state.panes.map(item => item.pane_id === 'w1:p1' ? { ...item, agent_status: 'done' } : item) };
  await watcher.tick();
  expect(sent.at(-1)).toEqual(['phone', { title: 'Reviewer finished', body: 'tap · claude', paneId: 'w1:p1' }]);
});

test('push API: paired devices only, same-origin writes, and revocation drops the subscription', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-push-api-'));
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  try {
    host = await startHost(directory, { HERDR_SOCKET_PATH: join(directory, 'missing.sock') });
    expect((await host.request('/api/push')).status).toBe(401);
    const login = async () => (await host!.request('/api/login', { method: 'POST', body: JSON.stringify({ token: testToken }) }))
      .headers.get('set-cookie')!.split(';')[0];
    const [phone, laptop] = [await login(), await login()];
    const status = await (await host.request('/api/push', { headers: { Cookie: phone } })).json();
    expect(status.subscribed).toBe(false);
    expect(Buffer.from(status.publicKey, 'base64url')).toHaveLength(65);
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: {
      p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') } };
    const put = (body: unknown, extra: Record<string, string> = {}) =>
      host!.request('/api/push', { method: 'PUT', headers: { Cookie: phone, ...extra }, body: JSON.stringify(body) });
    expect((await put(subscription, { Origin: 'https://evil.invalid' })).status).toBe(403);
    expect((await put({ ...subscription, endpoint: 'https://127.0.0.1:8790/api/actions' })).status).toBe(400);
    const settings = (body: unknown, extra: Record<string, string> = {}) =>
      host!.request('/api/push/settings', { method: 'PUT', headers: { Cookie: phone, ...extra }, body: JSON.stringify(body) });
    const quiet = { finished: false, quiet: { start: '22:00', end: '07:00', timeZone: 'Europe/Berlin' } };
    expect((await settings(quiet)).status).toBe(409); // Not subscribed yet.
    expect((await put(subscription)).status).toBe(200);
    expect((await settings(quiet, { Origin: 'https://evil.invalid' })).status).toBe(403);
    expect((await settings({ finished: 'no' })).status).toBe(400);
    expect((await settings(quiet)).status).toBe(200);
    expect((await (await host.request('/api/push', { headers: { Cookie: phone } })).json()).settings).toEqual(quiet);
    expect((await (await host.request('/api/push', { headers: { Cookie: laptop } })).json()).settings).toEqual({ finished: true });
    expect((await (await host.request('/api/push', { headers: { Cookie: phone } })).json()).subscribed).toBe(true);
    expect((await (await host.request('/api/push', { headers: { Cookie: laptop } })).json()).subscribed).toBe(false);
    expect((await host.request('/api/push', { method: 'DELETE', headers: { Cookie: phone } })).status).toBe(200);
    expect((await (await host.request('/api/push', { headers: { Cookie: phone } })).json()).subscribed).toBe(false);

    expect((await put(subscription)).status).toBe(200);
    const listed = await (await host.request('/api/devices', { headers: { Cookie: laptop } })).json();
    const phoneId = listed.devices.find((device: { current: boolean }) => !device.current).id;
    expect((await host.request(`/api/devices/${phoneId}`, { method: 'DELETE', headers: { Cookie: laptop } })).status).toBe(200);
    await host.stop(); host = undefined;
    const store = new PushStore(join(directory, '.runtime', 'push.sqlite'));
    expect(store.all()).toEqual([]);
    store.close();
    expect((await stat(join(directory, '.runtime', 'push-vapid.json'))).mode & 0o777).toBe(0o600);
  } finally {
    await host?.stop();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

test('alert settings: validation, overnight quiet hours in the phone time zone', () => {
  expect(parseSettings({ finished: false })).toEqual({ finished: false });
  const quiet = parseSettings({ finished: true, quiet: { start: '22:00', end: '07:30', timeZone: 'Asia/Jerusalem' }, extra: 1 });
  expect(quiet).toEqual({ finished: true, quiet: { start: '22:00', end: '07:30', timeZone: 'Asia/Jerusalem' } });
  for (const bad of [null, {}, { finished: 'yes' }, { finished: true, quiet: { start: '24:00', end: '07:00', timeZone: 'UTC' } },
    { finished: true, quiet: { start: '9:00', end: '07:00', timeZone: 'UTC' } }, { finished: true, quiet: { start: '07:00', end: '07:00', timeZone: 'UTC' } },
    { finished: true, quiet: { start: '22:00', end: '07:00', timeZone: 'Mars/Olympus' } }]) {
    expect(() => parseSettings(bad)).toThrow();
  }
  // 21:59 and 07:30 are outside; 22:00, 03:00 and 07:29 are inside (Jerusalem is UTC+3 in October).
  const at = (utc: string) => isQuiet(quiet, new Date(`2026-10-17T${utc}:00Z`));
  expect([at('18:59'), at('19:00'), at('00:00'), at('04:29'), at('04:30')]).toEqual([false, true, true, true, false]);
  const daytime = parseSettings({ finished: true, quiet: { start: '09:00', end: '17:00', timeZone: 'UTC' } });
  expect([isQuiet(daytime, new Date('2026-10-17T08:59:00Z')), isQuiet(daytime, new Date('2026-10-17T12:00:00Z'))]).toEqual([false, true]);
  expect(isQuiet({ finished: true })).toBe(false);
});

test('settings survive re-subscribing, older databases are migrated, and the watcher applies them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whistle-push-settings-'));
  try {
    const path = join(directory, 'push.sqlite');
    const { Database } = await import('bun:sqlite');
    const old = new Database(path);
    old.exec(`CREATE TABLE subscriptions (device_id TEXT PRIMARY KEY, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL);
      INSERT INTO subscriptions VALUES ('phone', 'https://fcm.googleapis.com/x', 'k', 'a', 1)`);
    old.close();
    const store = new PushStore(path);
    expect(store.settings('phone')).toEqual({ finished: true });
    const settings = parseSettings({ finished: false, quiet: { start: '22:00', end: '07:00', timeZone: 'UTC' } });
    expect(store.saveSettings('phone', settings)).toBe(true);
    expect(store.saveSettings('stranger', settings)).toBe(false);
    store.save('phone', { endpoint: 'https://fcm.googleapis.com/y', keys: { p256dh: 'k2', auth: 'a2' } });
    expect(store.settings('phone')).toEqual(settings);
    expect(store.get('phone')?.endpoint).toBe('https://fcm.googleapis.com/y');

    const panes = (status: string) => ({ workspaces: [{ workspace_id: 'w1', label: 'tap' }], tabs: [], panes: [
      { pane_id: 'w1:p1', terminal_id: 't1', workspace_id: 'w1', tab_id: 'a', agent: 'claude', agent_status: status },
      { pane_id: 'w1:p2', terminal_id: 't2', workspace_id: 'w1', tab_id: 'b', agent: 'codex', agent_status: status === 'working' ? 'working' : 'done' },
    ] }) as Snapshot;
    let state = panes('working');
    let now = new Date('2026-10-17T23:00:00Z');
    const sent: [string, Alert][] = [];
    const watcher = new AgentWatcher({
      snapshot: async () => state, subscribers: () => ['phone', 'tablet'], send: async (deviceId, alert) => { sent.push([deviceId, alert]); },
      isActive: () => true, isWatching: () => false, onGone: () => {}, now: () => now,
      settings: deviceId => deviceId === 'phone' ? store.settings('phone') : { finished: true },
    });
    await watcher.tick();
    state = panes('blocked');
    await watcher.tick();
    // The phone skips "finished" and gets a quiet "needs you" at night; the tablet gets both, with sound.
    expect(sent).toEqual([
      ['phone', { title: 'claude needs you', body: 'tap · claude', paneId: 'w1:p1', quiet: true }],
      ['tablet', { title: 'claude needs you', body: 'tap · claude', paneId: 'w1:p1' }],
      ['tablet', { title: 'codex finished', body: 'tap · codex', paneId: 'w1:p2' }],
    ]);
    sent.length = 0; now = new Date('2026-10-17T12:00:00Z');
    state = panes('working'); await watcher.tick();
    state = panes('blocked'); await watcher.tick();
    expect(sent[0]).toEqual(['phone', { title: 'claude needs you', body: 'tap · claude', paneId: 'w1:p1' }]);
    store.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
