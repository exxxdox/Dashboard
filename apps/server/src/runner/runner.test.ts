import { randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, test, vi, type Mock } from 'vitest';

import type { ExecutionSummary, ServerMessage } from '@dashboard/shared';
import { cleanupStagingCommand, resolveInterpreter } from '@dashboard/shared';

import { openDatabase, type Db } from '../db/client.js';
import { createLogger } from '../lib/logger.js';
import { createSecretBox } from '../lib/crypto.js';
import { getExecution } from '../services/executions.js';
import { createNotificationService, type NotificationService } from '../services/notifications/service.js';
import type { GotifyMessage } from '../services/notifications/gotify.js';
import {
  createFakeTransport,
  type FakeExec,
  type FakeScript,
  type FakeTransport,
} from '../transport/fake-transport.js';
import { createExecutionHub } from '../ws/hub.js';
import { createExecutionRunner, type ExecutionPlan } from './runner.js';

const STAGING_DIR = '/tmp/sd-run_test';
const SCRIPT_PATH = `${STAGING_DIR}/api.sh`;
const WORK_DIR = '/srv/scripts';
const SCRIPT_BYTES = Buffer.from('echo hello\n');
const EXECUTION_ID = 'run_test';

/** Insert the minimal graph an execution row needs, then the row itself. */
function seed(db: Db): void {
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO targets (id, name, host, port, username, auth_method, secret_encrypted,
       work_dir, connect_timeout_sec, created_at, updated_at)
     VALUES ('tgt_1','edge','edge.test',22,'deploy','key','x','/srv/scripts',15,?,?)`,
  ).run(now, now);

  db.prepare(
    `INSERT INTO sources (id, name, kind, mount_path, created_at, updated_at)
     VALUES ('src_1','ops','local','local',?,?)`,
  ).run(now, now);

  db.prepare(
    `INSERT INTO scripts (id, source_id, rel_path, rel_dir, file_name, format, size_bytes,
       content_hash, display_name, params_json, discovered_at, updated_at)
     VALUES ('scr_1','src_1','api.sh','','api.sh','sh',10,'hash','Deploy API','[]',?,?)`,
  ).run(now, now);

  db.prepare(
    `INSERT INTO executions (id, script_id, target_id, status, command_display, target_name,
       script_name, script_rel_path, param_values_json, work_dir, queued_at)
     VALUES (?, 'scr_1','tgt_1','queued','bash api.sh','edge','Deploy API','api.sh','{}',?,?)`,
  ).run(EXECUTION_ID, WORK_DIR, now);
}

type Harness = {
  db: Db;
  messages: ServerMessage[];
  notifications: NotificationService;
  notify: Mock<(message: GotifyMessage) => Promise<boolean>>;
  logger: ReturnType<typeof createLogger>;
  /** What the most recent run asked the transport to do. */
  transportExecs: () => FakeExec[];
  run: (
    scripts: FakeScript[],
    options?: { timeoutMs?: number | null; signal?: AbortSignal; argv?: readonly string[] },
  ) => Promise<string>;
};

function buildHarness(maxLogBytes = 1024 * 1024): Harness {
  const db = openDatabase(':memory:');
  seed(db);

  const hub = createExecutionHub();
  const messages: ServerMessage[] = [];
  hub.subscribe(EXECUTION_ID, (message) => messages.push(message));

  const notify = vi.fn<(message: GotifyMessage) => Promise<boolean>>(async () => true);
  const notifications = createNotificationService({
    db, box: createSecretBox(randomBytes(32)), notify,
  });
  notifications.saveSettings({ gotifyAddress: 'notify.test', gotifyToken: 'gotify-secret' });
  const logger = createLogger({ level: 'silent', pretty: false });

  const runner = createExecutionRunner({
    db,
    hub,
    logger,
    maxLogBytes,
    loadSummary: (id) => getExecution(db, id),
    sendNotification: (notification) => notifications.send(notification),
  });

  let lastTransport: FakeTransport | undefined;

  return {
    db,
    messages,
    notifications,
    notify,
    logger,
    /** What the most recent run asked the transport to do. */
    transportExecs: () => lastTransport?.execs ?? [],
    async run(scripts, options = {}) {
      const transport = createFakeTransport({ scripts });
      lastTransport = transport;
      const plan: ExecutionPlan = {
        executionId: EXECUTION_ID,
        scriptPath: SCRIPT_PATH,
        stagingDir: STAGING_DIR,
        workDir: WORK_DIR,
        interpreter: resolveInterpreter('.sh'),
        displayCommand: 'bash api.sh',
        scriptBytes: SCRIPT_BYTES,
        env: { ENV: 'prod' },
        paramValues: { ENV: 'prod' },
        argv: options.argv ?? [],
        timeoutMs: options.timeoutMs ?? null,
      };

      return runner.run(plan, transport, options.signal ?? new AbortController().signal);
    },
  };
}

/** Read the persisted log rows in order. */
function readLogs(db: Db): { seq: number; stream: string; data: string }[] {
  return db
    .prepare<[string], { seq: number; stream: string; data: string }>(
      'SELECT seq, stream, data FROM execution_logs WHERE execution_id = ? ORDER BY seq',
    )
    .all(EXECUTION_ID);
}

describe('createExecutionRunner', () => {
  let h: Harness;

  beforeEach(() => {
    h = buildHarness();
  });

  test.each([
    { script: { match: SCRIPT_PATH, exitCode: 0 }, status: 'succeeded', label: 'Succeeded / 成功' },
    { script: { match: SCRIPT_PATH, exitCode: 3 }, status: 'failed', label: 'Failed / 失败' },
    { script: { match: SCRIPT_PATH, failWith: new Error('connection refused') }, status: 'failed', label: 'Failed / 失败' },
    { script: { match: SCRIPT_PATH, hangUntilAborted: true }, status: 'timed_out', label: 'Timed out / 超时' },
  ])('notifies once after persisting $status and publishing its final status', async ({ script, status, label }) => {
    let summaryAtSend: ExecutionSummary | undefined;
    let eventAtSend: ServerMessage | undefined;
    h.notify.mockImplementation(async () => {
      summaryAtSend = getExecution(h.db, EXECUTION_ID);
      eventAtSend = h.messages.at(-1);
      return true;
    });

    await expect(h.run([script], { timeoutMs: 20 })).resolves.toBe(status);
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({
      address: 'notify.test', token: 'gotify-secret',
      title: `Script result / 脚本结果: ${label}`,
      message: expect.stringContaining(`Result / 结果: ${label}`),
    }));
    const message = h.notify.mock.calls[0]![0].message;
    expect(summaryAtSend?.status).toBe(status);
    expect(summaryAtSend?.finishedAt).toEqual(expect.any(String));
    expect(eventAtSend).toMatchObject({ type: 'status', execution: { status } });
    expect(message).toContain(`Duration / 耗时: ${(summaryAtSend!.durationMs! / 1000).toFixed(1)} s`);
    expect(message).toContain('Script / 脚本: Deploy API');
    expect(message).toContain('Target / 目标: edge');
    expect(message).toContain(`Run / 运行: ${EXECUTION_ID}`);
  });

  test('notifies about a running cancellation without forwarding the aborted signal', async () => {
    const controller = new AbortController();
    const pending = h.run([{ match: SCRIPT_PATH, hangUntilAborted: true }], { signal: controller.signal });
    controller.abort();
    await expect(pending).resolves.toBe('canceled');
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(h.notify.mock.calls[0]![0].title).toContain('Canceled / 已取消');
    expect(h.notify.mock.calls[0]![0].signal).toBeUndefined();
  });

  test('does not send when Gotify is unconfigured', async () => {
    h.notifications.saveSettings({ clearGotifyToken: true });
    await expect(h.run([{ match: SCRIPT_PATH, exitCode: 0 }])).resolves.toBe('succeeded');
    expect(h.notify).not.toHaveBeenCalled();
  });

  test.each([{ exitCode: 0, status: 'succeeded' }, { exitCode: 3, status: 'failed' }])(
    'keeps $status when notification delivery fails and logs no raw delivery error', async ({ exitCode, status }) => {
    const warn = vi.spyOn(h.logger, 'warn');
    h.notify.mockRejectedValue(new Error('Gotify answered 500 token=secret'));
    await expect(h.run([{ match: SCRIPT_PATH, exitCode }])).resolves.toBe(status);
    expect(getExecution(h.db, EXECUTION_ID)).toMatchObject({ status, exitCode, errorMessage: null });
    expect(h.messages.at(-1)).toMatchObject({ type: 'status', execution: { status } });
    expect(h.notify).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ executionId: EXECUTION_ID }, 'execution result notification failed');
  });

  test.each([
    { match: SCRIPT_PATH, stdout: 'output-secret', exitCode: 0 },
    { match: SCRIPT_PATH, failWith: new Error('transport-secret') },
  ])('does not include arguments, parameters, output or transport errors in notifications ($exitCode)', async (script) => {
    h.db.prepare('UPDATE executions SET param_values_json = ? WHERE id = ?')
      .run(JSON.stringify({ TOKEN: 'parameter-secret' }), EXECUTION_ID);
    await h.run([script], { argv: ['argument-secret'] });
    const { title, message } = h.notify.mock.calls[0]![0];
    expect(`${title}\n${message}`).not.toMatch(/parameter-secret|argument-secret|output-secret|transport-secret|gotify-secret/);
  });

  test('marks a zero exit as succeeded and records the exit code', async () => {
    const status = await h.run([{ match: SCRIPT_PATH, stdout: 'deploying\n', exitCode: 0 }]);

    expect(status).toBe('succeeded');
    const summary = getExecution(h.db, EXECUTION_ID);
    expect(summary.status).toBe('succeeded');
    expect(summary.exitCode).toBe(0);
    expect(summary.startedAt).not.toBeNull();
    expect(summary.finishedAt).not.toBeNull();
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('marks a non-zero exit as failed', async () => {
    await h.run([{ match: SCRIPT_PATH, stderr: 'boom\n', exitCode: 3 }]);
    const summary = getExecution(h.db, EXECUTION_ID);
    expect(summary.status).toBe('failed');
    expect(summary.exitCode).toBe(3);
  });

  test('records a signal-terminated process with the signal name', async () => {
    await h.run([{ match: SCRIPT_PATH, signal: 'KILL', exitCode: null }]);
    const summary = getExecution(h.db, EXECUTION_ID);
    expect(summary.status).toBe('failed');
    expect(summary.signal).toBe('KILL');
  });

  test('persists a header line and the script output in order', async () => {
    await h.run([{ match: SCRIPT_PATH, stdout: 'one\n', stderr: 'warn\n', exitCode: 0 }]);

    const logs = readLogs(h.db);
    expect(logs[0]?.stream).toBe('system');
    expect(logs[0]?.data).toContain('bash api.sh');
    // The staging path is different on every run, so it must never become part
    // of a history row that someone reads back later.
    expect(logs[0]?.data).not.toContain(STAGING_DIR);
    expect(logs.map((row) => row.seq)).toEqual([1, 2, 3]);
    expect(logs[1]).toMatchObject({ stream: 'stdout', data: 'one\n' });
    expect(logs[2]).toMatchObject({ stream: 'stderr', data: 'warn\n' });
  });

  test('sends the script bytes and a cleanup command to the transport', async () => {
    await h.run([{ match: SCRIPT_PATH, exitCode: 0 }]);

    const exec = h.transportExecs()[0];
    // The host does not have the file: the bytes are the only copy it gets.
    expect(exec?.stdin?.equals(SCRIPT_BYTES)).toBe(true);
    expect(exec?.cleanupCommand).toBe(cleanupStagingCommand(STAGING_DIR));
  });

  test('cleans up after a cancelled run as well as a finished one', async () => {
    // A cancelled run leaves the most behind, because the remote command was
    // stopped before it could reach its own cleanup.
    const controller = new AbortController();
    const running = h.run([{ match: SCRIPT_PATH, hangUntilAborted: true }], {
      signal: controller.signal,
    });
    controller.abort();
    await running;

    expect(h.transportExecs()[0]?.cleanupCommand).toBe(cleanupStagingCommand(STAGING_DIR));
  });

  test('says so when the script did not reach the host intact', async () => {
    await h.run([{ match: SCRIPT_PATH, stdinFailWith: 'connection reset', exitCode: 0 }]);

    // Without this line a dropped connection reads exactly like a script that
    // exited non-zero without explaining itself.
    const text = readLogs(h.db)
      .map((row) => row.data)
      .join('');
    expect(text).toContain('did not reach the host intact');
    expect(text).toContain('connection reset');
  });

  test('publishes log and status events for live subscribers', async () => {
    await h.run([{ match: SCRIPT_PATH, stdout: 'hi\n', exitCode: 0 }]);

    const types = h.messages.map((message) => message.type);
    expect(types).toContain('log');
    expect(types).toContain('status');

    const last = h.messages.filter((message) => message.type === 'status').at(-1);
    expect(last?.type === 'status' ? last.execution.status : null).toBe('succeeded');
  });

  test('marks a canceled run and keeps output produced before it stopped', async () => {
    const controller = new AbortController();

    const pending = h.run([{ match: SCRIPT_PATH, stdout: 'partial\n', hangUntilAborted: true }], {
      signal: controller.signal,
    });

    controller.abort();
    const status = await pending;

    expect(status).toBe('canceled');
    expect(getExecution(h.db, EXECUTION_ID).status).toBe('canceled');
    expect(readLogs(h.db).some((row) => row.data === 'partial\n')).toBe(true);
  });

  test('marks a run that exceeded its timeout as timed out', async () => {
    const status = await h.run([{ match: SCRIPT_PATH, hangUntilAborted: true }], { timeoutMs: 20 });

    expect(status).toBe('timed_out');
    expect(getExecution(h.db, EXECUTION_ID).status).toBe('timed_out');
  });

  test('reports a transport failure as failed with the error message', async () => {
    const status = await h.run([{ match: SCRIPT_PATH, failWith: new Error('connect ECONNREFUSED') }]);

    expect(status).toBe('failed');
    expect(getExecution(h.db, EXECUTION_ID).errorMessage).toContain('ECONNREFUSED');
    // The failure also goes into the log, so the run page explains itself.
    expect(readLogs(h.db).some((row) => row.data.includes('transport error'))).toBe(true);
  });

  test('stops persisting past the capture limit, flags the run, and says so', async () => {
    // A small cap so a modest amount of output trips it.
    const small = buildHarness(120);
    await small.run([{ match: SCRIPT_PATH, stdout: 'x'.repeat(500), exitCode: 0 }]);

    const summary = getExecution(small.db, EXECUTION_ID);
    expect(summary.truncated).toBe(true);

    const logs = readLogs(small.db);
    expect(logs.at(-1)?.stream).toBe('system');
    expect(logs.at(-1)?.data).toContain('truncated');
    expect(summary.logBytes).toBeLessThan(500);
  });

  test('keeps streaming to live subscribers even after the capture limit', async () => {
    const small = buildHarness(120);
    await small.run([{ match: SCRIPT_PATH, stdout: 'x'.repeat(500), exitCode: 0 }]);

    // Storage is bounded; live delivery is not, because someone watching a
    // runaway script should still see it running.
    const delivered = small.messages
      .filter((message) => message.type === 'log')
      .reduce((total, message) => total + (message.type === 'log' ? message.chunk.data.length : 0), 0);

    expect(delivered).toBeGreaterThan(400);
  });
});
