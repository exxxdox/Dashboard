import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { loadConfig, type AppConfig } from '../config.js';
import { openDatabase, type Db } from '../db/client.js';
import { ConflictError, ValidationError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { createSource, deleteSource, gitProxyArgs, syncSource, updateSource } from './sources.js';

/** Roots created by `setup`, removed after each test. */
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const logger = createLogger({ level: 'silent', pretty: false });

/**
 * A real shared root under the temp directory: a local source creates its own
 * directory now, and that is only provable against a filesystem.
 */
function setup(): { db: Db; config: AppConfig; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'dashboard-sources-'));
  roots.push(root);
  return {
    db: openDatabase(':memory:'),
    config: loadConfig({ SCRIPT_ROOT_CONTAINER: root }),
    root,
  };
}

/** A source that already has a checkout and a completed sync, for edit tests. */
function synced(db: Db, config: AppConfig, input: Parameters<typeof createSource>[2]) {
  const source = createSource(db, config, input);
  db.prepare("UPDATE sources SET sync_status = 'ok', last_sync_at = ? WHERE id = ?").run(
    '2026-01-01T00:00:00.000Z',
    source.id,
  );
  return source;
}

describe('gitProxyArgs', () => {
  test('adds nothing when no proxy is configured', () => {
    expect(gitProxyArgs(undefined)).toEqual([]);
  });

  test('passes the proxy as a -c override, which must precede the subcommand', () => {
    expect(gitProxyArgs('http://127.0.0.1:7890')).toEqual(['-c', 'http.proxy=http://127.0.0.1:7890']);
  });

  test('accepts the scheme-less host:port form git also understands', () => {
    expect(gitProxyArgs('127.0.0.1:7890')).toEqual(['-c', 'http.proxy=127.0.0.1:7890']);
  });

  test('keeps credentials in the proxy URL intact', () => {
    expect(gitProxyArgs('socks5h://user:pass@proxy.internal:1080')).toEqual([
      '-c',
      'http.proxy=socks5h://user:pass@proxy.internal:1080',
    ]);
  });
});

describe('updateSource', () => {
  test('renames a source and leaves its directory alone', () => {
    const { db, config } = setup();
    const source = synced(db, config, { name: 'ops', kind: 'local', subPath: 'local' });

    const updated = updateSource(db, config, source.id, { name: 'ops-scripts' });

    expect(updated.name).toBe('ops-scripts');
    expect(updated.mountPath).toBe('local');
  });

  test('refuses a name another source already uses', () => {
    const { db, config } = setup();
    createSource(db, config, { name: 'taken', kind: 'local', subPath: 'local' });
    const source = createSource(db, config, { name: 'ops', kind: 'local', subPath: 'other' });

    expect(() => updateSource(db, config, source.id, { name: 'taken' })).toThrow(ConflictError);
  });

  test('lets a source keep its own name', () => {
    const { db, config } = setup();
    const source = createSource(db, config, { name: 'ops', kind: 'local', subPath: 'local' });

    expect(updateSource(db, config, source.id, { name: 'ops' }).name).toBe('ops');
  });

  test('moves a local source to another directory', () => {
    const { db, config } = setup();
    const source = synced(db, config, { name: 'ops', kind: 'local', subPath: 'local' });

    const updated = updateSource(db, config, source.id, { subPath: 'ops-scripts' });

    expect(updated.mountPath).toBe('ops-scripts');
    expect(updated.subPath).toBe('ops-scripts');
  });

  test('refuses a local directory another source already holds', () => {
    const { db, config } = setup();
    createSource(db, config, { name: 'taken', kind: 'local', subPath: 'local' });
    const source = createSource(db, config, { name: 'ops', kind: 'local', subPath: 'other' });

    expect(() => updateSource(db, config, source.id, { subPath: 'local' })).toThrow(ConflictError);
  });

  test('refuses a local directory that would escape the shared root', () => {
    const { db, config } = setup();
    const source = createSource(db, config, { name: 'ops', kind: 'local', subPath: 'local' });

    expect(() => updateSource(db, config, source.id, { subPath: '../etc' })).toThrow(ValidationError);
  });

  test('refuses to leave a local source without a directory', () => {
    const { db, config } = setup();
    const source = createSource(db, config, { name: 'ops', kind: 'local', subPath: 'local' });

    expect(() => updateSource(db, config, source.id, { subPath: '  ' })).toThrow(ValidationError);
  });

  test('refuses repository settings on a local source', () => {
    const { db, config } = setup();
    const source = createSource(db, config, { name: 'ops', kind: 'local', subPath: 'local' });

    expect(() =>
      updateSource(db, config, source.id, { repoUrl: 'https://github.com/acme/ops' }),
    ).toThrow(ValidationError);
  });

  test('repoints a GitHub source and follows the new repository slug', () => {
    const { db, config } = setup();
    const source = synced(db, config, {
      name: 'ops',
      kind: 'github',
      repoUrl: 'https://github.com/acme/ops',
    });

    const updated = updateSource(db, config, source.id, {
      repoUrl: 'https://github.com/other/repo',
    });

    expect(updated.mountPath).toBe('repos/other__repo');
    expect(updated.repoUrl).toContain('github.com/other/repo');
  });

  test('reports an unusable repository URL as a validation error, not a crash', () => {
    const { db, config } = setup();
    const source = createSource(db, config, {
      name: 'ops',
      kind: 'github',
      repoUrl: 'https://github.com/acme/ops',
    });

    expect(() => updateSource(db, config, source.id, { repoUrl: 'not a url' })).toThrow(
      ValidationError,
    );
  });

  test('clears the branch back to the repository default', () => {
    const { db, config } = setup();
    const source = createSource(db, config, {
      name: 'ops',
      kind: 'github',
      repoUrl: 'https://github.com/acme/ops',
      branch: 'release',
    });

    expect(updateSource(db, config, source.id, { branch: null }).branch).toBeNull();
  });

  test('sends a GitHub source back to never-synced when its ref changes', () => {
    const { db, config } = setup();
    const source = synced(db, config, {
      name: 'ops',
      kind: 'github',
      repoUrl: 'https://github.com/acme/ops',
    });

    const updated = updateSource(db, config, source.id, { branch: 'release' });

    // The stored scripts came from the old ref, so the row must stop claiming
    // they are current.
    expect(updated.syncStatus).toBe('never');
  });

  test('leaves the sync state alone when only the name changes', () => {
    const { db, config } = setup();
    const source = synced(db, config, { name: 'ops', kind: 'local', subPath: 'local' });

    expect(updateSource(db, config, source.id, { name: 'renamed' }).syncStatus).toBe('ok');
  });
});

/**
 * A local source owns its directory. The bind mount exists so the files survive
 * a container rebuild, not as a precondition the host has to satisfy first.
 */
describe('local directories', () => {
  test.each([['ops', 'ops/child'], ['ops/child', 'ops']])('rejects overlapping source directories %s and %s', (first, second) => {
    const { db, config } = setup();
    createSource(db, config, { name: 'first', kind: 'local', subPath: first });
    expect(() => createSource(db, config, { name: 'second', kind: 'local', subPath: second })).toThrow(ConflictError);
  });

  test('allows separate directories that only share a text prefix', () => {
    const { db, config } = setup();
    createSource(db, config, { name: 'first', kind: 'local', subPath: 'ops' });
    expect(() => createSource(db, config, { name: 'second', kind: 'local', subPath: 'ops2' })).not.toThrow();
  });

  test('rejects moving a source inside another source', () => {
    const { db, config } = setup();
    createSource(db, config, { name: 'first', kind: 'local', subPath: 'ops' });
    const second = createSource(db, config, { name: 'second', kind: 'local', subPath: 'other' });
    expect(() => updateSource(db, config, second.id, { subPath: 'ops/child' })).toThrow(ConflictError);
  });

  test('keeps legacy overlapping files and rows when deleting their parent with files', () => {
    const { db, config, root } = setup();
    const parent = createSource(db, config, { name: 'parent', kind: 'local', subPath: 'ops' });
    const child = createSource(db, config, { name: 'child', kind: 'local', subPath: 'other' });
    db.prepare('UPDATE sources SET mount_path = ?, sub_path = ? WHERE id = ?').run('ops/child', 'ops/child', child.id);
    writeFileSync(join(root, 'ops', 'test.sh'), 'echo keep');
    expect(() => deleteSource(db, config, parent.id, true)).toThrow(ConflictError);
    expect(db.prepare('SELECT id FROM sources WHERE id = ?').get(parent.id)).toBeDefined();
    expect(existsSync(join(root, 'ops', 'test.sh'))).toBe(true);
    // Forgetting a row without touching shared files remains the recovery path.
    expect(() => deleteSource(db, config, parent.id, false)).not.toThrow();
  });

  test('refuses a legacy overlapping GitHub sync before changing files or sync status', async () => {
    const { db, config, root } = setup();
    const github = createSource(db, config, { name: 'github', kind: 'github', repoUrl: 'https://github.com/example/scripts' });
    const local = createSource(db, config, { name: 'local', kind: 'local', subPath: 'other' });
    db.prepare('UPDATE sources SET mount_path = ?, sub_path = ? WHERE id = ?').run(`${github.mountPath}/personal`, `${github.mountPath}/personal`, local.id);
    // An incomplete checkout avoids making a network call if the ownership guard regresses.
    mkdirSync(join(root, github.mountPath, '.git'), { recursive: true });
    await expect(syncSource(db, config, github.id, logger)).rejects.toThrow(ConflictError);
    expect(db.prepare('SELECT sync_status FROM sources WHERE id = ?').get(github.id)).toEqual({ sync_status: 'never' });
  });

  test('creates the directory when a local source is added', () => {
    const { db, config, root } = setup();

    createSource(db, config, { name: 'ops', kind: 'local', subPath: 'ops-scripts' });

    expect(existsSync(join(root, 'ops-scripts'))).toBe(true);
  });

  test('creates the intermediate directories a nested path names', () => {
    const { db, config, root } = setup();

    createSource(db, config, { name: 'ops', kind: 'local', subPath: 'team/ops' });

    expect(existsSync(join(root, 'team/ops'))).toBe(true);
  });

  test('creates the directory when a local source is moved to a new one', () => {
    const { db, config, root } = setup();
    const source = createSource(db, config, { name: 'ops', kind: 'local', subPath: 'before' });

    updateSource(db, config, source.id, { subPath: 'after' });

    expect(existsSync(join(root, 'after'))).toBe(true);
    // A metadata edit still never deletes files, so the old directory stays.
    expect(existsSync(join(root, 'before'))).toBe(true);
  });

  test('recreates a vanished directory instead of refusing to sync', async () => {
    const { db, config, root } = setup();
    const source = createSource(db, config, { name: 'ops', kind: 'local', subPath: 'ops-scripts' });
    rmSync(join(root, 'ops-scripts'), { recursive: true, force: true });

    const result = await syncSource(db, config, source.id, logger);

    expect(result.total).toBe(0);
    expect(existsSync(join(root, 'ops-scripts'))).toBe(true);
  });

  test('reports an unwritable directory as a validation error, not a crash', () => {
    const { db, config, root } = setup();
    // A file where a directory would have to go: mkdir cannot succeed here.
    writeFileSync(join(root, 'blocked'), 'not a directory');

    expect(() =>
      createSource(db, config, { name: 'ops', kind: 'local', subPath: 'blocked/child' }),
    ).toThrow(ValidationError);
  });
});
