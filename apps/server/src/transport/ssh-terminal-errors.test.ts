import { beforeEach, expect, test, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  commands: [] as string[], normalExit: false, unknownClose: false, input: [] as Buffer[], delayPid: false,
}));
vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('node:events');
  class Channel extends EventEmitter {
    stderr = new EventEmitter();
    writableLength = 0;
    writable = true;
    destroyed = false;
    constructor(readonly terminal: boolean, readonly command: string) { super(); }
    write(data: Buffer): boolean { fixture.input.push(data); return true; }
    setWindow(): void {}
    end(): void { queueMicrotask(() => this.emit('close', this.command === 'plain' && fixture.unknownClose ? undefined : 0)); }
    close(): void { this.destroyed = true; }
  }
  class Client extends EventEmitter {
    connect(): void { queueMicrotask(() => this.emit('ready')); }
    exec(command: string, optionsOrCallback: unknown, callback?: (error: undefined, channel: Channel) => void): void {
      fixture.commands.push(command);
      const done = typeof optionsOrCallback === 'function' ? optionsOrCallback as (error: undefined, channel: Channel) => void : callback;
      const terminal = typeof optionsOrCallback !== 'function';
      const channel = new Channel(terminal, command);
      done?.(undefined, channel);
      if (command === 'upload' || command === 'plain') setTimeout(() => channel.stderr.emit('data', Buffer.from('__SD_PID__=100\n')), 0);
      else if (terminal) {
        const start = (): void => {
          channel.emit('data', Buffer.from('__SD_PID__=101\r\n'));
          queueMicrotask(() => {
            if (fixture.normalExit) channel.emit('close', 0);
            else if (fixture.unknownClose) channel.emit('close');
            else channel.emit('error', new Error('terminal channel failed'));
          });
        };
        setTimeout(start, fixture.delayPid ? 100 : 0);
      } else queueMicrotask(() => channel.emit('close', 0));
    }
    end(): void {}
  }
  return { Client, default: { Client } };
});
import { createSshTransport } from './ssh-transport.js';

beforeEach(() => { fixture.commands = []; fixture.normalExit = false; fixture.unknownClose = false; fixture.input = []; fixture.delayPid = false; vi.useRealTimers(); });

const execute = (signal = new AbortController().signal) => createSshTransport({
  host: 'localhost', port: 22, username: 'test', auth: { method: 'password', password: 'test' }, connectTimeoutSec: 1,
}).exec({ command: 'terminal', stdin: Buffer.from('echo hello'), cleanupCommand: 'cleanup',
  terminal: { uploadCommand: 'upload', onReady: () => undefined }, signal, timeoutMs: 1000, onChunk: () => undefined });

test('kills the known remote group before cleanup when only the PTY channel fails', async () => {
  vi.useFakeTimers();
  const result = execute();
  // Observe rejection immediately so fake timer advancement cannot produce an unhandled promise.
  const outcome = result.catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(6000);
  expect(await outcome).toBeInstanceOf(Error);
  expect(fixture.commands[2]).toContain('kill -TERM -101');
  expect(fixture.commands[3]).toContain('kill -KILL -101');
  expect(fixture.commands[4]).toBe('cleanup');
  vi.useRealTimers();
});

test('does not kill a normally completed terminal process', async () => {
  fixture.normalExit = true;
  expect(await execute()).toMatchObject({ exitCode: 0 });
  expect(fixture.commands).toEqual(['upload', 'terminal', 'cleanup']);
});

test('never confirms terminal startup when canceled before its PID arrives', async () => {
  vi.useFakeTimers();
  fixture.delayPid = true;
  const controller = new AbortController();
  const result = execute(controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await vi.advanceTimersByTimeAsync(100);
  expect(await result).toMatchObject({ canceled: true });
  expect(fixture.input).toEqual([Buffer.from('\necho hello')]);
  vi.useRealTimers();
});


test('reports a terminal that closes without an exit status and cleans up its remote group', async () => {
  vi.useFakeTimers();
  fixture.unknownClose = true;
  const outcome = execute().catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(6000);
  expect(await outcome).toEqual(new Error('The SSH channel closed without reporting an exit status. The connection may have been interrupted.'));
  expect(fixture.commands[2]).toContain('kill -TERM -101');
  expect(fixture.commands[3]).toContain('kill -KILL -101');
  expect(fixture.commands[4]).toBe('cleanup');
  vi.useRealTimers();
});


test('reports a non-PTY channel that closes without an exit status', async () => {
  fixture.unknownClose = true;
  const transport = createSshTransport({
    host: 'localhost', port: 22, username: 'test', auth: { method: 'password', password: 'test' }, connectTimeoutSec: 1,
  });
  await expect(transport.exec({ command: 'plain', stdin: Buffer.from('echo hello'),
    signal: new AbortController().signal, timeoutMs: 1000, onChunk: () => undefined,
  })).rejects.toThrow('The SSH channel closed without reporting an exit status');
});
