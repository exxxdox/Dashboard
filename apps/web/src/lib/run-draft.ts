import type { RunDraft, ScriptParam, ScriptRunPrefill } from '@dashboard/shared';

import type { MessageKey } from './i18n';
import { addRow, updateRow, type CustomParamRow } from './run-params';

/**
 * Turning the run form into a draft and back.
 *
 * Both directions are pure so the round trip can be tested without a browser:
 * the form is the only place this state lives, and a bug here silently changes
 * what a run is submitted with.
 */

export type RunFormState = {
  /** Values for the declared parameters. */
  values: Record<string, string>;
  /** The custom rows, ids and all. */
  rows: CustomParamRow[];
  timeoutSec: string;
};

export function emptyDraft(): RunDraft {
  return { params: {}, custom: [], timeoutSec: '' };
}

/** A draft with nothing in it: the fallback to the last run depends on this. */
export function isDraftEmpty(draft: RunDraft): boolean {
  return (
    Object.keys(draft.params).length === 0 && draft.custom.length === 0 && draft.timeoutSec === ''
  );
}

export function draftFromForm(state: RunFormState): RunDraft {
  return {
    params: state.values,
    // Ids are the form's own bookkeeping; a restored row gets a fresh one.
    custom: state.rows.map(({ name, value, mode }) => ({ name, value, mode })),
    timeoutSec: state.timeoutSec,
  };
}

/**
 * Seed the form from what the server says it last held.
 *
 * A declared parameter keeps its declared default when the draft says nothing
 * about it: the draft records what was typed, not a complete set of values, so a
 * parameter nobody touched should not come back blank.
 */
export function formFromDraft(draft: RunDraft, declared: ScriptParam[]): RunFormState {
  const values: Record<string, string> = {};
  for (const param of declared) {
    const saved = draft.params[param.name];
    if (saved !== undefined) values[param.name] = saved;
    else if (param.default !== null) values[param.name] = param.default;
    else if (param.type === 'bool') values[param.name] = '0';
  }

  const declaredNames = new Set(declared.map((param) => param.name));
  // A saved value for a parameter the header no longer declares is kept as a
  // custom row: the header changing under a filled-in form must not silently
  // drop what someone typed.
  const strays = Object.entries(draft.params).filter(([name]) => !declaredNames.has(name));

  let rows: CustomParamRow[] = [];
  for (const row of [
    ...draft.custom,
    ...strays.map(([name, value]) => ({ name, value, mode: 'env' as const })),
  ]) {
    rows = addRow(rows);
    const added = rows[rows.length - 1]!;
    rows = updateRow(rows, added.id, { name: row.name, value: row.value, mode: row.mode });
  }

  return { values, rows, timeoutSec: draft.timeoutSec };
}

/** Two drafts are the same if they would produce the same run. */
export function sameDraft(left: RunDraft, right: RunDraft): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * What to tell the operator about where the values came from.
 *
 * A key rather than a sentence: this module holds no words of its own, and the
 * caller is the one that knows the reader's language.
 *
 * `none` is the ordinary case -- a script nobody has run or filled in -- and
 * announcing it would be noise on every first visit.
 */
export function describePrefill(prefill: ScriptRunPrefill): MessageKey | null {
  if (prefill.source === 'draft') return 'runs.prefill.draft';
  if (prefill.source === 'last-run') return 'runs.prefill.lastRun';
  return null;
}
