/**
 * A FIFO mutex for work that must not interleave.
 *
 * Node runs one thing at a time, but the DNS check awaits between its steps --
 * probe, query, write -- so two overlapping runs could both read "the record
 * says X" and both decide to write Y. The module-level lock the Python version
 * used has no direct equivalent, and this is it.
 *
 * The execution queue is not the right tool for this: `enqueue` returns
 * immediately and settles out of band, while a manual check has to answer with
 * the result of its own run.
 */

export type Mutex = {
  /** Runs `fn` once every previously queued call has settled, and resolves with its result. */
  run: <T>(fn: () => Promise<T>) => Promise<T>;
};

export function createMutex(): Mutex {
  // The tail of the chain. Callers append their own link, so acquisition order
  // is call order. It is kept fulfilled on purpose: a rejected link would make
  // every later call inherit that failure instead of running.
  let tail: Promise<unknown> = Promise.resolve();

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const result = tail.then(() => fn());
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}
