import { describe, expect, test } from 'vitest';
import type { RunDraft, ScriptParam } from '@script-dashboard/shared';

import { openDatabase, type Db } from '../db/client.js';
import { NotFoundError } from '../lib/errors.js';
import { getRunPrefill, saveRunDraft } from './run-draft.js';

const DECLARED: ScriptParam[] = [
  { name: 'ENV', type: 'string', required: true, default: null, description: 'Target environment' },
  { name: 'REPLICAS', type: 'number', required: false, default: '3', description: '' },
];

const NOW = '2026-01-01T00:00:00.000Z';

/** A script with declared parameters, and whatever runs the caller adds. */
function seed(db: Db, params: ScriptParam[] = DECLARED): string {
  db.prepare(
    `INSERT INTO sources (id, name, kind, mount_path, sync_status, created_at, updated_at)
     VALUES ('src_1', 'ops', 'local', 'local', 'ok', ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO targets (id, name, host, port, username, auth_method, secret_encrypted,
       work_dir, created_at, updated_at)
     VALUES ('tgt_1', 'edge', '10.0.0.1', 22, 'deploy', 'key', 'x', '/srv', ?, ?)`,
  ).run(NOW, NOW);
  db.prepare(
    `INSERT INTO scripts (id, source_id, rel_path, rel_dir, file_name, format, size_bytes,
       content_hash, display_name, params_json, discovered_at, updated_at)
     VALUES ('scr_1', 'src_1', 'deploy.sh', '', 'deploy.sh', 'sh', 10, 'h', 'deploy.sh', ?, ?, ?)`,
  ).run(JSON.stringify(params), NOW, NOW);
  return 'scr_1';
}

function addRun(
  db: Db,
  id: string,
  queuedAt: string,
  params: Record<string, string>,
  argv: string[] = [],
): void {
  db.prepare(
    `INSERT INTO executions (id, script_id, target_id, status, command_display, target_name,
       script_name, script_rel_path, param_values_json, argv_json, work_dir, queued_at)
     VALUES (?, 'scr_1', 'tgt_1', 'succeeded', 'bash deploy.sh', 'edge', 'deploy.sh', 'deploy.sh',
       ?, ?, '/srv', ?)`,
  ).run(id, JSON.stringify(params), JSON.stringify(argv), queuedAt);
}

describe('getRunPrefill', () => {
  test('reports nothing to restore for a script that was never run or edited', () => {
    const db = openDatabase(':memory:');
    const scriptId = seed(db);

    expect(getRunPrefill(db, scriptId)).toEqual({
      source: 'none',
      draft: { params: {}, custom: [], timeoutSec: '' },
    });
  });

  test('restores the last run when there is no draft', () => {
    const db = openDatabase(':memory:');
    const scriptId = seed(db);
    addRun(db, 'ex_1', '2026-01-01T00:00:00.000Z', { ENV: 'prod', REPLICAS: '5' }, ['100', '200']);

    const prefill = getRunPrefill(db, scriptId);

    expect(prefill.source).toBe('last-run');
    // Declared values come back as parameters, not as custom rows: the form has
    // its own input for them.
    expect(prefill.draft.params).toEqual({ ENV: 'prod', REPLICAS: '5' });
    expect(prefill.draft.custom).toEqual([
      { name: '', value: '100', mode: 'argv' },
      { name: '', value: '200', mode: 'argv' },
    ]);
  });

  test('returns the newest run, not the first one recorded', () => {
    const db = openDatabase(':memory:');
    const scriptId = seed(db);
    addRun(db, 'ex_1', '2026-01-01T00:00:00.000Z', { ENV: 'staging', REPLICAS: '1' });
    addRun(db, 'ex_2', '2026-02-01T00:00:00.000Z', { ENV: 'prod', REPLICAS: '5' });

    expect(getRunPrefill(db, scriptId).draft.params).toEqual({ ENV: 'prod', REPLICAS: '5' });
  });

  test('turns an environment value the script never declared into a custom row', () => {
    const db = openDatabase(':memory:');
    const scriptId = seed(db);
    addRun(db, 'ex_1', NOW, { ENV: 'prod', API_BASE: 'https://example.test' });

    const custom = getRunPrefill(db, scriptId).draft.custom;
    expect(custom).toEqual([{ name: 'API_BASE', value: 'https://example.test', mode: 'env' }]);
  });

  test('prefers a draft over the last run, which the draft may not even resemble', () => {
    const db = openDatabase(':memory:');
    const scriptId = seed(db);
    addRun(db, 'ex_1', NOW, { ENV: 'prod', REPLICAS: '5' });
    const draft: RunDraft = {
      params: { ENV: 'canary' },
      custom: [{ name: '起始端口', value: '100', mode: 'argv' }],
      timeoutSec: '900',
    };
    saveRunDraft(db, scriptId, draft);

    expect(getRunPrefill(db, scriptId)).toEqual({ source: 'draft', draft });
  });

  test('falls back to the last run once the draft is cleared', () => {
    const db = openDatabase(':memory:');
    const scriptId = seed(db);
    addRun(db, 'ex_1', NOW, { ENV: 'prod', REPLICAS: '5' });
    saveRunDraft(db, scriptId, { params: { ENV: 'canary' }, custom: [], timeoutSec: '' });
    saveRunDraft(db, scriptId, { params: {}, custom: [], timeoutSec: '' });

    expect(getRunPrefill(db, scriptId).source).toBe('last-run');
  });

  test('treats a column that is not JSON at all as no draft', () => {
    // Only reachable by editing the database by hand -- the API always writes
    // JSON.stringify -- but reading it must not throw: the form loses a
    // convenience, where a 500 would cost the whole page.
    const db = openDatabase(':memory:');
    const scriptId = seed(db);
    db.prepare("UPDATE scripts SET run_draft_json = 'not json' WHERE id = ?").run(scriptId);

    expect(getRunPrefill(db, scriptId)).toEqual({
      source: 'none',
      draft: { params: {}, custom: [], timeoutSec: '' },
    });
  });

  test('falls back to the last run when the draft column is unusable', () => {
    const db = openDatabase(':memory:');
    const scriptId = seed(db);
    addRun(db, 'ex_1', NOW, { ENV: 'prod' });
    db.prepare("UPDATE scripts SET run_draft_json = '{' WHERE id = ?").run(scriptId);

    expect(getRunPrefill(db, scriptId).source).toBe('last-run');
  });

  test('refuses a script that does not exist, so the route can answer 404', () => {
    const db = openDatabase(':memory:');
    expect(() => getRunPrefill(db, 'scr_missing')).toThrow(NotFoundError);
  });
});

describe('saveRunDraft', () => {
  test('keeps a row that has not been filled in yet', () => {
    const db = openDatabase(':memory:');
    const scriptId = seed(db);
    const draft: RunDraft = {
      params: {},
      custom: [{ name: 'START', value: '', mode: 'argv' }],
      timeoutSec: '',
    };

    saveRunDraft(db, scriptId, draft);

    expect(getRunPrefill(db, scriptId).draft).toEqual(draft);
  });

  test('replaces the previous draft rather than merging with it', () => {
    const db = openDatabase(':memory:');
    const scriptId = seed(db);
    saveRunDraft(db, scriptId, {
      params: { ENV: 'prod' },
      custom: [{ name: 'A', value: '1', mode: 'env' }],
      timeoutSec: '',
    });
    saveRunDraft(db, scriptId, { params: { ENV: 'dev' }, custom: [], timeoutSec: '60' });

    expect(getRunPrefill(db, scriptId).draft).toEqual({
      params: { ENV: 'dev' },
      custom: [],
      timeoutSec: '60',
    });
  });

  test('refuses a script that does not exist', () => {
    const db = openDatabase(':memory:');
    expect(() =>
      saveRunDraft(db, 'scr_missing', { params: {}, custom: [], timeoutSec: '' }),
    ).toThrow(NotFoundError);
  });
});
