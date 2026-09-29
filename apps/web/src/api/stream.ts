import type { ExecutionLogChunk } from '@dashboard/shared';
import { api, errorMessage } from './client';

/**
 * Merges a run's log chunks from two sources — the stored history and the live
 * socket — into one strictly increasing `seq` ordered stream.
 *
 * The cursor only ever advances through chunks that have actually been handed
 * to the consumer. A chunk that arrives past the next expected `seq` is held
 * back rather than written out of order, and the hole is re-requested with
 * `afterSeq` — which is exactly what a dropped socket leaves behind.
 */
export class LogStream {
  private cursor = 0;
  private filling = false;
  private pending: ExecutionLogChunk[] = [];
  /** Cursor value of the last fill attempt, so a hole cannot retry forever. */
  private lastFillFrom = -1;

  constructor(
    private readonly executionId: string,
    private readonly onChunk: (chunk: ExecutionLogChunk) => void,
    private readonly onError: (message: string) => void,
  ) {}

  /** Highest `seq` handed to the consumer so far. */
  get lastSeq(): number {
    return this.cursor;
  }

  /** Load everything the server still holds. Safe to call once per mount. */
  async loadHistory(): Promise<void> {
    await this.fill(0);
  }

  /** Re-request from the cursor: used after every (re)subscribe. */
  async resync(): Promise<void> {
    await this.fill(this.cursor);
  }

  /** Feed a chunk from the live socket. */
  push(chunk: ExecutionLogChunk): void {
    // While a fill is in flight, live chunks wait so the hole is written first.
    if (this.filling) {
      this.pending.push(chunk);
      return;
    }

    // Already delivered: the backfill and the socket overlap by design.
    if (chunk.seq <= this.cursor) return;

    if (chunk.seq > this.cursor + 1) {
      if (this.lastFillFrom === this.cursor) {
        // The server has nothing in between, so the hole is permanent. Writing
        // the chunk late beats never writing it.
        this.cursor = chunk.seq;
        this.onChunk(chunk);
        return;
      }
      this.pending.push(chunk);
      void this.fill(this.cursor);
      return;
    }

    this.cursor = chunk.seq;
    this.onChunk(chunk);
  }

  private async fill(fromSeq: number): Promise<void> {
    if (this.filling) return;
    this.filling = true;
    this.lastFillFrom = fromSeq;

    try {
      const chunks = await api.getExecutionLogs(this.executionId, fromSeq);
      for (const chunk of [...chunks].sort((a, b) => a.seq - b.seq)) {
        if (chunk.seq <= this.cursor) continue;
        this.cursor = chunk.seq;
        this.onChunk(chunk);
      }
    } catch (error) {
      this.onError(errorMessage(error));
      // Allow a later chunk to retry the same hole rather than locking it out.
      this.lastFillFrom = -1;
    } finally {
      this.filling = false;
      const buffered = this.pending;
      this.pending = [];
      for (const chunk of buffered) this.push(chunk);
    }
  }
}
