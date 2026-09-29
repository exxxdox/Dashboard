import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  baseName,
  formatBytes,
  formatDuration,
  formatExit,
  formatParams,
  formatRelative,
  runTag,
} from './format';
import { translate, type Locale } from './i18n';

/**
 * The two formatters that produce words take a translator, so these tests hand
 * them real ones. Asserting through the dictionary rather than a stub is what
 * makes "the same instant reads differently in Chinese" testable at all.
 */
const translator = (locale: Locale) =>
  ((key, params) => translate(locale, key, params)) as Parameters<typeof formatRelative>[1];

const en = translator('en');
const zh = translator('zh');

describe('formatDuration', () => {
  it('renders an open run without inventing a number', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
    // A clock skew must not produce a negative duration.
    expect(formatDuration(-5)).toBe('—');
  });

  it('scales the unit to the magnitude', () => {
    expect(formatDuration(380)).toBe('380ms');
    expect(formatDuration(4200)).toBe('4.2s');
    expect(formatDuration(72_000)).toBe('1m 12s');
    expect(formatDuration(3_600_000)).toBe('1h 00m');
  });

  it('does not round a sub-second run up to a whole second', () => {
    expect(formatDuration(999)).toBe('999ms');
    expect(formatDuration(1000)).toBe('1.0s');
  });
});

describe('formatBytes', () => {
  it('renders an unknown size without inventing one', () => {
    expect(formatBytes(null)).toBe('—');
  });

  it('uses decimal units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(184_320)).toBe('184 kB');
    expect(formatBytes(1_500_000)).toBe('1.5 MB');
  });
});

describe('runTag', () => {
  it('is short, prefixed and stable', () => {
    expect(runTag('ex-77f3a1b2-c4d5-4e6f-8a9b-0c1d2e3f4a5b')).toBe('r-ex77f');
    expect(runTag('abcdef')).toBe('r-abcde');
  });

  it('is the same for the same id', () => {
    expect(runTag('ex-12345678')).toBe(runTag('ex-12345678'));
  });
});

describe('formatExit', () => {
  it('prefers the exit code', () => {
    expect(formatExit(2, null)).toBe('2');
  });

  it('falls back to the signal that killed the process', () => {
    expect(formatExit(null, 'SIGKILL')).toBe('SIGKILL');
  });

  it('shows a dash while the run has neither', () => {
    expect(formatExit(null, null)).toBe('—');
  });

  it('treats a zero exit code as a real value, not as absent', () => {
    expect(formatExit(0, null)).toBe('0');
  });
});

describe('formatParams', () => {
  it('says so when a script takes no parameters', () => {
    expect(formatParams({}, en)).toBe('(none)');
  });

  it('renders an environment assignment per value', () => {
    expect(formatParams({ A: '1', B: 'two words' }, en)).toBe('A=1  B=two words');
  });
});

describe('formatRelative', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('measures against the current time', () => {
    expect(formatRelative('2026-09-27T11:59:00.000Z', en)).toBe('1m ago');
    expect(formatRelative('2026-09-27T09:00:00.000Z', en)).toBe('3h ago');
    expect(formatRelative('2026-09-25T12:00:00.000Z', en)).toBe('2d ago');
  });

  it('never reports a negative age from a clock that is ahead', () => {
    expect(formatRelative('2026-09-27T12:00:30.000Z', en)).toBe('just now');
  });

  it('renders a missing timestamp as a dash', () => {
    expect(formatRelative(null, en)).toBe('—');
    expect(formatRelative('not a date', en)).toBe('—');
  });

  it('speaks the language it was handed', () => {
    // The unit is the translator's business rather than this module's, so the
    // same instant reads differently through a different one.
    expect(formatRelative('2026-09-27T09:00:00.000Z', zh)).toBe('3 小时前');
  });
});

describe('baseName', () => {
  it('returns the last path segment', () => {
    expect(baseName('deploy/api.sh')).toBe('api.sh');
    expect(baseName('api.sh')).toBe('api.sh');
    expect(baseName('a/b/')).toBe('b');
  });
});
