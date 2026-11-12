import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import Fastify from 'fastify';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  return { ...original, execFile: Object.assign(vi.fn(), {
    [promisify.custom]: async () => ({ stdout: '', stderr: '' }),
  }) };
});

import { loadConfig } from '../config.js';
import type { AppContext } from '../context.js';
import { openDatabase } from '../db/client.js';
import { createSecretBox } from '../lib/crypto.js';
import { ValidationError } from '../lib/errors.js';
import { createLogger } from '../lib/logger.js';
import type { ExecutionPlan } from '../runner/runner.js';
import { createQueue } from '../runner/queue.js';
import { registerSourceRoutes } from '../routes/sources.js';
import { createExecutionService } from './executions.js';
import { scanSourceDirectory } from './scan.js';
import { createSource, getSource, syncSource } from './sources.js';
import { createTarget } from './targets.js';

const fileFailure = vi.hoisted(() => ({ path: '' }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...original,
    readFile: vi.fn((...args: Parameters<typeof original.readFile>) => {
      if (args[0] === fileFailure.path) return Promise.reject(new Error('temporary read failure'));
      return original.readFile(...args);
    }),
  };
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  fileFailure.path = '';
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function setup() {
  const root = mkdtempSync(resolve(import.meta.dirname, '../../../../tmp/source-safety-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const db = openDatabase(':memory:');
  cleanups.push(() => db.close());
  const config = loadConfig({ SCRIPT_ROOT_CONTAINER: root, SERVE_WEB: 'false' });
  const logger = createLogger({ level: 'silent', pretty: false });
  return { root, db, config, logger };
}

function githubFixture() {
  const h = setup();
  const source = createSource(h.db, h.config, {
    name: 'ops', kind: 'github', repoUrl: 'https://github.com/example/ops', subPath: 'ops',
  });
  // Git is mocked so the scan, preview and run use deterministic checkout bytes.
  const checkout = join(h.root, source.mountPath);
  mkdirSync(join(checkout, '.git'), { recursive: true });
  mkdirSync(join(checkout, 'ops'), { recursive: true });
  writeFileSync(join(checkout, 'test.sh'), 'echo wrong-root-script\n');
  writeFileSync(join(checkout, 'ops/test.sh'), 'echo selected-script\n');
  return { ...h, source };
}

test('GitHub scan, preview and execution use the selected subdirectory', async () => {
  const h = githubFixture();
  await syncSource(h.db, h.config, h.source.id, h.logger);
  const script = h.db.prepare<[], { id: string; rel_path: string }>(
    'SELECT id, rel_path FROM scripts WHERE deleted_at IS NULL',
  ).get()!;
  expect(script.rel_path).toBe('test.sh');
  const app = Fastify();
  registerSourceRoutes(app, { ...h } as unknown as AppContext);
  try {
    const response = await app.inject({ method: 'GET', url: `/api/scripts/${script.id}` });
    expect(response.json().content).toBe('echo selected-script\n');
  } finally {
    await app.close();
  }
  const box = createSecretBox(randomBytes(32));
  const target = createTarget(h.db, box, {
    name: 'target', host: 'localhost', port: 22, username: 'ops',
    auth: { method: 'password', password: 'unused' }, connectTimeoutSec: 5,
  });
  const plans: ExecutionPlan[] = [];
  const queue = createQueue({ concurrency: 1, perKeyConcurrency: 1 });
  const service = createExecutionService({
    ...h, box, queue, hub: { publish() {}, subscribe: () => () => {} },
    runner: { getTerminal: () => null, flushLogs: () => undefined, async run(plan) { plans.push(plan); return 'succeeded'; } },
  });
  await service.submit(script.id, { targetId: target.id, params: {}, argv: [] });
  await queue.drain();
  expect(plans[0]?.scriptBytes.toString()).toBe('echo selected-script\n');
});

test('a missing GitHub subdirectory fails sync without removing known scripts', async () => {
  const h = githubFixture();
  await syncSource(h.db, h.config, h.source.id, h.logger);
  h.db.prepare('UPDATE sources SET sub_path = ? WHERE id = ?').run('missing', h.source.id);
  await expect(syncSource(h.db, h.config, h.source.id, h.logger)).rejects.toThrow();
  expect(getSource(h.db, h.source.id).syncStatus).toBe('error');
  expect(getSource(h.db, h.source.id).scriptCount).toBe(1);
});

test('a depth-limited scan keeps the previous list instead of deleting unseen scripts', async () => {
  const h = setup();
  const source = createSource(h.db, h.config, { name: 'local', kind: 'local', subPath: 'local' });
  const directory = join(h.root, 'local');
  writeFileSync(join(directory, 'kept.sh'), 'echo kept\n');
  await syncSource(h.db, h.config, source.id, h.logger);
  rmSync(join(directory, 'kept.sh'));
  mkdirSync(join(directory, ...Array<string>(14).fill('nested')), { recursive: true });
  await expect(syncSource(h.db, h.config, source.id, h.logger)).rejects.toThrow();
  expect(getSource(h.db, source.id).scriptCount).toBe(1);
  expect(getSource(h.db, source.id).syncStatus).toBe('error');
});

test('a scan whose root cannot be read is incomplete', async () => {
  const h = setup();
  expect((await scanSourceDirectory(join(h.root, 'missing'))).incomplete).toBe(true);
});

test('GitHub subdirectories cannot escape the checkout', () => {
  const h = setup();
  expect(() => createSource(h.db, h.config, {
    name: 'escape', kind: 'github', repoUrl: 'https://github.com/example/ops', subPath: '../outside',
  })).toThrow(ValidationError);
});

test('a script read failure keeps the previous list and reports a failed sync', async () => {
  const h = setup();
  const source = createSource(h.db, h.config, { name: 'local', kind: 'local', subPath: 'local' });
  const scriptPath = join(h.root, 'local', 'kept.sh');
  writeFileSync(scriptPath, 'echo kept\n');
  await syncSource(h.db, h.config, source.id, h.logger);
  fileFailure.path = scriptPath;
  await expect(syncSource(h.db, h.config, source.id, h.logger)).rejects.toThrow('temporary read failure');
  expect(getSource(h.db, source.id).scriptCount).toBe(1);
  expect(getSource(h.db, source.id).syncStatus).toBe('error');
});


test('scanning discovers Bash scripts and leaves PowerShell files untouched', async () => {
  const h = setup();
  writeFileSync(join(h.root, 'test.sh'), 'echo hello');
  writeFileSync(join(h.root, 'legacy.ps1'), 'Write-Output hello');
  const scan = await scanSourceDirectory(h.root);
  expect(scan.scripts.map(script => [script.relPath, script.format])).toEqual([['test.sh', 'sh']]);
  expect(readFileSync(join(h.root, 'legacy.ps1'), 'utf8')).toBe('Write-Output hello');
});
