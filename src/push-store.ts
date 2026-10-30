import type { Database } from 'bun:sqlite';
import { parseSettings } from './alerts.ts';
import type { AlertSettings } from '../shared/api.ts';
import { openPrivateDatabase } from './database.ts';
import type { PushSubscription } from './webpush.ts';

const DEFAULT_SETTINGS: AlertSettings = { finished: true };

// Each paired device's push subscription and alert settings.
export class PushStore {
  private readonly db: Database;
  constructor(path: string) {
    this.db = openPrivateDatabase(path, 'alerts', [
      db => {
        db.exec(`CREATE TABLE IF NOT EXISTS subscriptions (
          device_id TEXT PRIMARY KEY, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL)`);
        // Databases from before settings existed already have the table, without this column.
        const columns = db.query<{ name: string }, []>('PRAGMA table_info(subscriptions)').all().map(column => column.name);
        if (!columns.includes('settings')) db.exec(`ALTER TABLE subscriptions ADD COLUMN settings TEXT NOT NULL DEFAULT '{}'`);
      },
    ]);
  }
  // Re-subscribing (new key, new phone browser) keeps the device's settings.
  save(deviceId: string, subscription: PushSubscription) {
    this.db.query(`INSERT INTO subscriptions (device_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_id) DO UPDATE SET endpoint=excluded.endpoint, p256dh=excluded.p256dh, auth=excluded.auth, created_at=excluded.created_at`)
      .run(deviceId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, Date.now());
  }
  settings(deviceId: string): AlertSettings {
    const row = this.db.query<{ settings: string }, [string]>('SELECT settings FROM subscriptions WHERE device_id=?').get(deviceId);
    try { return parseSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(row?.settings || '{}') }); }
    catch { return DEFAULT_SETTINGS; }
  }
  // Only for a subscribed device; returns false otherwise.
  saveSettings(deviceId: string, settings: AlertSettings) {
    return this.db.query('UPDATE subscriptions SET settings=? WHERE device_id=?').run(JSON.stringify(settings), deviceId).changes > 0;
  }
  get(deviceId: string): PushSubscription | undefined {
    const row = this.db.query<{ endpoint: string; p256dh: string; auth: string }, [string]>(
      'SELECT endpoint, p256dh, auth FROM subscriptions WHERE device_id=?').get(deviceId);
    return row ? { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } } : undefined;
  }
  all() { return this.db.query<{ deviceId: string }, []>('SELECT device_id AS deviceId FROM subscriptions').all().map(row => row.deviceId); }
  remove(deviceId: string) { this.db.query('DELETE FROM subscriptions WHERE device_id=?').run(deviceId); }
  close() { this.db.close(); }
}
