import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEVICE_LIFETIME_MS, DeviceStore, deviceName } from '../src/devices.ts';

let directory: string;
let store: DeviceStore;
let now: number;
const clock = () => now;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'whistle-devices-'));
  now = 1_800_000_000_000;
  store = new DeviceStore(join(directory, 'devices.sqlite'), clock);
});
afterEach(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });

test('pairing survives reopening the database without storing bearer credentials', () => {
  const { credential, device } = store.issue('My phone');
  expect(store.authenticate(credential)?.id).toBe(device.id);
  store.close(); store = new DeviceStore(join(directory, 'devices.sqlite'), clock);
  expect(store.authenticate(credential)?.name).toBe('My phone');
  expect(store.list()).toEqual([device]);
  const db = new Database(join(directory, 'devices.sqlite'), { readonly: true });
  try {
    const row = db.query<{ credential_hash: string }, []>('SELECT credential_hash FROM devices').get()!;
    expect(row.credential_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.credential_hash).not.toBe(credential);
  } finally { db.close(); }
  expect(readFileSync(join(directory, 'devices.sqlite')).includes(Buffer.from(credential))).toBe(false);
  expect(statSync(join(directory, 'devices.sqlite')).mode & 0o777).toBe(0o600);
});

test('revocation is durable, scoped to one device and does not affect other credentials', () => {
  const first = store.issue('First'); const second = store.issue('Second');
  expect(first.credential).not.toBe(second.credential);
  expect(store.revoke(first.device.id)).toBe(true);
  expect(store.revoke(first.device.id)).toBe(false);
  expect(store.authenticate(first.credential)).toBeNull();
  expect(store.isActive(first.device.id)).toBe(false);
  store.close(); store = new DeviceStore(join(directory, 'devices.sqlite'), clock);
  expect(store.authenticate(first.credential)).toBeNull();
  expect(store.authenticate(second.credential)?.id).toBe(second.device.id);
});

test('expired credentials cannot authenticate or retain a stream lease', () => {
  const issued = store.issue('Phone');
  now += DEVICE_LIFETIME_MS;
  expect(store.authenticate(issued.credential)).toBeNull();
  expect(store.isActive(issued.device.id)).toBe(false);
  store.sweep(); expect(store.list()).toEqual([]);
});

test('last-seen writes are throttled and malformed credentials fail closed', () => {
  const { credential, device } = store.issue('Phone');
  now += 30_000;
  expect(store.authenticate(credential)?.lastSeenAt).toBe(device.lastSeenAt);
  now += 30_000;
  expect(store.authenticate(credential)?.lastSeenAt).toBe(now);
  for (const invalid of [undefined, '', 'invalid', 'a'.repeat(1000), credential.slice(1)]) expect(store.authenticate(invalid)).toBeNull();
  expect(JSON.stringify(store.list())).not.toContain(credential);
});

test('device labels are bounded printable text with platform defaults', () => {
  expect(deviceName('  My Android  ')).toBe('My Android');
  expect(deviceName(undefined, 'Mozilla Android')).toBe('Android browser');
  expect(deviceName(undefined, 'Mozilla iPhone')).toContain('iPhone');
  expect(() => deviceName('x'.repeat(81))).toThrow();
  expect(() => deviceName('\x1b[31m')).toThrow();
  expect(() => deviceName({})).toThrow();
});
