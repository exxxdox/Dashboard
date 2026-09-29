import { PARAM_NAME_MESSAGE, paramNameProblem, type ScriptParam } from '@dashboard/shared';

/**
 * A parameter the operator adds by hand, because the script's header does not
 * declare it -- or because the value is only known at run time.
 *
 * Rows carry their own id: a name can be blank or repeated while it is being
 * typed, so it cannot be the React key, and an error has to be attributed to the
 * row the operator is looking at rather than to a name that has since changed.
 */
/**
 * How a value reaches the script.
 *
 * `env` names an environment variable, so the name has to be a shell
 * identifier. `argv` is a positional argument: it goes on the command line in
 * row order, and the name is only a label for the operator -- which is why a
 * non-identifier like `起始端口` is allowed there and not here.
 */
export type CustomParamMode = 'env' | 'argv';

export type CustomParamRow = {
  id: string;
  name: string;
  value: string;
  mode: CustomParamMode;
};

/** Prefix for generated row ids; only the trailing number is ever read back. */
const ROW_ID_PREFIX = 'row-';

/** Blank means nothing typed at all: a name alone, or a value alone, is not. */
export function isBlankRow(row: CustomParamRow): boolean {
  return row.name.trim() === '' && row.value.trim() === '';
}

/** The number in a row id, or 0 for anything else. */
function rowSequence(id: string): number {
  const match = /(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

/**
 * Append an empty row.
 *
 * The id is derived from the rows being appended to rather than from a counter
 * held beside them: the caller passes this to a state updater, so several adds
 * in one batch each see the previous result and still get distinct ids. A
 * counter read from the render closure gives them all the same one, which
 * collapses the rows into a single React key and a single error slot.
 */
export function addRow(rows: readonly CustomParamRow[]): CustomParamRow[] {
  const next = rows.reduce((max, row) => Math.max(max, rowSequence(row.id)), 0) + 1;
  return [...rows, { id: `${ROW_ID_PREFIX}${next}`, name: '', value: '', mode: 'env' }];
}

export function updateRow(
  rows: readonly CustomParamRow[],
  id: string,
  patch: Partial<Pick<CustomParamRow, 'name' | 'value' | 'mode'>>,
): CustomParamRow[] {
  return rows.map((row) => (row.id === id ? { ...row, ...patch } : row));
}

export function removeRow(rows: readonly CustomParamRow[], id: string): CustomParamRow[] {
  return rows.filter((row) => row.id !== id);
}

/**
 * Errors keyed by row id, empty when every row is usable.
 *
 * Everything a row can be wrong about is answered here, using the same
 * `paramNameProblem` the server calls, so the form refuses exactly what a run
 * would refuse instead of letting a request discover it.
 */
export function validateRows(
  rows: readonly CustomParamRow[],
  declared: readonly ScriptParam[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  const declaredNames = new Set(declared.map((param) => param.name));
  const seen = new Set<string>();

  for (const row of rows) {
    if (isBlankRow(row)) continue;
    // A positional argument has nothing to name, so its name is a free-text
    // label and carries no rules at all.
    if (row.mode === 'argv') continue;

    const name = row.name.trim();
    if (name === '') {
      errors[row.id] = 'Name required';
      continue;
    }

    const problem = paramNameProblem(name);
    if (problem) {
      errors[row.id] = PARAM_NAME_MESSAGE[problem];
      continue;
    }
    if (declaredNames.has(name)) {
      errors[row.id] = 'Already declared above';
      continue;
    }
    if (seen.has(name)) {
      errors[row.id] = 'Already set above';
      continue;
    }
    seen.add(name);
  }

  return errors;
}

/**
 * The rows as a parameter map: names trimmed, values untouched.
 *
 * A value is never trimmed -- leading or trailing spaces can be the value -- and
 * an empty one is kept, because `FOO=` and no `FOO` at all mean different things
 * to a script. Rows with no name cannot be sent; blank rows are not errors, they
 * are simply unattended.
 */
export function collectParams(rows: readonly CustomParamRow[]): Record<string, string> {
  const params: Record<string, string> = {};
  for (const row of rows) {
    if (row.mode === 'argv') continue;
    const name = row.name.trim();
    // A row with no name cannot be sent: there is no variable to set.
    if (name === '') continue;
    params[name] = row.value;
  }
  return params;
}

/**
 * The argument rows as the command line, in the order they are listed.
 *
 * Row order is the argument order and nothing re-sorts it, because `$1` is
 * positional: the operator drags a row or retypes it to reorder. Environment
 * rows in between are ignored and take no position. A blank row contributes
 * nothing; a row with an empty *value* contributes an empty argument, which is
 * a different thing and one a script can count.
 */
export function collectArgv(rows: readonly CustomParamRow[]): string[] {
  const argv: string[] = [];
  for (const row of rows) {
    if (row.mode !== 'argv' || isBlankRow(row)) continue;
    argv.push(row.value);
  }
  return argv;
}
