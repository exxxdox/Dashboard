import { describe, expect, test } from 'vitest';

import { loadConfig, type AppConfig } from '../config.js';
import { openDatabase, type Db } from '../db/client.js';
import { ConflictError, ValidationError } from '../lib/errors.js';
import { createSource, gitProxyArgs, updateSource } from './sources.js';

function setup(): { db: Db; config: AppConfig } {
  return {
    db: openDatabase(':memory:'),
    config: loadConfig({ SCRIPT_ROOT_CONTAINER: '/workspace' }),
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
