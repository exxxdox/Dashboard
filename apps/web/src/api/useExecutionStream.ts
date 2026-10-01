import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExecutionLogChunk, ExecutionSummary } from '@dashboard/shared';
import { LogStream } from './stream';
import { executionSocket } from './ws';

export type ExecutionStreamOptions = {
  executionId: string;
  /** True while the run has not reached a terminal status. */
  live: boolean;
  onChunk: (chunk: ExecutionLogChunk) => void;
  onStatus?: (execution: ExecutionSummary) => void;
};

/**
 * Owns the log stream for one run.
 *
 * History is loaded before the socket subscribes, so the two never race: any
 * chunk emitted between the two is picked up by the resync that runs on
 * `subscribed`. When the run finishes, the subscription is dropped and a final
 * resync collects whatever was written as it exited.
 *
 * Reports nothing back: the terminal renders the chunks as they arrive, so
 * there is no second thing for a caller to read.
 */
export function useExecutionStream({
  executionId,
  live,
  onChunk,
  onStatus,
}: ExecutionStreamOptions): void {
  const [loaded, setLoaded] = useState(false);

  // Callbacks are read through refs so a re-render never resubscribes the socket.
  const chunkRef = useRef(onChunk);
  const statusRef = useRef(onStatus);
  useEffect(() => {
    chunkRef.current = onChunk;
    statusRef.current = onStatus;
  });

  const stream = useMemo(
    () => new LogStream(executionId, (chunk) => chunkRef.current(chunk)),
    [executionId],
  );

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);

    void stream.loadHistory().then(() => {
      if (!cancelled) setLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [stream]);

  useEffect(() => {
    // Waiting for `loaded` keeps the backfill and the live stream from racing.
    if (!live || !loaded) return;

    const unsubscribe = executionSocket.subscribe(executionId, {
      onLog: (chunk) => stream.push(chunk),
      onStatus: (execution) => statusRef.current?.(execution),
      // Fires on connect and on every reconnect.
      onSubscribed: () => void stream.resync(),
    });

    return () => {
      unsubscribe();
      // The run just went terminal: collect the tail written as it exited.
      void stream.resync();
    };
  }, [live, loaded, executionId, stream]);
}
