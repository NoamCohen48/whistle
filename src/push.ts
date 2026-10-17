import { Database } from 'bun:sqlite';
import { createCipheriv, createECDH, createHash, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Pane, Snapshot } from './herdr.ts';

// "Needs you" alerts over standard Web Push (RFC 8030/8291/8292). The PC polls Herdr and,
// when an agent turns blocked or done, sends an end-to-end encrypted message through the
// browser vendor's push service. The push service sees only ciphertext, the endpoint and timing.

export interface PushSubscriptionInput { endpoint: string; keys: { p256dh: string; auth: string } }
export interface Alert { title: string; body: string; paneId: string }

const b64 = (value: Buffer | Uint8Array) => Buffer.from(value).toString('base64url');
const unb64 = (value: string) => Buffer.from(value, 'base64url');

// Only the browser vendors' push services: a subscription must never turn the PC into a
// request proxy for arbitrary URLs on the tailnet or the local machine.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
export function parseSubscription(input: unknown): PushSubscriptionInput {
  const body = input as Partial<PushSubscriptionInput> | null;
  if (!body || typeof body !== 'object' || typeof body.endpoint !== 'string' || body.endpoint.length > 1024) throw new Error('Invalid subscription');
  let url: URL;
  try { url = new URL(body.endpoint); } catch { throw new Error('Invalid subscription'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !PUSH_HOSTS.some(host => host.test(url.hostname))) {
    throw new Error('Unsupported push service');
  }
  const { p256dh, auth } = body.keys || {} as PushSubscriptionInput['keys'];
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !/^[A-Za-z0-9_-]+$/.test(p256dh + auth)
    || unb64(p256dh).length !== 65 || unb64(p256dh)[0] !== 4 || unb64(auth).length !== 16) throw new Error('Invalid subscription keys');
  return { endpoint: url.href, keys: { p256dh, auth } };
}

// RFC 8291 aes128gcm, one record. `salt` and `senderPrivate` are injectable only for test vectors.
export function encrypt(plaintext: Buffer, subscription: PushSubscriptionInput['keys'],
  { salt = randomBytes(16), senderPrivate }: { salt?: Buffer; senderPrivate?: Buffer } = {}) {
  const sender = createECDH('prime256v1');
  if (senderPrivate) sender.setPrivateKey(senderPrivate); else sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const receiverPublic = unb64(subscription.p256dh);
  const secret = sender.computeSecret(receiverPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublic, senderPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, unb64(subscription.auth), keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = senderPublic.length;
  return Buffer.concat([header, senderPublic, sealed]);
}

// VAPID application-server key: created once, private half stays in the state directory (0600).
export class VapidKeys {
  readonly publicKey: string;
  private readonly privateKey: KeyObject;
  constructor(path: string, private readonly subject: string) {
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      writeFileSync(path, JSON.stringify(privateKey.export({ format: 'jwk' })), { mode: 0o600, flag: 'wx' });
    }
    chmodSync(path, 0o600);
    const jwk = JSON.parse(readFileSync(path, 'utf8'));
    this.privateKey = createPrivateKey({ key: jwk, format: 'jwk' });
    this.publicKey = b64(Buffer.concat([Buffer.from([4]), unb64(jwk.x), unb64(jwk.y)]));
  }
  authorization(endpoint: string, now = Date.now()) {
    const header = b64(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
    const claims = b64(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: this.subject })));
    const signature = sign('sha256', Buffer.from(`${header}.${claims}`), { key: this.privateKey, dsaEncoding: 'ieee-p1363' });
    return `vapid t=${header}.${claims}.${b64(signature)}, k=${this.publicKey}`;
  }
}

export class PushStore {
  private readonly db: Database;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    closeSync(openSync(path, 'a', 0o600));
    chmodSync(path, 0o600);
    this.db = new Database(path, { strict: true });
    this.db.exec(`PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS subscriptions (
      device_id TEXT PRIMARY KEY, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  }
  save(deviceId: string, subscription: PushSubscriptionInput) {
    this.db.query('INSERT OR REPLACE INTO subscriptions VALUES (?, ?, ?, ?, ?)')
      .run(deviceId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, Date.now());
  }
  get(deviceId: string): PushSubscriptionInput | undefined {
    const row = this.db.query<{ endpoint: string; p256dh: string; auth: string }, [string]>(
      'SELECT endpoint, p256dh, auth FROM subscriptions WHERE device_id=?').get(deviceId);
    return row ? { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } } : undefined;
  }
  all() { return this.db.query<{ deviceId: string }, []>('SELECT device_id AS deviceId FROM subscriptions').all().map(row => row.deviceId); }
  remove(deviceId: string) { this.db.query('DELETE FROM subscriptions WHERE device_id=?').run(deviceId); }
  close() { this.db.close(); }
}

export type Sender = (deviceId: string, alert: Alert) => Promise<void>;
export class PushGone extends Error {}
export function webPushSender(store: PushStore, keys: VapidKeys, request: typeof fetch = fetch): Sender {
  return async (deviceId, alert) => {
    const subscription = store.get(deviceId);
    if (!subscription) throw new PushGone('Not subscribed');
    // Topic collapses undelivered alerts for the same pane into the newest one.
    const topic = createHash('sha256').update(alert.paneId).digest('base64url').slice(0, 32);
    const response = await request(subscription.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: keys.authorization(subscription.endpoint), 'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high', Topic: topic },
      body: encrypt(Buffer.from(JSON.stringify(alert)), subscription.keys),
    });
    if (response.status === 404 || response.status === 410) throw new PushGone('Subscription expired');
    if (!response.ok) throw new Error(`Push service answered ${response.status}`);
  };
}

const waiting = (pane: Pane) => pane.agent && (pane.agent_status === 'blocked' || pane.agent_status === 'done') ? pane.agent_status : undefined;
export function alertFor(state: Snapshot, pane: Pane): Alert {
  const name = pane.label || pane.terminal_title_stripped || pane.agent || pane.pane_id;
  const workspace = state.workspaces.find(item => item.workspace_id === pane.workspace_id);
  return {
    title: waiting(pane) === 'blocked' ? `${name} needs you` : `${name} finished`,
    body: [workspace?.label || workspace?.name, pane.agent].filter(Boolean).join(' · '),
    paneId: pane.pane_id,
  };
}

// Edge-triggered: an alert fires when a known agent changes into blocked/done, never for
// panes already waiting when the watcher starts, and never twice for the same wait.
export class AgentWatcher {
  private previous?: Map<string, string | undefined>;
  constructor(private readonly options: {
    snapshot: () => Promise<Snapshot>; subscribers: () => string[]; send: Sender;
    isActive: (deviceId: string) => boolean; isWatching: (deviceId: string, paneId: string) => boolean;
    onGone: (deviceId: string) => void; onError?: (error: Error) => void;
  }) {}
  async tick() {
    const devices = this.options.subscribers();
    if (!devices.length) { this.previous = undefined; return; }
    const state = await this.options.snapshot();
    const current = new Map(state.panes.map(pane => [`${pane.pane_id}:${pane.terminal_id}`, waiting(pane)]));
    const previous = this.previous;
    this.previous = current;
    if (!previous) return;
    const alerts = state.panes.filter(pane => {
      const key = `${pane.pane_id}:${pane.terminal_id}`;
      return waiting(pane) && previous.has(key) && previous.get(key) !== waiting(pane);
    }).map(pane => alertFor(state, pane));
    await Promise.all(devices.flatMap(deviceId => {
      if (!this.options.isActive(deviceId)) { this.options.onGone(deviceId); return []; }
      return alerts.filter(alert => !this.options.isWatching(deviceId, alert.paneId)).map(alert =>
        this.options.send(deviceId, alert).catch(error => {
          if (error instanceof PushGone) this.options.onGone(deviceId);
          else this.options.onError?.(error as Error);
        }));
    }));
  }
}
