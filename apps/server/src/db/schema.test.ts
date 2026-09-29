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

/**
 * A database at schema v4, which is what the DNS migration has to upgrade from.
 * The first four migrations run in order because each one assumes the state the
 * previous left behind.
 */
function versionFourDatabase(): SqliteDatabase {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const migration of MIGRATIONS.slice(0, 4)) migration(db);
  db.pragma('user_version = 4');
  return db;
}

describe('v5 migration', () => {
  test('adds both dns tables without touching what was there', () => {
    const db = versionFourDatabase();
    try {
      migrate(db);

      expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
      expect(columnsOf(db, 'dns_settings')).toContain('cloudflare_token_encrypted');
      expect(columnsOf(db, 'dns_settings')).toContain('alibaba_access_key_secret_encrypted');
      // The third secret this migration created has since moved to
      // `app_settings`; the v6 block below is where that is asserted.
      expect(columnsOf(db, 'dns_checks')).toContain('failure_reason');
      // The tables the rest of the app is written against are still intact.
      expect(columnsOf(db, 'executions')).toContain('argv_json');
      expect(columnsOf(db, 'scripts')).toContain('run_draft_json');
    } finally {
      db.close();
    }
  });

  test('keeps the three secrets nullable, so "not stored" is expressible', () => {
    const db = versionFourDatabase();
    try {
      migrate(db);

      // NULL is the only value that can mean "no credential"; an empty string
      // would be a second, ambiguous spelling of the same thing.
      expect(notNullOf(db, 'dns_settings', 'cloudflare_token_encrypted')).toBe(0);
      expect(notNullOf(db, 'dns_settings', 'alibaba_access_key_secret_encrypted')).toBe(0);
      expect(notNullOf(db, 'dns_checks', 'previous_value')).toBe(0);
      // Everything the form has to display is NOT NULL, so the row type carries
      // no nullability the UI would have to invent text for.
      expect(notNullOf(db, 'dns_settings', 'cloudflare_zone_id')).toBe(1);
      expect(notNullOf(db, 'dns_settings', 'interval_minutes')).toBe(1);
    } finally {
      db.close();
    }
  });

  test('refuses values outside the enumerations it pins', () => {
    const db = versionFourDatabase();
    try {
      migrate(db);

      const settings = db.prepare(
        `INSERT INTO dns_settings (id, provider, interval_minutes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      expect(() => settings.run('dns', 'route53', 10, NOW, NOW)).toThrow(/CHECK/);
      expect(() => settings.run('dns', 'cloudflare', 0, NOW, NOW)).toThrow(/CHECK/);
      expect(() => settings.run('dns', 'cloudflare', 10, NOW, NOW)).not.toThrow();

      const checks = db.prepare(
        `INSERT INTO dns_checks (id, at, source, ok, action, failure_reason, provider)
         VALUES (?, ?, ?, 1, ?, ?, 'cloudflare')`,
      );
      expect(() => checks.run('dnsc_1', NOW, 'cli', 'unchanged', null)).toThrow(/CHECK/);
      expect(() => checks.run('dnsc_2', NOW, 'manual', 'skipped', null)).toThrow(/CHECK/);
      expect(() => checks.run('dnsc_3', NOW, 'manual', 'failed', 'dns_is_broken')).toThrow(/CHECK/);
      expect(() => checks.run('dnsc_4', NOW, 'scheduled', 'unchanged', null)).not.toThrow();
      expect(() => checks.run('dnsc_5', NOW, 'manual', 'failed', 'dns_query_failed')).not.toThrow();
    } finally {
      db.close();
    }
  });
});

/**
 * A database at schema v5 holding a notification credential on the DNS
 * settings row, which is what the settings move has to upgrade from.
 */
function versionFiveDatabase(): SqliteDatabase {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const migration of MIGRATIONS.slice(0, 5)) migration(db);
  db.pragma('user_version = 5');

  db.prepare(
    `INSERT INTO dns_settings
       (id, provider, interval_minutes, cloudflare_zone_id, cloudflare_record_name,
        gotify_address, gotify_token_encrypted, created_at, updated_at)
     VALUES ('dns','cloudflare',10,'zone-1','home.example.com','notify.test','ciphertext',?,?)`,
  ).run(NOW, NOW);

  return db;
}

describe('v6 migration', () => {
  test('carries the notification credential over and drops it from the DNS row', () => {
    const db = versionFiveDatabase();
    try {
      migrate(db);

      const app = db
        .prepare<[], { gotify_address: string; gotify_token_encrypted: string | null }>(
          `SELECT gotify_address, gotify_token_encrypted FROM app_settings WHERE id = 'app'`,
        )
        .get();
      // Ciphertext in, ciphertext out: the move does not decrypt and re-encrypt,
      // so it cannot fail on a credential it has no reason to understand.
      expect(app).toEqual({
        gotify_address: 'notify.test',
        gotify_token_encrypted: 'ciphertext',
      });

      // One source of truth: the old columns are gone rather than shadowed.
      expect(columnsOf(db, 'dns_settings')).not.toContain('gotify_address');
      expect(columnsOf(db, 'dns_settings')).not.toContain('gotify_token_encrypted');
      expect(columnsOf(db, 'dns_settings')).toContain('cloudflare_token_encrypted');
      expect(columnsOf(db, 'dns_settings')).toContain('cloudflare_zone_id');
    } finally {
      db.close();
    }
  });

  test('writes no row when there were no DNS settings to move', () => {
    const db = new Database(':memory:');
    try {
      for (const migration of MIGRATIONS.slice(0, 5)) migration(db);
      // Without this the version is still 0 and `migrate` replays v1 into the
      // tables it just made. The DNS row is what is deliberately absent here.
      db.pragma('user_version = 5');
      migrate(db);

      // A fresh install has no notification address, not an empty one that
      // looks like an address someone deleted.
      expect(db.prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM app_settings').get()).toEqual({
        n: 0,
      });
    } finally {
      db.close();
    }
  });

  test('keeps the moved credential nullable, so "not stored" stays expressible', () => {
    const db = versionFiveDatabase();
    try {
      migrate(db);

      expect(notNullOf(db, 'app_settings', 'gotify_token_encrypted')).toBe(0);
      expect(notNullOf(db, 'app_settings', 'gotify_address')).toBe(1);
    } finally {
      db.close();
    }
  });
});

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
