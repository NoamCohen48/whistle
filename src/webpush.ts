import { createCipheriv, createECDH, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Standard Web Push (RFC 8030/8291/8292): end-to-end encrypted messages through the browser
// vendor's push service, which sees only ciphertext, the endpoint and timing. Nothing here
// knows what Whistle sends; see alerts.ts for that.

export interface PushSubscription { endpoint: string; keys: { p256dh: string; auth: string } }

const b64 = (value: Buffer | Uint8Array) => Buffer.from(value).toString('base64url');
const unb64 = (value: string) => Buffer.from(value, 'base64url');

// Only the browser vendors' push services: a subscription must never turn the PC into a
// request proxy for arbitrary URLs on the tailnet or the local machine.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];
export function parseSubscription(input: unknown): PushSubscription {
  const body = input as Partial<PushSubscription> | null;
  if (!body || typeof body !== 'object' || typeof body.endpoint !== 'string' || body.endpoint.length > 1024) throw new Error('Invalid subscription');
  let url: URL;
  try { url = new URL(body.endpoint); } catch { throw new Error('Invalid subscription'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !PUSH_HOSTS.some(host => host.test(url.hostname))) {
    throw new Error('Unsupported push service');
  }
  const { p256dh, auth } = body.keys || {} as PushSubscription['keys'];
  if (typeof p256dh !== 'string' || typeof auth !== 'string' || !/^[A-Za-z0-9_-]+$/.test(p256dh + auth)
    || unb64(p256dh).length !== 65 || unb64(p256dh)[0] !== 4 || unb64(auth).length !== 16) throw new Error('Invalid subscription keys');
  return { endpoint: url.href, keys: { p256dh, auth } };
}

// RFC 8291 aes128gcm, one record. `salt` and `senderPrivate` are injectable only for test vectors.
export function encrypt(plaintext: Buffer, subscription: PushSubscription['keys'],
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

// The subscription no longer exists; the device should be unsubscribed.
export class PushGone extends Error {}

// Sends one encrypted message. A topic collapses undelivered messages that share it into the newest.
export type PushSend = (subscription: PushSubscription, payload: unknown, topic: string) => Promise<void>;
export function webPushSender(keys: VapidKeys, request: typeof fetch = fetch): PushSend {
  return async (subscription, payload, topic) => {
    const response = await request(subscription.endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
      headers: { Authorization: keys.authorization(subscription.endpoint), 'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream', TTL: '3600', Urgency: 'high', Topic: topic },
      body: encrypt(Buffer.from(JSON.stringify(payload)), subscription.keys),
    });
    if (response.status === 404 || response.status === 410) throw new PushGone('Subscription expired');
    if (!response.ok) throw new Error(`Push service answered ${response.status}`);
  };
}
