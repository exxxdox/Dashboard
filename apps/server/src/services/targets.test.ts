import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createTargetSchema } from '@dashboard/shared';

import { openDatabase } from '../db/client.js';
import { createSecretBox } from '../lib/crypto.js';
import { ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import type { ExecOptions, TransportCheck } from '../transport/types.js';
import {
  checkTarget, createTarget, createTransportForTarget, deleteTarget,
  getTarget, getTargetRow, listTargetDirectories, listTargets, updateTarget,
} from './targets.js';

const ssh = vi.hoisted(() => ({ create: vi.fn(), check: vi.fn(), exec: vi.fn() }));
vi.mock('../transport/ssh-transport.js', () => ({ createSshTransport: ssh.create }));

let db: ReturnType<typeof openDatabase>;
const box = createSecretBox(randomBytes(32));
const input = (name = 'edge') => createTargetSchema.parse({
  name, host: '10.0.0.1', username: 'ops',
  auth: { method: 'password', password: 'never-return-this' },
});
const connected: TransportCheck = {
  reachable: true, latencyMs: 12, detail: 'Connected', shell: 'bash 5.2', user: 'ops', hasSetsid: true,
};

beforeEach(() => {
  db = openDatabase(':memory:');
  vi.clearAllMocks();
  ssh.create.mockReturnValue({ kind: 'ssh', check: ssh.check, exec: ssh.exec });
  ssh.check.mockResolvedValue(connected);
  ssh.exec.mockImplementation(async (options: ExecOptions) => {
    options.onChunk({ stream: 'stdout', data: 'WORK_OK\nSTAGE_OK\n' });
    return { exitCode: 0, signal: null, canceled: false, timedOut: false, stdinError: null };
  });
});
afterEach(() => db.close());

describe('target credentials and lifecycle', () => {
  test('encrypts credentials and excludes them from every public summary', () => {
    const target = createTarget(db, box, input());
    const row = getTargetRow(db, target.id);
    expect(row.secret_encrypted).not.toContain('never-return-this');
    expect(JSON.parse(box.decrypt(row.secret_encrypted))).toEqual(input().auth);
    for (const summary of [target, getTarget(db, target.id), ...listTargets(db)]) {
      expect(summary).not.toHaveProperty('secret_encrypted');
      expect(summary).not.toHaveProperty('auth');
      expect(JSON.stringify(summary)).not.toContain('never-return-this');
    }
    expect(target.lastCheckOk).toBeNull();
  });

  test('keeps the credential when editing metadata, and replaces it when explicitly supplied', () => {
    const target = createTarget(db, box, input());
    const encrypted = getTargetRow(db, target.id).secret_encrypted;
    expect(updateTarget(db, box, target.id, { name: 'renamed', port: 2222 })).toMatchObject({
      name: 'renamed', port: 2222, host: '10.0.0.1', username: 'ops', authMethod: 'password',
    });
    expect(getTargetRow(db, target.id).secret_encrypted).toBe(encrypted);
    const auth = { method: 'key' as const, privateKey: 'private-key', passphrase: 'passphrase' };
    expect(updateTarget(db, box, target.id, {
      auth, host: '10.0.0.2', username: 'deploy', connectTimeoutSec: 15,
    })).toMatchObject({
      authMethod: 'key', host: '10.0.0.2', username: 'deploy', connectTimeoutSec: 15,
    });
    expect(JSON.parse(box.decrypt(getTargetRow(db, target.id).secret_encrypted))).toEqual(auth);
    createTransportForTarget(getTargetRow(db, target.id), box);
    expect(ssh.create).toHaveBeenCalledWith(expect.objectContaining({ auth, port: 2222 }));
  });

  test('refuses duplicate names without changing existing targets', () => {
    const first = createTarget(db, box, input());
    const second = createTarget(db, box, input('another'));
    expect(() => createTarget(db, box, input())).toThrow(ConflictError);
    expect(() => updateTarget(db, box, second.id, { name: first.name })).toThrow(ConflictError);
    expect(getTarget(db, second.id).name).toBe('another');
    expect(updateTarget(db, box, first.id, { name: first.name }).name).toBe('edge');
  });

  test('lists names without case-sensitive ordering and deletes unused targets', () => {
    const target = createTarget(db, box, input('zulu'));
    createTarget(db, box, input('Alpha'));
    expect(listTargets(db).map((item) => item.name)).toEqual(['Alpha', 'zulu']);
    deleteTarget(db, target.id);
    expect(() => getTarget(db, target.id)).toThrow(NotFoundError);
    expect(() => updateTarget(db, box, target.id, {})).toThrow(NotFoundError);
    expect(() => deleteTarget(db, target.id)).toThrow(NotFoundError);
  });

  test('preserves a target referenced by execution history', () => {
    const target = createTarget(db, box, input());
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO sources (id,name,kind,mount_path,created_at,updated_at)
      VALUES ('src','local','local','local',?,?)`).run(now, now);
    db.prepare(`INSERT INTO scripts (id,source_id,rel_path,rel_dir,file_name,format,size_bytes,
      content_hash,display_name,discovered_at,updated_at)
      VALUES ('scr','src','run.sh','','run.sh','sh',1,'h','run',?,?)`).run(now, now);
    db.prepare(`INSERT INTO executions (id,script_id,target_id,status,command_display,target_name,
      script_name,script_rel_path,work_dir,queued_at)
      VALUES ('ex','scr',?,'succeeded','sh run.sh','edge','run','run.sh','/srv',?)`).run(target.id, now);
    expect(() => deleteTarget(db, target.id)).toThrow(ConflictError);
    expect(getTarget(db, target.id).id).toBe(target.id);
  });

  test.each(['not-encrypted', 'wrong-key', 'invalid-json'])('refuses unusable stored credentials: %s', (kind) => {
    const target = createTarget(db, box, input());
    const row = getTargetRow(db, target.id);
    row.secret_encrypted = kind === 'wrong-key'
      ? createSecretBox(randomBytes(32)).encrypt('{}')
      : kind === 'invalid-json' ? box.encrypt('{') : 'broken';
    expect(() => createTransportForTarget(row, box)).toThrow(ValidationError);
    expect(ssh.create).not.toHaveBeenCalled();
  });
});

describe('target readiness', () => {
  test('persists successful readiness and probes staging only', async () => {
    const target = createTarget(db, box, input());
    // A recovered host must replace the stale failure shown in the target list.
    db.prepare('UPDATE targets SET last_check_ok = 0, last_check_detail = ? WHERE id = ?')
      .run('previous failure', target.id);
    const result = await checkTarget(db, box, target.id, { stagingRoot: '/tmp/staging' });
    expect(result).toMatchObject({ reachable: true, stagingOk: true, hostUser: 'ops' });
    expect(getTarget(db, target.id)).toMatchObject({ lastCheckOk: true, lastCheckDetail: result.detail });
    expect(getTarget(db, target.id).lastCheckAt).not.toBeNull();
    const command = (ssh.exec.mock.calls[0]![0] as ExecOptions).command;
    expect(command).toContain("mkdir -p /tmp/staging/probe-");
    // The working directory belongs to the run now, so no target path is probed.
    expect(command).not.toContain('[ -d ');
  });

  test('warns about missing setsid without marking a ready host as failed', async () => {
    ssh.check.mockResolvedValue({ ...connected, hasSetsid: false, user: null });
    const target = createTarget(db, box, input());
    const result = await checkTarget(db, box, target.id, { stagingRoot: '/tmp' });
    expect(result.detail).toContain('setsid is missing');
    expect(result.detail).toContain('Connected as ops');
    expect(getTarget(db, target.id).lastCheckOk).toBe(true);
  });

  test.each([
    ['STAGE_FAIL', false, 'could not be created and written'],
    ['', false, 'could not be checked'],
  ])('records a missing staging marker: %s', async (stdout, stagingOk, detail) => {
    ssh.exec.mockImplementation(async (options: ExecOptions) => {
      // Stderr cannot impersonate successful probe output.
      options.onChunk({ stream: 'stderr', data: 'STAGE_OK' });
      options.onChunk({ stream: 'stdout', data: stdout });
    });
    const target = createTarget(db, box, input());
    const result = await checkTarget(db, box, target.id, { stagingRoot: '/tmp' });
    expect(result).toMatchObject({ reachable: true, stagingOk });
    expect(result.detail).toContain(detail);
    expect(getTarget(db, target.id).lastCheckOk).toBe(false);
  });

  test.each([false, true])('records connection failure and skips the readiness probe (throws=%s)', async (throws) => {
    if (throws) ssh.check.mockRejectedValue('connection lost');
    else ssh.check.mockResolvedValue({ ...connected, reachable: false, detail: 'connection lost' });
    const target = createTarget(db, box, input());
    const result = await checkTarget(db, box, target.id, { stagingRoot: '/tmp' });
    expect(result).toMatchObject({ reachable: false, stagingOk: false, detail: 'connection lost' });
    expect(ssh.exec).not.toHaveBeenCalled();
    expect(getTarget(db, target.id).lastCheckOk).toBe(false);
  });

  test('keeps connectivity information when the readiness command fails', async () => {
    ssh.exec.mockRejectedValue(new Error('channel closed'));
    const target = createTarget(db, box, input());
    const result = await checkTarget(db, box, target.id, { stagingRoot: '/tmp' });
    expect(result).toMatchObject({ reachable: true, hostShell: 'bash 5.2', stagingOk: false });
    expect(result.detail).toContain('readiness probe could not run: channel closed');
    expect(getTarget(db, target.id).lastCheckOk).toBe(false);
  });
});

describe('directory browsing', () => {
  test('lists sorted child directories and normalizes the requested path', async () => {
    ssh.exec.mockImplementation(async (options: ExecOptions) => {
      options.onChunk({ stream: 'stdout', data: 'READY\n/tmp/zeta\0/tmp/alpha\0' });
      return { exitCode: 0, signal: null, canceled: false, timedOut: false, stdinError: null };
    });
    const target = createTarget(db, box, input());

    const listing = await listTargetDirectories(db, box, target.id, '/tmp/./');

    expect(listing).toEqual({
      path: '/tmp',
      parent: '/',
      entries: [
        { name: 'alpha', path: '/tmp/alpha' },
        { name: 'zeta', path: '/tmp/zeta' },
      ],
    });
    const command = (ssh.exec.mock.calls[0]![0] as ExecOptions).command;
    expect(command).toContain('find -L /tmp');
    // A name with a newline stays one entry because the list is NUL-delimited.
    expect(command).toContain('-print0');
  });

  test('refuses to report an unreadable directory as empty', async () => {
    ssh.exec.mockImplementation(async (options: ExecOptions) => {
      options.onChunk({ stream: 'stdout', data: 'UNREADABLE\n' });
      return { exitCode: 0, signal: null, canceled: false, timedOut: false, stdinError: null };
    });
    const target = createTarget(db, box, input());
    await expect(listTargetDirectories(db, box, target.id, '/root')).rejects.toThrow(ValidationError);
  });

  test('rejects a relative path before connecting', async () => {
    const target = createTarget(db, box, input());
    await expect(listTargetDirectories(db, box, target.id, 'tmp')).rejects.toThrow(ValidationError);
    expect(ssh.exec).not.toHaveBeenCalled();
  });
});
