/**
 * The scheduled check.
 *
 * One timer, in process, re-armed after each run rather than fired on a fixed
 * cadence: a run that outlasts its interval would otherwise overlap itself, and
 * the fix for that would be a queue of depth one.
 *
 * `configure` is idempotent on `(enabled, intervalMinutes)`, and that is what
 * stops a page refresh from resetting the schedule. The UI asks for the state on
 * every visit; without the check, a schedule would only ever fire for someone who
 * left the tab alone.
 */

import type { DnsFailureReason, DnsSchedulerView } from '@dashboard/shared';

import { errorMessage } from '../../lib/errors.js';
import type { Logger } from '../../lib/logger.js';
import type { DnsService } from './service.js';

export type DnsScheduleSettings = {
  scheduleEnabled: boolean;
  intervalMinutes: number;
};

export type DnsScheduler = {
  configure: (settings: DnsScheduleSettings) => void;
  snapshot: () => DnsSchedulerView;
  stop: () => void;
};

export type DnsSchedulerDeps = {
  /** Only the method it uses, so a test can pass a stub instead of a service. */
  service: Pick<DnsService, 'update'>;
  logger: Logger;
  /** Injected so a test can fire a tick without waiting for wall-clock time. */
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  now?: () => number;
};

export function createDnsScheduler(deps: DnsSchedulerDeps): DnsScheduler {
  const now = deps.now ?? ((): number => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms): NodeJS.Timeout => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((timer): void => clearTimeout(timer));

  let timer: NodeJS.Timeout | null = null;
  /** The pair the timer was armed for; null until the first `configure`. */
  let signature: string | null = null;
  let intervalMinutes = 0;
  let enabled = false;
  /**
   * Bumped by every `configure` and by `stop`. A tick that finishes after one of
   * those happened no longer owns the timer and must not re-arm it -- otherwise
   * switching the schedule off from the page would be undone by the run that was
   * already in flight.
   */
  let generation = 0;
  let nextRunAt: number | null = null;
  let lastRunAt: number | null = null;
  let lastOk: boolean | null = null;
  let lastFailureReason: DnsFailureReason | null = null;
  let running = false;

  function cancel(): void {
    if (timer !== null) clearTimer(timer);
    timer = null;
    nextRunAt = null;
  }

  function scheduleNext(owner: number, minutes: number): void {
    const delayMs = minutes * 60_000;
    nextRunAt = now() + delayMs;
    timer = setTimer(() => {
      void tick(owner, minutes);
    }, delayMs);
    // The timer must not hold the process open: the HTTP server decides how long
    // it lives, and `stop()` is what the shutdown path calls.
    if (typeof timer.unref === 'function') timer.unref();
  }

  async function tick(owner: number, minutes: number): Promise<void> {
    // Reconfigured while this tick was waiting: that call owns the timer now.
    if (owner !== generation) return;
    timer = null;

    if (running) {
      // Single flight. The run in progress reports its own outcome; this tick
      // simply did not happen, which is what `max_instances=1` gave the Python
      // version.
      deps.logger.debug('skipped a scheduled DNS check: the previous one is still running');
    } else {
      running = true;
      try {
        const result = await deps.service.update('scheduled');
        lastRunAt = now();
        lastOk = result.action !== 'failed';
        lastFailureReason = result.failureReason;
      } catch (error) {
        // `update` reports everything an operator can act on as a result, so an
        // exception here is a bug. Log it and keep the schedule alive rather than
        // letting one bad run stop the timer for good.
        lastRunAt = now();
        lastOk = false;
        lastFailureReason = null;
        deps.logger.error(
          { err: errorMessage(error) },
          'the scheduled DNS check failed unexpectedly',
        );
      } finally {
        running = false;
      }
    }

    if (owner === generation) scheduleNext(owner, minutes);
  }

  return {
    configure(settings) {
      const next = `${settings.scheduleEnabled ? 'on' : 'off'}:${settings.intervalMinutes}`;
      if (next === signature) return;

      signature = next;
      enabled = settings.scheduleEnabled;
      intervalMinutes = settings.intervalMinutes;
      generation += 1;
      cancel();
      if (enabled) scheduleNext(generation, intervalMinutes);
    },

    snapshot() {
      return {
        enabled,
        running,
        intervalMinutes,
        nextRunAt: nextRunAt === null ? null : new Date(nextRunAt).toISOString(),
        lastRunAt: lastRunAt === null ? null : new Date(lastRunAt).toISOString(),
        lastOk,
        lastFailureReason,
      };
    },

    stop() {
      generation += 1;
      enabled = false;
      signature = null;
      cancel();
    },
  };
}
