import { afterEach, describe, expect, test, vi } from 'vitest';

import { installCrashHandlers } from './crash-handlers.js';
import type { Logger } from './logger.js';

/**
 * Capture the listeners a module registers rather than leaving them on the real
 * process, where a later test in the same worker would inherit them.
 */
function captureListeners(): Map<string, (cause: unknown) => void> {
  const listeners = new Map<string, (cause: unknown) => void>();
  vi.spyOn(process, 'on').mockImplementation(((
    event: string,
    listener: (cause: unknown) => void,
  ) => {
    listeners.set(event, listener);
    return process;
  }) as typeof process.on);
  return listeners;
}

/** Only `fatal` is used on this path, so the rest of the logger is not faked. */
function fakeLogger(): Logger & { fatal: ReturnType<typeof vi.fn> } {
  return { fatal: vi.fn() } as unknown as Logger & { fatal: ReturnType<typeof vi.fn> };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('installCrashHandlers', () => {
  test('covers both ways a process dies unasked', () => {
    const listeners = captureListeners();

    installCrashHandlers({ logger: fakeLogger(), shutdown: vi.fn() });

    expect([...listeners.keys()]).toEqual(['uncaughtException', 'unhandledRejection']);
  });

  test('reports an uncaught exception at fatal and shuts down with a failing exit code', () => {
    const listeners = captureListeners();
    const logger = fakeLogger();
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const cause = new Error('boom');

    installCrashHandlers({ logger, shutdown });
    listeners.get('uncaughtException')?.(cause);

    expect(logger.fatal).toHaveBeenCalledWith({ err: cause }, 'uncaught exception');
    expect(shutdown).toHaveBeenCalledWith('uncaughtException', 1);
  });

  test('treats an unhandled rejection the same way, reason included', () => {
    const listeners = captureListeners();
    const logger = fakeLogger();
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const reason = new Error('rejected');

    installCrashHandlers({ logger, shutdown });
    listeners.get('unhandledRejection')?.(reason);

    expect(logger.fatal).toHaveBeenCalledWith({ err: reason }, 'unhandled rejection');
    expect(shutdown).toHaveBeenCalledWith('unhandledRejection', 1);
  });
});
