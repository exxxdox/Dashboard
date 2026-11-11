import { chmodSync, statSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Fastify from 'fastify';
import { afterEach, expect, test } from 'vitest';
import { loadConfig } from '../config.js';
import type { AppContext } from '../context.js';
import { openDatabase } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { registerSourceRoutes } from '../routes/sources.js';
import { createSource, deleteSource, syncSource, updateSource } from './sources.js';
import { createLogger } from '../lib/logger.js';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function setup(kind: 'local' | 'github' = 'local') {
  const root = mkdtempSync(resolve(import.meta.dirname, '../../../../tmp/script-files-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const db = openDatabase(':memory:');
  cleanups.push(() => { db.close(); });
  const config = loadConfig({ SCRIPT_ROOT_CONTAINER: root, SERVE_WEB: 'false' });
  const logger = createLogger({ level: 'silent', pretty: false });
  const source = createSource(db, config, { name: 'scripts', kind, subPath: kind === 'local' ? 'local' : undefined, repoUrl: kind === 'github' ? 'https://github.com/example/scripts' : undefined });
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof AppError ? error.statusCode : 400).send({ error: { message: error instanceof Error ? error.message : String(error) } }));
  registerSourceRoutes(app, { db, config, logger } as AppContext);
  cleanups.push(() => app.close());
  return { app, db, config, logger, source, root, directory: join(root, source.mountPath) };
}

test('local scripts can be created, read in full, updated and soft deleted without changing siblings', async () => {
  const h = setup();
  writeFileSync(join(h.directory, 'sibling.sh'), 'echo sibling\n');
  await syncSource(h.db, h.config, h.source.id, h.logger);
  const content = '# @name Example\n' + '# more\n'.repeat(40_000);
  const created = await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'nested/example.sh', content } });
  expect(created.statusCode).toBe(201);
  const script = created.json();
  expect(script.displayName).toBe('Example');
  const read = await h.app.inject(`/api/scripts/${script.id}/content`);
  expect(read.json()).toEqual({ content, contentHash: script.contentHash });
  const saved = await h.app.inject({ method: 'PUT', url: `/api/scripts/${script.id}/content`, payload: { content: '# @name Changed\necho changed\n', expectedHash: script.contentHash } });
  expect(saved.statusCode).toBe(200);
  expect(saved.json().displayName).toBe('Changed');
  expect(readFileSync(join(h.directory, 'nested/example.sh'), 'utf8')).toContain('echo changed');
  expect(h.db.prepare('SELECT id FROM scripts WHERE file_name = ? AND deleted_at IS NULL').get('sibling.sh')).toBeTruthy();
  const deleted = await h.app.inject({ method: 'DELETE', url: `/api/scripts/${script.id}`, payload: { expectedHash: saved.json().contentHash } });
  expect(deleted.statusCode).toBe(204);
  expect(h.db.prepare('SELECT deleted_at FROM scripts WHERE id = ?').get(script.id)).toMatchObject({ deleted_at: expect.any(String) });
  expect((await h.app.inject(`/api/scripts/${script.id}`)).statusCode).toBe(404);
});

test('edits and deletes reject stale content and concurrent saves have one winner', async () => {
  const h = setup();
  const script = (await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'test.sh', content: 'echo original' } })).json();
  const responses = await Promise.all(['first', 'second'].map((content) => h.app.inject({ method: 'PUT', url: `/api/scripts/${script.id}/content`, payload: { content, expectedHash: script.contentHash } })));
  expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
  expect((await h.app.inject({ method: 'DELETE', url: `/api/scripts/${script.id}`, payload: { expectedHash: script.contentHash } })).statusCode).toBe(409);
  writeFileSync(join(h.directory, 'test.sh'), 'echo external');
  const latest = (await h.app.inject(`/api/scripts/${script.id}/content`)).json();
  expect(latest.content).toBe('echo external');
  expect((await h.app.inject({ method: 'PUT', url: `/api/scripts/${script.id}/content`, payload: { content: 'saved external', expectedHash: latest.contentHash } })).statusCode).toBe(200);
});

test.each(['../outside.sh', '/outside.sh', 'a/../../outside.sh', 'a\\b.sh', '.git/hook.sh', '.hidden.sh', 'node_modules/hook.sh', 'unsupported.txt', 'a//b.sh', 'a/./b.sh'])('rejects unsafe or unsupported new script path %s', async (relPath) => {
  const h = setup();
  expect((await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath, content: 'echo hello' } })).statusCode).toBe(422);
});

test('creation never overwrites existing files and refuses symlink directories', async () => {
  const h = setup();
  writeFileSync(join(h.directory, 'existing.sh'), 'keep');
  const create = (relPath: string) => h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath, content: 'replace' } });
  expect((await create('existing.sh')).statusCode).toBe(409);
  expect(readFileSync(join(h.directory, 'existing.sh'), 'utf8')).toBe('keep');
  mkdirSync(join(h.root, 'outside'));
  symlinkSync(join(h.root, 'outside'), join(h.directory, 'linked'));
  expect((await create('linked/escape.sh')).statusCode).toBe(422);
});

test('content operations reject a symlink substituted after scanning', async () => {
  const h = setup();
  writeFileSync(join(h.directory, 'test.sh'), 'echo original');
  await syncSource(h.db, h.config, h.source.id, h.logger);
  const script = h.db.prepare('SELECT id, content_hash FROM scripts').get() as { id: string; content_hash: string };
  writeFileSync(join(h.root, 'outside.sh'), 'private');
  rmSync(join(h.directory, 'test.sh'));
  symlinkSync(join(h.root, 'outside.sh'), join(h.directory, 'test.sh'));
  expect((await h.app.inject(`/api/scripts/${script.id}/content`)).statusCode).toBe(422);
  expect((await h.app.inject({ method: 'PUT', url: `/api/scripts/${script.id}/content`, payload: { content: 'replace', expectedHash: script.content_hash } })).statusCode).toBe(422);
  expect((await h.app.inject({ method: 'DELETE', url: `/api/scripts/${script.id}`, payload: { expectedHash: script.content_hash } })).statusCode).toBe(422);
  expect(readFileSync(join(h.root, 'outside.sh'), 'utf8')).toBe('private');
});

test('GitHub content cannot be created, edited or deleted through the API', async () => {
  const h = setup('github');
  mkdirSync(h.directory, { recursive: true });
  writeFileSync(join(h.directory, 'test.sh'), 'echo readonly');
  const local = createSource(h.db, h.config, { name: 'seed', kind: 'local', subPath: 'seed' });
  writeFileSync(join(h.root, 'seed/test.sh'), 'echo readonly');
  await syncSource(h.db, h.config, local.id, h.logger);
  const script = h.db.prepare('SELECT id, content_hash FROM scripts').get() as { id: string; content_hash: string };
  h.db.prepare('UPDATE scripts SET source_id = ? WHERE id = ?').run(h.source.id, script.id);
  expect((await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'new.sh', content: '' } })).statusCode).toBe(422);
  expect((await h.app.inject({ method: 'PUT', url: `/api/scripts/${script.id}/content`, payload: { content: '', expectedHash: script.content_hash } })).statusCode).toBe(422);
  expect((await h.app.inject({ method: 'DELETE', url: `/api/scripts/${script.id}`, payload: { expectedHash: script.content_hash } })).statusCode).toBe(422);
  expect(readFileSync(join(h.directory, 'test.sh'), 'utf8')).toBe('echo readonly');
});

test('creation bounds UTF-8 byte size and refuses PowerShell scripts', async () => {
  const h = setup();
  const response = await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'test.ps1', content: 'Write-Output hello' } });
  expect(response.statusCode).toBe(422);
  expect((await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'large.sh', content: '界'.repeat(700_000) } })).statusCode).toBe(422);
});


test('saving preserves executable permission bits', async () => {
  const h = setup();
  const script = (await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'exec.sh', content: 'echo original' } })).json();
  chmodSync(join(h.directory, 'exec.sh'), 0o777);
  expect((await h.app.inject({ method: 'PUT', url: `/api/scripts/${script.id}/content`, payload: { content: 'echo changed', expectedHash: script.contentHash } })).statusCode).toBe(200);
  expect(statSync(join(h.directory, 'exec.sh')).mode & 0o777).toBe(0o777);
});

test('file changes roll back when database metadata cannot be stored', async () => {
  const h = setup();
  const script = (await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'test.sh', content: 'original' } })).json();
  h.db.exec("CREATE TRIGGER refuse_insert BEFORE INSERT ON scripts BEGIN SELECT RAISE(ABORT, 'test insert failure'); END; CREATE TRIGGER refuse_update BEFORE UPDATE ON scripts BEGIN SELECT RAISE(ABORT, 'test update failure'); END;");
  expect((await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'new.sh', content: 'new' } })).statusCode).toBe(422);
  expect(() => readFileSync(join(h.directory, 'new.sh'))).toThrow();
  expect((await h.app.inject({ method: 'PUT', url: `/api/scripts/${script.id}/content`, payload: { content: 'changed', expectedHash: script.contentHash } })).statusCode).toBe(422);
  expect(readFileSync(join(h.directory, 'test.sh'), 'utf8')).toBe('original');
  expect((await h.app.inject({ method: 'DELETE', url: `/api/scripts/${script.id}`, payload: { expectedHash: script.contentHash } })).statusCode).toBe(422);
  expect(readFileSync(join(h.directory, 'test.sh'), 'utf8')).toBe('original');
});

test('local sources cannot modify overlapping GitHub checkouts', async () => {
  const h = setup();
  const github = createSource(h.db, h.config, { name: 'github', kind: 'github', repoUrl: 'https://github.com/example/scripts' });
  h.db.prepare('UPDATE sources SET mount_path = ? WHERE id = ?').run(`local/repository`, github.id);
  expect((await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'repository/test.sh', content: 'no' } })).statusCode).toBe(422);
});

test('content writes reject a symlink in the source mount itself', async () => {
  const h = setup();
  rmSync(h.directory, { recursive: true });
  mkdirSync(join(h.root, 'outside'));
  symlinkSync(join(h.root, 'outside'), h.directory);
  expect((await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'test.sh', content: 'no' } })).statusCode).toBe(422);
});

test('a source being synchronized cannot accept file changes', async () => {
  const h = setup();
  h.db.prepare("UPDATE sources SET sync_status = 'syncing' WHERE id = ?").run(h.source.id);
  expect((await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'test.sh', content: 'no' } })).statusCode).toBe(409);
});

test('deleting preserves execution history and recreating the file keeps its schedules paused', async () => {
  const h = setup();
  const content = 'echo hello';
  const script = (await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'test.sh', content } })).json();
  h.db.prepare(`INSERT INTO targets (id,name,host,username,auth_method,secret_encrypted,work_dir,created_at,updated_at) VALUES ('target','target','localhost','ops','password','unused','/tmp','','')`).run();
  h.db.prepare(`INSERT INTO executions (id,script_id,target_id,status,command_display,target_name,script_name,script_rel_path,work_dir,queued_at) VALUES ('execution',?,'target','succeeded','echo hello','target','test','test.sh','/tmp','')`).run(script.id);
  h.db.prepare(`INSERT INTO script_schedules (id,script_id,name,target_id,cron,time_zone,enabled,run_input_json,next_run_at,created_at,updated_at) VALUES ('schedule',?,'Daily','target','* * * * *','UTC',1,'{}','2027-01-01','','')`).run(script.id);
  expect((await h.app.inject({ method: 'DELETE', url: `/api/scripts/${script.id}`, payload: { expectedHash: script.contentHash } })).statusCode).toBe(204);
  expect(h.db.prepare('SELECT id FROM executions WHERE script_id = ?').get(script.id)).toMatchObject({ id: 'execution' });
  const recreated = await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'test.sh', content } });
  expect(recreated.statusCode).toBe(201);
  expect(recreated.json().id).toBe(script.id);
  expect(h.db.prepare("SELECT enabled, next_run_at FROM script_schedules WHERE id = 'schedule'").get()).toEqual({ enabled: 0, next_run_at: null });
});


test('hard-linked scripts cannot be read, saved or deleted through the editor', async () => {
  const h = setup();
  const script = (await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'test.sh', content: 'original' } })).json();
  const alias = join(h.root, 'alias.sh');
  linkSync(join(h.directory, 'test.sh'), alias);
  expect((await h.app.inject(`/api/scripts/${script.id}/content`)).statusCode).toBe(422);
  expect((await h.app.inject({ method: 'PUT', url: `/api/scripts/${script.id}/content`, payload: { content: 'changed', expectedHash: script.contentHash } })).statusCode).toBe(422);
  expect((await h.app.inject({ method: 'DELETE', url: `/api/scripts/${script.id}`, payload: { expectedHash: script.contentHash } })).statusCode).toBe(422);
  expect(readFileSync(alias, 'utf8')).toBe('original');
  expect(readFileSync(join(h.directory, 'test.sh'), 'utf8')).toBe('original');
});

test('invalid UTF-8 scripts are refused without rewriting their bytes', async () => {
  const h = setup();
  const bytes = Buffer.from([0xff, 0xfe, 0x65, 0x00]);
  writeFileSync(join(h.directory, 'test.sh'), bytes);
  await syncSource(h.db, h.config, h.source.id, h.logger);
  const script = h.db.prepare('SELECT id, content_hash FROM scripts').get() as { id: string; content_hash: string };
  expect((await h.app.inject(`/api/scripts/${script.id}/content`)).statusCode).toBe(422);
  expect((await h.app.inject({ method: 'PUT', url: `/api/scripts/${script.id}/content`, payload: { content: 'changed', expectedHash: script.content_hash } })).statusCode).toBe(422);
  expect(readFileSync(join(h.directory, 'test.sh'))).toEqual(bytes);
});

test('synchronizations of the same source cannot overlap', async () => {
  const h = setup();
  const results = await Promise.allSettled([syncSource(h.db, h.config, h.source.id, h.logger), syncSource(h.db, h.config, h.source.id, h.logger)]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  // A completed sync releases the guard rather than permanently locking this source.
  await expect(syncSource(h.db, h.config, h.source.id, h.logger)).resolves.toMatchObject({ sourceId: h.source.id });
});


test('a persisted syncing flag can be repaired by syncing again after restart', async () => {
  const h = setup();
  h.db.prepare("UPDATE sources SET sync_status = 'syncing' WHERE id = ?").run(h.source.id);
  await syncSource(h.db, h.config, h.source.id, h.logger);
  expect((await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'test.sh', content: 'recovered' } })).statusCode).toBe(201);
});


test.each(['path', 'name', 'delete'] as const)('a running scan prevents source %s changes', async (operation) => {
  const h = setup();
  writeFileSync(join(h.directory, 'kept.sh'), 'echo kept');
  const syncing = syncSource(h.db, h.config, h.source.id, h.logger);
  try {
    const change = () => operation === 'delete'
      ? deleteSource(h.db, h.config, h.source.id, true)
      : updateSource(h.db, h.config, h.source.id, operation === 'path' ? { subPath: 'moved' } : { name: 'renamed' });
    expect(change).toThrow('Wait for source synchronization to finish');
    expect(readFileSync(join(h.directory, 'kept.sh'), 'utf8')).toBe('echo kept');
  } finally { await syncing; }
  expect(h.db.prepare('SELECT name, mount_path, sync_status FROM sources WHERE id = ?').get(h.source.id)).toEqual({ name: 'scripts', mount_path: 'local', sync_status: 'ok' });
});


test('editing a local name renames its file and preserves identity through a rescan', async () => {
  const h = setup();
  const script = (await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'folder/old.sh', content: 'echo original' } })).json();
  chmodSync(join(h.directory, 'folder/old.sh'), 0o755);
  h.db.prepare("UPDATE scripts SET run_draft_json = ? WHERE id = ?").run('{"interactive":true}', script.id);
  h.db.prepare(`INSERT INTO targets (id,name,host,username,auth_method,secret_encrypted,work_dir,created_at,updated_at) VALUES ('target','target','localhost','ops','password','unused','/tmp','','')`).run();
  h.db.prepare(`INSERT INTO executions (id,script_id,target_id,status,command_display,target_name,script_name,script_rel_path,work_dir,queued_at) VALUES ('execution',?,'target','succeeded','echo original','target','old','folder/old.sh','/tmp','')`).run(script.id);
  h.db.prepare(`INSERT INTO script_schedules (id,script_id,name,target_id,cron,time_zone,enabled,run_input_json,next_run_at,created_at,updated_at) VALUES ('schedule',?,'Daily','target','* * * * *','UTC',1,'{}','2027-01-01','','')`).run(script.id);

  const response = await h.app.inject({ method: 'PATCH', url: `/api/scripts/${script.id}`, payload: { displayName: '新名称', description: 'updated' } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ id: script.id, relPath: 'folder/新名称.sh', fileName: '新名称.sh', displayName: '新名称.sh', description: 'updated' });
  expect(() => readFileSync(join(h.directory, 'folder/old.sh'))).toThrow();
  expect(readFileSync(join(h.directory, 'folder/新名称.sh'), 'utf8')).toBe('echo original');
  expect(statSync(join(h.directory, 'folder/新名称.sh')).mode & 0o777).toBe(0o755);
  expect(h.db.prepare('SELECT script_id, script_rel_path FROM executions').get()).toEqual({ script_id: script.id, script_rel_path: 'folder/old.sh' });
  expect(h.db.prepare('SELECT script_id, enabled FROM script_schedules').get()).toEqual({ script_id: script.id, enabled: 1 });
  expect(h.db.prepare('SELECT run_draft_json FROM scripts WHERE id = ?').get(script.id)).toEqual({ run_draft_json: '{"interactive":true}' });

  await syncSource(h.db, h.config, h.source.id, h.logger);
  expect(h.db.prepare('SELECT id, rel_path FROM scripts WHERE deleted_at IS NULL').all()).toEqual([{ id: script.id, rel_path: 'folder/新名称.sh' }]);
});

test.each(['../escape.sh', 'folder/escape.sh', '.hidden.sh', 'bad.txt', 'different.ps1'])('local rename refuses invalid filename %s', async (displayName) => {
  const h = setup();
  const script = (await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'old.sh', content: 'original' } })).json();
  expect((await h.app.inject({ method: 'PATCH', url: `/api/scripts/${script.id}`, payload: { displayName } })).statusCode).toBe(422);
  expect(readFileSync(join(h.directory, 'old.sh'), 'utf8')).toBe('original');
});

test('rename never overwrites files and restores the file if metadata saving fails', async () => {
  const h = setup();
  const script = (await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'old.sh', content: 'original' } })).json();
  writeFileSync(join(h.directory, 'taken.sh'), 'keep');
  const rename = (displayName: string) => h.app.inject({ method: 'PATCH', url: `/api/scripts/${script.id}`, payload: { displayName, description: 'changed' } });
  expect((await rename('taken.sh')).statusCode).toBe(409);
  expect(readFileSync(join(h.directory, 'taken.sh'), 'utf8')).toBe('keep');
  h.db.exec("CREATE TRIGGER refuse_update BEFORE UPDATE ON scripts BEGIN SELECT RAISE(ABORT, 'failure'); END;");
  expect((await rename('new.sh')).statusCode).toBe(422);
  expect(readFileSync(join(h.directory, 'old.sh'), 'utf8')).toBe('original');
  expect(() => readFileSync(join(h.directory, 'new.sh'))).toThrow();
  expect(h.db.prepare('SELECT rel_path, description FROM scripts WHERE id = ?').get(script.id)).toEqual({ rel_path: 'old.sh', description: null });
});


test('GitHub name edits remain metadata-only and syncing blocks local renames', async () => {
  const h = setup();
  const script = (await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath: 'old.sh', content: 'original' } })).json();
  h.db.prepare("UPDATE sources SET sync_status = 'syncing' WHERE id = ?").run(h.source.id);
  expect((await h.app.inject({ method: 'PATCH', url: `/api/scripts/${script.id}`, payload: { displayName: 'new.sh' } })).statusCode).toBe(409);
  h.db.prepare("UPDATE sources SET kind = 'github', sync_status = 'ok' WHERE id = ?").run(h.source.id);
  const response = await h.app.inject({ method: 'PATCH', url: `/api/scripts/${script.id}`, payload: { displayName: 'Friendly name' } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ displayName: 'Friendly name', relPath: 'old.sh' });
  expect(readFileSync(join(h.directory, 'old.sh'), 'utf8')).toBe('original');
});

test('rename refuses symlink originals and paths retained for deleted scripts', async () => {
  const h = setup();
  const create = async (relPath: string) => (await h.app.inject({ method: 'POST', url: `/api/sources/${h.source.id}/scripts`, payload: { relPath, content: 'original' } })).json();
  const old = await create('old.sh');
  const deleted = await create('deleted.sh');
  await h.app.inject({ method: 'DELETE', url: `/api/scripts/${deleted.id}`, payload: { expectedHash: deleted.contentHash } });
  expect((await h.app.inject({ method: 'PATCH', url: `/api/scripts/${old.id}`, payload: { displayName: 'deleted.sh' } })).statusCode).toBe(409);
  writeFileSync(join(h.root, 'outside.sh'), 'private');
  rmSync(join(h.directory, 'old.sh'));
  symlinkSync(join(h.root, 'outside.sh'), join(h.directory, 'old.sh'));
  expect((await h.app.inject({ method: 'PATCH', url: `/api/scripts/${old.id}`, payload: { displayName: 'new.sh' } })).statusCode).toBe(422);
  expect(readFileSync(join(h.root, 'outside.sh'), 'utf8')).toBe('private');
});
