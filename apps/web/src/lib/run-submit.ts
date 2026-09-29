import type { ExecuteScriptInput } from '@dashboard/shared';

import type { RunFormState } from './run-draft';
import { collectArgv, collectParams } from './run-params';

/**
 * The run form's state as the request that starts a run.
 *
 * One function rather than two because the form and the one-click run button
 * both submit this shape: a second copy would be a second answer to "what does
 * an empty timeout mean", and the two would drift the first time either moved.
 *
 * An empty timeout box is not zero: it means the script's own limit applies, so
 * the field is left out rather than sent as a number that would override it.
 */
export function toRunInput(state: RunFormState, targetId: string): ExecuteScriptInput {
  const timeout = state.timeoutSec.trim();

  return {
    targetId,
    // Custom rows come last, so a row shadows nothing: a row repeating a
    // declared name is refused by the form before it can get here.
    params: { ...state.values, ...collectParams(state.rows) },
    argv: collectArgv(state.rows),
    ...(timeout === '' ? {} : { timeoutSec: Number(timeout) }),
  };
}
