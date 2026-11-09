import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ExecutionSummary, SaveScriptScheduleInput } from '@dashboard/shared';
import { openDatabase } from '../db/client.js';
import { createLogger } from '../lib/logger.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { createScriptScheduleService } from './script-schedules.js';

const NOW = '2026-11-10T00:00:00.000Z';
const cleanups: (() => void)[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); vi.useRealTimers(); });

function setup() {
  const db = openDatabase(':memory:');
  cleanups.push(() => db.close());
  db.prepare(`INSERT INTO targets (id,name,host,username,auth_method,secret_encrypted,work_dir,created_at,updated_at)
    VALUES ('tgt_1','edge','edge.test','ops','password','unused','/srv',?,?)`).run(NOW, NOW);
  db.prepare(`INSERT INTO sources (id,name,kind,mount_path,created_at,updated_at)
    VALUES ('src_1','ops','local','local',?,?)`).run(NOW, NOW);
  db.prepare(`INSERT INTO scripts (id,source_id,rel_path,rel_dir,file_name,format,size_bytes,content_hash,display_name,params_json,timeout_sec,discovered_at,updated_at)
    VALUES ('scr_1','src_1','job.sh','','job.sh','sh',10,'hash','Job',?,12,?,?)`)
    .run(JSON.stringify([{ name: 'COUNT', type: 'number', required: false, default: '3', description: '' }]), NOW, NOW);
  let sequence = 0;
  const submit = vi.fn(async (_scriptId: string, _input: SaveScriptScheduleInput['input']) => {
    const id = `run_${++sequence}`;
    db.prepare(`INSERT INTO executions (id,script_id,target_id,status,command_display,target_name,script_name,script_rel_path,work_dir,queued_at)
      VALUES (?,'scr_1','tgt_1','queued','bash job.sh','edge','Job','job.sh','/srv',?)`).run(id, new Date().toISOString());
    return { id } as ExecutionSummary;
  });
  const service = createScriptScheduleService({ db, executions: { submit }, config: { defaultTimeoutSec: 600 }, logger: createLogger({ level: 'silent', pretty: false }) });
  cleanups.push(() => service.stop());
  const input: SaveScriptScheduleInput = { cron: '* * * * *', timeZone: 'UTC', enabled: true, input: { targetId: 'tgt_1', params: {}, argv: ['a b'] } };
  return { db, service, input, submit };
}

describe('script schedules', () => {
  test('saves a validated snapshot independently of the run draft', () => {
    const h = setup();
    expect(h.service.get('scr_1')).toBeNull();
    const saved = h.service.save('scr_1', h.input);
    h.input.input.argv.push('changed');
    h.db.prepare(`UPDATE scripts SET run_draft_json = '{"params":{"COUNT":"99"}}'`).run();
    expect(h.service.get('scr_1')).toMatchObject({
      scriptId: 'scr_1', cron: '* * * * *', timeZone: 'UTC', enabled: true, targetName: 'edge',
      input: { targetId: 'tgt_1', params: { COUNT: '3' }, argv: ['a b'], timeoutSec: 12 },
      nextRunAt: '2026-11-10T00:01:00.000Z', lastError: null, lastExecutionId: null,
    });
    expect(saved).not.toHaveProperty('secret_encrypted');
  });

  test.each(['* * * * * *', '@daily', '61 * * * *', '* * 31 2 *'])('rejects unusable Cron %s before saving', (cron) => {
    const h = setup();
    expect(() => h.service.save('scr_1', { ...h.input, cron })).toThrow(ValidationError);
    expect(h.service.get('scr_1')).toBeNull();
  });

  test('validates time zones, parameters and entity existence without submitting work', () => {
    const h = setup();
    expect(() => h.service.save('scr_1', { ...h.input, timeZone: 'Invalid/Zone' })).toThrow(ValidationError);
    expect(() => h.service.save('scr_1', { ...h.input, input: { ...h.input.input, params: { SD_EXECUTION_ID: 'spoof' } } })).toThrow(ValidationError);
    expect(() => h.service.save('missing', h.input)).toThrow(NotFoundError);
    expect(() => h.service.get('missing')).toThrow(NotFoundError);
    expect(() => h.service.save('scr_1', { ...h.input, input: { ...h.input.input, targetId: 'missing' } })).toThrow(NotFoundError);
    expect(h.submit).not.toHaveBeenCalled();
  });

  test('calculates Cron in the saved time zone with standard day OR semantics', () => {
    const h = setup();
    expect(h.service.save('scr_1', { ...h.input, cron: '0 9 * * *', timeZone: 'Asia/Shanghai' }).nextRunAt).toBe('2026-11-10T01:00:00.000Z');
    expect(h.service.save('scr_1', { ...h.input, cron: '0 9 12 * 3' }).nextRunAt).toBe('2026-11-11T09:00:00.000Z');
  });

  test('fires through the execution service and skips queued or running previous runs', async () => {
    const h = setup();
    h.service.save('scr_1', h.input); h.service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.submit).toHaveBeenLastCalledWith('scr_1', { targetId: 'tgt_1', params: { COUNT: '3' }, argv: ['a b'], timeoutSec: 12 });
    expect(h.service.get('scr_1')).toMatchObject({ lastExecutionId: 'run_1', lastTriggeredAt: '2026-11-10T00:01:00.000Z', nextRunAt: '2026-11-10T00:02:00.000Z' });
    await vi.advanceTimersByTimeAsync(60_000);
    h.db.prepare("UPDATE executions SET status = 'running'").run();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.submit).toHaveBeenCalledTimes(1);
    h.db.prepare("UPDATE executions SET status = 'succeeded'").run();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.submit).toHaveBeenCalledTimes(2);
  });

  test('restart restores future triggers without replaying missed times and start is idempotent', async () => {
    const h = setup(); h.service.save('scr_1', h.input);
    vi.setSystemTime('2026-11-10T00:05:30.000Z');
    h.service.start(); h.service.start();
    expect(h.service.get('scr_1')?.nextRunAt).toBe('2026-11-10T00:06:00.000Z');
    await vi.advanceTimersByTimeAsync(29_000); expect(h.submit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000); expect(h.submit).toHaveBeenCalledTimes(1);
    h.service.stop(); await vi.advanceTimersByTimeAsync(120_000); expect(h.submit).toHaveBeenCalledTimes(1);
  });

  test('disabling and removing stop future submissions without deleting execution history', async () => {
    const h = setup(); h.service.save('scr_1', h.input); h.service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.service.save('scr_1', { ...h.input, enabled: false })).toMatchObject({ nextRunAt: null, lastExecutionId: 'run_1' });
    await vi.advanceTimersByTimeAsync(60_000); expect(h.submit).toHaveBeenCalledTimes(1);
    h.service.remove('scr_1'); expect(h.service.get('scr_1')).toBeNull();
    expect(h.db.prepare('SELECT id FROM executions').get()).toEqual({ id: 'run_1' });
  });

  test('records safe submission failures and retries only at the next Cron time', async () => {
    const h = setup(); h.submit.mockRejectedValueOnce(new Error('secret-token=private'));
    h.service.save('scr_1', h.input); h.service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.service.get('scr_1')).toMatchObject({ lastError: 'submit_failed', nextRunAt: '2026-11-10T00:02:00.000Z' });
    expect(JSON.stringify(h.service.get('scr_1'))).not.toContain('private');
    await vi.advanceTimersByTimeAsync(60_000); expect(h.submit).toHaveBeenCalledTimes(2);
    expect(h.service.get('scr_1')?.lastError).toBeNull();
  });

  test('does not execute soft-deleted scripts and cannot save plans for them', async () => {
    const h = setup(); h.service.save('scr_1', h.input); h.service.start();
    h.db.prepare('UPDATE scripts SET deleted_at = ?').run(NOW);
    await vi.advanceTimersByTimeAsync(120_000); expect(h.submit).not.toHaveBeenCalled();
    expect(() => h.service.save('scr_1', h.input)).toThrow(NotFoundError);
  });

  test('corrupt stored plans are disabled at startup without stopping valid schedules', () => {
    const h = setup(); h.service.save('scr_1', h.input);
    h.db.prepare("UPDATE script_schedules SET cron = 'invalid'").run();
    h.service.start();
    expect(h.service.get('scr_1')).toMatchObject({ enabled: false, nextRunAt: null, lastError: 'invalid_schedule' });
  });

  test('saving while a submission is pending retains its execution for overlap protection', async () => {
    const h = setup();
    const original = h.submit.getMockImplementation()!;
    let finish!: () => void;
    h.submit.mockImplementationOnce(async (...args) => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return original(...args);
    });
    h.service.save('scr_1', h.input); h.service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    h.service.save('scr_1', { ...h.input, input: { ...h.input.input, params: { COUNT: '9' } } });
    finish(); await vi.advanceTimersByTimeAsync(1);
    expect(h.service.get('scr_1')).toMatchObject({ lastExecutionId: 'run_1', input: { params: { COUNT: '9' } } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  test('a late submission result cannot write after stop and database close', async () => {
    const h = setup();
    let finish!: (value: ExecutionSummary) => void;
    h.submit.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    h.service.save('scr_1', h.input); h.service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    h.service.stop(); h.db.close();
    finish({ id: 'run_late' } as ExecutionSummary);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.submit).toHaveBeenCalledTimes(1);
  });

  test('deleting and recreating during a submission does not inherit its late error', async () => {
    const h = setup();
    let fail!: (reason: Error) => void;
    h.submit.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    h.service.save('scr_1', h.input); h.service.start();
    await vi.advanceTimersByTimeAsync(60_000);
    h.service.remove('scr_1'); h.service.save('scr_1', h.input);
    fail(new Error('old private configuration'));
    await vi.advanceTimersByTimeAsync(1);
    expect(h.service.get('scr_1')).toMatchObject({ lastError: null, lastExecutionId: null });
  });

  test('in-flight submissions cannot duplicate or resurrect deleted plans', async () => {
    const h = setup();
    let finish!: (value: ExecutionSummary) => void;
    h.submit.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    h.service.save('scr_1', h.input); h.service.start();
    await vi.advanceTimersByTimeAsync(120_000); expect(h.submit).toHaveBeenCalledTimes(1);
    h.service.remove('scr_1');
    finish({ id: 'not-stored' } as ExecutionSummary);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.service.get('scr_1')).toBeNull();
  });
});
