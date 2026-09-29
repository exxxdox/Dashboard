import Database, { type Database as SqliteDatabase } from 'better-sqlite3';
import { describe, expect, test } from 'vitest';

import { migrate, MIGRATIONS, SCHEMA_VERSION } from './schema.js';

/** Column names of a table, so a migration can be asserted on its effects. */
function columnsOf(db: SqliteDatabase, table: string): string[] {
  return db
    .prepare<[string], { name: string }>('SELECT name FROM pragma_table_info(?)')
    .all(table)
    .map((row) => row.name);
}

function notNullOf(db: SqliteDatabase, table: string, column: string): number | undefined {
  return db
    .prepare<[string, string], { notnull: number }>(
      'SELECT "notnull" FROM pragma_table_info(?) WHERE name = ?',
    )
    .get(table, column)?.notnull;
}

const NOW = '2026-01-01T00:00:00.000Z';

/**
 * A database at schema v1 holding the rows an upgrade has to carry over.
 * `openDatabase` is no use here: it migrates to the current version, so the
 * pre-upgrade state can only be built by applying the first migration by hand.
 */
function versionOneDatabase(): SqliteDatabase {
  const db = new Database(':memory:');
  // Foreign keys on from the start: ALTER TABLE runs an implicit foreign-key
  // check when they are enforced, so the fixture has to be referentially valid
  // rather than merely convenient.
  db.pragma('foreign_keys = ON');

  const v1 = MIGRATIONS[0];
  if (!v1) throw new Error('expected a v1 migration to build the fixture with');
  v1(db);
  db.pragma('user_version = 1');

  db.prepare(
    `INSERT INTO sources (id, name, kind, mount_path, created_at, updated_at)
     VALUES ('src_1','scripts','local','local',?,?)`,
  ).run(NOW, NOW);

  db.prepare(
    `INSERT INTO scripts (id, source_id, rel_path, rel_dir, file_name, format, size_bytes,
       content_hash, display_name, discovered_at, updated_at)
     VALUES ('scr_1','src_1','api.sh','','api.sh','sh',10,'hash','API',?,?)`,
  ).run(NOW, NOW);

  db.prepare(
    `INSERT INTO targets (id, name, host, port, username, auth_method, secret_encrypted,
       script_root_host, connect_timeout_sec, created_at, updated_at)
     VALUES ('tgt_1','edge','edge.test',22,'deploy','key','x','/srv/scripts',15,?,?)`,
  ).run(NOW, NOW);

  db.prepare(
    `INSERT INTO executions (id, script_id, target_id, status, command_display, target_name,
       script_name, script_rel_path, param_values_json, cwd_host, queued_at)
     VALUES ('run_1','scr_1','tgt_1','succeeded','bash api.sh','edge','API','api.sh','{}','/srv/scripts',?)`,
  ).run(NOW);

  return db;
}

describe('v2 migration', () => {
  test('backfills the working directory from the old host path', () => {
    const db = versionOneDatabase();
    try {
      migrate(db);

      // The old value proved the host could traverse that directory, which is
      // exactly what `cd` needs, so it is the best available backfill.
      const target = db.prepare<[], { work_dir: string }>('SELECT work_dir FROM targets').get();
      expect(target?.work_dir).toBe('/srv/scripts');
    } finally {
      db.close();
    }
  });

  test('leaves no trace of the container/host mapping vocabulary', () => {
    const db = versionOneDatabase();
    try {
      migrate(db);

      expect(columnsOf(db, 'targets')).toContain('work_dir');
      expect(columnsOf(db, 'targets')).not.toContain('script_root_host');
      expect(columnsOf(db, 'executions')).toContain('work_dir');
      expect(columnsOf(db, 'executions')).not.toContain('cwd_host');
    } finally {
      db.close();
    }
  });

  test('keeps the renamed column NOT NULL', () => {
    // A nullable column would push `string | null` through the row type and the
    // plan builder for a case that cannot occur.
    const db = versionOneDatabase();
    try {
      migrate(db);

      expect(notNullOf(db, 'targets', 'work_dir')).toBe(1);
    } finally {
      db.close();
    }
  });

  test('carries the execution working directory across', () => {
    const db = versionOneDatabase();
    try {
      migrate(db);

      const execution = db
        .prepare<[], { work_dir: string; command_display: string }>(
          'SELECT work_dir, command_display FROM executions',
        )
        .get();
      expect(execution?.work_dir).toBe('/srv/scripts');
      expect(execution?.command_display).toBe('bash api.sh');
    } finally {
      db.close();
    }
  });

  test('records the version it applied and is a no-op the second time', () => {
    const db = versionOneDatabase();
    try {
      migrate(db);
      expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);

      expect(() => migrate(db)).not.toThrow();
      const target = db.prepare<[], { work_dir: string }>('SELECT work_dir FROM targets').get();
      expect(target?.work_dir).toBe('/srv/scripts');
    } finally {
      db.close();
    }
  });
});
