import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { migrate } from './schema.js';

export type Db = Database.Database;

/**
 * Open the dashboard database, creating it if needed.
 *
 * WAL is what lets the queue write a log chunk while a request reads the
 * execution list; without it SQLite serialises readers and writers and the UI
 * would stall behind a chatty script. Note that WAL needs a local filesystem:
 * on a network share, use a plain directory or a named volume instead.
 */
export function openDatabase(file: string): Db {
  if (file !== ':memory:') {
    mkdirSync(dirname(file), { recursive: true });
  }

  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  // Off by default in SQLite; we rely on cascades for log and script cleanup.
  db.pragma('foreign_keys = ON');
  // Wait rather than throw SQLITE_BUSY when a writer holds the lock briefly.
  db.pragma('busy_timeout = 5000');
  // Durability trade: a crash can lose the last commit or two, which is
  // acceptable for execution history and much faster for log-heavy writes.
  db.pragma('synchronous = NORMAL');

  migrate(db);
  return db;
}

/** Run `fn` inside a transaction, rolling back if it throws. */
export function transaction<T>(db: Db, fn: () => T): T {
  return db.transaction(fn)();
}

/** ISO 8601 UTC timestamp, the only datetime format stored in this database. */
export function nowIso(): string {
  return new Date().toISOString();
}
