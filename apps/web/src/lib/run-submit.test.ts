import { describe, expect, test } from 'vitest';

import type { RunFormState } from './run-draft';
import { toRunInput } from './run-submit';

/** Rows carry ids for React's sake; nothing here reads them. */
function state(patch: Partial<RunFormState> = {}): RunFormState {
  return { values: {}, rows: [], timeoutSec: '', ...patch };
}

describe('toRunInput', () => {
  test('sends the declared values as the environment', () => {
    const input = toRunInput(state({ values: { PORT: '8080', HOST: '0.0.0.0' } }), 'target-1');

    expect(input.params).toEqual({ PORT: '8080', HOST: '0.0.0.0' });
    expect(input.targetId).toBe('target-1');
  });

  test('merges custom env rows into the same map, and keeps argv separate', () => {
    const input = toRunInput(
      state({
        values: { PORT: '8080' },
        rows: [
          { id: 'row-1', name: 'MODE', value: 'fast', mode: 'env' },
          { id: 'row-2', name: 'first', value: 'a', mode: 'argv' },
          { id: 'row-3', name: 'second', value: 'b', mode: 'argv' },
        ],
      }),
      'target-1',
    );

    expect(input.params).toEqual({ PORT: '8080', MODE: 'fast' });
    expect(input.argv).toEqual(['a', 'b']);
  });

  test('keeps argv in row order, whatever the rows in between are', () => {
    const input = toRunInput(
      state({
        rows: [
          { id: 'row-1', name: 'first', value: '1', mode: 'argv' },
          { id: 'row-2', name: 'IGNORED', value: 'x', mode: 'env' },
          { id: 'row-3', name: 'second', value: '2', mode: 'argv' },
        ],
      }),
      'target-1',
    );

    expect(input.argv).toEqual(['1', '2']);
  });

  test('omits the timeout when the box is empty', () => {
    // The script's own limit is what applies then, so sending a number here
    // would silently override it.
    expect(toRunInput(state(), 'target-1')).not.toHaveProperty('timeoutSec');
    expect(toRunInput(state({ timeoutSec: '   ' }), 'target-1')).not.toHaveProperty('timeoutSec');
  });

  test('sends the timeout as a number when one was typed', () => {
    expect(toRunInput(state({ timeoutSec: ' 90 ' }), 'target-1').timeoutSec).toBe(90);
  });

  test('sends a blank row as nothing at all', () => {
    const input = toRunInput(
      state({ rows: [{ id: 'row-1', name: '  ', value: '  ', mode: 'env' }] }),
      'target-1',
    );

    expect(input.params).toEqual({});
    expect(input.argv).toEqual([]);
  });
});
