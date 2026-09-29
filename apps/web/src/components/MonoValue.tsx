import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../lib/cn';
import { useT } from '../lib/i18n';

/**
 * A machine value with a copy affordance.
 *
 * Commands, host paths and ids exist to be pasted somewhere else, so copying
 * is a first-class action rather than a text selection chore.
 */
export function MonoValue({
  value,
  className,
  wrap = false,
  label,
}: {
  value: string;
  className?: string;
  wrap?: boolean;
  label?: string;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard is unavailable outside a secure context; the value stays selectable.
    }
  }

  return (
    <span className={cn('group/mono inline-flex min-w-0 items-center gap-2', className)}>
      <span className={cn('mono text-ink text-body', wrap ? 'break-all' : 'truncate')} title={value}>
        {value}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={
          copied ? t('common.copied') : t('common.copyNamed', { name: label ?? t('common.value') })
        }
        className={cn(
          'focus-ring shrink-0 rounded-md p-1 transition-all duration-150 ease-out',
          'opacity-0 group-hover/mono:opacity-100 focus-visible:opacity-100',
          copied ? 'text-ok opacity-100' : 'text-faint hover:bg-panel-3 hover:text-ink',
        )}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
    </span>
  );
}
