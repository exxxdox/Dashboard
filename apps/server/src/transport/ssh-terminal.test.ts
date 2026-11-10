import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:net';
import { userInfo } from 'node:os';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { buildInteractiveCommand, cleanupStagingCommand, resolveInterpreter } from '@dashboard/shared';
import { createSshTransport } from './ssh-transport.js';
import type { TerminalControl } from './types.js';
import ssh2 from 'ssh2';

const sshd = '/usr/sbin/sshd';
const available = process.env.RUN_SSH_PTY_TESTS === '1' && existsSync(sshd) && existsSync('/run/sshd');
let directory = '';
let daemon: ChildProcess | undefined;
let port = 0;
let privateKey = '';
let nextId = 0;

beforeAll(async () => {
  if (!available) return;
  const scratch = resolve('../../tmp');
  mkdirSync(scratch, { recursive: true });
  directory = mkdtempSync(join(scratch, 'ssh-terminal-'));
  const key = join(directory, 'key');
  execFileSync('/usr/bin/ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { stdio: 'inherit' });
  privateKey = readFileSync(key, 'utf8');
  const listener = createServer();
  await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
  const address = listener.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  port = address.port;
  await new Promise<void>((done) => listener.close(() => done()));
  const config = join(directory, 'sshd_config');
  writeFileSync(config, [
    `Port ${port}`, 'ListenAddress 127.0.0.1', `HostKey ${key}`,
    `AuthorizedKeysFile ${key}.pub`, `PidFile ${directory}/sshd.pid`,
    'UsePAM no', 'StrictModes no', 'PermitRootLogin yes',
    'PasswordAuthentication no', 'KbdInteractiveAuthentication no', 'LogLevel ERROR',
  ].join('\n'));
  daemon = spawn(sshd, ['-D', '-e', '-f', config], { stdio: ['ignore', 'ignore', 'pipe'] });
  let error = '';
  daemon.stderr?.on('data', (chunk: Buffer) => { error += chunk.toString(); });
  await vi.waitFor(async () => {
    if (daemon?.exitCode !== null) throw new Error(`sshd exited: ${error}`);
    const { connect } = await import('node:net');
    await new Promise<void>((done, reject) => {
      const socket = connect(port, '127.0.0.1', () => { socket.destroy(); done(); });
      socket.once('error', reject);
    });
  });
});

afterAll(() => {
  daemon?.kill('SIGTERM');
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function begin(script: string, timeoutMs: number | null = 5000, uploadOverride?: string) {
  const stagingDir = join(directory, `run-${++nextId}`);
  const built = buildInteractiveCommand({
    interpreter: resolveInterpreter('.sh'), scriptPath: join(stagingDir, 'script.sh'),
    stagingDir, cwd: directory,
  });
  let resolveReady: (control: TerminalControl) => void = () => undefined;
  const ready = new Promise<TerminalControl>((done) => { resolveReady = done; });
  const controller = new AbortController();
  let output = '';
  let isReady = false;
  const result = createSshTransport({
    host: '127.0.0.1', port, username: userInfo().username,
    auth: { method: 'key', privateKey }, connectTimeoutSec: 2,
  }).exec({
    command: built.command, stdin: Buffer.from(script), cleanupCommand: cleanupStagingCommand(stagingDir),
    terminal: { uploadCommand: uploadOverride ?? built.uploadCommand, onReady(control) { isReady = true; resolveReady(control); } },
    signal: controller.signal, timeoutMs, onChunk: (chunk) => { output += chunk.data; },
  });
  return { result, ready, controller, stagingDir, output: () => output, isReady: () => isReady };
}

const realTest = test.skipIf(!available);

realTest('gives read a real TTY and keeps script delivery out of terminal output', async () => {
  const run = begin('test -t 0 && test -t 1 || exit 99; read -rp "Choice: " value; printf "\\nANSWER=%s\\n" "$value"');
  const terminal = await run.ready;
  expect(terminal.write('hello world\r')).toBe(true);
  expect(await run.result).toMatchObject({ exitCode: 0, stdinError: null });
  expect(run.output()).toContain('ANSWER=hello world');
  expect(run.output()).not.toContain('test -t');
  expect(run.output()).not.toContain('__SD_PID__');
  expect(existsSync(run.stagingDir)).toBe(false);
  expect(terminal.write('late')).toBe(false);
});

realTest('passes raw direction keys and never echoes password input when the script disables echo', async () => {
  const run = begin('stty -echo -icanon min 1 time 0; printf RAWREADY; dd bs=1 count=3 2>/dev/null | od -An -tx1; stty icanon; printf PASSWORD; read -r secret; stty echo; printf "\\nLENGTH=%s\\n" "${#secret}"');
  const terminal = await run.ready;
  await vi.waitFor(() => expect(run.output()).toContain('RAWREADY'));
  terminal.write('\x1b[A');
  await vi.waitFor(() => expect(run.output()).toContain('PASSWORD'));
  terminal.write('do-not-echo\r');
  expect(await run.result).toMatchObject({ exitCode: 0 });
  expect(run.output()).toContain('1b 5b 41');
  expect(run.output()).toContain('LENGTH=11');
  expect(run.output()).not.toContain('do-not-echo');
});

realTest('changes PTY dimensions and delivers Ctrl+D as EOF', async () => {
  const run = begin('read -r go; stty size; printf EOFREADY; read -r value || printf EOFSEEN');
  const terminal = await run.ready;
  terminal.resize(120, 35);
  terminal.write('go\r');
  await vi.waitFor(() => expect(run.output()).toContain('EOFREADY'));
  terminal.write('\x04');
  expect(await run.result).toMatchObject({ exitCode: 0 });
  expect(run.output()).toContain('35 120');
  expect(run.output()).toContain('EOFSEEN');
});

realTest('delivers Ctrl+C to the foreground script without removing its controlling terminal', async () => {
  const run = begin('trap "printf INTERRUPTED; exit 23" INT; printf INTREADY; while :; do sleep 1; done');
  const terminal = await run.ready;
  await vi.waitFor(() => expect(run.output()).toContain('INTREADY'));
  terminal.write('\x03');
  expect(await run.result).toMatchObject({ exitCode: 23, timedOut: false, canceled: false });
  expect(run.output()).toContain('INTERRUPTED');
});

realTest.each(['cancel', 'timeout'] as const)('stops a script and its child on %s and cleans staging', async (reason) => {
  const run = begin('sleep 60 & printf "CHILD=%s\\n" "$!"; wait', reason === 'timeout' ? 2000 : 5000);
  await run.ready;
  await vi.waitFor(() => expect(run.output()).toMatch(/CHILD=\d+/));
  const childPid = /CHILD=(\d+)/.exec(run.output())?.[1];
  if (reason === 'cancel') run.controller.abort();
  expect(await run.result).toMatchObject({ canceled: reason === 'cancel', timedOut: reason === 'timeout' });
  expect(existsSync(run.stagingDir)).toBe(false);
  if (!childPid) throw new Error('Missing child process');
  await vi.waitFor(() => {
    const path = `/proc/${childPid}/stat`;
    // A dead child can remain as a zombie until the container's PID 1 reaps it.
    expect(!existsSync(path) || readFileSync(path, 'utf8').includes(') Z ')).toBe(true);
  });
});

realTest('does not start an interpreter after upload failure', async () => {
  const run = begin('printf SHOULD_NOT_RUN', 1000, "printf '__SD_PID__=%s\\n' \"$$\" >&2; IFS= read -r ack; cat >/dev/null; exit 7");
  expect(await run.result).toMatchObject({ exitCode: 7 });
  expect(run.isReady()).toBe(false);
  expect(run.output()).not.toContain('SHOULD_NOT_RUN');
});


realTest.each(['cancel', 'timeout'] as const)('interrupts upload before PTY startup on %s', async (reason) => {
  const upload = "setsid -w sh -c 'printf \"__SD_PID__=%s\\n\" \"$$\" >&2; printf UPLOADING; IFS= read -r ack; cat >/dev/null; sleep 60'";
  const run = begin('printf SHOULD_NOT_RUN', reason === 'timeout' ? 2000 : 5000, upload);
  await vi.waitFor(() => expect(run.output()).toContain('UPLOADING'));
  if (reason === 'cancel') run.controller.abort();
  expect(await run.result).toMatchObject({ canceled: reason === 'cancel', timedOut: reason === 'timeout' });
  expect(run.isReady()).toBe(false);
  expect(run.output()).not.toContain('SHOULD_NOT_RUN');
});

realTest('refuses a successful upload channel which never confirmed a delivery PID', async () => {
  const run = begin('printf SHOULD_NOT_RUN', 2000, 'exit 0');
  const result = await run.result;
  expect(run.isReady()).toBe(false);
  expect(result.stdinError).toBeTruthy();
  expect(run.output()).not.toContain('SHOULD_NOT_RUN');
});


realTest('never invokes the interpreter if the terminal closes before startup confirmation', async () => {
  const scriptPath = join(directory, 'unconfirmed.sh');
  const invokedPath = join(directory, 'unconfirmed-invoked');
  writeFileSync(scriptPath, `printf ran > '${invokedPath}'`);
  const built = buildInteractiveCommand({ interpreter: resolveInterpreter('.sh'), scriptPath, stagingDir: directory, cwd: directory });
  const client = new ssh2.Client();
  try {
    await new Promise<void>((done, reject) => {
      client.once('ready', done);
      client.once('error', reject);
      client.connect({ host: '127.0.0.1', port, username: userInfo().username, privateKey });
    });
    await new Promise<void>((done, reject) => {
      client.exec(built.command, { pty: { term: 'xterm-256color' } }, (error, channel) => {
        if (error) { reject(error); return; }
        channel.on('data', () => channel.close());
        channel.once('error', reject);
        channel.once('close', done);
      });
    });
    expect(existsSync(invokedPath)).toBe(false);
  } finally { client.end(); }
});
