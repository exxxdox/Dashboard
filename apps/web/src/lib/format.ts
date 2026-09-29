/**
 * Formatters for machine data. Everything here is read at a glance.
 *
 * The two that produce words -- a relative time and the "(none)" of an empty
 * list -- take a translator rather than reaching for one, because this module
 * has no React in it. The ones that produce dates take the locale for the same
 * reason: the order of a date's fields belongs to a language, not to a machine.
 */

import type { Locale, Translate } from './i18n';

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Short stable handle for an execution, e.g. `r-7f3a1`. */
export function runTag(id: string): string {
  return `r-${id.replace(/-/g, '').slice(0, 5)}`;
}

/** `380ms` / `4.2s` / `1m 12s` / `2h 04m`; an em dash while the run is open. */
export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < MS_PER_SECOND) return `${Math.round(ms)}ms`;
  if (ms < MS_PER_MINUTE) return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
  if (ms < MS_PER_HOUR) {
    const minutes = Math.floor(ms / MS_PER_MINUTE);
    const seconds = Math.round((ms % MS_PER_MINUTE) / MS_PER_SECOND);
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  const hours = Math.floor(ms / MS_PER_HOUR);
  const minutes = Math.round((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

const BYTE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const rounded = value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${rounded} ${BYTE_UNITS[unit] ?? 'B'}`;
}

/**
 * Formatters are cached per locale.
 *
 * `Intl.DateTimeFormat` construction is the expensive part, and a table of a
 * hundred rows would otherwise build one per cell. Two locales means at most
 * two entries, so the cache needs no eviction.
 */
const timeFormats = new Map<Locale, Intl.DateTimeFormat>();
const dateTimeFormats = new Map<Locale, Intl.DateTimeFormat>();

function timeFormat(locale: Locale): Intl.DateTimeFormat {
  let format = timeFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    timeFormats.set(locale, format);
  }
  return format;
}

function dateTimeFormat(locale: Locale): Intl.DateTimeFormat {
  let format = dateTimeFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    dateTimeFormats.set(locale, format);
  }
  return format;
}

function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTime(iso: string | null, locale: Locale): string {
  const date = parseIso(iso);
  return date ? timeFormat(locale).format(date) : '—';
}

export function formatDateTime(iso: string | null, locale: Locale): string {
  const date = parseIso(iso);
  return date ? dateTimeFormat(locale).format(date) : '—';
}

/** Coarse on purpose — always shown next to the absolute timestamp. */
export function formatRelative(iso: string | null, t: Translate): string {
  const date = parseIso(iso);
  if (!date) return '—';
  const delta = Date.now() - date.getTime();
  if (delta < 0) return t('time.justNow');
  if (delta < MS_PER_MINUTE) {
    return t('time.secondsAgo', { count: Math.max(1, Math.round(delta / MS_PER_SECOND)) });
  }
  if (delta < MS_PER_HOUR) {
    return t('time.minutesAgo', { count: Math.round(delta / MS_PER_MINUTE) });
  }
  if (delta < MS_PER_DAY) return t('time.hoursAgo', { count: Math.round(delta / MS_PER_HOUR) });
  return t('time.daysAgo', { count: Math.round(delta / MS_PER_DAY) });
}

/** Exit code when the process exited, the signal name when it was killed. */
export function formatExit(exitCode: number | null, signal: string | null): string {
  if (exitCode !== null) return String(exitCode);
  if (signal) return signal;
  return '—';
}

/** Parameter values travel as environment variables, never as argv. */
export function formatParams(values: Record<string, string>, t: Translate): string {
  const entries = Object.entries(values);
  if (entries.length === 0) return t('common.none');
  return entries.map(([key, value]) => `${key}=${value}`).join('  ');
}

/** Trailing path segment, for compact breadcrumbs. */
export function baseName(path: string): string {
  const segments = path.split('/').filter((segment) => segment !== '');
  return segments[segments.length - 1] ?? path;
}
