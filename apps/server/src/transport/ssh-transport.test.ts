import { expect, test, vi } from 'vitest';

const output = vi.hoisted(() => ({ stdout: [] as Buffer[], stderr: [] as Buffer[] }));

vi.mock('ssh2', async () => {
  const { EventEmitter } = await import('node:events');
  class Channel extends EventEmitter {
    stderr = new EventEmitter();
    write() { return true; }
    end() {
      queueMicrotask(() => {
        for (let index = 0; index < Math.max(output.stdout.length, output.stderr.length); index++) {
          if (output.stdout[index]) this.emit('data', output.stdout[index]);
          if (output.stderr[index]) this.stderr.emit('data', output.stderr[index]);
        }
        this.emit('close', 0);
      });
    }
  }
  class Client extends EventEmitter {
    connect() { queueMicrotask(() => this.emit('ready')); }
    exec(_command: string, callback: (error: undefined, channel: Channel) => void) {
      callback(undefined, new Channel());
    }
    end() {}
  }
  return { Client, default: { Client } };
});

import { createSshTransport } from './ssh-transport.js';

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
