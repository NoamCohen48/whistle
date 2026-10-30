import type { Database } from 'bun:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { openPrivateDatabase } from './database.ts';

export const DEVICE_LIFETIME_MS = 90 * 86400_000;
export interface Device {
  id: string;
  name: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
}
const columns = 'id, name, created_at AS createdAt, expires_at AS expiresAt, last_seen_at AS lastSeenAt';
const digest = (secret: string) => createHash('sha256').update(secret).digest('hex');

export class DeviceStore {
  private readonly db: Database;
  constructor(path: string, private readonly now: () => number = Date.now) {
    this.db = openPrivateDatabase(path, 'device', [
      db => db.exec(`CREATE TABLE devices (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, credential_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL
      )`),
    ]);
  }
  issue(name: string) {
    const credential = randomBytes(32).toString('base64url');
    const now = this.now();
    const device: Device = { id: randomUUID(), name: name.trim().slice(0, 80) || 'Browser', createdAt: now, lastSeenAt: now, expiresAt: now + DEVICE_LIFETIME_MS };
    this.db.query('INSERT INTO devices VALUES (?, ?, ?, ?, ?, ?)').run(device.id, device.name, digest(credential), now, device.expiresAt, now);
    return { credential, device };
  }
  authenticate(credential: string | undefined): Device | null {
    if (!credential || !/^[A-Za-z0-9_-]{43}$/.test(credential)) return null;
    const device = this.db.query<Device, [string, number]>(`SELECT ${columns} FROM devices WHERE credential_hash=? AND expires_at>?`).get(digest(credential), this.now());
    if (device && this.now() - device.lastSeenAt >= 60_000) {
      device.lastSeenAt = this.now();
      this.db.query('UPDATE devices SET last_seen_at=? WHERE id=?').run(device.lastSeenAt, device.id);
    }
    return device;
  }
  isActive(id: string) {
    return Boolean(this.db.query('SELECT 1 FROM devices WHERE id=? AND expires_at>?').get(id, this.now()));
  }
  list(): Device[] { return this.db.query<Device, [number]>(`SELECT ${columns} FROM devices WHERE expires_at>? ORDER BY created_at, id`).all(this.now()); }
  revoke(id: string) { return this.db.query('DELETE FROM devices WHERE id=?').run(id).changes > 0; }
  sweep() { this.db.query('DELETE FROM devices WHERE expires_at<=?').run(this.now()); }
  close() { this.db.close(); }
}

export function deviceName(value: unknown, userAgent = '') {
  if (value !== undefined && (typeof value !== 'string' || value.length > 80 || /[\x00-\x1f\x7f]/.test(value))) {
    throw new Error('Device name must be at most 80 printable characters');
  }
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (/android/i.test(userAgent)) return 'Android browser';
  if (/iphone|ipad/i.test(userAgent)) return 'iPhone / iPad browser';
  return 'Desktop browser';
}
