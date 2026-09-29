/**
 * Last-resort handlers for the two ways a process dies without being asked.
 *
 * Node's defaults are not wrong, only unreadable: the stack goes to stderr
 * unformatted, with no timestamp and no level, and the process exits without
 * closing the database. A container that stops for either reason should leave
 * one JSON line an operator can find, and an exit code that says it failed.
 */

import type { Logger } from './logger.js';

/** Non-zero, and the same code Node itself would have used. */
const CRASH_EXIT_CODE = 1;

/**
 * Caps how long a shutdown triggered by a crash may take. A crash that arrives
 * while one is already running would otherwise wait on a shutdown that has
 * already decided to return, leaving a process that is neither serving nor
 * dying. Comfortably longer than the queue's own grace period.
 */
const CRASH_EXIT_DEADLINE_MS = 15_000;

export type CrashHandlerDeps = {
  logger: Logger;
  /** The normal shutdown sequence, which is expected to end the process. */
  shutdown: (reason: string, exitCode: number) => Promise<void>;
};

export function installCrashHandlers(deps: CrashHandlerDeps): void {
  const handle = (reason: string, message: string, cause: unknown): void => {
    // The event name goes to the shutdown, where it lands beside SIGTERM in the
    // `signal` field; the log line gets words, like every other line here.
    deps.logger.fatal({ err: cause }, message);

    // Held rather than unref'd: if the event loop drains before the shutdown
    // finishes, Node would exit 0 and report a crash as a clean stop.
    const deadline = setTimeout(() => process.exit(CRASH_EXIT_CODE), CRASH_EXIT_DEADLINE_MS);
    void deps.shutdown(reason, CRASH_EXIT_CODE).finally(() => {
      clearTimeout(deadline);
    });
  };

  process.on('uncaughtException', (error) => {
    handle('uncaughtException', 'uncaught exception', error);
  });
  process.on('unhandledRejection', (reason) => {
    handle('unhandledRejection', 'unhandled rejection', reason);
  });
}
