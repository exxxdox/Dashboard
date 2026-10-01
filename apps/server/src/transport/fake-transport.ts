/**
 * In-memory transport for tests.
 *
 * The runner's interesting behaviour is all bookkeeping -- queueing, log
 * sequencing, truncation, cancellation, status transitions -- and none of it
 * needs a real SSH server to exercise. Scripts here describe what the fake
 * should do when a given command runs.
 */

import type { ExecOptions, ExecOutcome, Transport, TransportCheck } from './types.js';

export type FakeScript = {
  /** Substring matched against the command; the first match wins. */
  match: string;
  stdout?: string;
  stderr?: string;
  /** `null` models a process that was signalled rather than exiting normally. */
  exitCode?: number | null;
  signal?: string | null;
  /** Delay before output is emitted, to exercise concurrent paths. */
  delayMs?: number;
  /** Reject instead of resolving, to exercise connection failures. */
  failWith?: Error;
  /** Report a stdin payload that could not be delivered in full. */
  stdinFailWith?: string;
  /** Emit output and then wait for the abort signal instead of finishing. */
  hangUntilAborted?: boolean;
};

/** One recorded exec, so tests can assert what the runner actually sent. */
export type FakeExec = {
  command: string;
  stdin?: Buffer;
  cleanupCommand?: string;
};

export type FakeTransportOptions = {
  scripts?: FakeScript[];
  check?: Partial<TransportCheck>;
  /** Delay applied to check() so the UI's loading state is observable. */
  checkDelayMs?: number;
};

export type FakeTransport = Transport & {
  /** Every exec this transport has been asked to run, in order. */
  readonly execs: FakeExec[];
  /** Number of exec calls that ended because of an abort. */
  readonly cancelCount: number;
  readonly disposeCount: number;
};

export function createFakeTransport(options: FakeTransportOptions = {}): FakeTransport {
  const scripts = options.scripts ?? [];
  const execs: FakeExec[] = [];
  const state = { cancelCount: 0, disposeCount: 0 };

  return {
    kind: 'fake',
    get execs() {
      return execs;
    },
    get cancelCount() {
      return state.cancelCount;
    },
    get disposeCount() {
      return state.disposeCount;
    },

    async check(): Promise<TransportCheck> {
      if (options.checkDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.checkDelayMs));
      }
      return {
        reachable: true,
        latencyMs: 1,
        detail: 'fake transport',
        shell: 'bash 5.2.15',
        user: 'tester',
        hasSetsid: true,
        ...options.check,
      };
    },

    async exec(execOptions: ExecOptions): Promise<ExecOutcome> {
      const record: FakeExec = { command: execOptions.command };
      if (execOptions.stdin !== undefined) record.stdin = execOptions.stdin;
      if (execOptions.cleanupCommand !== undefined) {
        record.cleanupCommand = execOptions.cleanupCommand;
      }
      execs.push(record);

      const script = scripts.find((candidate) => execOptions.command.includes(candidate.match));

      if (!script) {
        return {
          exitCode: 0,
          signal: null,
          canceled: false,
          timedOut: false,
          stdinError: null,
        };
      }

      if (script.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, script.delayMs));
      }

      if (script.failWith) throw script.failWith;

      if (script.stdout) execOptions.onChunk({ stream: 'stdout', data: script.stdout });
      if (script.stderr) execOptions.onChunk({ stream: 'stderr', data: script.stderr });

      if (script.hangUntilAborted) {
        return new Promise<ExecOutcome>((resolve) => {
          const finish = (canceled: boolean, timedOut: boolean): void => {
            if (canceled) state.cancelCount += 1;
            resolve({
              exitCode: null,
              signal: canceled ? 'TERM' : null,
              canceled,
              timedOut,
              stdinError: script.stdinFailWith ?? null,
            });
          };

          if (execOptions.signal.aborted) {
            finish(true, false);
            return;
          }
          execOptions.signal.addEventListener('abort', () => finish(true, false), { once: true });

          if (execOptions.timeoutMs !== null) {
            const timer = setTimeout(() => finish(false, true), execOptions.timeoutMs);
            // Do not keep the event loop alive purely for the timeout.
            timer.unref?.();
          }
        });
      }

      return {
        // Distinguish "not specified" from "explicitly no exit status", which is
        // what a signalled process reports.
        exitCode: script.exitCode === undefined ? 0 : script.exitCode,
        signal: script.signal ?? null,
        canceled: false,
        timedOut: false,
        stdinError: script.stdinFailWith ?? null,
      };
    },

    async dispose(): Promise<void> {
      state.disposeCount += 1;
    },
  };
}
