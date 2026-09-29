import { describe, expect, it } from 'vitest';
import type { ScriptParam } from '@dashboard/shared';

import { translate, type Translate } from './i18n';
import {
  addRow,
  collectArgv,
  collectParams,
  isBlankRow,
  validateRows,
  type CustomParamRow,
  type CustomParamMode,
} from './run-params';

// The form's messages are dictionary keys; this resolves them the way the page
// does, so an assertion here also proves the key exists.
const t: Translate = (key) => translate('en', key);

const DECLARED: ScriptParam[] = [
  { name: 'ENV', type: 'string', required: true, default: null, description: 'Target environment' },
  { name: 'REPLICAS', type: 'number', required: false, default: '3', description: '' },
];

/** `rows(['A', '1'])` is an environment row; `rows(['A:argv', '1'])` is positional. */
function rows(...specs: [string, string][]): CustomParamRow[] {
  return specs.map(([name, value], index) => {
    const [label, mode] = name.split(':');
    return {
      id: `row-${index}`,
      name: label ?? '',
      value,
      mode: (mode as CustomParamMode | undefined) ?? 'env',
    };
  });
}

describe('isBlankRow', () => {
  it('treats a row with neither a name nor a value as blank', () => {
    expect(isBlankRow({ id: 'r0', name: '', value: '', mode: 'env' })).toBe(true);
    expect(isBlankRow({ id: 'r0', name: '  ', value: '', mode: 'env' })).toBe(true);
    expect(isBlankRow({ id: 'r0', name: 'A', value: '', mode: 'env' })).toBe(false);
    expect(isBlankRow({ id: 'r0', name: '', value: 'x', mode: 'argv' })).toBe(false);
  });
});

describe('addRow', () => {
  it('appends an empty row and leaves the existing ones alone', () => {
    const before = rows(['A', '1']);
    const after = addRow(before);
    expect(after).toEqual([...before, { id: 'row-1', name: '', value: '', mode: 'env' }]);
    expect(before).toHaveLength(1);
  });

  it('gives each row its own id when several are added in the same batch', () => {
    // Three clicks before React re-renders: each call sees the previous result
    // through the state updater, so the ids must still differ.
    const three = addRow(addRow(addRow([])));
    expect(three.map((row) => row.id)).toEqual(['row-1', 'row-2', 'row-3']);
  });
});

describe('validateRows', () => {
  it('reports nothing for rows that are still empty, and sends nothing for them', () => {
    const list = rows(['', ''], ['', '']);
    expect(validateRows(list, DECLARED, t)).toEqual({});
    expect(collectParams(list)).toEqual({});
  });

  it('asks for a name once a value has been typed', () => {
    expect(validateRows(rows(['', 'x']), DECLARED, t)).toEqual({ 'row-0': 'Name required' });
  });

  it('refuses a name that is not a shell variable', () => {
    expect(validateRows(rows(['A; rm -rf /', 'x']), DECLARED, t)).toEqual({
      'row-0': 'Not a valid parameter name',
    });
  });

  it('refuses the names the runner owns, after trimming', () => {
    expect(validateRows(rows(['SD_SCRIPT_PATH', '/tmp/x']), DECLARED, t)).toEqual({
      'row-0': 'The runner sets this variable',
    });
    expect(validateRows(rows(['  SD_TARGET_NAME  ', 'host1']), DECLARED, t)).toEqual({
      'row-0': 'The runner sets this variable',
    });
  });

  it('refuses a name that repeats an earlier row', () => {
    const errors = validateRows(rows(['API_BASE', 'a'], ['API_BASE', 'b']), DECLARED, t);
    expect(errors).toEqual({ 'row-1': 'Already set above' });
  });

  it('refuses a name the script already declares', () => {
    expect(validateRows(rows(['ENV', 'prod']), DECLARED, t)).toEqual({
      'row-0': 'Already declared above',
    });
  });

  it('accepts a name the script never declared', () => {
    expect(validateRows(rows(['API_BASE', 'https://example.test']), DECLARED, t)).toEqual({});
  });

  it('ignores a blank row while judging the rows around it', () => {
    const errors = validateRows(rows(['', ''], ['API_BASE', 'x'], ['API_BASE', 'y']), DECLARED, t);
    expect(errors).toEqual({ 'row-2': 'Already set above' });
  });
});

describe('collectParams', () => {
  it('trims the name and keeps the value exactly as typed', () => {
    expect(collectParams(rows(['  API_BASE  ', '  a b  ']))).toEqual({ API_BASE: '  a b  ' });
  });

  it('keeps an empty value, which is a value the script may test for', () => {
    expect(collectParams(rows(['FLAG', '']))).toEqual({ FLAG: '' });
  });

  it('skips blank rows and rows with no name', () => {
    expect(collectParams(rows(['', ''], ['', 'orphan'], ['A', '1']))).toEqual({ A: '1' });
  });

  it('returns an empty object when there is nothing to send', () => {
    expect(collectParams([])).toEqual({});
  });
});

describe('positional arguments', () => {
  it('takes no name check on an argument row: the name is only a label', () => {
    // A positional argument has no environment variable to name, so the label
    // may be anything the operator finds readable -- including a non-identifier.
    expect(validateRows(rows(['起始端口:argv', '100']), DECLARED, t)).toEqual({});
    expect(validateRows(rows(['SD_SCRIPT_PATH:argv', '100']), DECLARED, t)).toEqual({});
    // Not even the name-required rule applies: `:argv` is a bare argument.
    expect(validateRows(rows([':argv', '100']), DECLARED, t)).toEqual({});
  });

  it('keeps an argument out of the environment and a parameter out of argv', () => {
    const list = rows(['API_BASE', 'x'], ['起始端口:argv', '100']);
    expect(collectParams(list)).toEqual({ API_BASE: 'x' });
    expect(collectArgv(list)).toEqual(['100']);
  });

  it('orders arguments by row, skipping the environment rows between them', () => {
    const list = rows(['A:argv', '1'], ['ENV_LIKE', 'x'], ['B:argv', '2']);
    expect(collectArgv(list)).toEqual(['1', '2']);
  });

  it('sends an empty argument as an empty argument', () => {
    // `script ''` and `script` differ: a script counting `$#` sees the first.
    expect(collectArgv(rows(['empty:argv', '']))).toEqual(['']);
  });

  it('sends nothing for a row that is still blank', () => {
    expect(collectArgv(rows([':argv', '']))).toEqual([]);
    expect(collectArgv([])).toEqual([]);
  });

  it('does not trim a value, which may be significant', () => {
    expect(collectArgv(rows(['label:argv', '  two words  ']))).toEqual(['  two words  ']);
  });
});
