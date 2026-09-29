import { useMemo } from 'react';
import type { ScriptFormat } from '@dashboard/shared';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';

const MAX_LINES = 400;

type Line = { number: number; text: string; kind: 'code' | 'comment' | 'header' };

/**
 * Comment lines carry the declarations the run form is built from, so dimming
 * them inverts the usual emphasis: the code is the payload, the header is the
 * interface. Cheap to compute and dependency-free — no highlighter offline.
 */
function classify(text: string, index: number): Line['kind'] {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('#') || trimmed.startsWith('<#')) return index === 0 ? 'header' : 'comment';
  return 'code';
}

export function ScriptSource({ content, format }: { content: string; format: ScriptFormat }) {
  const t = useT();
  const lines = useMemo<Line[]>(
    () =>
      content
        .split(/\r?\n/)
        .slice(0, MAX_LINES)
        .map((text, index) => ({ number: index + 1, text, kind: classify(text, index) })),
    [content],
  );

  const total = content.split(/\r?\n/).length;

  return (
    <div className="grid gap-2">
      <div className="border-line bg-base max-h-[420px] overflow-auto rounded-lg border">
        <pre className="mono text-body leading-[1.6]">
          <code>
            {lines.map((line) => (
              <span key={line.number} className="flex">
                <span
                  aria-hidden
                  className="text-faint bg-base sticky left-0 w-11 shrink-0 pr-3 text-right select-none"
                >
                  {line.number}
                </span>
                {/* Soft-wrapped rather than horizontally scrollable: a shell
                    line is often wider than the pane, and reading it by
                    scrolling sideways loses the line worth reading. Wrapping
                    keeps the whole line in view, and `break-words` is what
                    stops one long path or URL from overflowing anyway.
                    `min-w-0` lets this flex item shrink below its content,
                    which is what allows the wrap to happen at all. */}
                <span
                  className={cn(
                    'min-w-0 pr-4 whitespace-pre-wrap break-words',
                    line.kind === 'code' ? 'text-ink' : 'text-mute',
                    line.kind === 'header' && 'text-accent',
                  )}
                >
                  {line.text === '' ? ' ' : line.text}
                </span>
              </span>
            ))}
          </code>
        </pre>
      </div>
      <p className="text-faint text-micro">
        <span className="mono">{format}</span>
        {' · '}
        {total > MAX_LINES
          ? t('scripts.source.overflow', { shown: MAX_LINES, total })
          : t('scripts.source.lines', { count: total })}
      </p>
    </div>
  );
}
