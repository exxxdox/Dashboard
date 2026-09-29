/**
 * The small amount of shared plumbing the DNS console needs for outbound HTTP.
 *
 * This is the only part of the server that talks to the internet, so there is no
 * existing helper to reuse. Deliberately tiny: no retries (a retried DNS write is
 * the wrong instinct, and the Python version had none either) and no client
 * abstraction -- `fetch` already is one.
 */

/**
 * Combine the caller's cancellation with a deadline.
 *
 * `fetch` takes one signal and both matter: the caller aborts on shutdown, while
 * the deadline is what stops a black-holed connection from holding the DNS mutex
 * until the process dies.
 */
export function withDeadline(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const deadline = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}

/**
 * A fetch failure flattened for the log.
 *
 * Node reports every transport failure as `TypeError: fetch failed` with the
 * real reason buried in `.cause`, and the message alone is worthless. The URL is
 * deliberately left out: it can carry a query string, and nothing here needs it
 * to be diagnosable.
 */
export function fetchFailure(error: unknown): { type: string; code?: string; reason?: string } {
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    typeof cause === 'object' && cause !== null && 'code' in cause
      ? String((cause as { code: unknown }).code)
      : undefined;
  const reason = cause instanceof Error ? cause.message : undefined;
  return {
    type: error instanceof Error ? error.name : 'UnknownError',
    ...(code === undefined ? {} : { code }),
    ...(reason === undefined ? {} : { reason }),
  };
}
