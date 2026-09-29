import { describe, expect, test } from 'vitest';

import { createQueue, type QueueEvent, type QueueTask } from './queue.js';

/** A promise whose resolution the test controls. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Let pending microtasks and timers settle. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Start tasks synchronously rather than via queueMicrotask, so the assertions
 * below do not depend on how many microtask turns a promise resolution takes.
 */
function makeQueue(concurrency: number, perKeyConcurrency: number, events: QueueEvent[] = []) {
  return createQueue({
    concurrency,
    perKeyConcurrency,
    schedule: (fn) => fn(),
    onEvent: (event) => events.push(event),
  });
}

function task(id: string, key: string, gate: Promise<void>, started: string[]): QueueTask {
  return {
    id,
    key,
    run: async () => {
      started.push(id);
      await gate;
    },
  };
}

describe('createQueue', () => {
  test('runs up to the global concurrency limit', async () => {
    const started: string[] = [];
    const queue = makeQueue(2, 2);
    const gates = [deferred(), deferred(), deferred()];

    queue.enqueue(task('a', 'k1', gates[0]!.promise, started));
    queue.enqueue(task('b', 'k2', gates[1]!.promise, started));
    queue.enqueue(task('c', 'k3', gates[2]!.promise, started));

    expect(started).toEqual(['a', 'b']);
    expect(queue.activeCount).toBe(2);
    expect(queue.pendingCount).toBe(1);

    gates[0]!.resolve();
    await tick();

    expect(started).toEqual(['a', 'b', 'c']);
  });

  test('enforces the per-key limit independently of the global one', () => {
    const started: string[] = [];
    const queue = makeQueue(4, 1);
    const gates = [deferred(), deferred()];

    queue.enqueue(task('a', 'host-1', gates[0]!.promise, started));
    queue.enqueue(task('b', 'host-1', gates[1]!.promise, started));

    // Same host, so the second waits even though global capacity remains.
    expect(started).toEqual(['a']);
    expect(queue.activeCount).toBe(1);
  });

  test('does not let a blocked key stall an unrelated task behind it', () => {
    const started: string[] = [];
    const queue = makeQueue(2, 1);
    const gates = [deferred(), deferred()];

    queue.enqueue(task('a', 'host-1', gates[0]!.promise, started));
    queue.enqueue(task('b', 'host-1', gates[0]!.promise, started));
    queue.enqueue(task('c', 'host-2', gates[1]!.promise, started));

    // `c` is queued behind `b`, which cannot start. Scanning for the first
    // eligible task rather than taking the head is what lets `c` run.
    expect(started).toEqual(['a', 'c']);
  });

  test('reports the position of a waiting task', () => {
    const started: string[] = [];
    const queue = makeQueue(1, 1);
    const gate = deferred();

    queue.enqueue(task('a', 'k', gate.promise, started));
    queue.enqueue(task('b', 'k', gate.promise, started));
    queue.enqueue(task('c', 'k', gate.promise, started));

    expect(queue.positionOf('b')).toBe(0);
    expect(queue.positionOf('a')).toBe(-1);
    expect(queue.isActive('a')).toBe(true);
  });

  test('drops a queued task that is canceled', async () => {
    const started: string[] = [];
    const queue = makeQueue(1, 1);
    const gate = deferred();

    queue.enqueue(task('a', 'k', gate.promise, started));
    queue.enqueue(task('b', 'k', gate.promise, started));

    expect(queue.cancel('b')).toBe(true);
    expect(queue.pendingCount).toBe(0);

    gate.resolve();
    await tick();

    expect(started).toEqual(['a']);
  });

  test('aborts the signal of a running task that is canceled', async () => {
    const started: string[] = [];
    const events: QueueEvent[] = [];
    const queue = makeQueue(1, 1, events);
    const gate = deferred();

    let observed: AbortSignal | undefined;
    queue.enqueue({
      id: 'a',
      key: 'k',
      run: async (signal) => {
        observed = signal;
        started.push('a');
        await gate;
      },
    });

    expect(observed).toBeDefined();
    expect(observed?.aborted).toBe(false);

    expect(queue.cancel('a')).toBe(true);
    expect(observed?.aborted).toBe(true);

    gate.resolve();
    await tick();

    // An aborted task settles as canceled regardless of what it returned.
    expect(events.at(-1)).toEqual({ type: 'settled', id: 'a', key: 'k', outcome: 'canceled' });
  });

  test('returns false when canceling an unknown id', () => {
    expect(makeQueue(1, 1).cancel('nope')).toBe(false);
  });

  test('refuses to enqueue the same id twice', async () => {
    const started: string[] = [];
    const queue = makeQueue(1, 1);
    const gate = deferred();

    queue.enqueue(task('a', 'k', gate.promise, started));
    expect(() => queue.enqueue(task('a', 'k', gate.promise, started))).toThrow(/already queued/);

    gate.resolve();
    await tick();
  });

  test('frees the slot when a task rejects', async () => {
    const started: string[] = [];
    const queue = makeQueue(1, 1);

    queue.enqueue({
      id: 'a',
      key: 'k',
      run: async () => {
        started.push('a');
        throw new Error('boom');
      },
    });
    queue.enqueue({
      id: 'b',
      key: 'k',
      run: async () => {
        started.push('b');
      },
    });

    await queue.drain();
    expect(started).toEqual(['a', 'b']);
  });

  test('drain resolves once everything has settled', async () => {
    const started: string[] = [];
    const queue = makeQueue(2, 2);
    const gate = deferred();

    queue.enqueue(task('a', 'k1', gate.promise, started));
    queue.enqueue(task('b', 'k2', gate.promise, started));

    gate.resolve();
    await queue.drain();

    expect(started).toEqual(['a', 'b']);
    expect(queue.activeCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });
});
