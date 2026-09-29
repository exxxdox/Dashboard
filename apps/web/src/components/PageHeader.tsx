import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Page title block: a quiet mono eyebrow, a real heading, actions on the right. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  hints,
  className,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  hints?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('border-line flex flex-wrap items-end gap-4 border-b pb-5', className)}>
      <div className="min-w-0 flex-1">
        <p className="label mb-2.5">{eyebrow}</p>
        <h1 className="text-ink text-display truncate font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-mute text-body mt-2.5 max-w-2xl">{description}</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {hints}
        {actions}
      </div>
    </header>
  );
}
