import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionLogChunk, ExecutionStream } from '@script-dashboard/shared';
import { LogStream } from './stream';
import { api } from './client';

vi.mock('./client', () => ({
  api: { getExecutionLogs: vi.fn() },
  errorMessage: (error: unknown) => (error instanceof Error ? error.message : 'Unexpected error'),
}));

const getExecutionLogs = vi.mocked(api.getExecutionLogs);

function chunk(seq: number, data = `line ${seq}`, stream: ExecutionStream = 'stdout'): ExecutionLogChunk {
  return { executionId: 'ex-1', seq, stream, data, ts: '2026-09-27T12:00:00.000Z' };
}

/** Deferred promise, so a fill can be held open while live chunks arrive. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeStream() {
  const received: number[] = [];
  const errors: string[] = [];
  const stream = new LogStream(
    'ex-1',
    (incoming) => received.push(incoming.seq),
    (message) => errors.push(message),
  );
  return { stream, received, errors };
}

beforeEach(() => {
  getExecutionLogs.mockReset();
});

describe('LogStream history', () => {
  it('asks for everything from the beginning', async () => {
    getExecutionLogs.mockResolvedValue([]);
    const { stream } = makeStream();

    await stream.loadHistory();

    expect(getExecutionLogs).toHaveBeenCalledWith('ex-1', 0);
  });

  it('emits stored chunks in seq order even when the server sends them shuffled', async () => {
    getExecutionLogs.mockResolvedValue([chunk(3), chunk(1), chunk(2)]);
    const { stream, received } = makeStream();

    await stream.loadHistory();

    expect(received).toEqual([1, 2, 3]);
    expect(stream.lastSeq).toBe(3);
  });
});

describe('LogStream live merging', () => {
  it('appends a chunk that continues the sequence', async () => {
    getExecutionLogs.mockResolvedValue([chunk(1), chunk(2)]);
    const { stream, received } = makeStream();
    await stream.loadHistory();

    stream.push(chunk(3));

    expect(received).toEqual([1, 2, 3]);
  });

  it('drops a duplicate the backfill already delivered', async () => {
    // The backfill and the socket overlap by design; replaying a chunk would
    // duplicate terminal output.
    getExecutionLogs.mockResolvedValue([chunk(1), chunk(2)]);
    const { stream, received } = makeStream();
    await stream.loadHistory();

    stream.push(chunk(2));
    stream.push(chunk(1));

    expect(received).toEqual([1, 2]);
    expect(getExecutionLogs).toHaveBeenCalledTimes(1);
  });

  it('treats a chunk beyond the next seq as a gap and re-requests from the cursor', async () => {
    getExecutionLogs.mockResolvedValueOnce([chunk(1), chunk(2)]);
    const { stream, received } = makeStream();
    await stream.loadHistory();

    // seq 5 arrives: 3 and 4 were produced while the socket was down.
    getExecutionLogs.mockResolvedValueOnce([chunk(3), chunk(4), chunk(5)]);
    stream.push(chunk(5));
    await vi.waitFor(() => expect(received).toEqual([1, 2, 3, 4, 5]));

    // The re-request must start after the last chunk we already had, not from 0
    // and not from the chunk that revealed the gap.
    expect(getExecutionLogs).toHaveBeenLastCalledWith('ex-1', 2);
    expect(stream.lastSeq).toBe(5);
  });

  it('writes a chunk that arrives past a hole only after the hole is filled', async () => {
    getExecutionLogs.mockResolvedValueOnce([chunk(1), chunk(2)]);
    const { stream, received } = makeStream();
    await stream.loadHistory();

    getExecutionLogs.mockResolvedValueOnce([chunk(3), chunk(4)]);
    stream.push(chunk(4));

    // Emitting 4 here would print the tail of the run above its middle.
    expect(received).toEqual([1, 2]);
    await vi.waitFor(() => expect(received).toEqual([1, 2, 3, 4]));
  });

  it('accepts a permanent hole rather than stalling the run forever', async () => {
    getExecutionLogs.mockResolvedValueOnce([chunk(1)]);
    const { stream, received } = makeStream();
    await stream.loadHistory();

    // The server has nothing between 1 and 9, so asking again cannot help.
    getExecutionLogs.mockResolvedValue([]);
    stream.push(chunk(9));
    await vi.waitFor(() => expect(received).toContain(9));

    expect(received).toEqual([1, 9]);
    expect(stream.lastSeq).toBe(9);
    // One attempt to fill the hole, not an unbounded retry loop.
    expect(getExecutionLogs).toHaveBeenCalledTimes(2);
  });

  it('does not re-request when the next chunk is contiguous', async () => {
    getExecutionLogs.mockResolvedValueOnce([chunk(1)]);
    const { stream } = makeStream();
    await stream.loadHistory();

    stream.push(chunk(2));

    expect(getExecutionLogs).toHaveBeenCalledTimes(1);
  });

  it('resync asks only for what is missing', async () => {
    getExecutionLogs.mockResolvedValueOnce([chunk(1), chunk(2)]);
    const { stream } = makeStream();
    await stream.loadHistory();

    getExecutionLogs.mockResolvedValueOnce([chunk(3)]);
    await stream.resync();

    expect(getExecutionLogs).toHaveBeenLastCalledWith('ex-1', 2);
  });

  it('holds live chunks during a gap fill and then delivers them in seq order', async () => {
    getExecutionLogs.mockResolvedValueOnce([chunk(1)]);
    const { stream, received } = makeStream();
    await stream.loadHistory();

    // Hold the fill for the gap open, then land a later chunk while it is in flight.
    const fill = deferred<ExecutionLogChunk[]>();
    getExecutionLogs.mockReturnValueOnce(fill.promise);

    stream.push(chunk(4)); // reveals the gap 2,3 and starts the fill
    stream.push(chunk(5)); // arrives mid-fill and must not overtake 2,3

    fill.resolve([chunk(2), chunk(3)]);
    await vi.waitFor(() => expect(received).toContain(5));

    // Nothing overtook the hole, including the chunk that revealed it.
    expect(received).toEqual([1, 2, 3, 4, 5]);
    expect(stream.lastSeq).toBe(5);
  });

  it('surfaces a failed fill without wedging the stream', async () => {
    getExecutionLogs.mockResolvedValueOnce([]);
    const { stream, received, errors } = makeStream();
    await stream.loadHistory();

    getExecutionLogs.mockRejectedValueOnce(new Error('network_error'));
    await stream.resync();
    expect(errors).toEqual(['network_error']);

    // A later chunk still lands.
    stream.push(chunk(1));
    expect(received).toEqual([1]);
  });
});
