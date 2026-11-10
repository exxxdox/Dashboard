import { describe, expect, it } from 'vitest';
import { executionStatusSchema, syncStatusSchema } from '@dashboard/shared';
import {
  EXECUTION_STATUS_META,
  SYNC_STATUS_META,
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
      expect(TONE_RAIL[tone], `no rail class for ${tone}`).toBeTruthy();    }
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

it('describes local discovery as scanning while keeping GitHub sync wording', async () => {
  const { syncStatusLabel } = await import('./status');
  const { translate } = await import('./i18n');
  for (const locale of ['en', 'zh'] as const) {
    const t: import('./i18n').Translate = (key, params) => translate(locale, key, params);
    expect(syncStatusLabel(t, 'ok', 'local')).toBe(locale === 'zh' ? '已扫描' : 'Scanned');
    expect(syncStatusLabel(t, 'syncing', 'local')).toBe(locale === 'zh' ? '扫描中' : 'Scanning');
    expect(syncStatusLabel(t, 'never', 'local')).toBe(locale === 'zh' ? '未扫描' : 'Not scanned');
    expect(syncStatusLabel(t, 'error', 'local')).toBe(locale === 'zh' ? '扫描失败' : 'Scan failed');
    expect(syncStatusLabel(t, 'ok', 'github')).toBe(syncStatusLabel(t, 'ok'));
  }
});
