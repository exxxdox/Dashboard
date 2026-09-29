import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExecutionLogChunk, ExecutionSummary } from '@dashboard/shared';
import { LogStream } from './stream';
import { executionSocket, type SocketState } from './ws';

export type ExecutionStreamOptions = {
  executionId: string;
  /** True while the run has not reached a terminal status. */
  live: boolean;
  onChunk: (chunk: ExecutionLogChunk) => void;
  onStatus?: (execution: ExecutionSummary) => void;
};

export type ExecutionStream = {
  /** Stored history has been loaded; the view is renderable. */
  loaded: boolean;
  /** Set once history is complete, so a load failure can be retried. */
  error: string | null;
  socketState: SocketState;
  /** Set when the socket reports a protocol-level error. */
  streamError: string | null;
};

/**
 * Owns the log stream for one run.
 *
 * History is loaded before the socket subscribes, so the two never race: any
 * chunk emitted between the two is picked up by the resync that runs on
 * `subscribed`. When the run finishes, the subscription is dropped and a final
 * resync collects whatever was written as it exited.
 */
export function useExecutionStream({
  executionId,
  live,
  onChunk,
  onStatus,
}: ExecutionStreamOptions): ExecutionStream {
  const [state, setState] = useState({
    loaded: false,
    error: null as string | null,
    socketState: 'idle' as SocketState,
    streamError: null as string | null,
  });

  // Callbacks are read through refs so a re-render never resubscribes the socket.
  const chunkRef = useRef(onChunk);
  const statusRef = useRef(onStatus);
  useEffect(() => {
    chunkRef.current = onChunk;
    statusRef.current = onStatus;
  });

  const stream = useMemo(
    () =>
      new LogStream(
        executionId,
        (chunk) => chunkRef.current(chunk),
        (message) => setState((current) => ({ ...current, error: message })),
      ),
    [executionId],
  );

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loaded: false, error: null }));

    void stream.loadHistory().then(() => {
      if (!cancelled) setState((current) => ({ ...current, loaded: true }));
    });

    return () => {
      cancelled = true;
    };
  }, [stream]);

  useEffect(() => {
    const unsubscribeState = executionSocket.onStateChange((socketState) =>
      setState((current) => ({ ...current, socketState })),
    );
    setState((current) => ({ ...current, socketState: executionSocket.getState() }));
    return unsubscribeState;
  }, []);

  useEffect(() => {
    // Waiting for `loaded` keeps the backfill and the live stream from racing.
    if (!live || !state.loaded) return;

    const unsubscribe = executionSocket.subscribe(executionId, {
      onLog: (chunk) => stream.push(chunk),
      onStatus: (execution) => statusRef.current?.(execution),
      // Fires on connect and on every reconnect.
      onSubscribed: () => void stream.resync(),
      onError: (message) => setState((current) => ({ ...current, streamError: message })),
    });

    return () => {
      unsubscribe();
      // The run just went terminal: collect the tail written as it exited.
      void stream.resync();
    };
  }, [live, state.loaded, executionId, stream]);

  return state;
}
