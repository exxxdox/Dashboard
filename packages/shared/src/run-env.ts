/**
 * The environment the runner adds to every execution.
 *
 * These are the runner's own channel to the script: where the staged file is,
 * which execution this is, which target and source it came from. A parameter may
 * not take one of these names, because the runner writes them *after* the
 * parameters and would discard the supplied value without saying so.
 *
 * This list is the single source of truth. `executions.ts` types its own env
 * object as `Record<RunEnvName, string>`, so a variable added on either side
 * without the other fails typecheck instead of quietly losing the guard.
 */
export const RUN_ENV_NAMES = [
  'SD_EXECUTION_ID',
  'SD_SCRIPT_NAME',
  'SD_SCRIPT_PATH',
  'SD_SCRIPT_REL_PATH',
  'SD_WORK_DIR',
  // Deprecated alias: the working directory used to be the script's own
  // directory, and scripts in the wild read this name for exactly that.
  'SD_SCRIPT_DIR',
  'SD_TARGET_NAME',
  'SD_SOURCE_NAME',
] as const;

export type RunEnvName = (typeof RUN_ENV_NAMES)[number];

export function isRunEnvName(name: string): name is RunEnvName {
  return (RUN_ENV_NAMES as readonly string[]).includes(name);
}
