import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('./targets.js', async (original) => ({
  ...await original<typeof import('./targets.js')>(),
  createTransportForTarget: vi.fn(),
}));

import { loadConfig } from '../config.js';
import { openDatabase } from '../db/client.js';
import { createSecretBox } from '../lib/crypto.js';
import { ConflictError, NotFoundError, UnprocessableError, ValidationError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import { createQueue } from '../runner/queue.js';
import type { ExecutionPlan } from '../runner/runner.js';
import { createFakeTransport } from '../transport/fake-transport.js';
import type { Transport } from '../transport/types.js';
import { createExecutionHub } from '../ws/hub.js';
import { createExecutionService } from './executions.js';
import { createScriptScheduleService } from './script-schedules.js';
import { MAX_FILE_BYTES } from './scan.js';
import { createTransportForTarget } from './targets.js';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });
beforeEach(() => vi.mocked(createTransportForTarget).mockReturnValue(createFakeTransport()));

function setup(retentionDays = 30) {
  const temporaryRoot = resolve(import.meta.dirname, '../../../../tmp');
  mkdirSync(temporaryRoot, { recursive: true });
  const root = mkdtempSync(join(temporaryRoot, 'executions-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const db = openDatabase(':memory:');
  cleanups.push(() => db.close());
  const now = '2026-01-01T00:00:00.000Z';
  db.prepare(`INSERT INTO targets (id,name,host,username,auth_method,secret_encrypted,work_dir,created_at,updated_at)
    VALUES ('tgt_1','edge','edge.test','ops','password','unused','/srv',?,?)`).run(now, now);
  db.prepare(`INSERT INTO sources (id,name,kind,mount_path,created_at,updated_at)
    VALUES ('src_1','ops','local','local',?,?)`).run(now, now);
  db.prepare(`INSERT INTO scripts (id,source_id,rel_path,rel_dir,file_name,format,size_bytes,content_hash,display_name,params_json,discovered_at,updated_at)
    VALUES ('scr_1','src_1','deploy.sh','','deploy.sh','sh',10,'hash','Deploy',?, ?,?)`)
    .run(JSON.stringify([{ name: 'ENV', type: 'string', required: true, default: null, description: '' },
      { name: 'COUNT', type: 'number', required: false, default: '3', description: '' }]), now, now);
  mkdirSync(join(root, 'local'));
  const scriptPath = join(root, 'local/deploy.sh');
  writeFileSync(scriptPath, 'echo original\n');
  // Hold scheduled work so submit-time snapshots and queued cancellation are deterministic.
  const scheduled: (() => void)[] = [];
  const queue = createQueue({ concurrency: 1, perKeyConcurrency: 1, schedule: (fn) => scheduled.push(fn) });
  const run = vi.fn(async (_plan: ExecutionPlan, _transport: Transport, _signal: AbortSignal) => 'succeeded' as const);
  const config = { ...loadConfig({ SCRIPT_ROOT_CONTAINER: root, SERVE_WEB: 'false' }), retentionDays };
  const service = createExecutionService({ db, queue, config, runner: { run },
    box: createSecretBox(randomBytes(32)), hub: createExecutionHub(), logger: createLogger({ level: 'silent', pretty: false }) });
  const input = { targetId: 'tgt_1', params: { ENV: 'prod' }, argv: [] as string[] };
  const addRun = (id: string, status = 'succeeded', queuedAt = now) => db.prepare(`INSERT INTO executions
    (id,script_id,target_id,status,command_display,target_name,script_name,script_rel_path,param_values_json,argv_json,work_dir,queued_at)
    VALUES (?,'scr_1','tgt_1',?,'bash deploy.sh','edge','Deploy','deploy.sh','{"ENV":"prod"}','["one"]','/srv',?)`).run(id, status, queuedAt);
  const addLog = (id: string, seq: number) => db.prepare('INSERT INTO execution_logs (execution_id,seq,stream,data,ts) VALUES (?,?,\'stdout\',?,?)').run(id, seq, `line ${seq}`, now);
  return { db, queue, service, run, scheduled, input, addRun, addLog, scriptPath };
}

describe('execution submission', () => {
  test('snapshots script bytes, resolved parameters and argv before queued work starts', async () => {
    const h = setup();
    h.db.prepare('UPDATE scripts SET timeout_sec = 12').run();
    const execution = await h.service.submit('scr_1', { ...h.input, argv: ['a b', '; echo unsafe'], timeoutSec: 7 });
    expect(execution).toMatchObject({ status: 'queued', paramValues: { ENV: 'prod', COUNT: '3' }, argv: ['a b', '; echo unsafe'] });
    writeFileSync(h.scriptPath, 'echo changed\n');
    h.scheduled.shift()!();
    await h.queue.drain();
    const plan = h.run.mock.calls[0]![0];
    expect(plan.scriptBytes.toString()).toBe('echo original\n');
    expect(plan).toMatchObject({ workDir: '/srv', timeoutMs: 7000, argv: execution.argv,
      env: { ENV: 'prod', COUNT: '3', SD_EXECUTION_ID: execution.id, SD_WORK_DIR: '/srv', SD_SOURCE_NAME: 'ops' } });
    expect(plan.scriptPath).toBe(`${plan.stagingDir}/deploy.sh`);
    expect(vi.mocked(createTransportForTarget).mock.results.at(-1)?.value.disposeCount).toBe(1);
  });

  test('uses script timeout and then the configured default when no override is supplied', async () => {
    const h = setup();
    h.db.prepare('UPDATE scripts SET timeout_sec = 12').run();
    await h.service.submit('scr_1', h.input); h.scheduled.shift()!(); await h.queue.drain();
    expect(h.run.mock.calls[0]![0].timeoutMs).toBe(12000);
    h.db.prepare('UPDATE scripts SET timeout_sec = NULL').run();
    await h.service.submit('scr_1', h.input); h.scheduled.shift()!(); await h.queue.drain();
    expect(h.run.mock.calls[1]![0].timeoutMs).toBe(loadConfig({}).defaultTimeoutSec * 1000);
  });

  test.each<{ params: Record<string, string> }>([{ params: {} }, { params: { ENV: 'prod', SD_EXECUTION_ID: 'spoof' } }, { params: { ENV: 'prod', COUNT: 'abc' } }])('refuses invalid params without recording or queueing a run: %j', async (overrides) => {
    const h = setup();
    await expect(h.service.submit('scr_1', { ...h.input, ...overrides })).rejects.toThrow(ValidationError);
    expect(h.service.list({ limit: 50, offset: 0 }).total).toBe(0);
    expect(h.queue.activeCount + h.queue.pendingCount).toBe(0);
  });

  test('rejects unknown and soft-deleted scripts and unknown targets', async () => {
    const h = setup();
    await expect(h.service.submit('missing', h.input)).rejects.toThrow(NotFoundError);
    await expect(h.service.submit('scr_1', { ...h.input, targetId: 'missing' })).rejects.toThrow(NotFoundError);
    h.db.prepare("UPDATE scripts SET deleted_at = '2026-01-01'").run();
    await expect(h.service.submit('scr_1', h.input)).rejects.toThrow(NotFoundError);
  });

  test('refuses missing and oversized script bytes before queueing', async () => {
    const h = setup();
    rmSync(h.scriptPath);
    await expect(h.service.submit('scr_1', h.input)).rejects.toThrow(UnprocessableError);
    writeFileSync(h.scriptPath, Buffer.alloc(MAX_FILE_BYTES + 1));
    await expect(h.service.submit('scr_1', h.input)).rejects.toThrow(/over the/);
    expect(h.service.list({ limit: 1, offset: 0 }).total).toBe(0);
  });

  test('a stale failed host check does not prohibit a new execution', async () => {
    const h = setup(); h.db.prepare('UPDATE targets SET last_check_ok = 0').run();
    expect((await h.service.submit('scr_1', h.input)).status).toBe('queued');
    h.scheduled.shift()!(); await h.queue.drain();
  });

  test('disposes the transport even when the runner fails', async () => {
    const h = setup(); h.run.mockRejectedValueOnce(new Error('connection failed'));
    await h.service.submit('scr_1', h.input); h.scheduled.shift()!(); await h.queue.drain();
    expect(vi.mocked(createTransportForTarget).mock.results.at(-1)?.value.disposeCount).toBe(1);
  });
});

describe('execution history and lifecycle', () => {
  test('combines filters, returns total before paging, and orders tied timestamps newest first', () => {
    const h = setup(); h.addRun('older'); h.addRun('newer'); h.addRun('failed', 'failed');
    const result = h.service.list({ scriptId: 'scr_1', targetId: 'tgt_1', status: 'succeeded', limit: 1, offset: 1 });
    expect(result.total).toBe(2); expect(result.items.map((x) => x.id)).toEqual(['older']);
    expect(h.service.list({ targetId: 'missing', limit: 10, offset: 0 })).toEqual({ total: 0, items: [] });
    expect(h.service.get('newer')).toMatchObject({ paramValues: { ENV: 'prod' }, argv: ['one'], truncated: false });
    expect(() => h.service.get('missing')).toThrow(NotFoundError);
  });

  test('returns only the selected run logs strictly after the cursor, in sequence order', () => {
    const h = setup(); h.addRun('one'); h.addRun('two');
    h.addLog('one', 3); h.addLog('one', 1); h.addLog('one', 2); h.addLog('two', 4);
    expect(h.service.logs('one', 1).map((x) => [x.executionId, x.seq, x.data])).toEqual([['one', 2, 'line 2'], ['one', 3, 'line 3']]);
    expect(h.service.logs('one', 3)).toEqual([]);
  });

  test('marks a waiting task canceled while an active task remains owned by its runner', async () => {
    const h = setup();
    const active = await h.service.submit('scr_1', h.input);
    const waiting = await h.service.submit('scr_1', h.input);
    expect(h.service.cancel(waiting.id)).toMatchObject({ status: 'canceled', errorMessage: 'Canceled before it started.' });
    expect(h.service.cancel(active.id).status).toBe('queued');
    h.scheduled.shift()!(); await h.queue.drain();
    expect(h.run.mock.calls[0]![2].aborted).toBe(true);
    expect(() => h.service.cancel(waiting.id)).toThrow(ConflictError);
  });

  test('reconciles orphaned cancellation and rejects deletion of active rows', () => {
    const h = setup(); h.addRun('orphan', 'queued'); h.addRun('running', 'running');
    expect(() => h.service.remove('orphan')).toThrow(ConflictError);
    expect(() => h.service.remove('running')).toThrow(ConflictError);
    expect(h.service.cancel('orphan')).toMatchObject({ status: 'interrupted', finishedAt: expect.any(String) });
    h.addLog('orphan', 1); h.service.remove('orphan');
    expect(h.service.logs('orphan', 0)).toEqual([]);
    expect(() => h.service.remove('orphan')).toThrow(NotFoundError);
  });

  test('restart reconciliation changes only unfinished runs and is idempotent', () => {
    const h = setup(); h.addRun('queued', 'queued'); h.addRun('running', 'running'); h.addRun('done');
    expect(h.service.markInterrupted()).toBe(2);
    expect(h.service.get('done').status).toBe('succeeded');
    expect(h.service.get('running')).toMatchObject({ status: 'interrupted', finishedAt: expect.any(String) });
    expect(h.service.markInterrupted()).toBe(0);
  });

  test('retention deletes old finished runs and logs while keeping active and recent runs', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-04T00:00:00.000Z'));
    const h = setup(); h.addRun('old'); h.addRun('active', 'running'); h.addRun('recent', 'succeeded', new Date().toISOString()); h.addLog('old', 1);
    expect(h.service.prune()).toBe(1); expect(h.service.logs('old', 0)).toEqual([]);
    expect(h.service.list({ limit: 50, offset: 0 }).items.map((x) => x.id)).toEqual(['recent', 'active']);
    expect(h.service.prune()).toBe(0);
  });

  test('zero retention keeps all history', () => {
    const h = setup(0); h.addRun('old'); expect(h.service.prune()).toBe(0); expect(h.service.get('old').id).toBe('old');
  });
});


test('Cron submissions use the ordinary execution history and runner plan', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:30.000Z'));
  const h = setup();
  const schedules = createScriptScheduleService({
    db: h.db,
    executions: h.service,
    config: { defaultTimeoutSec: 60 },
    logger: createLogger({ level: 'silent', pretty: false }),
  });
  cleanups.push(() => schedules.stop());
  const saved = schedules.save('scr_1', {
    cron: '* * * * *', timeZone: 'UTC', enabled: true,
    input: { ...h.input, argv: ['with space'], timeoutSec: 7 },
  });
  expect(saved.input.params).toEqual({ ENV: 'prod', COUNT: '3' });
  schedules.start();
  await vi.advanceTimersByTimeAsync(30_000);
  const runs = h.service.list({ limit: 10, offset: 0 });
  expect(runs.total).toBe(1);
  expect(runs.items[0]).toMatchObject({ status: 'queued', paramValues: saved.input.params, argv: ['with space'] });
  expect(schedules.get('scr_1')?.lastExecutionId).toBe(runs.items[0]?.id);
  // A slow or queued scheduled run cannot accumulate another invocation each minute.
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.service.list({ limit: 10, offset: 0 }).total).toBe(1);
  h.scheduled.shift()!();
  const drained = h.queue.drain();
  await vi.advanceTimersByTimeAsync(10);
  await drained;
  expect(h.run.mock.calls[0]![0]).toMatchObject({ argv: ['with space'], timeoutMs: 7000, env: { ENV: 'prod', COUNT: '3' } });
});
