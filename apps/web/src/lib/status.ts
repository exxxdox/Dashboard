import type { ExecutionStatus, SyncStatus } from '@dashboard/shared';

import type { MessageKey, Translate } from './i18n';

/** Semantic colour roles. Status is the only thing allowed to colour a dot. */
export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'accent' | 'muted';

/**
 * The word for a status is a dictionary key, not the word.
 *
 * A status is data that arrives from the server, and the reader's language is
 * decided here, so the two can only be joined at render time -- see
 * `executionStatusLabel`. The tone stays beside the key because colour and word
 * have to agree about what a status means.
 */
export type StatusMeta = { labelKey: MessageKey; tone: Tone };

export const EXECUTION_STATUS_META: Record<ExecutionStatus, StatusMeta> = {
  queued: { labelKey: 'runs.status.queued', tone: 'muted' },
  running: { labelKey: 'runs.status.running', tone: 'accent' },
  succeeded: { labelKey: 'runs.status.succeeded', tone: 'ok' },
  failed: { labelKey: 'runs.status.failed', tone: 'danger' },
  canceled: { labelKey: 'runs.status.canceled', tone: 'warn' },
  timed_out: { labelKey: 'runs.status.timedOut', tone: 'warn' },
  interrupted: { labelKey: 'runs.status.interrupted', tone: 'warn' },
};

export const SYNC_STATUS_META: Record<SyncStatus, StatusMeta> = {
  never: { labelKey: 'runs.sync.never', tone: 'muted' },
  syncing: { labelKey: 'runs.sync.syncing', tone: 'accent' },
  ok: { labelKey: 'runs.sync.ok', tone: 'ok' },
  error: { labelKey: 'runs.sync.error', tone: 'danger' },
};

/**
 * The status as a word, in the reader's language.
 *
 * A plain function rather than a hook: the label components call it during
 * render, and a caller that only needs the word on its way to somewhere else --
 * a select's option text, say -- should not have to be a component.
 */
export function executionStatusLabel(t: Translate, status: ExecutionStatus): string {
  return t(EXECUTION_STATUS_META[status].labelKey);
}

export function syncStatusLabel(t: Translate, status: SyncStatus): string {
  return t(SYNC_STATUS_META[status].labelKey);
}

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
