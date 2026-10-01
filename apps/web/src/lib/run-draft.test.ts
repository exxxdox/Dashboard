import { describe, expect, it } from 'vitest';
import type { RunDraft, ScriptParam, ScriptRunPrefill } from '@dashboard/shared';

import {
  describePrefill,
  draftFromForm,
  formFromDraft,
  sameDraft,
  type RunFormState,
} from './run-draft';

const DECLARED: ScriptParam[] = [
  { name: 'ENV', type: 'string', required: true, default: null, description: '' },
  { name: 'REPLICAS', type: 'number', required: false, default: '3', description: '' },
  { name: 'DRY_RUN', type: 'bool', required: false, default: null, description: '' },
];

const EMPTY: RunDraft = { params: {}, custom: [], timeoutSec: '' };

describe('formFromDraft', () => {
  it('starts from the declared defaults when the draft says nothing', () => {
    const state = formFromDraft(EMPTY, DECLARED);
    expect(state.values).toEqual({ REPLICAS: '3', DRY_RUN: '0' });
    expect(state.rows).toEqual([]);
    expect(state.timeoutSec).toBe('');
  });

  it('lets the draft override a declared default', () => {
    const state = formFromDraft({ ...EMPTY, params: { REPLICAS: '9' } }, DECLARED);
    expect(state.values.REPLICAS).toBe('9');
  });

  it('keeps a draft value the script no longer declares, as a custom row', () => {
    // A parameter removed from the header must not silently vanish from a form
    // someone had filled in.
    const state = formFromDraft({ ...EMPTY, params: { OLD_PARAM: 'x' } }, DECLARED);
    expect(state.rows).toEqual([{ id: 'row-1', name: 'OLD_PARAM', value: 'x', mode: 'env' }]);
  });

  it('restores custom rows in order, with their labels and channels', () => {
    const draft: RunDraft = {
      params: {},
      custom: [
        { name: 'API_BASE', value: 'https://example.test', mode: 'env' },
        { name: '起始端口', value: '100', mode: 'argv' },
        { name: '', value: '200', mode: 'argv' },
      ],
      timeoutSec: '600',
    };

    const state = formFromDraft(draft, DECLARED);

    expect(state.rows.map((row) => row.name)).toEqual(['API_BASE', '起始端口', '']);
    expect(state.rows.map((row) => row.mode)).toEqual(['env', 'argv', 'argv']);
    expect(state.rows.map((row) => row.value)).toEqual(['https://example.test', '100', '200']);
    expect(new Set(state.rows.map((row) => row.id)).size).toBe(3);
    expect(state.timeoutSec).toBe('600');
  });
});

describe('round trip', () => {
  it('returns the same form it was given', () => {
    const state: RunFormState = {
      values: { ENV: 'prod', REPLICAS: '5' },
      rows: [
        { id: 'row-1', name: 'API_BASE', value: 'x', mode: 'env' },
        { id: 'row-2', name: '起始端口', value: '100', mode: 'argv' },
      ],
      timeoutSec: '30',
    };

    const restored = formFromDraft(draftFromForm(state), DECLARED);

    expect(restored.values).toMatchObject(state.values);
    // DRY_RUN was never set, so it comes back at its own default rather than
    // absent: the bool form has to render as on or off, not blank.
    expect(restored.values.DRY_RUN).toBe('0');
    expect(restored.rows.map(({ name, value, mode }) => ({ name, value, mode }))).toEqual(
      state.rows.map(({ name, value, mode }) => ({ name, value, mode })),
    );
    expect(restored.timeoutSec).toBe('30');
  });

  it("drops the ids, which are the form's own", () => {
    const draft = draftFromForm({
      values: {},
      rows: [{ id: 'row-7', name: 'A', value: '1', mode: 'env' }],
      timeoutSec: '',
    });
    expect(draft.custom).toEqual([{ name: 'A', value: '1', mode: 'env' }]);
  });
});

describe('sameDraft', () => {
  it('compares by content, not identity', () => {
    expect(sameDraft(EMPTY, { params: {}, custom: [], timeoutSec: '' })).toBe(true);
    expect(sameDraft(EMPTY, { ...EMPTY, timeoutSec: '1' })).toBe(false);
  });
});

describe('describePrefill', () => {
  it('says nothing when there is nothing to restore', () => {
    expect(describePrefill({ source: 'none', draft: EMPTY })).toBeNull();
  });

  it('names the source when there is', () => {
    // The notice is a dictionary key; the wording belongs to the area file.
    expect(describePrefill({ source: 'draft', draft: EMPTY })).toBe('runs.prefill.draft');
    expect(describePrefill({ source: 'last-run', draft: EMPTY })).toBe('runs.prefill.lastRun');
  });

  it('accepts the server response type', () => {
    const prefill: ScriptRunPrefill = { source: 'draft', draft: EMPTY };
    expect(describePrefill(prefill)).not.toBeNull();
  });
});
