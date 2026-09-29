import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'mono border-line bg-panel-3 text-mute inline-flex h-6 min-w-6 items-center justify-center',
        'rounded-md border px-2 text-micro leading-none shadow-card',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export type KeyHint = { keys: string[]; label: string };

/**
 * Keyboard hints sit in the page header, quietly, where the eye lands after the
 * title — never as a modal or a first-run tour.
 */
export function KeyHints({ hints, className }: { hints: KeyHint[]; className?: string }) {
  return (
    <div className={cn('text-faint hidden items-center gap-4 text-meta lg:flex', className)}>
      {hints.map((hint) => (
        <span key={hint.label} className="inline-flex items-center gap-1.5">
          {hint.keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
          <span className="label">{hint.label}</span>
        </span>
      ))}
    </div>
  );
}
