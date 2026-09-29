import type { ExecutionStatus, SyncStatus } from '@script-dashboard/shared';

/** Semantic colour roles. Status is the only thing allowed to colour a dot. */
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'accent' | 'muted';

export type StatusMeta = { label: string; tone: Tone };

export const EXECUTION_STATUS_META: Record<ExecutionStatus, StatusMeta> = {
  queued: { label: 'Queued', tone: 'muted' },
  running: { label: 'Running', tone: 'accent' },
  succeeded: { label: 'Succeeded', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  canceled: { label: 'Canceled', tone: 'warn' },
  timed_out: { label: 'Timed out', tone: 'warn' },
  interrupted: { label: 'Interrupted', tone: 'warn' },
};

export const SYNC_STATUS_META: Record<SyncStatus, StatusMeta> = {
  never: { label: 'Never synced', tone: 'muted' },
  syncing: { label: 'Syncing', tone: 'accent' },
  ok: { label: 'Synced', tone: 'ok' },
  error: { label: 'Sync failed', tone: 'danger' },
};

export const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent',
  muted: 'bg-faint',
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
  accent: 'text-accent',
  muted: 'text-mute',
};

export const TONE_BORDER: Record<Tone, string> = {
  ok: 'border-ok',
  warn: 'border-warn',
  danger: 'border-danger',
  info: 'border-info',
  accent: 'border-accent',
  muted: 'border-faint',
};

export const TONE_RAIL: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
  accent: 'bg-accent',
  muted: 'bg-faint',
};
