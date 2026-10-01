import type {
  ClientMessage,
  ExecutionLogChunk,
  ExecutionSummary,
  ServerMessage,
} from '@dashboard/shared';

export type SocketState = 'idle' | 'connecting' | 'open' | 'reconnecting';

export type MessageHandlers = {
  onLog?: (chunk: ExecutionLogChunk) => void;
  onStatus?: (execution: ExecutionSummary) => void;
  /** Fired on every (re)subscribe — the cue to backfill anything missed. */
  onSubscribed?: () => void;
  onError?: (message: string) => void;
};

/**
 * The slice of `WebSocket` this client uses.
 *
 * Narrowing to `on*` properties rather than `addEventListener` keeps the
 * surface small enough to fake in a test: an overloaded DOM signature is not
 * structurally satisfiable by a hand-written stub.
 */
export type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

export type ExecutionSocketOptions = {
  /** Defaults to the API's own `/api/ws` on the current origin. */
  url?: string;
  createSocket?: (url: string) => SocketLike;
  /** Jitter source; injected so a test can pin the backoff schedule. */
  random?: () => number;
};

type Subscription = { handlers: MessageHandlers };

/** `WebSocket.OPEN`, without depending on a global in a test environment. */
const SOCKET_OPEN = 1;

export const BASE_RETRY_MS = 500;
export const MAX_RETRY_MS = 15_000;
export const PING_INTERVAL_MS = 20_000;
/** Browsers can leave a half-open socket silent; treat quiet as gone. */
export const STALE_AFTER_MS = 55_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parse a frame from the server.
 *
 * Only the fields the client acts on are checked: a frame that reached the
 * wrong shape would otherwise corrupt the log, and dropping it is recoverable
 * because the gap-fill re-requests anything missing by `seq`.
 */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== 'string') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return null;

  switch (parsed.type) {
    case 'hello':
      return typeof parsed.serverTime === 'string'
        ? { type: 'hello', serverTime: parsed.serverTime }
        : null;
    case 'pong':
      return { type: 'pong' };
    case 'error':
      return {
        type: 'error',
        message: typeof parsed.message === 'string' ? parsed.message : 'Stream error',
      };
    case 'subscribed':
      return typeof parsed.executionId === 'string'
        ? { type: 'subscribed', executionId: parsed.executionId }
        : null;
    case 'log': {
      const chunk = parsed.chunk;
      if (!isRecord(chunk)) return null;
      if (typeof chunk.executionId !== 'string' || typeof chunk.seq !== 'number') return null;
      if (typeof chunk.data !== 'string') return null;
      return { type: 'log', chunk: chunk as unknown as ExecutionLogChunk };
    }
    case 'status': {
      const execution = parsed.execution;
      if (!isRecord(execution) || typeof execution.id !== 'string') return null;
      return { type: 'status', execution: execution as unknown as ExecutionSummary };
    }
    default:
      return null;
  }
}

function defaultSocketUrl(): string {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.host}/api/ws`;
}

/**
 * One socket for the whole app, shared by every run view.
 *
 * A run page is opened, left open, and expected to survive a dropped
 * connection: the socket reconnects with jittered backoff and re-subscribes
 * everything still subscribed, and subscribers are told each time so they can
 * re-request the chunks they missed.
 */
export class ExecutionSocket {
  private socket: SocketLike | null = null;
  private readonly subscriptions = new Map<string, Set<Subscription>>();
  private readonly stateListeners = new Set<(state: SocketState) => void>();
  private readonly options: Required<ExecutionSocketOptions>;
  private state: SocketState = 'idle';
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;

  constructor(options: ExecutionSocketOptions = {}) {
    this.options = {
      url: options.url ?? '',
      createSocket:
        options.createSocket ??
        // The DOM WebSocket satisfies this shape at runtime; the cast keeps the
        // client's own interface narrow enough to fake in a test.
        ((url: string) => new WebSocket(url) as unknown as SocketLike),
      random: options.random ?? Math.random,
    };
  }

  getState(): SocketState {
    return this.state;
  }

  onStateChange(listener: (state: SocketState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  subscribe(executionId: string, handlers: MessageHandlers): () => void {
    const subscription: Subscription = { handlers };
    const existing = this.subscriptions.get(executionId);
    if (existing) existing.add(subscription);
    else this.subscriptions.set(executionId, new Set([subscription]));

    if (this.socket === null) {
      // A reconnect already scheduled keeps its backoff; it re-subscribes on open.
      if (this.retryTimer === null) this.open();
    } else if (existing === undefined) {
      // Only the first subscriber for an execution needs to tell the server.
      this.send({ type: 'subscribe', executionId });
    }

    return () => {
      const set = this.subscriptions.get(executionId);
      if (!set) return;
      set.delete(subscription);
      if (set.size === 0) {
        this.subscriptions.delete(executionId);
        this.send({ type: 'unsubscribe', executionId });
      }
      // Nothing left to stream for: stop reconnecting and let the socket close.
      if (this.subscriptions.size === 0) this.teardown();
    };
  }

  private open(): void {
    if (this.socket !== null) return;
    this.setState('connecting');

    const socket = this.options.createSocket(this.options.url || defaultSocketUrl());
    this.socket = socket;

    socket.onopen = () => {
      // A connection that opened after a teardown is already stale.
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      this.setState('open');
      this.startPing();
      for (const executionId of this.subscriptions.keys()) {
        this.send({ type: 'subscribe', executionId });
      }
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.lastMessageAt = Date.now();
      this.dispatch(parseServerMessage(event.data));
    };

    socket.onclose = () => {
      // A socket we already replaced must not tear down its successor.
      if (this.socket !== socket) return;
      this.socket = null;
      this.stopPing();
      if (this.subscriptions.size === 0) this.setState('idle');
      else this.scheduleRetry();
    };

    // `error` is always followed by `close`, which owns the retry.
    socket.onerror = () => undefined;
  }

  private setState(next: SocketState): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.stateListeners) listener(next);
  }

  private send(message: ClientMessage): void {
    if (this.socket?.readyState !== SOCKET_OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private dispatch(message: ServerMessage | null): void {
    if (!message) return;

    switch (message.type) {
      case 'log': {
        for (const subscription of this.subscriptions.get(message.chunk.executionId) ?? []) {
          subscription.handlers.onLog?.(message.chunk);
        }
        return;
      }
      case 'status': {
        for (const subscription of this.subscriptions.get(message.execution.id) ?? []) {
          subscription.handlers.onStatus?.(message.execution);
        }
        return;
      }
      case 'subscribed': {
        for (const subscription of this.subscriptions.get(message.executionId) ?? []) {
          subscription.handlers.onSubscribed?.();
        }
        return;
      }
      case 'error': {
        // The frame carries no execution id, so every live view is told.
        for (const set of this.subscriptions.values()) {
          for (const subscription of set) subscription.handlers.onError?.(message.message);
        }
        return;
      }
      case 'hello':
      case 'pong':
        return;
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== null) return;
    this.attempt += 1;
    const base = Math.min(BASE_RETRY_MS * 2 ** (this.attempt - 1), MAX_RETRY_MS);
    // Jitter keeps every open tab from reconnecting on the same tick.
    const delay = base * (0.75 + this.options.random() * 0.5);
    this.setState('reconnecting');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastMessageAt > STALE_AFTER_MS) {
        // No traffic for a minute: assume the peer is gone and force `close`.
        this.socket?.close();
        return;
      }
      this.send({ type: 'ping' });
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer === null) return;
    clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private teardown(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.stopPing();
    this.attempt = 0;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.setState('idle');
  }
}

export const executionSocket = new ExecutionSocket();
