import type { ReactNode } from 'react';
import { CircleAlert, Loader, TriangleAlert } from 'lucide-react';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';

/** Errors always show the server's own message; nothing is paraphrased. */
export function ErrorBanner({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useT();

  return (
    <div
      role="alert"
      className={cn(
        'border-danger/45 bg-danger/10 shadow-card flex items-start gap-3 rounded-xl border px-4 py-3',
        className,
      )}
    >
      <CircleAlert className="text-danger mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="text-ink text-body min-w-0 flex-1 break-words">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="focus-ring text-danger hover:bg-danger/15 text-meta rounded-lg px-2 py-1 font-semibold transition-colors duration-150"
        >
          {t('common.retry')}
        </button>
      ) : null}
    </div>
  );
}

export function WarningBanner({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'border-warn/45 bg-warn/10 text-ink text-body shadow-card flex items-start gap-3 rounded-xl border px-4 py-3',
        className,
      )}
    >
      <TriangleAlert className="text-warn mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="border-line bg-panel-2/30 flex flex-col items-center gap-4 rounded-xl border border-dashed px-8 py-14 text-center">
      {icon ? (
        <div className="bg-panel-3 text-mute grid size-11 place-items-center rounded-xl">{icon}</div>
      ) : null}
      <div className="grid gap-1.5">
        <p className="text-ink text-lead font-semibold">{title}</p>
        <p className="text-mute text-body mx-auto max-w-md">{description}</p>
      </div>
      {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function LoadingRows({ rows = 5, className }: { rows?: number; className?: string }) {
  const t = useT();

  return (
    <div className={cn('divide-line divide-y', className)} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-4">
          <div className="bg-panel-3 size-2 animate-pulse rounded-full" />
          <div className="bg-panel-3 h-3 w-24 animate-pulse rounded" />
          <div className="bg-panel-3 h-3 w-40 animate-pulse rounded" />
          <div className="bg-panel-3 ml-auto h-3 w-12 animate-pulse rounded" />
        </div>
      ))}
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}

export function LoadingBlock({ label }: { label?: string }) {
  const t = useT();

  return (
    <div className="text-mute text-body flex items-center gap-2.5 px-4 py-8" aria-busy="true">
      <Loader className="size-4 animate-spin" aria-hidden />
      {label ?? t('common.loading')}
    </div>
  );
}
