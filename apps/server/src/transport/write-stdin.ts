/**
 * Deliver a script's bytes to a remote command's stdin.
 *
 * The dashboard is the single source of truth for script content, so a run
 * starts by pushing the file to the host rather than by pointing at a directory
 * both sides must share. That makes this write path load-bearing, and it has
 * three ways to go wrong that a naive `write(payload); end()` would not survive:
 *
 *   - The channel window fills before the remote `cat` starts draining, so the
 *     write has to respect backpressure.
 *   - The remote end can close mid-payload, which must be reported rather than
 *     thrown, because the run already has a status to record.
 *   - The exec can settle first (cancel, timeout, crash) while this writer is
 *     still parked on a `drain` that will now never arrive. Waiting there would
 *     delay the kill and then hang forever.
 */

/** The slice of a writable channel this module needs. */
export type StdinSink = {
  /** Returns false when the channel is full and the caller must wait for `drain`. */
  write(chunk: Buffer): boolean;
  end(): void;
  on(event: 'drain' | 'close' | 'error', listener: (...args: unknown[]) => void): unknown;
  off(event: 'drain' | 'close' | 'error', listener: (...args: unknown[]) => void): unknown;
};

/**
 * Chunk size. Small enough that one chunk never has to be buffered whole by a
 * channel with a modest window, large enough that a 2 MiB script is a few dozen
 * writes rather than thousands.
 */
export const STDIN_CHUNK_BYTES = 64 * 1024;

export type WriteStdinOptions = {
  /**
   * Resolves once the exec this write belongs to has settled, for any reason.
   * The writer then stops without reporting an error: a cancelled run has
   * nothing to deliver and must not be labelled a delivery failure.
   */
  giveUp: Promise<void>;
};

/**
 * Write `payload` to `sink` and send EOF.
 *
 * Resolves with `null` when the payload was delivered in full, or with a
 * human-readable reason when it was not. It never rejects -- the caller records
 * the outcome as part of the run rather than as an exception.
 */
export function writeStdin(
  sink: StdinSink,
  payload: Buffer,
  options: WriteStdinOptions,
): Promise<string | null> {
  return new Promise((resolve) => {
    let offset = 0;
    let settled = false;

    const describe = (error: unknown): string =>
      error instanceof Error ? error.message : String(error);

    const detach = (): void => {
      sink.off('drain', onDrain);
      sink.off('close', onClose);
      sink.off('error', onError);
    };

    const settle = (error: string | null): void => {
      if (settled) return;
      settled = true;
      detach();
      resolve(error);
    };

    function push(): void {
      if (settled) return;

      while (offset < payload.length) {
        const chunk = payload.subarray(offset, offset + STDIN_CHUNK_BYTES);
        offset += chunk.length;
        // A false return means the window is full. Returning here and resuming
        // on `drain` is what keeps a large script from being buffered whole.
        if (!sink.write(chunk)) return;
      }

      sink.end();
      settle(null);
    }

    function onDrain(): void {
      push();
    }

    function onClose(): void {
      settle('the channel closed before the script was delivered in full');
    }

    function onError(error: unknown): void {
      settle(`the channel failed while sending the script: ${describe(error)}`);
    }

    // Attached before the first write, so a `drain` that arrives immediately is
    // never missed.
    sink.on('drain', onDrain);
    sink.on('close', onClose);
    sink.on('error', onError);
    void options.giveUp.then(() => {
      settle(null);
    });

    push();
  });
}
