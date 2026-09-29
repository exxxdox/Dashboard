/**
 * Executes one plan on one target, streaming and persisting its output.
 *
 * Kept free of database lookups beyond its own writes: it receives a plan that
 * is already resolved and validated, so the interesting part -- sequencing,
 * truncation, status transitions, cancellation -- can be tested against a fake
 * transport with no SQLite and no SSH in the way. The one read it does need,
 * loading the updated row to publish, is injected to avoid a module cycle.
 */

import type { ExecutionStatus, ExecutionStream, ExecutionSummary } from '@dashboard/shared';
import {
  buildCommand,
  cleanupStagingCommand,
  type InterpreterSpec,
} from '@dashboard/shared';

import type { Db } from '../db/client.js';
import { nowIso } from '../db/client.js';
import type { Logger } from '../lib/logger.js';
import type { Transport } from '../transport/types.js';
import type { ExecutionHub } from '../ws/hub.js';

export type ExecutionPlan = {
  executionId: string;
  /**
   * Absolute path on the host the script is staged at. Transient: it exists for
   * the duration of the run and is removed afterwards.
   */
  scriptPath: string;
  /** Directory on the host the script is staged into, and removed from. */
  stagingDir: string;
  /** Working directory on the host. Never the staging directory. */
  workDir: string;
  interpreter: InterpreterSpec;
  /** Stable, human-readable invocation, for `command_display` and the header. */
  displayCommand: string;
  /** The script's bytes, delivered to the host on stdin. */
  scriptBytes: Buffer;
  /** Full environment handed to the script, including the SD_* context vars. */
  env: Record<string, string>;
  /**
   * Only the values the user chose, keyed by declared parameter name. Recorded
   * separately from `env` so a run's history shows a reproducible set of inputs
   * rather than the dashboard's own bookkeeping variables.
   */
  paramValues: Record<string, string>;
  /**
   * Positional arguments, in order, appended after the script path. Quoted on
   * assembly, so a value stays one argument whatever it contains.
   */
  argv: readonly string[];
  timeoutMs: number | null;
};

export type RunnerDeps = {
  db: Db;
  hub: ExecutionHub;
  logger: Logger;
  /** Bytes of output retained per execution before truncation kicks in. */
  maxLogBytes: number;
  /** Reads back the row to publish a status event. */
  loadSummary: (executionId: string) => ExecutionSummary;
};

/** Log chunks are buffered this long before being written, to batch inserts. */
const FLUSH_INTERVAL_MS = 80;
/** ...or immediately once this many bytes have accumulated. */
const FLUSH_BYTES = 16 * 1024;

export type ExecutionRunner = {
  /**
   * Run a plan to completion. Resolves once the execution row is final; never
   * rejects for a script that exits non-zero, and never rejects on cancel.
   */
  run: (plan: ExecutionPlan, transport: Transport, signal: AbortSignal) => Promise<ExecutionStatus>;
};

export function createExecutionRunner(deps: RunnerDeps): ExecutionRunner {
  const { db, hub, logger, maxLogBytes, loadSummary } = deps;

  const insertLog = db.prepare(
    'INSERT INTO execution_logs (execution_id, seq, stream, data, ts) VALUES (?, ?, ?, ?, ?)',
  );
  const markTruncated = db.prepare('UPDATE executions SET truncated = 1 WHERE id = ?');
  const markRunning = db.prepare('UPDATE executions SET status = ?, started_at = ? WHERE id = ?');
  const markFinished = db.prepare(
    `UPDATE executions SET
       status = ?, exit_code = ?, signal = ?, finished_at = ?, duration_ms = ?,
       log_bytes = ?, error_message = ?
     WHERE id = ?`,
  );

  return {
    async run(plan, transport, signal): Promise<ExecutionStatus> {
      const { executionId } = plan;

      let seq = 0;
      let persistedBytes = 0;
      let truncated = false;
      let buffer: { seq: number; stream: ExecutionStream; data: string; ts: string }[] = [];
      let bufferedBytes = 0;
      let flushTimer: NodeJS.Timeout | null = null;

      const flush = (): void => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (buffer.length === 0) return;

        const batch = buffer;
        buffer = [];
        bufferedBytes = 0;
        db.transaction(() => {
          for (const chunk of batch) {
            insertLog.run(executionId, chunk.seq, chunk.stream, chunk.data, chunk.ts);
          }
        })();
      };

      /**
       * Publish live, persist only while under the byte cap.
       *
       * Live delivery is deliberately not capped: a user watching a runaway
       * script should still see it running. Only storage is bounded, because
       * that is what would otherwise grow without limit.
       */
      const record = (stream: ExecutionStream, data: string): void => {
        if (data === '') return;
        seq += 1;
        const ts = nowIso();

        hub.publish(executionId, { type: 'log', chunk: { executionId, seq, stream, data, ts } });

        if (truncated) return;

        if (persistedBytes + data.length > maxLogBytes) {
          truncated = true;
          const notice =
            `\n[output truncated: this run exceeded the ${Math.round(maxLogBytes / 1024 / 1024)} MB capture limit; ` +
            `the stored log is incomplete]\n`;
          seq += 1;
          const noticeTs = nowIso();
          hub.publish(executionId, {
            type: 'log',
            chunk: { executionId, seq, stream: 'system', data: notice, ts: noticeTs },
          });
          buffer.push({ seq, stream: 'system', data: notice, ts: noticeTs });
          bufferedBytes += notice.length;
          flush();
          markTruncated.run(executionId);
          return;
        }

        persistedBytes += data.length;
        buffer.push({ seq, stream, data, ts });
        bufferedBytes += data.length;

        if (bufferedBytes >= FLUSH_BYTES) {
          flush();
        } else if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = null;
            flush();
          }, FLUSH_INTERVAL_MS);
        }
      };

      const startedAt = nowIso();
      markRunning.run('running', startedAt, executionId);
      record('system', `$ ${plan.displayCommand}\n`);
      hub.publish(executionId, { type: 'status', execution: loadSummary(executionId) });

      let status: ExecutionStatus = 'failed';
      let exitCode: number | null = null;
      let processSignal: string | null = null;
      let errorMessage: string | null = null;

      try {
        const built = buildCommand({
          interpreter: plan.interpreter,
          scriptPath: plan.scriptPath,
          stagingDir: plan.stagingDir,
          cwd: plan.workDir,
          env: plan.env,
          args: plan.argv,
        });

        const outcome = await transport.exec({
          command: built.command,
          stdin: plan.scriptBytes,
          // Sent whatever the outcome, so a cancelled or timed-out run does not
          // leave its staging directory behind on the host.
          cleanupCommand: cleanupStagingCommand(plan.stagingDir),
          onChunk: (chunk) => record(chunk.stream, chunk.data),
          signal,
          timeoutMs: plan.timeoutMs,
        });

        exitCode = outcome.exitCode;
        processSignal = outcome.signal;

        if (outcome.canceled) status = 'canceled';
        else if (outcome.timedOut) status = 'timed_out';
        else if (exitCode === 0) status = 'succeeded';
        else status = 'failed';

        // Without this, a connection dropped mid-push reads exactly like a
        // script that exited non-zero without saying why.
        if (outcome.stdinError !== null) {
          record('system', `\n[delivery] the script did not reach the host intact: ${outcome.stdinError}\n`);
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
        status = 'failed';
        record('system', `\n[transport error] ${errorMessage}\n`);
        logger.warn({ executionId, err: error }, 'execution transport failed');
      } finally {
        flush();
      }

      const finishedAt = nowIso();
      const durationMs = Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt));

      markFinished.run(
        status,
        exitCode,
        processSignal,
        finishedAt,
        durationMs,
        persistedBytes,
        errorMessage,
        executionId,
      );

      hub.publish(executionId, { type: 'status', execution: loadSummary(executionId) });

      return status;
    },
  };
}
