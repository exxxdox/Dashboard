/**
 * SSH targets: CRUD, credential storage, and the reachability check.
 *
 * A target row holds an encrypted secret, so every read that leaves this module
 * returns a `TargetSummary` with no secret material. The only code allowed to
 * decrypt is `createTransportForTarget`.
 */

import { randomBytes } from 'node:crypto';
import type {
  CreateTargetInput,
  TargetCheckResult,
  TargetSummary,
  UpdateTargetInput,
} from '@dashboard/shared';
import { quote } from '@dashboard/shared';

import type { Db } from '../db/client.js';
import { nowIso } from '../db/client.js';
import type { SecretBox } from '../lib/crypto.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { newTargetId } from '../lib/ids.js';
import { joinRoot } from '../lib/paths.js';
import { createSshTransport } from '../transport/ssh-transport.js';
import type { Transport } from '../transport/types.js';

export type TargetRow = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_method: 'key' | 'password';
  secret_encrypted: string;
  work_dir: string;
  connect_timeout_sec: number;
  last_check_at: string | null;
  last_check_ok: number | null;
  last_check_detail: string | null;
  created_at: string;
  updated_at: string;
};

/** The credential payload that goes into `secret_encrypted`. */
type StoredSecret =
  | { method: 'key'; privateKey: string; passphrase?: string }
  | { method: 'password'; password: string };

function toSummary(row: TargetRow): TargetSummary {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authMethod: row.auth_method,
    workDir: row.work_dir,
    connectTimeoutSec: row.connect_timeout_sec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastCheckAt: row.last_check_at,
    lastCheckOk: row.last_check_ok === null ? null : row.last_check_ok === 1,
    lastCheckDetail: row.last_check_detail,
  };
}

export function listTargets(db: Db): TargetSummary[] {
  const rows = db.prepare<[], TargetRow>('SELECT * FROM targets ORDER BY name COLLATE NOCASE').all();
  return rows.map(toSummary);
}

/** Load a target row, including its encrypted secret. Throws when absent. */
export function getTargetRow(db: Db, id: string): TargetRow {
  const row = db.prepare<[string], TargetRow>('SELECT * FROM targets WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Target');
  return row;
}

export function getTarget(db: Db, id: string): TargetSummary {
  return toSummary(getTargetRow(db, id));
}

export function createTarget(db: Db, box: SecretBox, input: CreateTargetInput): TargetSummary {
  const existing = db
    .prepare<[string], { id: string }>('SELECT id FROM targets WHERE name = ?')
    .get(input.name);
  if (existing) throw new ConflictError(`A target named ${JSON.stringify(input.name)} already exists`);

  const id = newTargetId();
  const timestamp = nowIso();
  const secret = box.encrypt(JSON.stringify(input.auth satisfies StoredSecret));

  db.prepare(
    `INSERT INTO targets (
       id, name, host, port, username, auth_method, secret_encrypted,
       work_dir, connect_timeout_sec, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    input.host,
    input.port,
    input.username,
    input.auth.method,
    secret,
    input.workDir,
    input.connectTimeoutSec,
    timestamp,
    timestamp,
  );

  return getTarget(db, id);
}

export function updateTarget(
  db: Db,
  box: SecretBox,
  id: string,
  input: UpdateTargetInput,
): TargetSummary {
  const current = getTargetRow(db, id);

  if (input.name !== undefined && input.name !== current.name) {
    const clash = db
      .prepare<[string, string], { id: string }>('SELECT id FROM targets WHERE name = ? AND id != ?')
      .get(input.name, id);
    if (clash) throw new ConflictError(`A target named ${JSON.stringify(input.name)} already exists`);
  }

  // An omitted secret means "keep the stored one": the API never returns the
  // secret, so a client cannot round-trip it and must not have to.
  const secret = input.auth
    ? box.encrypt(JSON.stringify(input.auth satisfies StoredSecret))
    : current.secret_encrypted;

  db.prepare(
    `UPDATE targets SET
       name = ?, host = ?, port = ?, username = ?, auth_method = ?,
       secret_encrypted = ?, work_dir = ?, connect_timeout_sec = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name ?? current.name,
    input.host ?? current.host,
    input.port ?? current.port,
    input.username ?? current.username,
    input.auth?.method ?? current.auth_method,
    secret,
    input.workDir ?? current.work_dir,
    input.connectTimeoutSec ?? current.connect_timeout_sec,
    nowIso(),
    id,
  );

  return getTarget(db, id);
}

export function deleteTarget(db: Db, id: string): void {
  const used = db
    .prepare<[string], { count: number }>('SELECT COUNT(*) AS count FROM executions WHERE target_id = ?')
    .get(id);

  // Executions reference their target with ON DELETE RESTRICT, so the delete
  // would otherwise fail deep in SQLite with an opaque foreign-key error.
  if (used && used.count > 0) {
    throw new ConflictError(
      `This target has ${used.count} recorded execution(s). Delete those runs first if you really mean to remove it.`,
    );
  }

  const result = db.prepare('DELETE FROM targets WHERE id = ?').run(id);
  if (result.changes === 0) throw new NotFoundError('Target');
}

/** Decrypt the stored credential and build a transport for this target. */
export function createTransportForTarget(row: TargetRow, box: SecretBox): Transport {
  let secret: StoredSecret;
  try {
    secret = JSON.parse(box.decrypt(row.secret_encrypted)) as StoredSecret;
  } catch {
    throw new ValidationError(
      'Stored credentials for this target could not be decrypted. This usually means the encryption key changed — re-enter the credentials.',
    );
  }

  return createSshTransport({
    host: row.host,
    port: row.port,
    username: row.username,
    auth: secret,
    connectTimeoutSec: row.connect_timeout_sec,
  });
}

export type CheckTargetOptions = {
  /**
   * Root the run creates its per-execution staging directory under. Unlike the
   * old shared-directory probe, this is a path the dashboard owns, so the check
   * never writes inside the user's own working directory.
   */
  stagingRoot: string;
};

/**
 * Verify a target is ready to run something.
 *
 * Reachability alone is not enough: a run has to be able to `cd` into its
 * working directory, and it has to be able to create, write and remove a
 * staging directory on the host. Both are probed here, in one round trip, so a
 * broken target is diagnosed before the first run rather than by it.
 *
 * The staging probe writes under the staging root and never under `workDir`:
 * checking readiness must not litter the directory a user keeps their data in.
 */
export async function checkTarget(
  db: Db,
  box: SecretBox,
  id: string,
  options: CheckTargetOptions,
): Promise<TargetCheckResult> {
  const row = getTargetRow(db, id);
  const transport = createTransportForTarget(row, box);

  const record = (result: TargetCheckResult): TargetCheckResult => {
    db.prepare(
      'UPDATE targets SET last_check_at = ?, last_check_ok = ?, last_check_detail = ? WHERE id = ?',
    ).run(
      nowIso(),
      result.reachable && result.workDirOk && result.stagingOk ? 1 : 0,
      result.detail,
      id,
    );
    return result;
  };

  const unreachable = (detail: string): TargetCheckResult =>
    record({
      reachable: false,
      latencyMs: null,
      detail,
      hostShell: null,
      hostUser: null,
      hasSetsid: false,
      workDirOk: false,
      stagingOk: false,
    });

  let connectivity;
  try {
    connectivity = await transport.check();
  } catch (error) {
    return unreachable(error instanceof Error ? error.message : String(error));
  }

  if (!connectivity.reachable) return unreachable(connectivity.detail);

  const shared = {
    reachable: true,
    latencyMs: connectivity.latencyMs,
    hostShell: connectivity.shell,
    hostUser: connectivity.user,
    hasSetsid: connectivity.hasSetsid,
  };

  // A directory the dashboard owns and removes again. The token keeps concurrent
  // checks on the same host from colliding.
  const token = randomBytes(16).toString('hex');
  const stagingProbe = joinRoot(options.stagingRoot, `probe-${token}`);
  const stagingFile = joinRoot(stagingProbe, 'probe');

  // One round trip, two facts. The marker lines are what the service reads back;
  // the exit status is deliberately not used, because the second half should
  // still run and report when the first half fails.
  const probe =
    `if [ -d ${quote(row.work_dir)} ] && [ -x ${quote(row.work_dir)} ] ; ` +
    `then echo WORK_OK ; else echo WORK_FAIL ; fi ; ` +
    `if (umask 077 && mkdir -p ${quote(stagingProbe)}) && ` +
    `printf %s ${quote(token)} > ${quote(stagingFile)} && ` +
    `[ "$(cat ${quote(stagingFile)})" = ${quote(token)} ] ; ` +
    `then echo STAGE_OK ; else echo STAGE_FAIL ; fi ; ` +
    `rm -rf -- ${quote(stagingProbe)}`;

  let stdout = '';
  try {
    await transport.exec({
      command: probe,
      onChunk: (chunk) => {
        if (chunk.stream === 'stdout') stdout += chunk.data;
      },
      signal: new AbortController().signal,
      timeoutMs: 10_000,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return record({
      ...shared,
      workDirOk: false,
      stagingOk: false,
      detail: `Connected, but the readiness probe could not run: ${reason}`,
    });
  }

  const workDirOk = stdout.includes('WORK_OK');
  const stagingOk = stdout.includes('STAGE_OK');

  if (workDirOk && stagingOk) {
    return record({
      ...shared,
      workDirOk: true,
      stagingOk: true,
      detail:
        `Connected as ${connectivity.user ?? row.username}; ready to run.` +
        (connectivity.hasSetsid
          ? ''
          : ' Note: setsid is missing on the host, so cancelling a run may leave child processes behind.'),
    });
  }

  const problems: string[] = [];
  if (!workDirOk) {
    problems.push(
      stdout.includes('WORK_FAIL')
        ? `the working directory "${row.work_dir}" does not exist or cannot be entered`
        : `the working directory "${row.work_dir}" could not be checked`,
    );
  }
  if (!stagingOk) {
    problems.push(
      stdout.includes('STAGE_FAIL')
        ? `a staging directory could not be created and written under "${options.stagingRoot}"`
        : `the staging area under "${options.stagingRoot}" could not be checked`,
    );
  }

  return record({
    ...shared,
    workDirOk,
    stagingOk,
    detail: `Connected, but nothing can run yet: ${problems.join('; ')}.`,
  });
}
