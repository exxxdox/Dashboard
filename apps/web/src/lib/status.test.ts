import { describe, expect, it } from 'vitest';
import { executionStatusSchema, syncStatusSchema } from '@dashboard/shared';
import {
  EXECUTION_STATUS_META,
  SYNC_STATUS_META,
  TONE_BORDER,
  TONE_DOT,
  TONE_RAIL,
  TONE_TEXT,
} from './status';

describe('status metadata', () => {
  it('covers every status the server can send', () => {
    // Drift here would render a raw enum value into the UI.
    for (const status of executionStatusSchema.options) {
      expect(EXECUTION_STATUS_META[status], `missing label for ${status}`).toBeDefined();
    }
    for (const status of syncStatusSchema.options) {
      expect(SYNC_STATUS_META[status], `missing label for ${status}`).toBeDefined();
    }
  });

  it('has no entries for statuses that no longer exist', () => {
    const known = new Set<string>(executionStatusSchema.options);
    for (const status of Object.keys(EXECUTION_STATUS_META)) {
      expect(known.has(status), `stale label for ${status}`).toBe(true);
    }
  });

  it('labels every status with readable text', () => {
    for (const meta of [...Object.values(EXECUTION_STATUS_META), ...Object.values(SYNC_STATUS_META)]) {
      // The label is a dictionary key now, so what is checked here is that it
      // names something: a key misspelt or left as the raw enum has an
      // underscore in it, and no key does.
      expect(meta.labelKey.length).toBeGreaterThan(0);
      expect(meta.labelKey).not.toMatch(/_/);
    }
  });

  it('styles every tone, so a new tone cannot render unstyled', () => {
    const tones = new Set([
      ...Object.values(EXECUTION_STATUS_META).map((meta) => meta.tone),
      ...Object.values(SYNC_STATUS_META).map((meta) => meta.tone),
    ]);
    for (const tone of tones) {
      expect(TONE_DOT[tone], `no dot class for ${tone}`).toBeTruthy();
      expect(TONE_TEXT[tone], `no text class for ${tone}`).toBeTruthy();
      expect(TONE_RAIL[tone], `no rail class for ${tone}`).toBeTruthy();
      expect(TONE_BORDER[tone], `no border class for ${tone}`).toBeTruthy();
    }
  });

  it('does not report a finished run as still active', () => {
    // The run-detail page decides whether to open a socket from the tone, so
    // only `running` may use the live accent.
    const live = Object.entries(EXECUTION_STATUS_META)
      .filter(([, meta]) => meta.tone === 'accent')
      .map(([status]) => status);
    expect(live).toEqual(['running']);
  });

  it('distinguishes success from failure', () => {
    expect(EXECUTION_STATUS_META.succeeded.tone).toBe('ok');
    expect(EXECUTION_STATUS_META.failed.tone).toBe('danger');
    expect(EXECUTION_STATUS_META.succeeded.tone).not.toBe(EXECUTION_STATUS_META.failed.tone);
  });
});
