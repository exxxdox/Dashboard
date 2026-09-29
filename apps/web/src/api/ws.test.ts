import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionLogChunk, ExecutionSummary } from '@dashboard/shared';
import {
  BASE_RETRY_MS,
  ExecutionSocket,
  PING_INTERVAL_MS,
  STALE_AFTER_MS,
  parseServerMessage,
  type SocketLike,
} from './ws';

/** Stands in for a WebSocket: nothing is opened, nothing is dialled. */
class FakeSocket implements SocketLike {
  readyState = 0;
  readonly sent: string[] = [];
  closed = false;

  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({});
  }

  /** Test control: complete the handshake. */
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  /** Test control: deliver a server frame. */
  receive(frame: unknown): void {
    this.onmessage?.({ data: typeof frame === 'string' ? frame : JSON.stringify(frame) });
  }

  /** Test control: the connection drops. */
  drop(): void {
    this.readyState = 3;
    this.closed = true;
    this.onclose?.({});
  }

  frames(): { type?: string; executionId?: string }[] {
    return this.sent.map((raw) => JSON.parse(raw) as { type?: string; executionId?: string });
  }
}

function makeChunk(executionId: string, seq: number): ExecutionLogChunk {
  return { executionId, seq, stream: 'stdout', data: `line ${seq}`, ts: '2026-09-27T12:00:00.000Z' };
}

const execution = (id: string): ExecutionSummary => ({ id }) as ExecutionSummary;

function harness() {
  const sockets: FakeSocket[] = [];
  const socket = new ExecutionSocket({
    url: 'ws://test/api/ws',
    // Pinned jitter so the backoff schedule is exact: base * (0.75 + 0.5 * 0.5).
    random: () => 0.5,
    createSocket: () => {
      const created = new FakeSocket();
      sockets.push(created);
      return created;
    },
  });
  const latest = (): FakeSocket => {
    const created = sockets[sockets.length - 1];
    if (!created) throw new Error('no socket has been created yet');
    return created;
  };
  return { socket, sockets, latest };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parseServerMessage', () => {
  it('rejects anything that is not a known frame', () => {
    expect(parseServerMessage('not json')).toBeNull();
    expect(parseServerMessage(42)).toBeNull();
    expect(parseServerMessage('{"type":"unknown"}')).toBeNull();
    expect(parseServerMessage('null')).toBeNull();
  });

  it('rejects a log frame it cannot order', () => {
    // A chunk without a numeric seq would silently corrupt the merge.
    expect(parseServerMessage('{"type":"log","chunk":{"executionId":"ex-1"}}')).toBeNull();
    expect(parseServerMessage('{"type":"log","chunk":{"executionId":"ex-1","seq":"3","data":"x"}}')).toBeNull();
    expect(parseServerMessage('{"type":"log"}')).toBeNull();
  });

  it('accepts a well-formed log frame', () => {
    const parsed = parseServerMessage(
      JSON.stringify({ type: 'log', chunk: makeChunk('ex-1', 4) }),
    );
    expect(parsed).toEqual({ type: 'log', chunk: makeChunk('ex-1', 4) });
  });

  it('accepts the handshake and heartbeat frames', () => {
    expect(parseServerMessage('{"type":"hello","serverTime":"t"}')).toEqual({
      type: 'hello',
      serverTime: 't',
    });
    expect(parseServerMessage('{"type":"pong"}')).toEqual({ type: 'pong' });
  });
});

describe('ExecutionSocket subscription', () => {
  it('subscribes once the connection is open, not before', () => {
    const { socket, latest } = harness();
    socket.subscribe('ex-1', {});

    // Nothing can be sent on a socket that has not completed its handshake.
    expect(latest().frames()).toEqual([]);

    latest().open();
    expect(latest().frames()).toEqual([{ type: 'subscribe', executionId: 'ex-1' }]);
  });

  it('tells the server once when two views watch the same run', () => {
    const { socket, latest } = harness();
    socket.subscribe('ex-1', {});
    latest().open();

    socket.subscribe('ex-1', {});

    expect(latest().frames()).toEqual([{ type: 'subscribe', executionId: 'ex-1' }]);
  });

  it('routes a chunk only to the run it belongs to', () => {
    const { socket, latest } = harness();
    const one = vi.fn();
    const two = vi.fn();
    socket.subscribe('ex-1', { onLog: one });
    socket.subscribe('ex-2', { onLog: two });
    latest().open();

    latest().receive({ type: 'log', chunk: makeChunk('ex-2', 1) });

    expect(two).toHaveBeenCalledWith(makeChunk('ex-2', 1));
    expect(one).not.toHaveBeenCalled();
  });

  it('pushes a status frame into the matching view', () => {
    const { socket, latest } = harness();
    const onStatus = vi.fn();
    socket.subscribe('ex-1', { onStatus });
    latest().open();

    latest().receive({ type: 'status', execution: execution('ex-1') });

    expect(onStatus).toHaveBeenCalledWith(execution('ex-1'));
  });

  it('delivers a frame to every subscriber of the same run', () => {
    const { socket, latest } = harness();
    const first = vi.fn();
    const second = vi.fn();
    socket.subscribe('ex-1', { onLog: first });
    socket.subscribe('ex-1', { onLog: second });
    latest().open();

    latest().receive({ type: 'log', chunk: makeChunk('ex-1', 7) });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes only when the last view of a run goes away', () => {
    const { socket, latest } = harness();
    const releaseFirst = socket.subscribe('ex-1', {});
    const releaseSecond = socket.subscribe('ex-1', {});
    latest().open();

    releaseFirst();
    expect(latest().frames().some((frame) => frame.type === 'unsubscribe')).toBe(false);

    releaseSecond();
    expect(latest().frames().some((frame) => frame.type === 'unsubscribe')).toBe(true);
  });

  it('closes the connection when nothing is being watched', () => {
    const { socket, latest } = harness();
    const release = socket.subscribe('ex-1', {});
    latest().open();

    release();

    expect(latest().closed).toBe(true);
    expect(socket.getState()).toBe('idle');
  });

  it('reports an error frame to every live view', () => {
    const { socket, latest } = harness();
    const onError = vi.fn();
    socket.subscribe('ex-1', { onError });
    latest().open();

    latest().receive({ type: 'error', message: 'subscription limit reached' });

    expect(onError).toHaveBeenCalledWith('subscription limit reached');
  });

  it('reports state transitions so the UI can show a reconnect', () => {
    const { socket, latest } = harness();
    const states: string[] = [];
    socket.onStateChange((state) => states.push(state));
    socket.subscribe('ex-1', {});
    latest().open();

    expect(states).toEqual(['connecting', 'open']);
  });
});

describe('ExecutionSocket reconnection', () => {
  it('reconnects and re-subscribes after the connection drops', () => {
    const { socket, latest } = harness();
    const onSubscribed = vi.fn();
    socket.subscribe('ex-1', { onSubscribed });
    latest().open();

    latest().drop();
    expect(socket.getState()).toBe('reconnecting');

    vi.advanceTimersByTime(BASE_RETRY_MS);
    expect(socket.getState()).toBe('connecting');

    latest().open();
    // The run view must not have to re-subscribe itself.
    expect(latest().frames()).toEqual([{ type: 'subscribe', executionId: 'ex-1' }]);

    latest().receive({ type: 'subscribed', executionId: 'ex-1' });
    expect(onSubscribed).toHaveBeenCalled();
  });

  it('backs off further on each successive failure', () => {
    const { socket, latest } = harness();
    socket.subscribe('ex-1', {});

    latest().drop();
    vi.advanceTimersByTime(BASE_RETRY_MS);
    expect(socket.getState()).toBe('connecting');

    // Second failure: the delay has doubled, so the base interval is not enough.
    latest().drop();
    vi.advanceTimersByTime(BASE_RETRY_MS);
    expect(socket.getState()).toBe('reconnecting');

    vi.advanceTimersByTime(BASE_RETRY_MS);
    expect(socket.getState()).toBe('connecting');
  });

  it('keeps the backoff that is already scheduled instead of dialling again', () => {
    const { socket, sockets, latest } = harness();
    socket.subscribe('ex-1', {});
    latest().drop();

    socket.subscribe('ex-2', {});

    // A second dial here would reset the backoff and hammer the server.
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(BASE_RETRY_MS);
    expect(sockets).toHaveLength(2);
  });

  it('stops reconnecting once the last view is released', () => {
    const { socket, sockets, latest } = harness();
    const release = socket.subscribe('ex-1', {});
    latest().drop();

    release();
    vi.advanceTimersByTime(BASE_RETRY_MS * 8);

    expect(sockets).toHaveLength(1);
    expect(socket.getState()).toBe('idle');
  });

  it('does not let a superseded socket tear down its replacement', () => {
    const { socket, sockets, latest } = harness();
    socket.subscribe('ex-1', {});
    const stale = latest();
    stale.drop();

    vi.advanceTimersByTime(BASE_RETRY_MS);
    const current = latest();
    expect(current).not.toBe(stale);

    // A late close from the old socket must not schedule another reconnect.
    stale.onclose?.({});
    vi.advanceTimersByTime(BASE_RETRY_MS * 4);

    expect(sockets.length).toBeLessThanOrEqual(3);
    expect(socket.getState()).toBe('connecting');
  });
});

describe('ExecutionSocket liveness', () => {
  it('pings while the connection is quiet', () => {
    const { socket, latest } = harness();
    socket.subscribe('ex-1', {});
    latest().open();

    vi.advanceTimersByTime(PING_INTERVAL_MS);

    expect(latest().frames().some((frame) => frame.type === 'ping')).toBe(true);
  });

  it('drops a half-open connection that stops answering', () => {
    // A browser can leave a dead socket open forever; silence is the only signal.
    const { socket, latest } = harness();
    socket.subscribe('ex-1', {});
    const halfOpen = latest();
    halfOpen.open();

    // Stop at the tick that notices the silence, before the retry is dialled.
    vi.advanceTimersByTime(PING_INTERVAL_MS * Math.ceil(STALE_AFTER_MS / PING_INTERVAL_MS));

    expect(halfOpen.closed).toBe(true);
    expect(socket.getState()).toBe('reconnecting');
  });

  it('keeps a connection alive while the server is still talking', () => {
    const { socket, latest } = harness();
    socket.subscribe('ex-1', {});
    const live = latest();
    live.open();

    for (let tick = 0; tick < 5; tick += 1) {
      vi.advanceTimersByTime(PING_INTERVAL_MS / 2);
      live.receive({ type: 'pong' });
    }

    expect(live.closed).toBe(false);
    expect(socket.getState()).toBe('open');
  });
});
