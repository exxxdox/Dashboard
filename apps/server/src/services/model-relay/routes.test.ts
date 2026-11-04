import { mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { buildApp } from '../../app.js';
import type { AppContext } from '../../context.js';
import { openDatabase } from '../../db/client.js';
import { createAuthenticator, createLoginThrottle } from '../../lib/auth.js';
import { createLogger } from '../../lib/logger.js';
import { registerModelRelayRoutes } from '../../routes/model-relay.js';
import { loadConfig } from '../../config.js';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function harness() {
  const dataDir = mkdtempSync(join(resolve('../../tmp'), 'relay-routes-'));
  const app = Fastify();
  registerModelRelayRoutes(app, { config: loadConfig({ DATA_DIR: dataDir, SERVE_WEB: 'false' }) });
  cleanups.push(async () => { await app.close(); rmSync(dataDir, { recursive: true, force: true }); });
  return app;
}

test('manages relay configuration and preserves separate MCP credentials', async () => {
  const app = await harness();
  const capabilities = (await app.inject('/api/model-relay/capabilities')).json();
  expect(capabilities[0].definition.parameters).toHaveLength(3);
  const endpoint = await app.inject({ method: 'POST', url: '/api/model-relay/endpoints', payload: { name: 'Local', baseUrl: 'http://localhost:11434' } });
  expect(endpoint.statusCode).toBe(201);
  const saved = await app.inject({ method: 'PUT', url: `/api/model-relay/capabilities/${capabilities[0].id}/configuration`, payload: { ...capabilities[0], routes: [{ endpointId: endpoint.json().id, modelName: 'vision', supportsVision: true, timeoutMs: 1000, priority: 10, enabled: true }] } });
  expect(saved.statusCode).toBe(200);
  expect((await app.inject('/api/model-relay/health')).json().ready).toBe(true);
  const security = (await app.inject('/api/model-relay/security')).json();
  expect(security.map((item: { kind: string }) => item.kind)).toEqual(['mcp']);
  const oldKey = security[0].token;
  expect((await app.inject('/mcp')).statusCode).toBe(401);
  const rotated = await app.inject({ method: 'POST', url: '/api/model-relay/security/mcp/rotate' });
  expect(rotated.json().token).not.toBe(oldKey);
  expect((await app.inject({ url: '/mcp', headers: { authorization: `Bearer ${oldKey}` } })).statusCode).toBe(401);
});

test('MCP validates bearer and socket network before dispatch', async () => {
  const app = await harness();
  const [credential] = (await app.inject('/api/model-relay/security')).json();
  await app.inject({ method: 'PUT', url: '/api/model-relay/settings', payload: { maxImageBytes: 1024, maxConcurrentRequests: 1, allowNetworkAccess: false } });
  const denied = await app.inject({ method: 'POST', url: '/mcp', remoteAddress: '203.0.113.22', headers: { authorization: `Bearer ${credential.token}`, 'x-forwarded-for': '127.0.0.1' }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  expect(denied.statusCode).toBe(403);
  const tools = await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${credential.token}`, accept: 'application/json, text/event-stream' }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  expect(tools.statusCode).toBe(200);
  const body = tools.headers['content-type']?.includes('text/event-stream')
    ? JSON.parse(tools.body.split('\n').find((line) => line.startsWith('data: '))!.slice(6))
    : tools.json();
  expect(body.result.tools[0].name).toBe('image_describe');
});


test('dashboard session owns management access and MCP keys cannot enter it', async () => {
  const dataDir = mkdtempSync(join(resolve('../../tmp'), 'relay-auth-'));
  const db = openDatabase(':memory:');
  const ctx = {
    config: loadConfig({ DATA_DIR: dataDir, SERVE_WEB: 'false' }),
    db,
    logger: createLogger({ level: 'silent', pretty: false }),
    auth: createAuthenticator({ username: 'ops', password: 'secret' }),
    loginThrottle: createLoginThrottle(),
    isShuttingDown: () => false,
  } as unknown as AppContext;
  const app = await buildApp(ctx);
  cleanups.push(async () => { await app.close(); db.close(); rmSync(dataDir, { recursive: true, force: true }); });
  expect((await app.inject('/api/model-relay/security')).statusCode).toBe(401);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'ops', password: 'secret' } });
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const security = await app.inject({ url: '/api/model-relay/security', headers: { cookie } });
  expect(security.statusCode).toBe(200);
  const token = security.json()[0].token;
  expect((await app.inject({ url: '/api/model-relay/security', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
  expect((await app.inject({ url: '/mcp', headers: { cookie } })).statusCode).toBe(401);
  const denied = await app.inject({ method: 'PUT', url: '/api/model-relay/settings', headers: { cookie, 'sec-fetch-site': 'cross-site' }, payload: { maxImageBytes: 1024, maxConcurrentRequests: 1, allowNetworkAccess: true } });
  expect(denied.statusCode).toBe(403);
});

test('validates URLs and rejects stale configuration', async () => {
  const app = await harness();
  for (const baseUrl of ['ftp://localhost', 'http://user:pass@localhost', 'http://localhost/api/chat']) {
    expect((await app.inject({ method: 'POST', url: '/api/model-relay/endpoints', payload: { name: 'Invalid', baseUrl } })).statusCode).toBe(422);
  }
  const [capability] = (await app.inject('/api/model-relay/capabilities')).json();
  const update = { ...capability, name: 'Renamed' };
  const url = `/api/model-relay/capabilities/${capability.id}`;
  expect((await app.inject({ method: 'PUT', url, payload: update })).statusCode).toBe(200);
  expect((await app.inject({ method: 'PUT', url, payload: update })).statusCode).toBe(409);
  expect((await app.inject('/api/model-relay/ready')).statusCode).toBe(503);
});
