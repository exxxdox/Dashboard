import { Cron } from 'croner';
import {
  executeScriptSchema,
  saveScriptScheduleSchema,
  validateParams,
  type SaveScriptScheduleInput,
  type ScriptSchedule,
} from '@dashboard/shared';

import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { nowIso } from '../db/client.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { newScriptScheduleId } from '../lib/ids.js';
import type { ExecutionService } from './executions.js';
import { toScriptSummary, type ScriptRow } from './sources.js';
import { getTargetRow } from './targets.js';

type ScheduleRow = {
  id: string;
  name: string;
  retention_days: number | null;
  script_id: string;
  target_id: string;
  target_name: string;
  cron: string;
  time_zone: string;
  enabled: number;
  run_input_json: string;
  next_run_at: string | null;
  last_triggered_at: string | null;
  last_execution_id: string | null;
  last_error: ScriptSchedule['lastError'];
  created_at: string;
  updated_at: string;
};

export type ScriptScheduleService = {
  list: () => ScriptSchedule[];
  get: (id: string) => ScriptSchedule;
  create: (input: SaveScriptScheduleInput) => ScriptSchedule;
  save: (id: string, input: SaveScriptScheduleInput) => ScriptSchedule;
  remove: (id: string) => void;
  start: () => void;
  stop: () => void;
};

type Deps = {
  db: Db;
  executions: Pick<ExecutionService, 'submit'>;
  logger: Logger;
  config: Pick<AppConfig, 'defaultTimeoutSec' | 'retentionDays'>;
};

function nextRun(cron: string, timeZone: string, after: Date): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(after);
  } catch {
    throw new ValidationError('Choose a valid IANA time zone', undefined, { key: 'error.schedule.timeZone' });
  }
  try {
    if (cron.trim().split(/\s+/).length !== 5) throw new Error('Five fields required');
    const job = new Cron(cron, { timezone: timeZone, legacyMode: true, paused: true });
    try {
      const next = job.nextRun(after);
      if (next === null) throw new Error('No future occurrence');
      return next.toISOString();
    } finally {
      job.stop();
    }
  } catch {
    throw new ValidationError('Enter a valid five-field Cron expression with a future occurrence', undefined, { key: 'error.schedule.cron' });
  }
}

function runInput(row: ScheduleRow): SaveScriptScheduleInput['input'] {
  // The target FK is authoritative; JSON holds only the rest of the immutable run snapshot.
  return executeScriptSchema.parse({ ...JSON.parse(row.run_input_json), targetId: row.target_id });
}

function toView(row: ScheduleRow, fallbackRetentionDays: number): ScriptSchedule {
  return {
    id: row.id,
    name: row.name,
    retentionDays: row.retention_days ?? fallbackRetentionDays,
    scriptId: row.script_id,
    targetName: row.target_name,
    cron: row.cron,
    timeZone: row.time_zone,
    enabled: row.enabled === 1,
    input: runInput(row),
    nextRunAt: row.next_run_at,
    lastTriggeredAt: row.last_triggered_at,
    lastExecutionId: row.last_execution_id,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export function createScriptScheduleService({ db, executions, logger, config }: Deps): ScriptScheduleService {
  const select = `SELECT ss.*, t.name AS target_name FROM script_schedules ss
    JOIN targets t ON t.id = ss.target_id`;
  let timer: NodeJS.Timeout | null = null;
  const submitting = new Set<string>();
  const revisions = new Map<string, number>();

  function script(scriptId: string): ScriptRow {
    const row = db.prepare<[string], ScriptRow>('SELECT * FROM scripts WHERE id = ? AND deleted_at IS NULL').get(scriptId);
    if (!row) throw new NotFoundError('Script');
    return row;
  }

  function row(id: string): ScheduleRow {
    const current = db.prepare<[string], ScheduleRow>(`${select} WHERE ss.id = ?`).get(id);
    if (!current) throw new NotFoundError('Schedule');
    return current;
  }

  function disableInvalid(id: string): void {
    db.prepare("UPDATE script_schedules SET enabled = 0, next_run_at = NULL, last_error = 'invalid_schedule' WHERE id = ?").run(id);
    logger.warn({ scheduleId: id }, 'invalid stored script schedule was disabled');
  }

  async function submit(due: ScheduleRow): Promise<void> {
    const id = due.id;
    const revision = revisions.get(id);
    submitting.add(id);
    try {
      const execution = await executions.submit(due.script_id, runInput(due), {
        scheduleId: id, scheduleName: due.name, retentionDays: due.retention_days ?? config.retentionDays,
      });
      // A settings edit retains the in-flight run for overlap protection; deleting the plan leaves no row to update.
      if (timer !== null) {
        db.prepare(`UPDATE script_schedules SET last_execution_id = ?,
          last_error = CASE WHEN ? THEN NULL ELSE last_error END WHERE id = ?`)
          .run(execution.id, revisions.get(id) === revision ? 1 : 0, id);
      }
    } catch {
      // Parameters and upstream errors may contain secrets; expose only a fixed, localizable outcome.
      if (timer !== null && revisions.get(id) === revision) {
        db.prepare("UPDATE script_schedules SET last_error = 'submit_failed' WHERE id = ?").run(id);
        logger.warn({ scheduleId: id }, 'scheduled script could not be submitted');
      }
    } finally {
      submitting.delete(id);
    }
  }

  function tick(): void {
    const now = new Date();
    const due = db.prepare<[string], ScheduleRow>(`${select}
      JOIN scripts s ON s.id = ss.script_id AND s.deleted_at IS NULL
      WHERE ss.enabled = 1 AND ss.next_run_at <= ?`).all(now.toISOString());
    for (const current of due) {
      if (timer === null) return;
      try {
        const next = nextRun(current.cron, current.time_zone, now);
        // Advance before submitting: missed times and slow submissions cannot create a catch-up burst.
        db.prepare('UPDATE script_schedules SET next_run_at = ?, last_triggered_at = ? WHERE id = ?')
          .run(next, now.toISOString(), current.id);
        const active = current.last_execution_id && db.prepare<[string], { status: string }>('SELECT status FROM executions WHERE id = ?').get(current.last_execution_id);
        if (submitting.has(current.id) || (active && (active.status === 'queued' || active.status === 'running'))) continue;
        void submit(current);
      } catch {
        disableInvalid(current.id);
      }
    }
  }

  function write(id: string, rawInput: SaveScriptScheduleInput): ScriptSchedule {
    const input = saveScriptScheduleSchema.parse(rawInput);
    const metadata = toScriptSummary(script(input.scriptId));
    getTargetRow(db, input.input.targetId);
    const next = nextRun(input.cron, input.timeZone, new Date());
    const validation = validateParams(metadata.params, input.input.params);
    if (!validation.ok) throw new ValidationError('One or more parameters are invalid', validation.errors, { key: 'error.schedule.params' });
    const snapshot = {
      params: validation.env,
      argv: input.input.argv,
      timeoutSec: input.input.timeoutSec ?? metadata.timeoutSec ?? config.defaultTimeoutSec,
    };
    const timestamp = nowIso();
    db.prepare(`INSERT INTO script_schedules
      (id,script_id,name,retention_days,target_id,cron,time_zone,enabled,run_input_json,next_run_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      script_id = excluded.script_id, name = excluded.name, retention_days = excluded.retention_days,
      target_id = excluded.target_id, cron = excluded.cron, time_zone = excluded.time_zone,
      enabled = excluded.enabled, run_input_json = excluded.run_input_json,
      next_run_at = excluded.next_run_at, last_error = NULL, updated_at = excluded.updated_at`)
      .run(id, input.scriptId, input.name, input.retentionDays, input.input.targetId, input.cron, input.timeZone,
        input.enabled ? 1 : 0, JSON.stringify(snapshot), input.enabled ? next : null, timestamp, timestamp);
    revisions.set(id, (revisions.get(id) ?? 0) + 1);
    return toView(row(id), config.retentionDays);
  }

  return {
    list() {
      return db.prepare<[], ScheduleRow>(`${select}
        JOIN scripts s ON s.id = ss.script_id AND s.deleted_at IS NULL
        ORDER BY ss.name COLLATE NOCASE, ss.id`).all().map((current) => toView(current, config.retentionDays));
    },

    get: (id) => toView(row(id), config.retentionDays),

    create: (input) => write(newScriptScheduleId(), input),

    save(id, input) {
      row(id);
      return write(id, input);
    },

    remove(id) {
      const current = row(id);
      // Detached history keeps the policy in effect when its plan was removed.
      db.transaction(() => {
        db.prepare('UPDATE executions SET retention_days = ? WHERE schedule_id = ?')
          .run(current.retention_days ?? config.retentionDays, id);
        db.prepare('DELETE FROM script_schedules WHERE id = ?').run(id);
      })();
      revisions.set(id, (revisions.get(id) ?? 0) + 1);
    },

    start() {
      if (timer !== null) return;
      const current = db.prepare<[], ScheduleRow>(`${select} WHERE ss.enabled = 1`).all();
      for (const stored of current) {
        try {
          runInput(stored);
          const next = nextRun(stored.cron, stored.time_zone, new Date());
          db.prepare('UPDATE script_schedules SET next_run_at = ? WHERE id = ?').run(next, stored.id);
        } catch {
          disableInvalid(stored.id);
        }
      }
      timer = setInterval(() => {
        try { tick(); } catch { logger.warn('script schedule polling failed'); }
      }, 1000);
      timer.unref();
    },

    stop() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
  };
}
