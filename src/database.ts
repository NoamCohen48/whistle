import { Database } from 'bun:sqlite';
import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname } from 'node:path';

// A SQLite database only this user can read, with its schema brought up to `version`.
// `migrations[n]` upgrades a database from schema version n to n + 1.
export function openPrivateDatabase(path: string, name: string, migrations: ((db: Database) => void)[]) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  closeSync(openSync(path, 'a', 0o600));
  chmodSync(path, 0o600);
  const db = new Database(path, { strict: true });
  try {
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
    const version = db.query<{ user_version: number }, []>('PRAGMA user_version').get()!.user_version;
    if (version > migrations.length) throw new Error(`The ${name} database is newer than this Whistle version`);
    db.transaction(() => {
      for (let next = version; next < migrations.length; next++) migrations[next](db);
      db.exec(`PRAGMA user_version=${migrations.length}`);
    })();
  } catch (cause) { db.close(); throw cause; }
  return db;
}
