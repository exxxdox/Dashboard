/** Formatters for machine data. Everything here is read at a glance. */

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

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatTime(iso: string | null): string {
  const date = parseIso(iso);
  return date ? TIME_FORMAT.format(date) : '—';
}

export function formatDateTime(iso: string | null): string {
  const date = parseIso(iso);
  return date ? DATE_TIME_FORMAT.format(date) : '—';
}

/** Coarse on purpose — always shown next to the absolute timestamp. */
export function formatRelative(iso: string | null): string {
  const date = parseIso(iso);
  if (!date) return '—';
  const delta = Date.now() - date.getTime();
  if (delta < 0) return 'just now';
  if (delta < MS_PER_MINUTE) return `${Math.max(1, Math.round(delta / MS_PER_SECOND))}s ago`;
  if (delta < MS_PER_HOUR) return `${Math.round(delta / MS_PER_MINUTE)}m ago`;
  if (delta < MS_PER_DAY) return `${Math.round(delta / MS_PER_HOUR)}h ago`;
  return `${Math.round(delta / MS_PER_DAY)}d ago`;
}

/** Exit code when the process exited, the signal name when it was killed. */
export function formatExit(exitCode: number | null, signal: string | null): string {
  if (exitCode !== null) return String(exitCode);
  if (signal) return signal;
  return '—';
}

/** Parameter values travel as environment variables, never as argv. */
export function formatParams(values: Record<string, string>): string {
  const entries = Object.entries(values);
  if (entries.length === 0) return '(none)';
  return entries.map(([key, value]) => `${key}=${value}`).join('  ');
}

/** Trailing path segment, for compact breadcrumbs. */
export function baseName(path: string): string {
  const segments = path.split('/').filter((segment) => segment !== '');
  return segments[segments.length - 1] ?? path;
}
