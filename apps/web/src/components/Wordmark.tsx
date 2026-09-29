import { useId } from 'react';

import { cn } from '../lib/cn';

/**
 * The product's name, drawn rather than typed.
 *
 * What it replaced was two words in the mono face -- "script" greyed out beside
 * "dashboard" -- which described the software instead of naming it, and read as
 * a sentence the reader had to finish. This is one word, and a mark whose arc
 * is the shape the product is actually about: a dial with its needle resting
 * high, which is what a dashboard is for.
 *
 * The lettering is a gradient from the ink colour into the accent, so the word
 * arrives as one object rather than as two halves of a compound noun.
 */
export function Wordmark({
  size = 'rail',
  className,
}: {
  size?: 'rail' | 'hero';
  className?: string;
}) {
  const hero = size === 'hero';

  return (
    <span className={cn('flex items-center', hero ? 'gap-4' : 'gap-3', className)}>
      <GaugeMark className={cn('mark-glow shrink-0', hero ? 'size-14' : 'size-9')} />
      <span
        className={cn(
          'from-ink to-accent bg-linear-to-r bg-clip-text font-semibold text-transparent',
          // Tight tracking, because a wordmark is a shape before it is a word.
          hero ? 'text-[2.5rem] tracking-[-0.045em]' : 'text-brand tracking-[-0.035em]',
        )}
      >
        dashboard
      </span>
    </span>
  );
}

/**
 * A dial, open at the bottom, with its needle near the top.
 *
 * The gradient id is per-instance because the mark appears more than once on a
 * page, and duplicate ids in one document are invalid however harmlessly the
 * browser resolves them.
 */
function GaugeMark({ className }: { className?: string }) {
  const rimId = useId();

  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={rimId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      <rect
        x="1"
        y="1"
        width="38"
        height="38"
        rx="11"
        fill="var(--surface-2)"
        stroke={`url(#${rimId})`}
        strokeWidth="1.5"
      />
      <path
        d="M10 26a10 10 0 0 1 20 0"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M20 26 27 16.5"
        fill="none"
        stroke="var(--text)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx="20" cy="26" r="2.6" fill="var(--accent)" />
    </svg>
  );
}
