/**
 * What a script's run form should open with.
 *
 * A run's inputs are remembered in two places for two different reasons: the
 * execution rows are history -- what actually ran -- and the draft on the script
 * is intent -- what someone had typed. The form wants the second, falls back to
 * the first, and otherwise has nothing to restore.
 */

import {
  runDraftSchema,
  type RunDraft,
  type ScriptParam,
  type ScriptRunPrefill,
} from '@script-dashboard/shared';

import type { Db } from '../db/client.js';
import { NotFoundError } from '../lib/errors.js';

/**
 * Read a draft back out of its column.
 *
 * The default value is `'{}'`, not a complete draft, so the schema is what fills
 * the missing keys. A value that does not parse at all -- a hand-edited row, a
 * column written by an older build -- is treated as no draft: the form loses a
 * convenience, where throwing would cost the whole page.
 */
function parseDraft(json: string): RunDraft | null {
  // `JSON.parse` throws on a value that is not JSON at all, so it has to be
  // inside the same guard as the schema: the comment above is a promise the
  // code has to keep, and a SyntaxError here would be a 500 on a page that has
  // a perfectly good fallback.
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }

  const parsed = runDraftSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** No draft, nothing to restore: the declared defaults speak for themselves. */
export function emptyDraft(): RunDraft {
  return { params: {}, custom: [], timeoutSec: '' };
}

/**
 * A draft nothing has been typed into is indistinguishable from no draft and is
 * *stored* as none: the fallback to the last run depends on that, or a form
 * someone opened and left alone would freeze the last run's values out.
 */
function hasContent(draft: RunDraft): boolean {
  return Object.keys(draft.params).length > 0 || draft.custom.length > 0 || draft.timeoutSec !== '';
}

type ScriptDraftRow = {
  params_json: string;
  run_draft_json: string;
};

function loadScriptRow(db: Db, scriptId: string): ScriptDraftRow {
  const row = db
    .prepare<[string], ScriptDraftRow>(
      'SELECT params_json, run_draft_json FROM scripts WHERE id = ?',
    )
    .get(scriptId);
  if (!row) throw new NotFoundError(`No script with id ${JSON.stringify(scriptId)}`);
  return row;
}

type LastRunRow = {
  param_values_json: string;
  argv_json: string;
};

/**
 * The last run's inputs, as a draft.
 *
 * Values the script declares become parameters again; anything else it received
 * in its environment was typed by hand last time, so it comes back as a custom
 * row. Arguments have no names to restore, so they come back as bare positional
 * rows in the order they ran. The timeout is not recovered: an execution stores
 * the *resolved* limit, and what was typed in that box is recorded nowhere.
 */
function draftFromLastRun(db: Db, scriptId: string, declared: ScriptParam[]): RunDraft | null {
  const row = db
    .prepare<[string], LastRunRow>(
      `SELECT param_values_json, argv_json FROM executions
       WHERE script_id = ? ORDER BY queued_at DESC LIMIT 1`,
    )
    .get(scriptId);
  if (!row) return null;

  const values = JSON.parse(row.param_values_json) as Record<string, string>;
  const declaredNames = new Set(declared.map((param) => param.name));

  const params: Record<string, string> = {};
  const custom: RunDraft['custom'] = [];
  for (const [name, value] of Object.entries(values)) {
    if (declaredNames.has(name)) params[name] = value;
    else custom.push({ name, value, mode: 'env' });
  }
  for (const value of JSON.parse(row.argv_json) as string[]) {
    custom.push({ name: '', value, mode: 'argv' });
  }

  return { params, custom, timeoutSec: '' };
}

export function getRunPrefill(db: Db, scriptId: string): ScriptRunPrefill {
  const row = loadScriptRow(db, scriptId);
  const declared = JSON.parse(row.params_json) as ScriptParam[];

  const saved = parseDraft(row.run_draft_json);
  if (saved && hasContent(saved)) return { source: 'draft', draft: saved };

  const lastRun = draftFromLastRun(db, scriptId, declared);
  if (lastRun) return { source: 'last-run', draft: lastRun };

  return { source: 'none', draft: emptyDraft() };
}

export function saveRunDraft(db: Db, scriptId: string, draft: RunDraft): ScriptRunPrefill {
  loadScriptRow(db, scriptId);

  // An empty draft is stored as none, so the next visit falls back to the last
  // run rather than restoring an empty form over it.
  db.prepare('UPDATE scripts SET run_draft_json = ? WHERE id = ?').run(
    JSON.stringify(hasContent(draft) ? draft : emptyDraft()),
    scriptId,
  );

  return getRunPrefill(db, scriptId);
}
