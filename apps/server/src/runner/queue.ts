/**
 * Bounded execution queue.
 *
 * Two limits, because they protect different things. The global limit keeps the
 * container from opening an unbounded number of SSH connections; the per-key
 * limit keeps one busy host from consuming every slot, which a single global
 * limit would allow.
 *
 * The queue is in-process, so a restart loses queued and running work. That is
 * why `markInterrupted` exists at boot: state left behind by a dead process has
 * to be reconciled rather than shown as still running.
 */

export type QueueTask = {
  id: string;
  /** Second-level grouping key, normally the target id. */
  key: string;
  run: (signal: AbortSignal) => Promise<void>;
};

export type QueueEvent =
  | { type: 'started'; id: string; key: string }
  | { type: 'settled'; id: string; key: string; outcome: 'done' | 'failed' | 'canceled' };

export type QueueOptions = {
  concurrency: number;
  perKeyConcurrency: number;
  onEvent?: (event: QueueEvent) => void;
  /** Injected for tests; defaults to `queueMicrotask`. */
  schedule?: (fn: () => void) => void;
};

export type Queue = {
  /** Add a task. Throws when the id is already queued or running. */
  enqueue: (task: QueueTask) => void;
  /**
   * Cancel a task. A queued task is dropped immediately; a running one has its
   * signal aborted and settles as `canceled`. Returns false when id is unknown.
   */
  cancel: (id: string) => boolean;
  /** Position in the waiting line, or -1 when not waiting. */
  positionOf: (id: string) => number;
  isActive: (id: string) => boolean;
  readonly activeCount: number;
  readonly pendingCount: number;
  /** Resolve once nothing is queued or running. For tests and shutdown. */
  drain: () => Promise<void>;
};

export function createQueue(options: QueueOptions): Queue {
  const { concurrency, perKeyConcurrency, onEvent, schedule = queueMicrotask } = options;

  const pending: QueueTask[] = [];
  /** Running tasks, keyed by id; the key is kept for per-host counting. */
  const active = new Map<string, { key: string; controller: AbortController }>();
  const known = new Set<string>();

  const countForKey = (key: string): number => {
    let count = 0;
    for (const entry of active.values()) {
      if (entry.key === key) count += 1;
    }
    return count;
  };

  const canStart = (task: QueueTask): boolean =>
    active.size < concurrency && countForKey(task.key) < perKeyConcurrency;

  function pump(): void {
    for (;;) {
      // Scan for the first task that fits rather than only looking at the head:
      // otherwise a task blocked by its key's limit would stall unrelated work
      // queued behind it.
      const index = pending.findIndex((task) => canStart(task));
      if (index === -1) return;

      const task = pending.splice(index, 1)[0];
      if (!task) return;

      const controller = new AbortController();
      active.set(task.id, { key: task.key, controller });
      onEvent?.({ type: 'started', id: task.id, key: task.key });

      // Defer the call so enqueue() never runs a task synchronously; otherwise
      // callers would observe the run starting before enqueue returned.
      schedule(() => {
        task.run(controller.signal).then(
          () => settle(task, 'done'),
          () => settle(task, 'failed'),
        );
      });
    }
  }

  function settle(task: QueueTask, outcome: 'done' | 'failed'): void {
    const entry = active.get(task.id);
    if (!entry) return;

    active.delete(task.id);
    known.delete(task.id);
    // An aborted signal means the task was stopped on purpose, whatever it
    // reported: the runner resolves rather than rejects on cancellation.
    onEvent?.({
      type: 'settled',
      id: task.id,
      key: entry.key,
      outcome: entry.controller.signal.aborted ? 'canceled' : outcome,
    });
    pump();
  }

  return {
    enqueue(task: QueueTask): void {
      if (known.has(task.id)) {
        throw new Error(`Task ${task.id} is already queued or running`);
      }
      known.add(task.id);
      pending.push(task);
      pump();
    },

    cancel(id: string): boolean {
      const activeEntry = active.get(id);
      if (activeEntry) {
        activeEntry.controller.abort();
        return true;
      }

      const index = pending.findIndex((task) => task.id === id);
      if (index === -1) return false;

      pending.splice(index, 1);
      known.delete(id);
      onEvent?.({ type: 'settled', id, key: '', outcome: 'canceled' });
      // Removing a waiter can free the slot that was blocking another task.
      pump();
      return true;
    },

    positionOf(id: string): number {
      return pending.findIndex((task) => task.id === id);
    },

    isActive(id: string): boolean {
      return active.has(id);
    },

    get activeCount(): number {
      return active.size;
    },

    get pendingCount(): number {
      return pending.length;
    },

    async drain(): Promise<void> {
      while (active.size > 0 || pending.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
  };
}
