import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import type { ScriptSchedule } from '@dashboard/shared';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import type { AppContext } from '../context.js';
import { openDatabase } from '../db/client.js';
import { createAuthenticator, createLoginThrottle } from '../lib/auth.js';
import { createSecretBox } from '../lib/crypto.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import type { ScriptScheduleService } from '../services/script-schedules.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function setup(login = false) {
  const db = openDatabase(':memory:');
  const auth = createAuthenticator(login ? { username: 'operator', password: 'password' } : {});
  const schedule: ScriptSchedule = {
    id: 'sch_1', scriptId: 'scr_1', name: 'Daily job', retentionDays: 30,
    targetName: 'edge', cron: '* * * * *', timeZone: 'UTC', enabled: true,
    input: { targetId: 'tgt_1', params: {}, argv: [] }, nextRunAt: '2026-11-10T00:01:00.000Z',
    lastTriggeredAt: null, lastExecutionId: null, lastError: null, updatedAt: '2026-11-10T00:00:00.000Z',
  };
  const scriptSchedules = {
    list: vi.fn(() => [schedule]), get: vi.fn((id: string) => { if (id !== 'sch_1') throw new NotFoundError('Schedule'); return schedule; }),
    create: vi.fn(() => schedule), save: vi.fn(() => schedule), remove: vi.fn(), start: vi.fn(), stop: vi.fn(),
  } satisfies ScriptScheduleService;
  const executions = { list: vi.fn(() => ({ items: [], total: 0 })) };
  let shuttingDown = false;
  const app = await buildApp({
    config: loadConfig({ SERVE_WEB: 'false' }), db, auth, loginThrottle: createLoginThrottle(),
    box: createSecretBox(randomBytes(32)), logger: createLogger({ level: 'silent', pretty: false }),
    scriptSchedules, executions, isShuttingDown: () => shuttingDown,
  } as unknown as AppContext);
  cleanups.push(async () => { await app.close(); db.close(); });
  const payload = { scriptId: 'scr_1', name: 'Daily job', cron: '* * * * *', timeZone: 'UTC', enabled: true, input: { targetId: 'tgt_1' } };
  return { app, scriptSchedules, executions, payload, schedule, shutdown: () => { shuttingDown = true; } };
}

test('collection create and plan CRUD address independent plan ids', async () => {
  const h = await setup(); const url = '/api/script-schedules/sch_1';
  expect((await h.app.inject('/api/script-schedules')).json()).toEqual([h.schedule]);
  const created = await h.app.inject({ method: 'POST', url: '/api/script-schedules', payload: h.payload });
  expect(created.statusCode).toBe(201); expect(created.json()).toEqual(h.schedule);
  const parsed = { ...h.payload, retentionDays: 30, input: { targetId: 'tgt_1', params: {}, argv: [] } };
  expect(h.scriptSchedules.create).toHaveBeenCalledWith(parsed);
  expect((await h.app.inject(url)).json()).toEqual(h.schedule);
  const updated = await h.app.inject({ method: 'PUT', url, payload: { ...h.payload, retentionDays: 0 } });
  expect(updated.statusCode).toBe(200);
  expect(h.scriptSchedules.save).toHaveBeenCalledWith('sch_1', { ...parsed, retentionDays: 0 });
  expect((await h.app.inject({ method: 'DELETE', url })).statusCode).toBe(204);
  expect(h.scriptSchedules.remove).toHaveBeenCalledWith('sch_1');
  expect((await h.app.inject('/api/script-schedules/missing')).statusCode).toBe(404);
  expect((await h.app.inject('/api/scripts/scr_1/schedule')).statusCode).toBe(404);
});

test('history is filtered by plan with bounded paging and rejects unknown plans', async () => {
  const h = await setup(); const url = '/api/script-schedules/sch_1/executions';
  expect((await h.app.inject(url)).json()).toEqual({ items: [], total: 0 });
  expect(h.executions.list).toHaveBeenLastCalledWith({ scheduleId: 'sch_1', limit: 50, offset: 0 });
  expect((await h.app.inject(url + '?limit=2&offset=4')).statusCode).toBe(200);
  expect(h.executions.list).toHaveBeenLastCalledWith({ scheduleId: 'sch_1', limit: 2, offset: 4 });
  for (const query of ['limit=0', 'limit=201', 'offset=-1']) {
    expect((await h.app.inject(url + '?' + query)).statusCode).toBe(422);
  }
  expect((await h.app.inject('/api/script-schedules/missing/executions')).statusCode).toBe(404);
});

test('invalid updates, shutdown and service failures retain the API error contract', async () => {
  const h = await setup(); const url = '/api/script-schedules/sch_1';
  for (const payload of [{}, { ...h.payload, name: '' }, { ...h.payload, retentionDays: -1 }, { ...h.payload, retentionDays: 3651 }, { ...h.payload, enabled: 'true' }, { ...h.payload, timeZone: '' }, { ...h.payload, input: { targetId: 'tgt_1', timeoutSec: -1 } }]) {
    expect((await h.app.inject({ method: 'PUT', url, payload })).statusCode).toBe(422);
  }
  expect(h.scriptSchedules.save).not.toHaveBeenCalled();
  h.scriptSchedules.save.mockImplementationOnce(() => { throw new ValidationError('Invalid Cron', undefined, { key: 'error.schedule.cron' }); });
  const error = await h.app.inject({ method: 'PUT', url, payload: h.payload });
  expect(error.statusCode).toBe(422); expect(error.json().error.i18n.key).toBe('error.schedule.cron');
  h.shutdown();
  expect((await h.app.inject({ method: 'PUT', url, payload: h.payload })).statusCode).toBe(503);
  expect((await h.app.inject({ method: 'POST', url: '/api/script-schedules', payload: h.payload })).statusCode).toBe(503);
  expect(h.scriptSchedules.create).not.toHaveBeenCalled(); expect(h.scriptSchedules.save).toHaveBeenCalledTimes(1);
});

test('plans and their histories require sign-in, and writes refuse cross-site requests', async () => {
  const h = await setup(true); const url = '/api/script-schedules/sch_1';
  for (const [method, path] of [['GET','/api/script-schedules'], ['POST','/api/script-schedules'], ['GET',url], ['PUT',url], ['DELETE',url], ['GET',url+'/executions']] as const) {
    expect((await h.app.inject({ method, url: path, ...(method === 'POST' || method === 'PUT' ? { payload: h.payload } : {}) })).statusCode).toBe(401);
  }
  const signedIn = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'operator', password: 'password' } });
  const cookie = signedIn.cookies.map(item => `${item.name}=${item.value}`).join('; ');
  expect((await h.app.inject({ url, headers: { cookie } })).statusCode).toBe(200);
  for (const [method,path] of [['POST','/api/script-schedules'], ['PUT',url], ['DELETE',url]] as const) {
    expect((await h.app.inject({ method, url: path, headers: { cookie, 'sec-fetch-site': 'cross-site' }, ...(method === 'DELETE' ? {} : { payload: h.payload }) })).statusCode).toBe(403);
  }
  expect(h.scriptSchedules.create).not.toHaveBeenCalled(); expect(h.scriptSchedules.save).not.toHaveBeenCalled(); expect(h.scriptSchedules.remove).not.toHaveBeenCalled();
});
