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
    // `data-glow` is what makes the card's highlight follow the pointer instead
    // of sitting in the middle of it; the listener that feeds it is mounted
    // once, in `App`.
    <section data-glow className={cn('card overflow-hidden', className)}>
      {title ? (
        <header className="border-line bg-panel-2/50 flex h-16 items-center justify-between gap-3 border-b px-5">
          {/* A long title truncates and the aside keeps its own width: a title
              that wraps instead grows past the header's fixed height, and the
              aside beside it -- a status label, a button -- wraps with it. */}
          <h2 className="text-ink text-lead min-w-0 truncate font-semibold tracking-tight">
            {title}
          </h2>
          {/* `gap-3` so several children in one aside keep the spacing they had
              when they were laid out as siblings of the title. */}
          {aside ? <div className="flex shrink-0 items-center gap-3">{aside}</div> : null}
        </header>
      ) : null}
      <div className={cn(flush ? '' : 'p-5', bodyClassName)}>{children}</div>
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
    // `min-w-0` on both rows: a stat's value is often one long unbroken token
    // -- an IPv6 address, a host path -- and without it a grid column refuses to
    // shrink, so the value paints over its neighbour instead of wrapping.
    <div className={cn('grid min-w-0 gap-2', className)}>
      <span className="label">{label}</span>
      <span className={cn('text-ink text-lead min-w-0 break-words', mono && 'mono')}>
        {children}
      </span>
    </div>
  );
}
