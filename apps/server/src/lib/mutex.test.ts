import { describe, expect, test } from 'vitest';

import { createMutex } from './mutex.js';

/** A promise plus its resolver, so a test can decide when work finishes. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('createMutex', () => {
  test('runs one caller at a time, in call order', async () => {
    const mutex = createMutex();
    const events: string[] = [];
    const first = deferred();

    const a = mutex.run(async () => {
      events.push('a:start');
      await first.promise;
      events.push('a:end');
    });
    const b = mutex.run(async () => {
      events.push('b:start');
      events.push('b:end');
    });

    // Yield enough times that b would have finished by now if it were not queued
    // behind a.
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(['a:start']);

    first.resolve();
    await Promise.all([a, b]);
    expect(events).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  test('resolves with the value the caller returns', async () => {
    const mutex = createMutex();
    await expect(mutex.run(async () => 42)).resolves.toBe(42);
  });

  test('a rejected run reaches its own caller and does not block the next', async () => {
    const mutex = createMutex();
    const failing = mutex.run(async () => {
      throw new Error('boom');
    });
    const following = mutex.run(async () => 'still runs');

    await expect(failing).rejects.toThrow('boom');
    await expect(following).resolves.toBe('still runs');
  });

  test('a caller that throws synchronously is still isolated', async () => {
    const mutex = createMutex();
    const failing = mutex.run(() => {
      throw new Error('sync boom');
    });
    await expect(failing).rejects.toThrow('sync boom');
    await expect(mutex.run(async () => 'ok')).resolves.toBe('ok');
  });
});
