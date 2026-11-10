import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const output = vi.hoisted(() => ({
  stdout: [] as Buffer[], stderr: [] as Buffer[], close: true, code: 0 as number | null,
  signal: null as string | null, connectError: null as Error | null, connectThrow: false,
  commandError: null as Error | null, cleanupError: false,
  commands: [] as string[], ended: 0, config: {} as Record<string, unknown>,
  callbackErrors: [] as unknown[], channelError: false, writes: 0, connectDelay: 0, earlyPid: false, channelDelay: 0, earlyBanner: false, backpressure: false, payloads: [] as Buffer[],
}));

vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('node:events');
  class Channel extends EventEmitter {
    stderr = new EventEmitter();
    write(chunk: Buffer) { output.writes++; output.payloads.push(chunk); return !output.backpressure; }
    end() {
      queueMicrotask(() => {
        for (let index = 0; index < Math.max(output.stdout.length, output.stderr.length); index++) {
          // A consumer exception must not escape the SSH event listener.
          try { if (output.stdout[index]) this.emit('data', output.stdout[index]); }
          catch (error) { output.callbackErrors.push(error); }
          try { if (output.stderr[index]) this.stderr.emit('data', output.stderr[index]); }
          catch (error) { output.callbackErrors.push(error); }
        }
        if (output.channelError) this.emit('error', new Error('stream disconnected'));
        if (output.close) this.emit('close', output.code, output.signal);
      });
    }
  }
  class Client extends EventEmitter {
    connect(config: Record<string, unknown>) {
      output.config = config;
      if (output.connectThrow) throw new Error('bad connection config');
      const ready = () => output.connectError ? this.emit('error', output.connectError) : this.emit('ready');
      if (output.connectDelay) setTimeout(ready, output.connectDelay); else queueMicrotask(ready);
    }
    exec(command: string, callback: (error: Error | undefined, channel: Channel) => void) {
      output.commands.push(command);
      const channel = new Channel();
      const error = command === 'unused' ? output.commandError : output.cleanupError ? new Error('cleanup failed') : null;
      if (command === 'unused' && output.channelDelay) { setTimeout(() => callback(error ?? undefined, channel), output.channelDelay); return; }
      callback(error ?? undefined, channel);
      if (command === 'unused' && output.earlyPid) setTimeout(() => {
        if (output.earlyBanner) channel.stderr.emit('data', Buffer.from('x'.repeat(513)));
        channel.stderr.emit('data', Buffer.from('__SD_PID__=123\n'));
      });
      // Probe and cleanup channels have no stdin writer to trigger their output.
      if (command !== 'unused' && !error) queueMicrotask(() => {
        for (const chunk of output.stdout) channel.emit('data', chunk);
        channel.emit('close', 0);
      });
    }
    end() { output.ended++; }
  }
  return { Client, default: { Client } };
});

import { createSshTransport } from './ssh-transport.js';

beforeEach(() => {
  Object.assign(output, {
    stdout: [], stderr: [], close: true, code: 0, signal: null, connectError: null,
    connectThrow: false, commandError: null, cleanupError: false, commands: [], ended: 0, config: {},
    callbackErrors: [], channelError: false, writes: 0, connectDelay: 0, earlyPid: false, channelDelay: 0, earlyBanner: false, backpressure: false, payloads: [],
  });
});
afterEach(() => vi.useRealTimers());

const transport = () => createSshTransport({
  host: 'localhost', port: 22, username: 'ops', auth: { method: 'password', password: 'unused' },
  connectTimeoutSec: 1,
});
const execute = (signal = new AbortController().signal, timeoutMs: number | null = null) => transport().exec({
  command: 'unused', signal, timeoutMs, onChunk: () => undefined, cleanupCommand: 'remove staging',
});

test('decodes UTF-8 across SSH chunks independently for stdout and stderr', async () => {
  const text = Buffer.from('中文🙂');
  output.stdout = [...text].map((byte) => Buffer.from([byte]));
  output.stderr = [Buffer.from('__SD_PID__=123\n'), ...output.stdout];
  const chunks = { stdout: '', stderr: '' };
  const transport = createSshTransport({
    host: 'localhost', port: 22, username: 'ops', auth: { method: 'password', password: 'unused' },
    connectTimeoutSec: 1,
  });
  await transport.exec({
    command: 'unused', signal: new AbortController().signal, timeoutMs: null,
    onChunk: (chunk) => { chunks[chunk.stream] += chunk.data; },
  });
  expect(chunks).toEqual({ stdout: '中文🙂', stderr: '中文🙂' });
});

test('flushes unfinished UTF-8 bytes and stderr without a pid marker on close', async () => {
  output.stdout = [Buffer.from([0xe4, 0xb8])];
  output.stderr = [Buffer.from('warning '), Buffer.from([0xe4])];
  const chunks = { stdout: '', stderr: '' };
  await createSshTransport({
    host: 'localhost', port: 22, username: 'ops', auth: { method: 'password', password: 'unused' },
    connectTimeoutSec: 1,
  }).exec({
    command: 'unused', signal: new AbortController().signal, timeoutMs: null,
    onChunk: (chunk) => { chunks[chunk.stream] += chunk.data; },
  });
  expect(chunks).toEqual({ stdout: '�', stderr: 'warning �' });
});

test('returns a nonzero remote exit and still removes staging on the same connection', async () => {
  output.code = 23;
  expect(await execute()).toMatchObject({ exitCode: 23, canceled: false, timedOut: false });
  expect(output.commands).toEqual(['unused', 'remove staging']);
  expect(output.ended).toBe(1);
});

test('preserves the remote signal when no exit code is available', async () => {
  output.code = null;
  output.signal = 'KILL';
  expect(await execute()).toMatchObject({ exitCode: null, signal: 'KILL', canceled: false });
});

test.each([false, true])('closes failed connections, including synchronous connect errors (sync=%s)', async (sync) => {
  if (sync) output.connectThrow = true;
  else output.connectError = new Error('authentication failed');
  await expect(execute()).rejects.toThrow(sync ? 'bad connection config' : 'authentication failed');
  expect(output.commands).toEqual([]);
  expect(output.ended).toBe(1);
});

test('closes the client when opening the command channel fails', async () => {
  output.commandError = new Error('channel refused');
  await expect(execute()).rejects.toThrow('channel refused');
  expect(output.ended).toBe(1);
});

test('treats cleanup failure as best effort without replacing the script outcome', async () => {
  output.cleanupError = true;
  expect(await execute()).toMatchObject({ exitCode: 0, stdinError: null });
  expect(output.ended).toBe(1);
});

test('never starts an already aborted run', async () => {
  output.close = false;
  const controller = new AbortController();
  controller.abort();
  expect(await execute(controller.signal)).toMatchObject({ canceled: true, timedOut: false, signal: 'TERM' });
  expect(output.commands).toEqual([]);
});

test.each(['cancel', 'timeout'])('terminates the remote process group before cleanup on %s', async (reason) => {
  vi.useFakeTimers();
  output.close = false;
  output.stderr = [Buffer.from('prefix __SD_PID__=12'), Buffer.from('3\nwarning')];
  const controller = new AbortController();
  const pending = execute(controller.signal, reason === 'timeout' ? 100 : null);
  await vi.advanceTimersByTimeAsync(0);
  if (reason === 'cancel') controller.abort();
  await vi.advanceTimersByTimeAsync(reason === 'timeout' ? 5100 : 5000);
  expect(await pending).toMatchObject({
    canceled: reason === 'cancel', timedOut: reason === 'timeout', exitCode: null, signal: 'TERM',
  });
  expect(output.commands[1]).toContain('kill -TERM -123');
  expect(output.commands[2]).toContain('kill -KILL -123');
  expect(output.commands[3]).toBe('remove staging');
  expect(output.ended).toBe(1);
});

test('does not send a kill command for an invalid PID marker', async () => {
  output.stderr = [Buffer.from('__SD_PID__=0\n')];
  output.close = false;
  const controller = new AbortController();
  const pending = execute(controller.signal);
  await vi.waitFor(() => expect(output.commands).toEqual(['unused']));
  controller.abort();
  expect(await pending).toMatchObject({ canceled: true });
  expect(output.commands).toEqual(['unused', 'remove staging']);
});

test('streams long stderr without waiting forever for a missing PID marker', async () => {
  output.stderr = [Buffer.from('x'.repeat(513)), Buffer.from('tail')];
  const chunks: string[] = [];
  await transport().exec({
    command: 'unused', signal: new AbortController().signal, timeoutMs: null,
    onChunk: (chunk) => chunks.push(chunk.data),
  });
  expect(chunks.join('')).toBe('x'.repeat(513) + 'tail');
});

test('reports probe metadata and sends private-key settings with host verification', async () => {
  output.stdout = [Buffer.from('noise\nshell=5.2\nuser=deploy\nsetsid=yes\n')];
  const ssh = createSshTransport({
    host: 'localhost', port: 2222, username: 'ops', connectTimeoutSec: 3,
    auth: { method: 'key', privateKey: 'key', passphrase: 'phrase' }, hostFingerprint: 'abcd',
  });
  expect(await ssh.check()).toMatchObject({ reachable: true, shell: 'bash 5.2', user: 'deploy', hasSetsid: true });
  expect(output.config).toMatchObject({ privateKey: 'key', passphrase: 'phrase', readyTimeout: 3000, port: 2222 });
  expect(output.config).not.toHaveProperty('password');
  const verify = output.config.hostVerifier as (key: Buffer) => boolean;
  expect(verify(Buffer.from('abcd', 'hex'))).toBe(true);
  expect(verify(Buffer.from('abce', 'hex'))).toBe(false);
  expect(output.ended).toBe(1);
});

test('uses sh and unknown user when the probe has no usable metadata', async () => {
  output.stdout = [Buffer.from('shell=unknown\nsetsid=no\n')];
  expect(await transport().check()).toMatchObject({ reachable: true, shell: 'sh', user: null, hasSetsid: false });
});

test('returns an unreachable check result instead of throwing an authentication error', async () => {
  output.connectError = new Error('authentication failed');
  expect(await transport().check()).toMatchObject({
    reachable: false, detail: 'authentication failed', latencyMs: null, shell: null, user: null,
  });
  expect(output.ended).toBe(1);
});

test('rejects a broken stream and closes its connection', async () => {
  output.channelError = true;
  await expect(execute()).rejects.toThrow('stream disconnected');
  expect(output.ended).toBe(1);
});

test.each(['stdout', 'stderr'] as const)('keeps reading when the %s consumer throws', async (stream) => {
  output[stream] = [Buffer.from(stream === 'stderr' ? '__SD_PID__=123\nfirst' : 'first'), Buffer.from('second')];
  const onChunk = vi.fn(() => { throw new Error('view disconnected'); });
  const result = await transport().exec({
    command: 'unused', signal: new AbortController().signal, timeoutMs: null, onChunk,
  });
  expect(output.callbackErrors).toEqual([]);
  expect(onChunk).toHaveBeenCalledTimes(2);
  expect(result).toMatchObject({ exitCode: 0, canceled: false, timedOut: false });
  expect(output.ended).toBe(1);
});

test('does not send a command when canceled during authentication', async () => {
  vi.useFakeTimers();
  output.connectDelay = 100;
  const controller = new AbortController();
  const pending = execute(controller.signal);
  controller.abort();
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ canceled: true });
  expect(output.commands).toEqual([]);
});

test.each(['cancel', 'timeout'])('withholds the script until its PID is known on %s', async (reason) => {
  vi.useFakeTimers();
  output.close = false;
  output.backpressure = true;
  const controller = new AbortController();
  const pending = transport().exec({
    command: 'unused', stdin: Buffer.from('echo DANGEROUS'), signal: controller.signal,
    timeoutMs: reason === 'timeout' ? 100 : null, onChunk: () => undefined,
  });
  await vi.advanceTimersByTimeAsync(0);
  if (reason === 'cancel') controller.abort();
  await vi.advanceTimersByTimeAsync(100);
  expect(await pending).toMatchObject({ canceled: reason === 'cancel', timedOut: reason === 'timeout' });
  expect(output.writes).toBe(0);
});

test('delivers the script after receiving its PID', async () => {
  output.earlyPid = true;
  await transport().exec({
    command: 'unused', stdin: Buffer.from('echo SAFE'), signal: new AbortController().signal,
    timeoutMs: 1000, onChunk: () => undefined,
  });
  expect(output.writes).toBe(1);
  expect(Buffer.concat(output.payloads).toString()).toBe('\necho SAFE');
});

test.each(['cancel', 'timeout'])('kills a known group when %s interrupts script delivery', async (reason) => {
  vi.useFakeTimers();
  output.earlyPid = true;
  output.close = false;
  output.backpressure = true;
  const controller = new AbortController();
  const pending = transport().exec({
    command: 'unused', stdin: Buffer.from('echo DANGEROUS'), signal: controller.signal,
    timeoutMs: reason === 'timeout' ? 100 : null, onChunk: () => undefined,
    cleanupCommand: 'remove staging',
  });
  await vi.advanceTimersByTimeAsync(0);
  expect(output.writes).toBe(1);
  if (reason === 'cancel') controller.abort();
  await vi.advanceTimersByTimeAsync(5100);
  expect(await pending).toMatchObject({ canceled: reason === 'cancel', timedOut: reason === 'timeout' });
  expect(output.commands[1]).toContain('kill -TERM -123');
  expect(output.commands[2]).toContain('kill -KILL -123');
  expect(output.commands[3]).toBe('remove staging');
});

test('cancels while the server delays the exec channel callback', async () => {
  vi.useFakeTimers();
  output.channelDelay = 10000;
  const controller = new AbortController();
  const pending = execute(controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await expect(pending).resolves.toMatchObject({ canceled: true });
  expect(output.writes).toBe(0);
});

test('accepts the PID after a long shell banner', async () => {
  output.earlyPid = true;
  output.earlyBanner = true;
  const result = await transport().exec({
    command: 'unused', stdin: Buffer.from('echo SAFE'), signal: new AbortController().signal,
    timeoutMs: 100, onChunk: () => undefined,
  });
  expect(result.exitCode).toBe(0);
  expect(output.writes).toBe(1);
});
