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
    scriptId: 'scr_1', targetName: 'edge', cron: '* * * * *', timeZone: 'UTC', enabled: true,
    input: { targetId: 'tgt_1', params: {}, argv: [] }, nextRunAt: '2026-11-10T00:01:00.000Z',
    lastTriggeredAt: null, lastExecutionId: null, lastError: null, updatedAt: '2026-11-10T00:00:00.000Z',
  };
  const scriptSchedules = {
    list: vi.fn(() => [schedule]),
    get: vi.fn((id: string) => { if (id !== 'scr_1') throw new NotFoundError('Script'); return schedule; }),
    save: vi.fn(() => schedule), remove: vi.fn(), start: vi.fn(), stop: vi.fn(),
  } satisfies ScriptScheduleService;
  let shuttingDown = false;
  const app = await buildApp({
    config: loadConfig({ SERVE_WEB: 'false' }), db, auth, loginThrottle: createLoginThrottle(),
    box: createSecretBox(randomBytes(32)), logger: createLogger({ level: 'silent', pretty: false }),
    scriptSchedules, isShuttingDown: () => shuttingDown,
  } as unknown as AppContext);
  cleanups.push(async () => { await app.close(); db.close(); });
  const payload = { cron: '* * * * *', timeZone: 'UTC', enabled: true, input: { targetId: 'tgt_1' } };
  return { app, scriptSchedules, payload, schedule, shutdown: () => { shuttingDown = true; } };
}

test('schedule GET, PUT and DELETE use the service and validated request contract', async () => {
  const h = await setup();
  const url = '/api/scripts/scr_1/schedule';
  expect((await h.app.inject('/api/script-schedules')).json()).toEqual([h.schedule]);
  expect((await h.app.inject(url)).json()).toEqual(h.schedule);
  const response = await h.app.inject({ method: 'PUT', url, payload: h.payload });
  expect(response.statusCode).toBe(200); expect(response.json()).toEqual(h.schedule);
  expect(h.scriptSchedules.save).toHaveBeenCalledWith('scr_1', { ...h.payload, input: { targetId: 'tgt_1', params: {}, argv: [] } });
  const removed = await h.app.inject({ method: 'DELETE', url });
  expect(removed.statusCode).toBe(204); expect(removed.body).toBe('');
  expect(h.scriptSchedules.remove).toHaveBeenCalledWith('scr_1');
  expect((await h.app.inject('/api/scripts/missing/schedule')).statusCode).toBe(404);
});

test('invalid updates and service errors use the API error contract', async () => {
  const h = await setup(); const url = '/api/scripts/scr_1/schedule';
  for (const payload of [{}, { ...h.payload, enabled: 'true' }, { ...h.payload, timeZone: '' }, { ...h.payload, input: { targetId: 'tgt_1', timeoutSec: -1 } }]) {
    expect((await h.app.inject({ method: 'PUT', url, payload })).statusCode).toBe(422);
  }
  expect(h.scriptSchedules.save).not.toHaveBeenCalled();
  h.scriptSchedules.save.mockImplementationOnce(() => { throw new ValidationError('Invalid Cron', undefined, { key: 'error.schedule.cron' }); });
  const error = await h.app.inject({ method: 'PUT', url, payload: h.payload });
  expect(error.statusCode).toBe(422); expect(error.json().error.i18n.key).toBe('error.schedule.cron');
  h.shutdown();
  expect((await h.app.inject({ method: 'PUT', url, payload: h.payload })).statusCode).toBe(503);
  expect(h.scriptSchedules.save).toHaveBeenCalledTimes(1);
});

test('schedule reads and writes require sign-in and refuse cross-site changes', async () => {
  const h = await setup(true); const url = '/api/scripts/scr_1/schedule';
  expect((await h.app.inject('/api/script-schedules')).statusCode).toBe(401);
  for (const method of ['GET', 'PUT', 'DELETE'] as const) {
    const response = await h.app.inject({ method, url, ...(method === 'PUT' ? { payload: h.payload } : {}) });
    expect(response.statusCode).toBe(401);
  }
  const signedIn = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'operator', password: 'password' } });
  const cookie = signedIn.cookies.map(item => `${item.name}=${item.value}`).join('; ');
  expect((await h.app.inject({ url, headers: { cookie } })).statusCode).toBe(200);
  for (const method of ['PUT', 'DELETE'] as const) {
    expect((await h.app.inject({ method, url, headers: { cookie, 'sec-fetch-site': 'cross-site' }, ...(method === 'PUT' ? { payload: h.payload } : {}) })).statusCode).toBe(403);
  }
  expect(h.scriptSchedules.save).not.toHaveBeenCalled();
  expect(h.scriptSchedules.remove).not.toHaveBeenCalled();
});
