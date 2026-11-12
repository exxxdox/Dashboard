import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ExecutionSummary, SaveScriptScheduleInput } from '@dashboard/shared';
import { openDatabase } from '../db/client.js';
import { createLogger } from '../lib/logger.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { createScriptScheduleService } from './script-schedules.js';

const NOW = '2026-11-10T00:00:00.000Z';
const cleanups: (() => void)[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.useRealTimers(); });

function setup() {
  const db = openDatabase(':memory:');
  cleanups.push(() => db.close());
  db.prepare(`INSERT INTO targets (id,name,host,username,auth_method,secret_encrypted,created_at,updated_at)
    VALUES ('tgt_1','edge','edge.test','ops','password','unused',?,?)`).run(NOW, NOW);
  db.prepare(`INSERT INTO sources (id,name,kind,mount_path,created_at,updated_at)
    VALUES ('src_1','ops','local','local',?,?)`).run(NOW, NOW);
  db.prepare(`INSERT INTO scripts (id,source_id,rel_path,rel_dir,file_name,format,size_bytes,content_hash,display_name,params_json,timeout_sec,discovered_at,updated_at)
    VALUES ('scr_1','src_1','job.sh','','job.sh','sh',10,'hash','Job',?,12,?,?)`)
    .run(JSON.stringify([{ name: 'COUNT', type: 'number', required: false, default: '3', description: '' }]), NOW, NOW);
  let sequence = 0;
  const submit = vi.fn(async (_scriptId: string, _input: SaveScriptScheduleInput['input'], _origin?: { scheduleId: string; scheduleName: string; retentionDays: number }) => {
    const id = `run_${++sequence}`;
    db.prepare(`INSERT INTO executions (id,script_id,target_id,status,command_display,target_name,script_name,script_rel_path,work_dir,queued_at)
      VALUES (?,'scr_1','tgt_1','queued','bash job.sh','edge','Job','job.sh','/srv',?)`).run(id, new Date().toISOString());
    return { id } as ExecutionSummary;
  });
  const service = createScriptScheduleService({ db, executions: { submit }, config: { defaultTimeoutSec: 600, retentionDays: 45 }, logger: createLogger({ level: 'silent', pretty: false }) });
  cleanups.push(() => service.stop());
  const input: SaveScriptScheduleInput = { scriptId: 'scr_1', name: 'Daily job', retentionDays: 30, cron: '* * * * *', timeZone: 'UTC', enabled: true, input: { targetId: 'tgt_1', params: {}, argv: ['a b'] } };
  return { db, service, input, submit };
}

describe('script schedules', () => {
  test('creates multiple independent invocation snapshots for one script', () => {
    const h = setup();
    const first = h.service.create(h.input);
    const second = h.service.create({ ...h.input, name: 'Evening job', retentionDays: 0, cron: '0 18 * * *' });
    expect(first.id).not.toBe(second.id);
    h.input.input.argv.push('changed');
    h.db.prepare(`UPDATE scripts SET run_draft_json = '{"params":{"COUNT":"99"}}'`).run();
    expect(h.service.get(first.id)).toMatchObject({ scriptId: 'scr_1', name: 'Daily job', retentionDays: 30,
      input: { targetId: 'tgt_1', params: { COUNT: '3' }, argv: ['a b'], timeoutSec: 12 }, nextRunAt: '2026-11-10T00:01:00.000Z' });
    expect(h.service.get(second.id)).toMatchObject({ name: 'Evening job', retentionDays: 0 });
    expect(h.service.list()).toHaveLength(2);
  });

  test('snapshots an explicitly chosen working directory and leaves a default one to each run', () => {
    const h = setup();
    const chosen = h.service.create({ ...h.input, name: 'Chosen', input: { ...h.input.input, workDir: '/srv/app' } });
    expect(chosen.input.workDir).toBe('/srv/app');
    expect(h.service.get(chosen.id).input.workDir).toBe('/srv/app');
    expect(h.service.create({ ...h.input, name: 'Defaulted' }).input).not.toHaveProperty('workDir');
  });

  test('rejects duplicate names on create and rename without changing saved plans', () => {
    const h = setup();
    const first = h.service.create(h.input);
    for (const name of ['Daily job', ' Daily job ', 'daily JOB']) {
      expect(() => h.service.create({ ...h.input, name })).toThrow(ConflictError);
    }
    const second = h.service.create({ ...h.input, name: 'Evening' });
    expect(() => h.service.save(second.id, { ...h.input, name: ' Daily job ' })).toThrow(ConflictError);
    expect(h.service.get(second.id).name).toBe('Evening');
    expect(h.service.save(first.id, { ...h.input, enabled: false }).enabled).toBe(false);
    h.service.remove(first.id);
    expect(h.service.create(h.input).name).toBe('Daily job');
  });

  test.each(['* * * * * *', '@daily', '61 * * * *', '* * 31 2 *'])('rejects unusable Cron %s before saving', (cron) => {
    const h = setup();
    expect(() => h.service.create({ ...h.input, cron })).toThrow(ValidationError);
    expect(h.service.list()).toEqual([]);
  });

  test('validates time zones, parameters and entity existence without submitting', () => {
    const h = setup();
    expect(() => h.service.create({ ...h.input, timeZone: 'Invalid/Zone' })).toThrow(ValidationError);
    expect(() => h.service.create({ ...h.input, input: { ...h.input.input, params: { SD_EXECUTION_ID: 'spoof' } } })).toThrow(ValidationError);
    expect(() => h.service.create({ ...h.input, scriptId: 'missing' })).toThrow(NotFoundError);
    expect(() => h.service.get('missing')).toThrow(NotFoundError);
    expect(() => h.service.save('missing', h.input)).toThrow(NotFoundError);
    expect(() => h.service.remove('missing')).toThrow(NotFoundError);
    expect(() => h.service.create({ ...h.input, input: { ...h.input.input, targetId: 'missing' } })).toThrow(NotFoundError);
    expect(h.submit).not.toHaveBeenCalled();
  });

  test('calculates Cron in the saved time zone with standard day OR semantics', () => {
    const h = setup();
    expect(h.service.create({ ...h.input, cron: '0 9 * * *', timeZone: 'Asia/Shanghai' }).nextRunAt).toBe('2026-11-10T01:00:00.000Z');
    expect(h.service.create({ ...h.input, name: 'Other rule', cron: '0 9 12 * 3' }).nextRunAt).toBe('2026-11-11T09:00:00.000Z');
  });

  test('keeps overlap protection per plan and submits atomic execution origin metadata', async () => {
    const h = setup();
    const first = h.service.create(h.input);
    const second = h.service.create({ ...h.input, name: 'Second', retentionDays: 7 });
    h.service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.submit).toHaveBeenCalledTimes(2);
    expect(h.submit).toHaveBeenCalledWith('scr_1', { targetId: 'tgt_1', params: { COUNT: '3' }, argv: ['a b'], timeoutSec: 12 },
      { scheduleId: first.id, scheduleName: 'Daily job', retentionDays: 30 });
    expect(h.submit).toHaveBeenCalledWith('scr_1', expect.anything(), { scheduleId: second.id, scheduleName: 'Second', retentionDays: 7 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.submit).toHaveBeenCalledTimes(2);
    h.db.prepare('UPDATE executions SET status = ? WHERE id = ?').run('succeeded', h.service.get(first.id).lastExecutionId);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.submit).toHaveBeenCalledTimes(3);
    expect(h.service.get(second.id).lastExecutionId).toBe('run_2');
  });

  test('restart restores future triggers without replaying missed times and start is idempotent', async () => {
    const h = setup(); const saved = h.service.create(h.input);
    vi.setSystemTime('2026-11-10T00:05:30.000Z'); h.service.start(); h.service.start();
    expect(h.service.get(saved.id).nextRunAt).toBe('2026-11-10T00:06:00.000Z');
    await vi.advanceTimersByTimeAsync(29_000); expect(h.submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000); expect(h.submit).toHaveBeenCalledTimes(1);
    h.service.stop(); await vi.advanceTimersByTimeAsync(120_000); expect(h.submit).toHaveBeenCalledTimes(1);
  });

  test('editing or deleting one plan does not affect another plan or execution history', async () => {
    const h = setup(); const first = h.service.create(h.input); const second = h.service.create({ ...h.input, name: 'Second' }); h.service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.service.save(first.id, { ...h.input, enabled: false, retentionDays: 2 })).toMatchObject({ retentionDays: 2, nextRunAt: null, lastExecutionId: 'run_1' });
    expect(h.service.get(second.id).enabled).toBe(true);
    h.db.prepare('UPDATE executions SET schedule_id = ? WHERE id = ?').run(first.id, 'run_1');
    h.service.remove(first.id); expect(() => h.service.get(first.id)).toThrow(NotFoundError);
    expect(h.db.prepare('SELECT retention_days FROM executions WHERE id = ?').get('run_1')).toEqual({ retention_days: 2 });
    expect(h.service.list()).toHaveLength(1);
    expect(h.db.prepare('SELECT id FROM executions').all()).toHaveLength(2);
  });

  test('records safe submission failures and retries only at the next Cron time', async () => {
    const h = setup(); h.submit.mockRejectedValueOnce(new Error('secret-token=private'));
    const saved = h.service.create(h.input); h.service.start(); await vi.advanceTimersByTimeAsync(60_000);
    expect(h.service.get(saved.id)).toMatchObject({ lastError: 'submit_failed', nextRunAt: '2026-11-10T00:02:00.000Z' });
    expect(JSON.stringify(h.service.get(saved.id))).not.toContain('private');
    await vi.advanceTimersByTimeAsync(60_000); expect(h.submit).toHaveBeenCalledTimes(2); expect(h.service.get(saved.id).lastError).toBeNull();
  });

  test('soft-deleted scripts do not run and disappear from the list, but plans remain removable', async () => {
    const h = setup(); const saved = h.service.create(h.input); h.service.start(); h.db.prepare('UPDATE scripts SET deleted_at = ?').run(NOW);
    await vi.advanceTimersByTimeAsync(120_000); expect(h.submit).not.toHaveBeenCalled(); expect(h.service.list()).toEqual([]);
    expect(() => h.service.save(saved.id, h.input)).toThrow(NotFoundError);
    h.service.remove(saved.id); expect(() => h.service.get(saved.id)).toThrow(NotFoundError);
  });

  test('legacy retention inherits global configuration without silently shortening history', () => {
    const h = setup(); const saved = h.service.create(h.input);
    h.db.prepare('UPDATE script_schedules SET retention_days = NULL WHERE id = ?').run(saved.id);
    expect(h.service.get(saved.id).retentionDays).toBe(45);
  });

  test('corrupt stored plans are disabled at startup without stopping valid schedules', () => {
    const h = setup(); const saved = h.service.create(h.input); const valid = h.service.create({ ...h.input, name: 'Valid' });
    h.db.prepare("UPDATE script_schedules SET cron = 'invalid' WHERE id = ?").run(saved.id); h.service.start();
    expect(h.service.get(saved.id)).toMatchObject({ enabled: false, nextRunAt: null, lastError: 'invalid_schedule' }); expect(h.service.get(valid.id).enabled).toBe(true);
  });

  test('saving while a submission is pending retains its execution for overlap protection', async () => {
    const h = setup(); const original = h.submit.getMockImplementation()!; let finish!: () => void;
    h.submit.mockImplementationOnce(async (...args) => { await new Promise<void>((resolve) => { finish = resolve; }); return original(...args); });
    const saved = h.service.create(h.input); h.service.start(); await vi.advanceTimersByTimeAsync(60_000);
    h.service.save(saved.id, { ...h.input, input: { ...h.input.input, params: { COUNT: '9' } } }); finish(); await vi.advanceTimersByTimeAsync(1);
    expect(h.service.get(saved.id)).toMatchObject({ lastExecutionId: 'run_1', input: { params: { COUNT: '9' } } });
    await vi.advanceTimersByTimeAsync(60_000); expect(h.submit).toHaveBeenCalledTimes(1);
  });

  test('a late submission result cannot write after stop and database close', async () => {
    const h = setup(); let finish!: (value: ExecutionSummary) => void; h.submit.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    h.service.create(h.input); h.service.start(); await vi.advanceTimersByTimeAsync(60_000); h.service.stop(); h.db.close();
    finish({ id: 'run_late' } as ExecutionSummary); await vi.advanceTimersByTimeAsync(120_000); expect(h.submit).toHaveBeenCalledTimes(1);
  });

  test('deleting during submission cannot resurrect a plan or contaminate a new one', async () => {
    const h = setup(); let fail!: (reason: Error) => void; h.submit.mockImplementationOnce(() => new Promise((_resolve,reject) => { fail = reject; }));
    const saved = h.service.create(h.input); h.service.start(); await vi.advanceTimersByTimeAsync(120_000); expect(h.submit).toHaveBeenCalledTimes(1);
    h.service.remove(saved.id); const replacement = h.service.create(h.input); fail(new Error('old private configuration')); await vi.advanceTimersByTimeAsync(1);
    expect(h.service.get(replacement.id)).toMatchObject({ lastError: null, lastExecutionId: null }); expect(() => h.service.get(saved.id)).toThrow(NotFoundError);
  });
});


test('refuses new schedules for retired PowerShell scripts', () => {
  const h = setup();
  h.db.prepare("UPDATE scripts SET format = 'ps1', rel_path = 'job.ps1', file_name = 'job.ps1'").run();
  expect(() => h.service.create(h.input)).toThrow(ValidationError);
  expect(h.db.prepare('SELECT COUNT(*) AS n FROM script_schedules').get()).toEqual({ n: 0 });
});
