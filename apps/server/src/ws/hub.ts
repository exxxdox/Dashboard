/**
 * In-process pub/sub for execution events.
 *
 * A run's output has two audiences: the browser watching it live, and the
 * database that keeps it for later. Only the live path goes through here, so a
 * slow or absent subscriber can never hold up an execution.
 */

import type { ServerMessage } from '@dashboard/shared';

export type HubListener = (message: ServerMessage) => void;

export type ExecutionHub = {
  publish: (executionId: string, message: ServerMessage) => void;
  subscribe: (executionId: string, listener: HubListener) => () => void;
};

export function createExecutionHub(): ExecutionHub {
  const listeners = new Map<string, Set<HubListener>>();

  return {
    publish(executionId, message): void {
      const set = listeners.get(executionId);
      if (!set) return;

      for (const listener of set) {
        try {
          listener(message);
        } catch {
          // A failing subscriber (typically a socket that just closed) must not
          // stop the others from receiving the event.
        }
      }
    },

    subscribe(executionId, listener): () => void {
      let set = listeners.get(executionId);
      if (!set) {
        set = new Set();
        listeners.set(executionId, set);
      }
      set.add(listener);

      return () => {
        const current = listeners.get(executionId);
        if (!current) return;
        current.delete(listener);
        // Drop the bucket once nobody is listening, so the map does not grow
        // without bound over a long-running process.
        if (current.size === 0) listeners.delete(executionId);
      };
    },
  };
}
