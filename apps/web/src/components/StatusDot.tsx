import type { ExecutionStatus, SyncStatus } from '@dashboard/shared';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';
import {
  EXECUTION_STATUS_META,
  SYNC_STATUS_META,
  executionStatusLabel,
  syncStatusLabel,
  TONE_DOT,
  TONE_TEXT,
  type StatusMeta,
} from '../lib/status';

export function StatusDot({
  tone,
  live = false,
  className,
}: {
  tone: StatusMeta['tone'];
  live?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn('relative inline-block size-2 shrink-0 rounded-full', TONE_DOT[tone], className)}
    >
      {live ? <span className={cn('dot-live absolute inset-0', TONE_TEXT[tone])} aria-hidden /> : null}
    </span>
  );
}

export function ExecutionStatusLabel({
  status,
  className,
  withDot = true,
}: {
  status: ExecutionStatus;
  className?: string;
  withDot?: boolean;
}) {
  const t = useT();
  const meta = EXECUTION_STATUS_META[status];
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      {withDot ? <StatusDot tone={meta.tone} live={status === 'running'} /> : null}
      <span className={cn('text-body', TONE_TEXT[meta.tone])}>
        {executionStatusLabel(t, status)}
      </span>
    </span>
  );
}

export function SyncStatusLabel({ status, className }: { status: SyncStatus; className?: string }) {
  const t = useT();
  const meta = SYNC_STATUS_META[status];
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <StatusDot tone={meta.tone} live={status === 'syncing'} />
      <span className={cn('text-body', TONE_TEXT[meta.tone])}>{syncStatusLabel(t, status)}</span>
    </span>
  );
}
