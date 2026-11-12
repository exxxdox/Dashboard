import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { SourceSummary } from '@dashboard/shared';
import { cn } from '../lib/cn';

/**
 * Source chooser for the scripts page.
 *
 * Not a native `<select>`: its popup is browser-drawn and opens with the
 * selected row under the pointer, so the first item the mouse crosses is that
 * row, not the first item. Here the list lives in the page, hover moves only
 * the highlight, and a click is the sole way the source changes.
 */
export function SourcePicker({
  sources,
  value,
  onChange,
  label,
  className,
}: {
  sources: SourceSummary[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedIndex = Math.max(
    0,
    sources.findIndex((source) => source.id === value),
  );
  const selected = sources[selectedIndex];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function openList(): void {
    setHighlight(selectedIndex);
    setOpen(true);
  }

  function choose(index: number): void {
    const source = sources[index];
    if (source) onChange(source.id);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    const last = sources.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (open) setHighlight((current) => Math.min(current + 1, last));
        else openList();
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (open) setHighlight((current) => Math.max(current - 1, 0));
        else openList();
        return;
      case 'Home':
        if (!open) return;
        event.preventDefault();
        setHighlight(0);
        return;
      case 'End':
        if (!open) return;
        event.preventDefault();
        setHighlight(last);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (open) choose(highlight);
        else openList();
        return;
      case 'Escape':
        if (!open) return;
        event.preventDefault();
        setOpen(false);
        return;
      case 'Tab':
        // Moving focus away must not leave the list floating over the page.
        setOpen(false);
        return;
      default:
        return;
    }
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={label}
        aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
        disabled={sources.length === 0}
        className="control flex cursor-pointer items-center justify-between gap-2 text-left"
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span className="truncate">
          {selected ? `${selected.name} (${selected.scriptCount})` : ''}
        </span>
        <ChevronDown
          className={cn('text-faint size-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="border-line bg-panel-2 shadow-float absolute top-11 left-0 z-30 max-h-72 w-full overflow-auto rounded-xl border py-1.5"
        >
          {sources.map((source, index) => (
            <li
              key={source.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={source.id === value}
              // Keep focus on the trigger so the click lands before `onBlur` closes the list.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => choose(index)}
              className={cn(
                'text-body flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2',
                index === highlight && 'bg-panel-3',
              )}
            >
              <span className="truncate">{source.name}</span>
              <span className="text-faint text-micro shrink-0">{source.scriptCount}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
