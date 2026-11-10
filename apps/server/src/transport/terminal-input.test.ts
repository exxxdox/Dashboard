import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import { createTerminalInput } from './terminal-input.js';

class Channel extends EventEmitter {
  writableLength = 0;
  writable = true;
  destroyed = false;
  blocked = false;
  data: Buffer[] = [];
  size: number[] = [];
  write(data: Buffer): boolean { this.data.push(data); return !this.blocked; }
  setWindow(rows: number, cols: number, height: number, width: number): void { this.size = [rows, cols, height, width]; }
}

test('preserves input order across backpressure and refuses an oversized pending queue', () => {
  const channel = new Channel();
  const input = createTerminalInput(channel);
  channel.blocked = true;
  expect(input.write('first')).toBe(true);
  expect(input.write('second')).toBe(true);
  expect(input.write('x'.repeat(65536))).toBe(false);
  expect(Buffer.concat(channel.data).toString()).toBe('first');
  channel.blocked = false;
  channel.emit('drain');
  expect(Buffer.concat(channel.data).toString()).toBe('firstsecond');
  input.resize(120, 35);
  expect(channel.size).toEqual([35, 120, 0, 0]);
  input.close();
  expect(input.write('late')).toBe(false);
});

test('counts SSH writable buffering and rejects invalid sizes and input after close', () => {
  const channel = new Channel();
  const input = createTerminalInput(channel);
  channel.writableLength = 65536;
  expect(input.write('x')).toBe(false);
  input.resize(0, 24);
  expect(channel.size).toEqual([]);
  channel.emit('close');
  expect(input.write('late')).toBe(false);
});
