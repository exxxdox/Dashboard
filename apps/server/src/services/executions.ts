/**
 * Execution lifecycle: validation, queueing, cancellation, and history reads.
 *
 * Everything that needs to know about both the database and the SSH target
 * lives here. The runner only knows how to run an already-resolved plan, which
 * keeps the queued work small and independently testable.
 */

import { readFileSync, statSync } from 'node:fs';

import type {
  ExecuteScriptInput,
  ExecutionLogChunk,
  ExecutionStatus,
  ExecutionSummary,
  ExecutionStream,
  ScriptSummary,
} from '@dashboard/shared';
import { resolveInterpreter, validateParams, type RunEnvName } from '@dashboard/shared';

import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { nowIso } from '../db/client.js';
import type { SecretBox } from '../lib/crypto.js';
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
  ValidationError,
} from '../lib/errors.js';
import { newExecutionId } from '../lib/ids.js';
import type { Logger } from '../lib/logger.js';
import { isInside, joinRoot } from '../lib/paths.js';
import { MAX_FILE_BYTES } from './scan.js';
import type { Queue } from '../runner/queue.js';
import type { ExecutionPlan, ExecutionRunner } from '../runner/runner.js';
import type { Transport } from '../transport/types.js';
import type { ExecutionHub } from '../ws/hub.js';
import {
  getSourceRow,
  sourceDirectory,
  toScriptSummary,
  type ScriptRow,
  type SourceRow,
} from './sources.js';
import { createTransportForTarget, getTargetRow, type TargetRow } from './targets.js';

/** Row shape for an execution, mirroring the `executions` table. */
export type ExecutionRow = {
  id: string;
  script_id: string;
  target_id: string;
  status: ExecutionStatus;
  exit_code: number | null;
  signal: string | null;
  command_display: string;
  target_name: string;
  script_name: string;
  script_rel_path: string;
  param_values_json: string;
  argv_json: string;
  work_dir: string;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  log_bytes: number;
  truncated: number;
  error_message: string | null;
};

export function toExecutionSummary(row: ExecutionRow): ExecutionSummary {
  return {
    id: row.id,
    scriptId: row.script_id,
    targetId: row.target_id,
    status: row.status,
    exitCode: row.exit_code,
    signal: row.signal,
    commandDisplay: row.command_display,
    targetName: row.target_name,
    scriptName: row.script_name,
    scriptRelPath: row.script_rel_path,
    // These are the environment the script actually received, not the raw form
    // input, so a run's history is reproducible.
    paramValues: JSON.parse(row.param_values_json) as Record<string, string>,
    argv: JSON.parse(row.argv_json) as string[],
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms,
    logBytes: row.log_bytes,
    truncated: row.truncated === 1,
    errorMessage: row.error_message,
  };
}

export function getExecution(db: Db, id: string): ExecutionSummary {
  const row = db.prepare<[string], ExecutionRow>('SELECT * FROM executions WHERE id = ?').get(id);
  if (!row) throw new NotFoundError('Execution');
  return toExecutionSummary(row);
}

export type ExecutionFilters = {
  scriptId?: string | undefined;
  targetId?: string | undefined;
  status?: ExecutionStatus | undefined;
  limit: number;
  offset: number;
};

/**
 * The directory a run stages itself into on the host.
 *
 * Validated before anything is composed from it: the cleanup command is an
 * `rm -rf` on the host, so a path that escaped the staging root is the one
 * mistake in this design that destroys something instead of failing loudly.
 */
function stagingDirectory(stagingRoot: string, executionId: string): string {
  // `newExecutionId()` always satisfies this. The check exists so that a future
  // caller cannot make an id part of a path in some other shape.
  if (!/^[A-Za-z0-9_-]+$/.test(executionId)) {
    throw new ValidationError(
      `Refusing to stage a run with an unusable id: ${JSON.stringify(executionId)}`,
    );
  }

  const directory = joinRoot(stagingRoot, `sd-${executionId}`);
  if (!isInside(stagingRoot, directory)) {
    throw new ValidationError('The staging path escapes its root');
  }
  return directory;
}

/**
 * Read the script the host will execute.
 *
 * Capped at the same limit the scanner applies, so a file that grew between the
 * scan and the run cannot be read into memory without bound.
 */
function readScriptBytes(containerPath: string, script: ScriptSummary): Buffer {
  let size: number;
  try {
    size = statSync(containerPath).size;
  } catch {
    throw new UnprocessableError(
      `The script "${script.relPath}" could not be read. Re-sync its source.`,
    );
  }

  if (size > MAX_FILE_BYTES) {
    throw new UnprocessableError(
      `The script "${script.relPath}" is ${size} bytes, over the ${MAX_FILE_BYTES}-byte limit.`,
    );
  }

  return readFileSync(containerPath);
}

export function listExecutions(
  db: Db,
  filters: ExecutionFilters,
): { items: ExecutionSummary[]; total: number } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filters.scriptId) {
    clauses.push('script_id = ?');
    params.push(filters.scriptId);
  }
  if (filters.targetId) {
    clauses.push('target_id = ?');
    params.push(filters.targetId);
  }
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

  const total = db
    .prepare<(string | number)[], { count: number }>(
      `SELECT COUNT(*) AS count FROM executions ${where}`,
    )
    .get(...params);

  const rows = db
    .prepare<(string | number)[], ExecutionRow>(
      `SELECT * FROM executions ${where} ORDER BY queued_at DESC, rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, filters.limit, filters.offset);

  return { items: rows.map(toExecutionSummary), total: total?.count ?? 0 };
}

export function getExecutionLogs(db: Db, executionId: string, afterSeq: number): ExecutionLogChunk[] {
  const rows = db
    .prepare<[string, number], { seq: number; stream: ExecutionStream; data: string; ts: string }>(
      `SELECT seq, stream, data, ts FROM execution_logs
       WHERE execution_id = ? AND seq > ? ORDER BY seq LIMIT 5000`,
    )
    .all(executionId, afterSeq);

  return rows.map((row) => ({
    executionId,
    seq: row.seq,
    stream: row.stream,
    data: row.data,
    ts: row.ts,
  }));
}

export type ExecutionServiceDeps = {
  db: Db;
  box: SecretBox;
  config: AppConfig;
  hub: ExecutionHub;
  logger: Logger;
  runner: ExecutionRunner;
  queue: Queue;
};

export type ExecutionService = {
  submit: (scriptId: string, input: ExecuteScriptInput) => Promise<ExecutionSummary>;
  cancel: (executionId: string) => ExecutionSummary;
  get: (executionId: string) => ExecutionSummary;
  list: (filters: ExecutionFilters) => { items: ExecutionSummary[]; total: number };
  logs: (executionId: string, afterSeq: number) => ExecutionLogChunk[];
  remove: (executionId: string) => void;
  /** Reconcile rows left non-terminal by a previous process. */
  markInterrupted: () => number;
  /** Drop history older than the configured retention window. */
  prune: () => number;
  stats: () => { active: number; pending: number };
};

export function createExecutionService(deps: ExecutionServiceDeps): ExecutionService {
  const { db, box, config, logger, runner, queue } = deps;

  /**
   * Resolve a script and target into a runnable plan.
   *
   * The container reads the script here and carries its bytes in the plan; the
   * host never has the file until the run stages it. Reading at submit time
   * rather than at run time makes the plan a snapshot, which matters because a
   * queued run can wait a while before a slot frees up.
   */
  const buildPlan = (
    executionId: string,
    script: ScriptSummary,
    source: SourceRow,
    target: TargetRow,
    input: ExecuteScriptInput,
  ): ExecutionPlan => {
    const scriptContainerPath = joinRoot(sourceDirectory(config, source), script.relPath);

    if (!isInside(config.scriptRootContainer, scriptContainerPath)) {
      throw new ValidationError('The script path escapes the shared script root');
    }

    const stagingDir = stagingDirectory(config.stagingDir, executionId);
    const scriptPath = joinRoot(stagingDir, script.fileName);

    const validation = validateParams(script.params, input.params);
    if (!validation.ok) {
      throw new ValidationError('One or more parameters are invalid', validation.errors);
    }

    const timeoutSec = input.timeoutSec ?? script.timeoutSec ?? config.defaultTimeoutSec;
    const interpreter = resolveInterpreter(`.${script.format}`, script.interpreterOverride);

    // Typed by name so this list and `RUN_ENV_NAMES` -- which is what refuses a
    // parameter colliding with one of these -- cannot drift apart: a key present
    // on one side only fails typecheck.
    const runEnv: Record<RunEnvName, string> = {
      // Let a script identify the run that invoked it. SD_SCRIPT_PATH is the
      // staged file and is only valid for this run; SD_SCRIPT_REL_PATH is the
      // stable handle on which script it is.
      SD_EXECUTION_ID: executionId,
      SD_SCRIPT_NAME: script.displayName,
      SD_SCRIPT_PATH: scriptPath,
      SD_SCRIPT_REL_PATH: script.relPath,
      SD_WORK_DIR: target.work_dir,
      // Deprecated alias: the working directory used to be the script's own
      // directory, and scripts in the wild read this name for exactly that.
      SD_SCRIPT_DIR: target.work_dir,
      SD_TARGET_NAME: target.name,
      SD_SOURCE_NAME: source.name,
    };

    return {
      executionId,
      scriptPath,
      stagingDir,
      workDir: target.work_dir,
      interpreter,
      displayCommand: `${interpreter.label} ${script.relPath}`,
      scriptBytes: readScriptBytes(scriptContainerPath, script),
      // Parameters first, runner variables after: the runner owns its own names
      // (validateParams refuses them as parameters), and this order is what
      // makes that true even if a name slips through.
      env: { ...validation.env, ...runEnv },
      paramValues: validation.env,
      argv: input.argv,
      timeoutMs: timeoutSec * 1000,
    };
  };

  return {
    async submit(scriptId, input): Promise<ExecutionSummary> {
      const scriptRow = db
        .prepare<[string], ScriptRow>('SELECT * FROM scripts WHERE id = ? AND deleted_at IS NULL')
        .get(scriptId);
      if (!scriptRow) throw new NotFoundError('Script');

      const script = toScriptSummary(scriptRow);
      const source = getSourceRow(db, script.sourceId);
      const target = getTargetRow(db, input.targetId);

      if (target.last_check_ok === 0) {
        // Not fatal -- the check may simply be stale -- but worth surfacing: a
        // failed mapping check means this run will fail with "no such file".
        logger.warn(
          { targetId: target.id },
          'submitting an execution to a target whose last check failed',
        );
      }

      const executionId = newExecutionId();
      const plan = buildPlan(executionId, script, source, target, input);

      db.prepare(
        `INSERT INTO executions (
           id, script_id, target_id, status, command_display, target_name, script_name,
           script_rel_path, param_values_json, argv_json, work_dir, queued_at
         ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        executionId,
        script.id,
        target.id,
        plan.displayCommand,
        target.name,
        script.displayName,
        script.relPath,
        JSON.stringify(plan.paramValues),
        JSON.stringify(plan.argv),
        plan.workDir,
        nowIso(),
      );

      queue.enqueue({
        id: executionId,
        key: target.id,
        run: async (signal) => {
          // The transport is created per attempt so a connection failure is
          // attributable to this run rather than to a shared, stale client.
          const transport: Transport = createTransportForTarget(target, box);
          try {
            await runner.run(plan, transport, signal);
          } finally {
            await transport.dispose().catch(() => undefined);
          }
        },
      });

      logger.info({ executionId, scriptId, targetId: target.id }, 'execution queued');
      return getExecution(db, executionId);
    },

    cancel(executionId): ExecutionSummary {
      const current = getExecution(db, executionId);

      if (current.status !== 'queued' && current.status !== 'running') {
        throw new ConflictError(`This run already finished with status "${current.status}"`);
      }

      const wasActive = queue.isActive(executionId);
      const found = queue.cancel(executionId);

      if (!found) {
        // Neither queued nor running: the process restarted since it was
        // submitted, so nothing will ever pick it up.
        db.prepare(
          "UPDATE executions SET status = 'interrupted', finished_at = ?, error_message = ? WHERE id = ?",
        ).run(nowIso(), 'The dashboard restarted before this run could start.', executionId);
        return getExecution(db, executionId);
      }

      if (!wasActive) {
        // It was still waiting, so no runner will write a final status for it.
        // Without this the row would sit at "queued" until the next restart.
        db.prepare(
          "UPDATE executions SET status = 'canceled', finished_at = ?, error_message = ? WHERE id = ?",
        ).run(nowIso(), 'Canceled before it started.', executionId);
      }

      return getExecution(db, executionId);
    },

    get: (executionId) => getExecution(db, executionId),
    list: (filters) => listExecutions(db, filters),
    logs: (executionId, afterSeq) => getExecutionLogs(db, executionId, afterSeq),

    remove(executionId): void {
      const current = getExecution(db, executionId);
      if (current.status === 'running' || current.status === 'queued') {
        throw new ConflictError('Cancel this run before deleting it');
      }
      // Logs cascade with the execution row.
      db.prepare('DELETE FROM executions WHERE id = ?').run(executionId);
    },

    markInterrupted(): number {
      // A queued or running row cannot survive a restart: the in-process queue
      // that owned it is gone. Reporting them as active would be a lie.
      const result = db
        .prepare(
          `UPDATE executions SET
             status = 'interrupted', finished_at = ?, error_message = ?
           WHERE status IN ('queued','running')`,
        )
        .run(nowIso(), 'The dashboard restarted while this run was queued or in progress.');

      if (result.changes > 0) {
        logger.warn({ count: result.changes }, 'marked executions interrupted after restart');
      }
      return result.changes;
    },

    prune(): number {
      if (config.retentionDays <= 0) return 0;

      const cutoff = new Date(Date.now() - config.retentionDays * 86_400_000).toISOString();
      const result = db
        .prepare("DELETE FROM executions WHERE queued_at < ? AND status NOT IN ('queued','running')")
        .run(cutoff);

      if (result.changes > 0) {
        logger.info({ count: result.changes, cutoff }, 'pruned old executions');
      }
      return result.changes;
    },

    stats: () => ({ active: queue.activeCount, pending: queue.pendingCount }),
  };
}
