import { describe, expect, test } from 'vitest';

import { writeStdin, type StdinSink } from './write-stdin.js';

type Listener = (...args: unknown[]) => void;

/** A channel stand-in whose flow control and lifecycle the test drives by hand. */
function fakeSink(options: { startStalled?: boolean } = {}) {
  const chunks: Buffer[] = [];
  const listeners = new Map<string, Set<Listener>>();
  let writable = options.startStalled !== true;
  let ended = false;

  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
  };

  const sink: StdinSink = {
    write(chunk: Buffer): boolean {
      chunks.push(chunk);
      return writable;
    },
    end(): void {
      ended = true;
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      listeners.set(event, set);
      return sink;
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener);
      return sink;
    },
  };

  return {
    sink,
    get chunks(): Buffer[] {
      return chunks;
    },
    get ended(): boolean {
      return ended;
    },
    get delivered(): Buffer {
      return Buffer.concat(chunks);
    },
    get listenerCount(): number {
      let total = 0;
      for (const set of listeners.values()) total += set.size;
      return total;
    },
    drain(): void {
      writable = true;
      emit('drain');
    },
    close(): void {
      emit('close');
    },
    fail(error: Error): void {
      emit('error', error);
    },
  };
}

/** A promise the writer never sees resolve, for the tests that do not cancel. */
const never = new Promise<void>(() => undefined);

/** Let the writer's synchronous first pass run. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('writeStdin', () => {
  test('sends the payload in chunks and ends the stream', async () => {
    const channel = fakeSink();
    const payload = Buffer.alloc(200 * 1024, 0x61);

    await expect(writeStdin(channel.sink, payload, { giveUp: never })).resolves.toBeNull();

    expect(channel.delivered.equals(payload)).toBe(true);
    // One `write` for the whole 200 KiB would rely on the channel buffering it,
    // which is exactly what backpressure handling exists to avoid.
    expect(channel.chunks.length).toBeGreaterThan(1);
    expect(channel.ended).toBe(true);
    // A settled writer holds no listeners, so a long-lived channel cannot leak.
    expect(channel.listenerCount).toBe(0);
  });

  test('ends the stream even when there is nothing to send', async () => {
    const channel = fakeSink();

    await expect(writeStdin(channel.sink, Buffer.alloc(0), { giveUp: never })).resolves.toBeNull();

    expect(channel.chunks).toHaveLength(0);
    expect(channel.ended).toBe(true);
  });

  test('waits for drain instead of dropping bytes when the channel is backed up', async () => {
    const channel = fakeSink({ startStalled: true });
    const payload = Buffer.alloc(200 * 1024, 0x62);

    let settled = false;
    const writing = writeStdin(channel.sink, payload, { giveUp: never }).then((result) => {
      settled = true;
      return result;
    });

    await tick();
    expect(settled).toBe(false);
    expect(channel.ended).toBe(false);

    channel.drain();

    await expect(writing).resolves.toBeNull();
    expect(channel.delivered.equals(payload)).toBe(true);
    expect(channel.ended).toBe(true);
  });

  test('stops waiting once the exec has settled, rather than hanging on a drain that never comes', async () => {
    // Cancel and timeout settle `pump` and only then kill the remote process; a
    // writer still parked on `drain` would delay that kill and then hang.
    const channel = fakeSink({ startStalled: true });
    let release!: () => void;
    const giveUp = new Promise<void>((resolve) => {
      release = resolve;
    });

    const writing = writeStdin(channel.sink, Buffer.alloc(200 * 1024), { giveUp });
    await tick();
    release();

    await expect(writing).resolves.toBeNull();
    expect(channel.listenerCount).toBe(0);
  });

  test('reports a channel that closed before the script was delivered', async () => {
    const channel = fakeSink({ startStalled: true });
    const writing = writeStdin(channel.sink, Buffer.alloc(200 * 1024), { giveUp: never });
    await tick();

    channel.close();

    await expect(writing).resolves.toMatch(/closed before/);
  });

  test('reports a channel error instead of rejecting', async () => {
    const channel = fakeSink({ startStalled: true });
    const writing = writeStdin(channel.sink, Buffer.alloc(200 * 1024), { giveUp: never });
    await tick();

    channel.fail(new Error('socket hang up'));

    // Rejecting here would surface as an unhandled rejection on a path the
    // runner already handles by status; a message is the honest signal.
    await expect(writing).resolves.toMatch(/socket hang up/);
  });
});
