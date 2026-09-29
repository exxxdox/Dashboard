import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export function Panel({
  title,
  aside,
  children,
  className,
  bodyClassName,
  flush = false,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Skip body padding for tables and lists that manage their own rows. */
  flush?: boolean;
}) {
  return (
    <section className={cn('card overflow-hidden', className)}>
      {title ? (
        <header className="border-line bg-panel-2/50 flex h-14 items-center justify-between gap-3 border-b px-4">
          <h2 className="text-ink text-lead font-semibold tracking-tight">{title}</h2>
          {aside}
        </header>
      ) : null}
      <div className={cn(flush ? '' : 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** A labelled value in a header strip. Machine values get the mono face. */
export function Stat({
  label,
  children,
  className,
  mono = true,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={cn('grid gap-1.5', className)}>
      <span className="label">{label}</span>
      <span className={cn('text-ink text-lead', mono && 'mono')}>{children}</span>
    </div>
  );
}
