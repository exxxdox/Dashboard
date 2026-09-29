import { useId, useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

import { cn } from '../lib/cn';

/**
 * A panel whose body folds away.
 *
 * The whole header is the control rather than a chevron beside a heading: a
 * 44-pixel target is easier to hit than a 16-pixel glyph, and it means the
 * heading can carry the summary of what is folded.
 *
 * The body stays in the document with `hidden` rather than being unmounted, so
 * the `aria-controls` relationship survives a collapse -- a control pointing at
 * an element that is not there is worse than no attribute at all. A form inside
 * therefore keeps what was typed while folded, which is what someone halfway
 * through filling one in wants.
 */
export function CollapsiblePanel({
  title,
  subtitle,
  aside,
  defaultOpen = false,
  children,
  className,
}: {
  title: string;
  /** Shown beside the title while folded, so collapsing is not losing. */
  subtitle?: ReactNode;
  aside?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className={cn('card overflow-hidden', className)}>
      <h2>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((current) => !current)}
          className={cn(
            'focus-ring group hover:bg-panel-2/60 flex w-full items-center gap-3 px-5 py-4 text-left',
            'transition-colors duration-150 ease-out',
            open && 'border-line border-b',
          )}
        >
          <ChevronRight
            aria-hidden
            className={cn(
              'text-faint group-hover:text-mute size-5 shrink-0',
              'transition-transform duration-200 ease-out',
              open && 'rotate-90',
            )}
          />
          <span className="text-ink text-lead font-semibold tracking-tight">{title}</span>
          <span className="min-w-0 flex-1" />
          {subtitle ? <span className="text-mute text-meta truncate">{subtitle}</span> : null}
          {aside}
        </button>
      </h2>
      <div id={bodyId} hidden={!open} className="animate-fade-in p-5">
        {children}
      </div>
    </section>
  );
}
