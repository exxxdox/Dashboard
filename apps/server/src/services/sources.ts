/**
 * Script sources: a local directory, or a public GitHub repository.
 *
 * Cloning happens *inside the container*, into the bind-mounted directory. That
 * is the whole reason the host needs no git, no rsync, and no write access from
 * us: the files land on the host as a side effect of the mount. It also means
 * the only remote command surface is the one the runner uses for execution.
 *
 * git is invoked with `execFile`, never through a shell, so a repository URL or
 * branch name can never be reinterpreted as a command.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type {
  CreateSourceInput,
  ScriptTreeNode,
  ScriptSummary,
  SourceKind,
  SourceSummary,
  SyncResult,
  UpdateSourceInput,
} from '@dashboard/shared';
import { assertValidBranch, parseGithubRepo } from '@dashboard/shared';

import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { nowIso } from '../db/client.js';
import {
  AppError,
  ConflictError,
  errorMessage,
  NotFoundError,
  TargetError,
  ValidationError,
} from '../lib/errors.js';
import { newSourceId } from '../lib/ids.js';
import type { Logger } from '../lib/logger.js';
import { assertSafeRelative, isInside, joinRoot, normalizePosix, relativeDir } from '../lib/paths.js';
import { scanSourceDirectory, syncScripts } from './scan.js';

/** Directory under the shared root that holds cloned repositories. */
const REPOS_DIRECTORY = 'repos';
/** Default directory under the shared root for loose local scripts. */
const DEFAULT_LOCAL_DIRECTORY = 'local';

/** git can be slow on a cold clone; this bounds it without being tight. */
const GIT_TIMEOUT_MS = 180_000;

export type SourceRow = {
  id: string;
  name: string;
  kind: 'local' | 'github';
  repo_url: string | null;
  branch: string | null;
  sub_path: string | null;
  mount_path: string;
  sync_status: 'never' | 'syncing' | 'ok' | 'error';
  sync_error: string | null;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Row shape for a script, mirroring the `scripts` table. */
export type ScriptRow = {
  id: string;
  source_id: string;
  rel_path: string;
  rel_dir: string;
  file_name: string;
  format: 'sh' | 'ps1';
  size_bytes: number;
  content_hash: string;
  display_name: string;
  description: string | null;
  params_json: string;
  timeout_sec: number | null;
  interpreter_override_json: string | null;
  discovered_at: string;
  updated_at: string;
};

export function toScriptSummary(row: ScriptRow): ScriptSummary {
  return {
    id: row.id,
    sourceId: row.source_id,
    relPath: row.rel_path,
    relDir: row.rel_dir,
    fileName: row.file_name,
    format: row.format,
    sizeBytes: row.size_bytes,
    contentHash: row.content_hash,
    displayName: row.display_name,
    description: row.description,
    params: JSON.parse(row.params_json) as ScriptSummary['params'],
    timeoutSec: row.timeout_sec,
    interpreterOverride: row.interpreter_override_json
      ? (JSON.parse(row.interpreter_override_json) as string[])
      : null,
    discoveredAt: row.discovered_at,
    updatedAt: row.updated_at,
  };
}

function toSummary(db: Db, row: SourceRow): SourceSummary {
  const count = db
    .prepare<[string], { count: number }>(
      'SELECT COUNT(*) AS count FROM scripts WHERE source_id = ? AND deleted_at IS NULL',
    )
    .get(row.id);

  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    repoUrl: row.repo_url,
    branch: row.branch,
    subPath: row.sub_path,
    mountPath: row.mount_path,
    syncStatus: row.sync_status,
    syncError: row.sync_error,
    lastSyncAt: row.last_sync_at,
    scriptCount: count?.count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSources(db: Db): SourceSummary[] {
  const rows = db.prepare<[], SourceRow>('SELECT * FROM sources ORDER BY name COLLATE NOCASE').all();
  return rows.map((row) => toSummary(db, row));
}

export function getSourceRow(db: Db, id: string): SourceRow {
  const row = db.prepare<[string], SourceRow>('SELECT * FROM sources WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Source');
  return row;
}

export function getSource(db: Db, id: string): SourceSummary {
  return toSummary(db, getSourceRow(db, id));
}

/** Absolute container-side directory a source's files live in. */
export function sourceDirectory(config: AppConfig, row: SourceRow): string {
  return joinRoot(config.scriptRootContainer, row.mount_path);
}

/** The four columns that a kind and its fields determine. */
type SourceShape = {
  repoUrl: string | null;
  branch: string | null;
  subPath: string | null;
  mountPath: string;
};

/**
 * Turn a path meant to sit inside the shared root into an absolute one, or
 * refuse it. Traversal first, then escape: the same two checks everywhere, in
 * one place rather than once per caller.
 */
function resolveInsideRoot(
  config: AppConfig,
  relativePath: string,
): { safe: string; absolute: string } {
  let safe: string;
  try {
    safe = assertSafeRelative(normalizePosix(relativePath));
  } catch (error) {
    throw new ValidationError(errorMessage(error));
  }

  if (safe === '') {
    throw new ValidationError('A local source needs a subdirectory inside the shared root');
  }

  const absolute = joinRoot(config.scriptRootContainer, safe);
  if (!isInside(config.scriptRootContainer, absolute)) {
    throw new ValidationError('The local path must stay inside the shared script root');
  }

  return { safe, absolute };
}

/** `mountPath` is derived, never taken from input: it is where the checkout lives. */
function githubShape(fields: {
  repoUrl: string;
  branch: string | null;
  subPath: string | null;
}): SourceShape {
  // Throws with a readable reason for anything that is not a public GitHub repo.
  const repo = parseGithubRepo(fields.repoUrl);
  const subPath = fields.subPath?.trim() ?? '';

  return {
    repoUrl: repo.cloneUrl,
    branch: fields.branch === null ? null : assertValidBranch(fields.branch),
    subPath: subPath === '' ? null : subPath,
    mountPath: `${REPOS_DIRECTORY}/${repo.slug}`,
  };
}

/** A local source is a directory inside the shared root, and nothing else. */
function localShape(config: AppConfig, subPath: string | null): SourceShape {
  const requested = subPath?.trim() ?? '';
  if (requested === '') {
    throw new ValidationError('A local source needs a subdirectory inside the shared root');
  }

  // Reject traversal before it can ever reach a filesystem call.
  const { safe } = resolveInsideRoot(config, requested);

  return { repoUrl: null, branch: null, subPath: safe, mountPath: safe };
}

function shapeFor(
  config: AppConfig,
  kind: SourceKind,
  fields: { repoUrl: string; branch: string | null; subPath: string | null },
): SourceShape {
  if (kind !== 'github') return localShape(config, fields.subPath);

  // The shared validators report bad input by throwing plain errors, because
  // they live in the shared package and must not depend on the server's error
  // types. Re-wrap, or a user's typo surfaces as a 500.
  try {
    return githubShape(fields);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new ValidationError(errorMessage(error));
  }
}

/**
 * Make sure a local source's directory exists, creating it if it does not.
 *
 * The bind mount is there so the files outlive the container, not as something
 * the host has to prepare: the dashboard owns the directories it manages, so a
 * missing one is created rather than reported. This is the same thing a GitHub
 * source already does before its first clone, and it is why a local source no
 * longer has to be seeded by hand before it can be synced.
 */
function ensureLocalDirectory(config: AppConfig, mountPath: string): void {
  const { absolute } = resolveInsideRoot(config, mountPath);

  try {
    mkdirSync(absolute, { recursive: true });
  } catch (error) {
    // Read-only mount, or a file where a directory has to go. Either way the
    // caller's path is what is wrong, so this is not a 500.
    throw new ValidationError(
      `Cannot create "${mountPath}" inside the shared root ` +
        `(${config.scriptRootContainer}): ${errorMessage(error)}`,
    );
  }
}

/** Two sources may not share a name, and may not share a directory. */
function assertUnique(db: Db, id: string | null, name: string, mountPath: string): void {
  // `IS NOT` rather than `!=` so a null id (create) compares as "no row is
  // excluded" while a real id excludes itself, without a second query shape.
  const nameClash = db
    .prepare<[string, string | null], { id: string }>(
      'SELECT id FROM sources WHERE name = ? AND id IS NOT ?',
    )
    .get(name, id);
  if (nameClash) throw new ConflictError(`A source named ${JSON.stringify(name)} already exists`);

  const mountClash = db
    .prepare<[string, string | null], { id: string }>(
      'SELECT id FROM sources WHERE mount_path = ? AND id IS NOT ?',
    )
    .get(mountPath, id);
  if (mountClash) {
    throw new ConflictError(
      `Another source already uses the directory "${mountPath}". Pick a different subdirectory.`,
    );
  }
}

export function createSource(db: Db, config: AppConfig, input: CreateSourceInput): SourceSummary {
  if (input.kind === 'github' && !input.repoUrl) {
    throw new ValidationError('A repository URL is required');
  }

  const shape = shapeFor(config, input.kind, {
    repoUrl: input.repoUrl ?? '',
    branch: input.branch ?? null,
    // A local source with no directory named falls back to the shared default.
    subPath: input.subPath ?? (input.kind === 'local' ? DEFAULT_LOCAL_DIRECTORY : null),
  });

  assertUnique(db, null, input.name, shape.mountPath);

  // Before the row, so a directory that cannot be created fails the request
  // instead of leaving a source whose files have nowhere to go.
  if (input.kind === 'local') ensureLocalDirectory(config, shape.mountPath);

  const id = newSourceId();
  const timestamp = nowIso();

  db.prepare(
    `INSERT INTO sources (
       id, name, kind, repo_url, branch, sub_path, mount_path,
       sync_status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'never', ?, ?)`,
  ).run(
    id,
    input.name,
    input.kind,
    shape.repoUrl,
    shape.branch,
    shape.subPath,
    shape.mountPath,
    timestamp,
    timestamp,
  );

  return getSource(db, id);
}

/**
 * Edit a source in place.
 *
 * The shape is re-derived from the row's kind plus whatever the caller sent, so
 * `mountPath` keeps its invariant whether or not the edit touched it. Changing
 * where the checkout lives does not move the old directory: a metadata edit must
 * never delete files, and the delete path already asks before removing them.
 */
export function updateSource(
  db: Db,
  config: AppConfig,
  id: string,
  input: UpdateSourceInput,
): SourceSummary {
  const current = getSourceRow(db, id);

  if (current.kind === 'local' && (input.repoUrl !== undefined || input.branch !== undefined)) {
    throw new ValidationError('This is a local source: it has no repository URL or branch.');
  }

  const shape = shapeFor(config, current.kind, {
    repoUrl: input.repoUrl ?? current.repo_url ?? '',
    branch: input.branch === undefined ? current.branch : input.branch,
    subPath: input.subPath === undefined ? current.sub_path : input.subPath,
  });

  assertUnique(db, id, input.name ?? current.name, shape.mountPath);

  // A move names a directory that may not exist yet; an edit that leaves the
  // path alone does not, and repairing a vanished one is sync's job.
  if (current.kind === 'local' && shape.mountPath !== current.mount_path) {
    ensureLocalDirectory(config, shape.mountPath);
  }

  // Only a moved checkout or a different ref invalidates what was synced. A
  // rename must not clear the row's state, or every edit would look like a
  // source that had never been read.
  const invalidates =
    shape.mountPath !== current.mount_path ||
    shape.repoUrl !== current.repo_url ||
    shape.branch !== current.branch ||
    shape.subPath !== current.sub_path;

  db.prepare(
    `UPDATE sources SET
       name = ?, repo_url = ?, branch = ?, sub_path = ?, mount_path = ?,
       sync_status = ?, sync_error = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    input.name ?? current.name,
    shape.repoUrl,
    shape.branch,
    shape.subPath,
    shape.mountPath,
    invalidates ? 'never' : current.sync_status,
    invalidates ? null : current.sync_error,
    nowIso(),
    id,
  );

  return getSource(db, id);
}

export function deleteSource(db: Db, config: AppConfig, id: string, removeFiles: boolean): void {
  const row = getSourceRow(db, id);

  // Scripts cascade with the source, taking their executions with them. Say so
  // rather than letting the caller discover it from a vanished history.
  const runs = db
    .prepare<[string], { count: number }>(
      `SELECT COUNT(*) AS count FROM executions e
       JOIN scripts s ON s.id = e.script_id
       WHERE s.source_id = ?`,
    )
    .get(id);

  if (runs && runs.count > 0) {
    throw new ConflictError(
      `This source owns ${runs.count} recorded execution(s). Delete those runs first, or keep the source.`,
    );
  }

  db.prepare('DELETE FROM sources WHERE id = ?').run(id);

  if (removeFiles) {
    // Only ever inside the shared root, and only the directory we manage.
    const absolute = sourceDirectory(config, row);
    if (isInside(config.scriptRootContainer, absolute)) {
      void rm(absolute, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * `-c` overrides that route git's HTTP transport through a proxy.
 *
 * `http.proxy` covers `https://` URLs too -- it is one transport -- so a single
 * key is enough. The override has to precede the subcommand, which is why every
 * git call goes through `runGit` instead of each call site remembering the
 * order.
 */
export function gitProxyArgs(gitProxy: string | undefined): string[] {
  return gitProxy === undefined ? [] : ['-c', `http.proxy=${gitProxy}`];
}

const execFileAsync = promisify(execFile);

/** Run git without a shell, with prompts disabled so it fails instead of hanging. */
async function runGit(config: AppConfig, args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', [...gitProxyArgs(config.gitProxy), ...args], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      env: {
        ...process.env,
        // Fail fast instead of blocking on a credential prompt: only public
        // repositories are supported, so any prompt means a wrong URL.
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '/bin/echo',
        // Ignore host-level config so behaviour is identical everywhere.
        GIT_CONFIG_NOSYSTEM: '1',
      },
    });
    return stdout;
  } catch (error) {
    // `stderr` is where git explains itself; `error.message` is the generic
    // "Command failed: git ..." that carries no reason.
    const stderr = (error as { stderr?: string }).stderr ?? '';
    throw new TargetError(
      `git ${args[0]} failed: ${stderr.trim() || errorMessage(error)}`,
    );
  }
}

async function ensureGitRepository(
  config: AppConfig,
  row: SourceRow,
  absolute: string,
): Promise<void> {
  if (!row.repo_url) throw new ValidationError('This source has no repository URL');

  const hasClone = existsSync(join(absolute, '.git'));

  if (!hasClone) {
    await mkdir(absolute, { recursive: true });
    const args = ['clone', '--depth', '1'];
    if (row.branch) args.push('--branch', row.branch, '--single-branch');
    // `--` terminates option parsing, so a URL can never be read as a flag.
    args.push('--', row.repo_url, absolute);
    await runGit(config, args);
    return;
  }

  // Existing clone: fetch the wanted ref and hard-reset onto it. A hard reset is
  // correct because this directory is ours to manage -- users edit scripts in
  // their own repositories, not in this checkout.
  const ref = row.branch ?? 'HEAD';
  await runGit(config, ['fetch', '--depth', '1', 'origin', ref], absolute);
  await runGit(config, ['reset', '--hard', 'FETCH_HEAD'], absolute);
  // Drop files upstream deleted. -x also clears ignored build output, so a stale
  // artifact cannot be mistaken for a real script.
  await runGit(config, ['clean', '-fdx'], absolute);
}

export async function syncSource(
  db: Db,
  config: AppConfig,
  id: string,
  logger: Logger,
): Promise<SyncResult> {
  const row = getSourceRow(db, id);
  const absolute = sourceDirectory(config, row);
  const warnings: string[] = [];

  db.prepare(
    "UPDATE sources SET sync_status = 'syncing', sync_error = NULL, updated_at = ? WHERE id = ?",
  ).run(nowIso(), id);

  try {
    if (row.kind === 'github') {
      await ensureGitRepository(config, row, absolute);
    } else {
      // Repair as well as seed: a directory deleted on the host is recreated
      // here, so a sync can only fail for a reason worth reporting.
      ensureLocalDirectory(config, row.mount_path);
    }

    // A subdirectory of a repo can be chosen as the script root; scanning starts
    // there, but stored paths stay relative to it.
    const scanRoot = row.kind === 'github' && row.sub_path ? join(absolute, row.sub_path) : absolute;

    const outcome = await scanSourceDirectory(scanRoot);
    warnings.push(...outcome.warnings);
    if (outcome.incomplete) warnings.push('The scan stopped early, so the script list may be incomplete.');

    const counts = syncScripts(db, id, outcome.scripts);
    const timestamp = nowIso();

    db.prepare(
      "UPDATE sources SET sync_status = 'ok', sync_error = NULL, last_sync_at = ?, updated_at = ? WHERE id = ?",
    ).run(timestamp, timestamp, id);

    logger.info({ sourceId: id, ...counts }, 'source synced');
    return { sourceId: id, ...counts, warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    db.prepare(
      "UPDATE sources SET sync_status = 'error', sync_error = ?, last_sync_at = ?, updated_at = ? WHERE id = ?",
    ).run(message, nowIso(), nowIso(), id);
    throw error;
  }
}

/**
 * Build the directory tree the UI shows.
 *
 * Directories are derived from script paths rather than read from disk, so a
 * folder holding no runnable script does not appear at all. Showing empty
 * directories would imply the dashboard can run something in them.
 */
export function getSourceTree(db: Db, id: string): ScriptTreeNode {
  const source = getSourceRow(db, id);
  const rows = db
    .prepare<[string], ScriptRow>(
      'SELECT * FROM scripts WHERE source_id = ? AND deleted_at IS NULL ORDER BY rel_path',
    )
    .all(id);

  const root: ScriptTreeNode = { name: source.name, path: '', type: 'dir', children: [] };
  /** Directory nodes by relative path, so children can be attached in order. */
  const directories = new Map<string, ScriptTreeNode>([['', root]]);

  const ensureDirectory = (path: string): ScriptTreeNode => {
    const cached = directories.get(path);
    if (cached) return cached;

    const parent = ensureDirectory(relativeDir(path));
    const node: ScriptTreeNode = {
      name: path.slice(path.lastIndexOf('/') + 1),
      path,
      type: 'dir',
      children: [],
    };
    parent.children?.push(node);
    directories.set(path, node);
    return node;
  };

  for (const row of rows) {
    const script = toScriptSummary(row);
    const parent = ensureDirectory(script.relDir);
    parent.children?.push({ name: script.fileName, path: script.relPath, type: 'file', script });
  }

  sortTree(root);
  return root;
}

/** Directories first, then files, each alphabetically. */
function sortTree(node: ScriptTreeNode): void {
  if (!node.children) return;
  node.children.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'dir' ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  for (const child of node.children) sortTree(child);
}

