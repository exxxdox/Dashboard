import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import type { ExecutionSummary, ServerMessage } from '@dashboard/shared';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { AppContext } from '../context.js';
import { openDatabase } from '../db/client.js';
import { createAuthenticator, createLoginThrottle } from '../lib/auth.js';
import { createSecretBox } from '../lib/crypto.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import type { ExecutionService } from '../services/executions.js';
import { createExecutionHub } from '../ws/hub.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup() {
  const db = openDatabase(':memory:');
  const summary: ExecutionSummary = {
    id: 'run_1', scheduleId: null, scheduleName: null, scriptId: 'scr_1', targetId: 'tgt_1', status: 'queued', exitCode: null, signal: null,
    commandDisplay: 'bash deploy.sh', targetName: 'edge', scriptName: 'Deploy', scriptRelPath: 'deploy.sh',
    paramValues: {}, argv: [], queuedAt: '2026-01-01T00:00:00.000Z', startedAt: null, finishedAt: null,
    durationMs: null, logBytes: 0, truncated: false, errorMessage: null,
  };
  const terminalControl = { write: vi.fn(() => true), resize: vi.fn() };
  let ready = false;
  const executions = {
    terminal: vi.fn(() => ready ? terminalControl : null),
    submit: vi.fn(async () => summary), get: vi.fn((id: string) => { if (id !== summary.id) throw new NotFoundError('Execution'); return summary; }),
    list: vi.fn(() => ({ items: [summary], total: 1 })), logs: vi.fn(() => []),
    cancel: vi.fn(() => ({ ...summary, status: 'canceled' as const })), remove: vi.fn(),
    markInterrupted: vi.fn(() => 0), prune: vi.fn(() => 0),
  } satisfies ExecutionService;
  const hub = createExecutionHub();
  const unsubscribe = vi.fn();
  const originalSubscribe = hub.subscribe;
  const subscribe = vi.spyOn(hub, 'subscribe');
  subscribe.mockImplementation((id, listener) => {
    const dispose = originalSubscribe(id, listener);
    return () => { dispose(); unsubscribe(); };
  });
  let shuttingDown = false;
  const app = await buildApp({
    config: loadConfig({ SCRIPT_ROOT_CONTAINER: '/workspace', SERVE_WEB: 'false' }), db,
    box: createSecretBox(randomBytes(32)), logger: createLogger({ level: 'silent', pretty: false }),
    auth: createAuthenticator({}), loginThrottle: createLoginThrottle(), executions, hub,
    isShuttingDown: () => shuttingDown,
  } as unknown as AppContext);
  cleanups.push(async () => { await app.close(); db.close(); });
  await app.ready();
  return { app, executions, hub, subscribe, unsubscribe, summary, terminalControl, ready: () => { ready = true; }, shutdown: () => { shuttingDown = true; } };
}

test('execute validates inputs, returns accepted identity, and rejects new work during shutdown', async () => {
  const h = await setup();
  const payload = { targetId: 'tgt_1', params: { ENV: 'prod' }, argv: ['a b'] };
  const accepted = await h.app.inject({ method: 'POST', url: '/api/scripts/scr_1/execute', payload });
  expect(accepted.statusCode).toBe(202); expect(accepted.json()).toEqual({ executionId: 'run_1', status: 'queued' });
  expect(h.executions.submit).toHaveBeenCalledWith('scr_1', payload);
  for (const invalid of [{}, { ...payload, argv: 'not-an-array' }, { ...payload, timeoutSec: -1 }]) {
    expect((await h.app.inject({ method: 'POST', url: '/api/scripts/scr_1/execute', payload: invalid })).statusCode).toBe(422);
  }
  expect(h.executions.submit).toHaveBeenCalledTimes(1);
  h.shutdown();
  const refused = await h.app.inject({ method: 'POST', url: '/api/scripts/scr_1/execute', payload });
  expect(refused.statusCode).toBe(503); expect(refused.json().error.code).toBe('shutting_down');
  expect(h.executions.submit).toHaveBeenCalledTimes(1);
});

test('history validates paging and status, applies defaults and forwards filters', async () => {
  const h = await setup();
  expect((await h.app.inject('/api/executions')).statusCode).toBe(200);
  expect(h.executions.list).toHaveBeenLastCalledWith({ limit: 50, offset: 0 });
  const response = await h.app.inject('/api/executions?scriptId=scr_1&targetId=tgt_1&status=failed&limit=2&offset=3');
  expect(response.json().total).toBe(1);
  expect(h.executions.list).toHaveBeenLastCalledWith({ scriptId: 'scr_1', targetId: 'tgt_1', status: 'failed', limit: 2, offset: 3 });
  await h.app.inject('/api/executions?scheduleId=sch_1');
  expect(h.executions.list).toHaveBeenLastCalledWith({ scheduleId: 'sch_1', limit: 50, offset: 0 });
  for (const query of ['limit=0', 'limit=201', 'offset=-1', 'status=unknown']) {
    expect((await h.app.inject(`/api/executions?${query}`)).statusCode).toBe(422);
  }
});

test('detail and logs distinguish unknown execution from empty output and validate cursor', async () => {
  const h = await setup();
  expect((await h.app.inject('/api/executions/run_1')).json().id).toBe('run_1');
  expect((await h.app.inject('/api/executions/missing')).statusCode).toBe(404);
  expect((await h.app.inject('/api/executions/missing/logs')).statusCode).toBe(404);
  expect(h.executions.logs).not.toHaveBeenCalled();
  expect((await h.app.inject('/api/executions/run_1/logs')).json()).toEqual([]);
  expect(h.executions.logs).toHaveBeenLastCalledWith('run_1', 0);
  await h.app.inject('/api/executions/run_1/logs?afterSeq=12');
  expect(h.executions.logs).toHaveBeenLastCalledWith('run_1', 12);
  expect((await h.app.inject('/api/executions/run_1/logs?afterSeq=-1')).statusCode).toBe(422);
});

test('cancel and delete preserve service conflicts and use the expected response contracts', async () => {
  const h = await setup();
  const canceled = await h.app.inject({ method: 'POST', url: '/api/executions/run_1/cancel' });
  expect(canceled.json().status).toBe('canceled'); expect(h.executions.cancel).toHaveBeenCalledWith('run_1');
  h.executions.remove.mockImplementationOnce(() => { throw new ConflictError('Cancel first'); });
  expect((await h.app.inject({ method: 'DELETE', url: '/api/executions/run_1' })).statusCode).toBe(409);
  const removed = await h.app.inject({ method: 'DELETE', url: '/api/executions/run_1' });
  expect(removed.statusCode).toBe(204); expect(removed.body).toBe('');
  expect(h.executions.remove).toHaveBeenLastCalledWith('run_1');
});

test('websocket validates messages, deduplicates subscriptions, streams events and cleans up on close', async () => {
  const h = await setup();
  const messages: ServerMessage[] = [];
  const socket = await h.app.injectWS('/api/ws', {}, { onInit: (ws) => ws.on('message', (raw: Buffer) => messages.push(JSON.parse(raw.toString()) as ServerMessage)) });
  const send = async (message: unknown) => {
    const previous = messages.length;
    socket.send(typeof message === 'string' ? message : JSON.stringify(message));
    await vi.waitFor(() => expect(messages.length).toBeGreaterThan(previous));
    return messages.at(-1);
  };
  expect(messages[0]).toMatchObject({ type: 'hello', serverTime: expect.any(String) });
  expect(await send('{')).toEqual({ type: 'error', message: 'Malformed message' });
  expect(await send({ type: 'unknown' })).toEqual({ type: 'error', message: 'Unrecognised message' });
  expect(await send({ type: 'ping' })).toEqual({ type: 'pong' });
  expect(await send({ type: 'subscribe', executionId: 'missing' })).toEqual({ type: 'error', message: 'No such execution' });
  expect(await send({ type: 'subscribe', executionId: 'run_1' })).toEqual({ type: 'subscribed', executionId: 'run_1' });
  await send({ type: 'subscribe', executionId: 'run_1' }); expect(h.subscribe).toHaveBeenCalledTimes(1);
  const event = { type: 'log', chunk: { executionId: 'run_1', seq: 1, stream: 'stdout', data: 'hello', ts: new Date().toISOString() } } as const;
  h.hub.publish('run_1', event); await vi.waitFor(() => expect(messages.at(-1)).toEqual(event));
  socket.send(JSON.stringify({ type: 'unsubscribe', executionId: 'run_1' }));
  await vi.waitFor(() => expect(h.unsubscribe).toHaveBeenCalledTimes(1));
  const count = messages.length; h.hub.publish('run_1', event);
  await send({ type: 'ping' }); expect(messages.length).toBe(count + 1);
  await send({ type: 'subscribe', executionId: 'run_1' });
  // injectWS uses duplex streams; terminate the server endpoint to model a disconnected peer.
  for (const peer of h.app.websocketServer.clients) peer.terminate();
  socket.terminate(); await vi.waitFor(() => expect(h.unsubscribe).toHaveBeenCalledTimes(2));
});


async function terminalPeer(h: Awaited<ReturnType<typeof setup>>) {
  const messages: ServerMessage[] = [];
  const peersBefore = new Set(h.app.websocketServer.clients);
  const socket = await h.app.injectWS('/api/ws', {}, {
    onInit: (ws) => ws.on('message', (raw: Buffer) => messages.push(JSON.parse(raw.toString()) as ServerMessage)),
  });
  const send = async (message: unknown) => {
    const count = messages.length;
    socket.send(JSON.stringify(message));
    await vi.waitFor(() => expect(messages.length).toBeGreaterThan(count));
    return messages.at(-1);
  };
  cleanups.push(async () => { socket.terminate(); });
  const serverSocket = [...h.app.websocketServer.clients].find((peer) => !peersBefore.has(peer))!;
  return { socket, serverSocket, messages, send };
}

test('terminal input requires a subscription, ready PTY and exclusive control, then releases on disconnect', async () => {
  const h = await setup();
  h.summary.interactive = true; h.summary.status = 'running';
  const first = await terminalPeer(h);
  expect(await first.send({ type: 'terminal_claim', executionId: 'run_1' })).toMatchObject({ error: 'not_subscribed' });
  await first.send({ type: 'subscribe', executionId: 'run_1' });
  expect(await first.send({ type: 'terminal_claim', executionId: 'run_1' })).toMatchObject({ state: 'waiting' });
  h.ready();
  expect(await first.send({ type: 'terminal_claim', executionId: 'run_1' })).toMatchObject({ state: 'controlling' });
  const second = await terminalPeer(h);
  await second.send({ type: 'subscribe', executionId: 'run_1' });
  expect(await second.send({ type: 'terminal_claim', executionId: 'run_1' })).toMatchObject({ state: 'busy' });
  expect(await second.send({ type: 'terminal_input', executionId: 'run_1', data: 'secret' })).toMatchObject({ error: 'not_controller' });
  expect(h.terminalControl.write).not.toHaveBeenCalled();
  first.socket.send(JSON.stringify({ type: 'terminal_input', executionId: 'run_1', data: '\x1b[A' }));
  await vi.waitFor(() => expect(h.terminalControl.write).toHaveBeenCalledWith('\x1b[A'));
  first.socket.send(JSON.stringify({ type: 'terminal_resize', executionId: 'run_1', cols: 90, rows: 30 }));
  await vi.waitFor(() => expect(h.terminalControl.resize).toHaveBeenCalledWith(90, 30));
  // Explicit release does not stop the execution and permits the watcher to take control.
  await first.send({ type: 'terminal_release', executionId: 'run_1' });
  expect(await second.send({ type: 'terminal_claim', executionId: 'run_1' })).toMatchObject({ state: 'controlling' });
  h.hub.publish('run_1', { type: 'terminal_state', executionId: 'run_1', state: 'closed' });
  await vi.waitFor(() => expect(second.messages.at(-1)).toMatchObject({ state: 'closed' }));
  expect(h.executions.cancel).not.toHaveBeenCalled();
});

test('invalid terminal input and sizes never reach the remote channel, and overflow is reported without echoing input', async () => {
  const h = await setup(); h.summary.interactive = true; h.summary.status = 'running'; h.ready();
  const peer = await terminalPeer(h);
  await peer.send({ type: 'subscribe', executionId: 'run_1' });
  await peer.send({ type: 'terminal_claim', executionId: 'run_1' });
  for (const message of [
    { type: 'terminal_input', data: '密'.repeat(6000) },
    { type: 'terminal_resize', cols: 0, rows: 20 },
    { type: 'terminal_resize', cols: 80, rows: 501 },
  ]) {
    expect(await peer.send({ ...message, executionId: 'run_1' })).toMatchObject({ type: 'error' });
  }
  expect(h.terminalControl.write).not.toHaveBeenCalled();
  expect(h.terminalControl.resize).not.toHaveBeenCalled();
  h.terminalControl.write.mockReturnValue(false);
  const refused = await peer.send({ type: 'terminal_input', executionId: 'run_1', data: 'private-input' });
  expect(refused).toMatchObject({ type: 'terminal_state', error: 'input_overflow' });
  expect(JSON.stringify(refused)).not.toContain('private-input');
  h.summary.status = 'succeeded';
  expect(await peer.send({ type: 'terminal_input', executionId: 'run_1', data: 'late' })).toMatchObject({ state: 'closed' });
  expect(h.terminalControl.write).toHaveBeenCalledTimes(1);
});

test('WebSocket upgrades reject foreign origins even without configured sign-in', async () => {
  const h = await setup();
  for (const origin of ['https://evil.example', 'null']) {
    const response = await h.app.inject({ method: 'GET', url: '/api/ws', headers: {
      host: 'dashboard.test', origin, connection: 'Upgrade', upgrade: 'websocket',
      'sec-websocket-version': '13', 'sec-websocket-key': randomBytes(16).toString('base64'),
    } });
    expect(response.statusCode).toBe(403);
  }
});


test('disconnecting the controller releases its lease without cancelling the run', async () => {
  const h = await setup(); h.summary.interactive = true; h.summary.status = 'running'; h.ready();
  const first = await terminalPeer(h);
  await first.send({ type: 'subscribe', executionId: 'run_1' });
  await first.send({ type: 'terminal_claim', executionId: 'run_1' });
  const second = await terminalPeer(h);
  await second.send({ type: 'subscribe', executionId: 'run_1' });
  expect(await second.send({ type: 'terminal_claim', executionId: 'run_1' })).toMatchObject({ state: 'busy' });
  first.serverSocket.terminate(); first.socket.terminate();
  await vi.waitFor(() => expect(second.messages.at(-1)).toMatchObject({ state: 'available' }));
  expect(await second.send({ type: 'terminal_claim', executionId: 'run_1' })).toMatchObject({ state: 'controlling' });
  expect(h.executions.cancel).not.toHaveBeenCalled();
});
