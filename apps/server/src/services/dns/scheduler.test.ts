import { describe, expect, test } from 'vitest';

import { createLogger } from '../../lib/logger.js';
import { createDnsScheduler, type DnsSchedulerDeps } from './scheduler.js';

const logger = createLogger({ level: 'silent', pretty: false });

/** A timer table a test fires by hand, standing in for wall-clock time. */
function fakeTimers() {
  const entries = new Map<number, { fn: () => void; ms: number }>();
  let nextId = 1;

  return {
    setTimer: (fn: () => void, ms: number): NodeJS.Timeout => {
      const id = nextId;
      nextId += 1;
      entries.set(id, { fn, ms });
      return { unref: (): void => {}, id } as unknown as NodeJS.Timeout;
    },
    clearTimer: (timer: NodeJS.Timeout): void => {
      entries.delete((timer as unknown as { id: number }).id);
    },
    /** Fire the timer that is currently armed; there is only ever one. */
    fire(): void {
      const [id, entry] = [...entries.entries()].at(-1) ?? [];
      if (id === undefined || !entry) throw new Error('nothing is scheduled');
      entries.delete(id);
      entry.fn();
    },
    pending: (): number => entries.size,
    delayMs: (): number => [...entries.values()].at(-1)?.ms ?? 0,
  };
}

/** Let every already-resolved promise in the tick chain settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

type UpdateResult = { action: string; failureReason: string | null };

function setup(overrides: Partial<DnsSchedulerDeps> = {}) {
  const timers = fakeTimers();
  const calls: string[] = [];
  const service = {
    update: async (source: string): Promise<UpdateResult> => {
      calls.push(source);
      return { action: 'unchanged', failureReason: null };
    },
  };
  const scheduler = createDnsScheduler({
    service: service as unknown as DnsSchedulerDeps['service'],
    logger,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    now: () => Date.parse('2026-01-01T00:00:00.000Z'),
    ...overrides,
  });
  return { scheduler, timers, calls };
}

describe('configure', () => {
  test('arms one timer for the interval and reports when it fires', () => {
    const { scheduler, timers } = setup();

    scheduler.configure({ scheduleEnabled: true, intervalMinutes: 15 });

    expect(timers.pending()).toBe(1);
    expect(timers.delayMs()).toBe(15 * 60_000);
    expect(scheduler.snapshot()).toMatchObject({
      enabled: true,
      intervalMinutes: 15,
      nextRunAt: '2026-01-01T00:15:00.000Z',
    });
  });

  test('does nothing when the same pair is configured again', () => {
    // The rule that keeps a page refresh from pushing the next run forward: the
    // UI asks for the state on every visit, and configure runs on each one.
    const { scheduler, timers } = setup();
    scheduler.configure({ scheduleEnabled: true, intervalMinutes: 15 });
    const armed = timers.pending();

    scheduler.configure({ scheduleEnabled: true, intervalMinutes: 15 });

    expect(timers.pending()).toBe(armed);
    expect(scheduler.snapshot().nextRunAt).toBe('2026-01-01T00:15:00.000Z');
  });

  test('re-arms when the interval changes', () => {
    const { scheduler, timers } = setup();
    scheduler.configure({ scheduleEnabled: true, intervalMinutes: 15 });

    scheduler.configure({ scheduleEnabled: true, intervalMinutes: 60 });

    expect(timers.pending()).toBe(1);
    expect(timers.delayMs()).toBe(60 * 60_000);
  });

  test('takes the timer away when the schedule is switched off', () => {
    const { scheduler, timers } = setup();
    scheduler.configure({ scheduleEnabled: true, intervalMinutes: 15 });

    scheduler.configure({ scheduleEnabled: false, intervalMinutes: 15 });

    expect(timers.pending()).toBe(0);
    expect(scheduler.snapshot()).toMatchObject({ enabled: false, nextRunAt: null });
  });
});

describe('a firing timer', () => {
  test('runs the check as a scheduled one and re-arms itself', async () => {
    const { scheduler, timers, calls } = setup();
    scheduler.configure({ scheduleEnabled: true, intervalMinutes: 15 });

    timers.fire();
    await flush();

    expect(calls).toEqual(['scheduled']);
    // Re-armed after the run rather than on a fixed cadence: a run longer than
    // the interval must not overlap itself.
    expect(timers.pending()).toBe(1);
  });

  test('skips a tick that arrives while a run is still in flight', async () => {
    // Since the timer re-arms only after a run finishes, the way a second tick
    // overlaps is a reconfigure mid-run: that arms a new timer while the old run
    // is still going.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls: string[] = [];
    const { scheduler, timers } = setup({
      service: {
        update: async (source: string): Promise<UpdateResult> => {
          calls.push(source);
          await gate;
          return { action: 'unchanged', failureReason: null };
        },
      } as unknown as DnsSchedulerDeps['service'],
    });

    scheduler.configure({ scheduleEnabled: true, intervalMinutes: 15 });
    timers.fire();
    await flush();
    expect(scheduler.snapshot().running).toBe(true);

    scheduler.configure({ scheduleEnabled: true, intervalMinutes: 60 });
    timers.fire();
    await flush();

    // The run in progress owns the outcome; this tick had nothing to do.
    expect(calls).toEqual(['scheduled']);
    expect(timers.pending()).toBe(1);

    release();
    await flush();
    expect(scheduler.snapshot().running).toBe(false);
  });

  test('keeps the schedule alive when a run comes back failed', async () => {
    // A failed check is a result, not an exception: the timer must still be
    // re-armed, or the record would stay wrong until someone noticed.
    const { scheduler, timers } = setup({
      service: {
        update: async (): Promise<UpdateResult> => ({
          action: 'failed',
          failureReason: 'dns_query_failed',
        }),
      } as unknown as DnsSchedulerDeps['service'],
    });
    scheduler.configure({ scheduleEnabled: true, intervalMinutes: 15 });

    timers.fire();
    await flush();

    expect(timers.pending()).toBe(1);
    expect(scheduler.snapshot().running).toBe(false);
  });

  test('keeps the schedule alive when a run throws unexpectedly', async () => {
    const { scheduler, timers } = setup({
      service: {
        update: async (): Promise<UpdateResult> => {
          throw new Error('bug');
        },
      } as unknown as DnsSchedulerDeps['service'],
    });
    scheduler.configure({ scheduleEnabled: true, intervalMinutes: 15 });

    timers.fire();
    await flush();

    expect(timers.pending()).toBe(1);
  });
});

describe('stop', () => {
  test('cancels the timer and ignores a tick that was already in flight', async () => {
    const { scheduler, timers, calls } = setup();
    scheduler.configure({ scheduleEnabled: true, intervalMinutes: 15 });
    timers.fire();

    // Shutdown lands while that run is between its await points.
    scheduler.stop();
    await flush();

    expect(timers.pending()).toBe(0);
    expect(scheduler.snapshot()).toMatchObject({ enabled: false, nextRunAt: null });
    // The run itself still completed; it just no longer re-arms anything.
    expect(calls).toEqual(['scheduled']);
  });
});
