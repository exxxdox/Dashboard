import { useId } from 'react';

import { cn } from '../lib/cn';

/**
 * The product's name, drawn rather than typed.
 *
 * What it replaced was two words in the mono face -- "script" greyed out beside
 * "dashboard" -- which described the software instead of naming it, and read as
 * a sentence the reader had to finish. This is one word, and a mark that is the
 * shell prompt the product runs: the same tile and glyph as `public/favicon.svg`,
 * so the browser tab and the rail name the product with one identity.
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
      <PromptMark className={cn('mark-glow shrink-0', hero ? 'size-14' : 'size-9')} />
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
 * A shell prompt on a dark tile lit by the accent pair: the same geometry as
 * `public/favicon.svg`.
 *
 * The tile stays a theme surface with the accent pair as its light, the way
 * every card and panel in the app is built; painting the whole square in the
 * accents made the mark sit on the page instead of in it.
 *
 * Colours come from CSS variables rather than literals so the mark follows the
 * theme; the favicon keeps hex copies because an icon file cannot read them.
 * The gradient id is per-instance because the mark appears more than once on a
 * page, and duplicate ids in one document are invalid however harmlessly the
 * browser resolves them.
 */
function PromptMark({ className }: { className?: string }) {
  const rimId = useId();

  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden focusable="false">
      <defs>
        <linearGradient id={rimId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>

      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="6.5"
        fill="var(--surface-2)"
        stroke={`url(#${rimId})`}
        strokeWidth="2"
      />
      <path
        d="M9.5 10.5 15 16 9.5 21.5"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17.5 21.5H23"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
