/**
 * SQLite schema and forward-only migrations.
 *
 * Migrations are keyed off `PRAGMA user_version`, which SQLite maintains for us:
 * no migration table, no bookkeeping code, and the file stays valid if someone
 * opens it with the sqlite3 CLI.
 */

import type { Database as SqliteDatabase } from 'better-sqlite3';

/** Bump this and append a migration function when the schema changes. */
const TARGET_VERSION = 4;

type Migration = (db: SqliteDatabase) => void;

/**
 * Exported for the migration test only: `openDatabase` always migrates to the
 * current version, so the only way to build a database at an older version is
 * to apply the earlier migrations by hand.
 */
export const MIGRATIONS: Migration[] = [
  // v1 -- initial schema.
  (db) => {
    db.exec(`
      CREATE TABLE targets (
        id                  TEXT PRIMARY KEY,
        name                TEXT NOT NULL,
        host                TEXT NOT NULL,
        port                INTEGER NOT NULL DEFAULT 22,
        username            TEXT NOT NULL,
        auth_method         TEXT NOT NULL CHECK (auth_method IN ('key','password')),
        -- AES-256-GCM ciphertext; the key lives outside the database.
        secret_encrypted    TEXT NOT NULL,
        script_root_host    TEXT NOT NULL,
        connect_timeout_sec INTEGER NOT NULL DEFAULT 15,
        last_check_at       TEXT,
        last_check_ok       INTEGER,
        last_check_detail   TEXT,
        created_at          TEXT NOT NULL,
        updated_at          TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_targets_name ON targets(name);

      CREATE TABLE sources (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        kind          TEXT NOT NULL CHECK (kind IN ('local','github')),
        repo_url      TEXT,
        branch        TEXT,
        sub_path      TEXT,
        -- Directory relative to the shared root, e.g. "repos/acme__ops".
        mount_path    TEXT NOT NULL,
        sync_status   TEXT NOT NULL DEFAULT 'never'
                      CHECK (sync_status IN ('never','syncing','ok','error')),
        sync_error    TEXT,
        last_sync_at  TEXT,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_sources_name ON sources(name);
      CREATE UNIQUE INDEX idx_sources_mount_path ON sources(mount_path);

      CREATE TABLE scripts (
        id                        TEXT PRIMARY KEY,
        source_id                 TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        rel_path                  TEXT NOT NULL,
        rel_dir                   TEXT NOT NULL,
        file_name                 TEXT NOT NULL,
        format                    TEXT NOT NULL CHECK (format IN ('sh','ps1')),
        size_bytes                INTEGER NOT NULL,
        content_hash              TEXT NOT NULL,
        display_name              TEXT NOT NULL,
        description               TEXT,
        params_json               TEXT NOT NULL DEFAULT '[]',
        timeout_sec               INTEGER,
        interpreter_override_json TEXT,
        discovered_at             TEXT NOT NULL,
        updated_at                TEXT NOT NULL,
        -- A resync that no longer finds a script marks it deleted instead of
        -- removing the row, so its execution history stays readable.
        deleted_at                TEXT
      );
      CREATE UNIQUE INDEX idx_scripts_source_relpath ON scripts(source_id, rel_path);
      CREATE INDEX idx_scripts_source ON scripts(source_id, deleted_at);

      CREATE TABLE executions (
        id                TEXT PRIMARY KEY,
        script_id         TEXT NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
        target_id         TEXT NOT NULL REFERENCES targets(id) ON DELETE RESTRICT,
        status            TEXT NOT NULL CHECK (status IN
                            ('queued','running','succeeded','failed','canceled','timed_out','interrupted')),
        exit_code         INTEGER,
        signal            TEXT,
        command_display   TEXT NOT NULL,
        -- Name and path are snapshotted so history reads correctly even after
        -- the script or target is renamed.
        target_name       TEXT NOT NULL,
        script_name       TEXT NOT NULL,
        script_rel_path   TEXT NOT NULL,
        param_values_json TEXT NOT NULL DEFAULT '{}',
        cwd_host          TEXT NOT NULL,
        queued_at         TEXT NOT NULL,
        started_at        TEXT,
        finished_at       TEXT,
        duration_ms       INTEGER,
        log_bytes         INTEGER NOT NULL DEFAULT 0,
        truncated         INTEGER NOT NULL DEFAULT 0,
        error_message     TEXT
      );
      CREATE INDEX idx_executions_queued_at ON executions(queued_at DESC);
      CREATE INDEX idx_executions_script ON executions(script_id, queued_at DESC);
      CREATE INDEX idx_executions_target ON executions(target_id, queued_at DESC);
      CREATE INDEX idx_executions_status ON executions(status);

      CREATE TABLE execution_logs (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        execution_id TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
        seq          INTEGER NOT NULL,
        stream       TEXT NOT NULL CHECK (stream IN ('stdout','stderr','system')),
        data         TEXT NOT NULL,
        ts           TEXT NOT NULL
      );
      CREATE INDEX idx_execution_logs_execution_seq ON execution_logs(execution_id, seq);
    `);
  },

  // v2 -- a run no longer needs a directory that the host and the container
  // both see. The script is pushed to a staging directory and executed from the
  // target's own work directory, so `script_root_host` becomes `work_dir` and
  // the old value is kept verbatim: the old check had proved the host could
  // traverse it, which is exactly the property `cd` needs.
  //
  // RENAME COLUMN rather than ADD + DROP: the replacement column would have to
  // be `NOT NULL DEFAULT ''` (SQLite allows nothing else for a non-null column),
  // which bakes an empty default into the DDL forever and still needs a separate
  // backfill UPDATE. Rebuilding the table needs foreign keys switched off, and
  // `PRAGMA foreign_keys` is silently ignored inside the transaction that
  // `migrate()` wraps every migration in.
  (db) => {
    db.exec('ALTER TABLE targets RENAME COLUMN script_root_host TO work_dir');
    db.exec('ALTER TABLE executions RENAME COLUMN cwd_host TO work_dir');
  },

  // v3 -- a run can carry positional arguments as well as parameters. They are
  // recorded separately from `param_values_json` because they are a different
  // channel: one reaches the script as an environment variable, the other as
  // `$1`… on the command line, and history has to say which was which. Existing
  // rows default to none, which is what they had.
  (db) => {
    db.exec("ALTER TABLE executions ADD COLUMN argv_json TEXT NOT NULL DEFAULT '[]'");
  },

  // v4 -- the run form remembers what it held, per script. Stored on `scripts`
  // because it is one draft per script, and kept apart from the execution rows:
  // a draft is what someone was *about to* run, including half-typed junk, and
  // it must not look like evidence of a run that happened. '{}' means no draft,
  // which is also what every existing row is.
  (db) => {
    db.exec("ALTER TABLE scripts ADD COLUMN run_draft_json TEXT NOT NULL DEFAULT '{}'");
  },
];

/** Apply any migrations the database has not seen yet. */
export function migrate(db: SqliteDatabase): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  if (current >= TARGET_VERSION) return;

  // One transaction per migration: a failure part-way leaves user_version
  // unchanged, so the next boot retries rather than running on a half-schema.
  for (let version = current; version < TARGET_VERSION; version += 1) {
    const migration = MIGRATIONS[version];
    if (!migration) throw new Error(`Missing migration for schema version ${version + 1}`);

    const apply = db.transaction(() => {
      migration(db);
      db.pragma(`user_version = ${version + 1}`);
    });
    apply();
  }
}

export const SCHEMA_VERSION = TARGET_VERSION;
