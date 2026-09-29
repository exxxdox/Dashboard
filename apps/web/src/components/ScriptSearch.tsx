import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { Search, X } from 'lucide-react';
import type { ScriptSummary } from '@script-dashboard/shared';
import { cn } from '../lib/cn';
import { useScripts } from '../api/queries';
import { useDebounced } from '../lib/useDebounced';

const MAX_SUGGESTIONS = 8;

/**
 * Search-and-pick for a script.
 *
 * The executions endpoint filters by `scriptId` but has no text search, so the
 * picker resolves a name to an id against `/api/scripts?q=` and the id is what
 * ends up in the URL.
 */
export function ScriptSearch({
  selected,
  onSelect,
  inputRef,
}: {
  selected: ScriptSummary | null;
  onSelect: (script: ScriptSummary | null) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const debounced = useDebounced(query, 200);
  const search = useScripts({ q: debounced.trim() });

  const suggestions = useMemo(() => {
    const items = search.data ?? [];
    // When a script is already chosen, drop it from its own suggestion list.
    return items.filter((item) => item.id !== selected?.id).slice(0, MAX_SUGGESTIONS);
  }, [search.data, selected?.id]);

  useEffect(() => {
    setHighlight(0);
  }, [debounced]);

  // Clicking anywhere else dismisses the list without stealing focus back.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function choose(script: ScriptSummary | null): void {
    onSelect(script);
    setQuery('');
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight((current) => Math.min(current + 1, Math.max(suggestions.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      const picked = suggestions[highlight];
      if (open && picked) {
        event.preventDefault();
        choose(picked);
      }
      return;
    }
    if (event.key === 'Escape' && open) {
      // The field owns `Esc` while its list is showing.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className="relative min-w-[260px] flex-1">
      {selected ? (
        <div className="border-line bg-panel-2 flex h-9 items-center gap-2.5 rounded-lg border px-3 transition-colors duration-150">
          <span className="text-faint text-micro shrink-0 tracking-[0.14em] uppercase">script</span>
          <span className="mono text-ink text-body min-w-0 flex-1 truncate" title={selected.relPath}>
            {selected.relPath}
          </span>
          <button
            type="button"
            onClick={() => choose(null)}
            aria-label="Clear script filter"
            className="focus-ring text-faint hover:text-ink hover:bg-panel-3 rounded-md p-1 transition-colors duration-150"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="relative">
          <Search
            className="text-faint pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="search"
            data-search-input="script"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            value={query}
            placeholder="Filter by script…"
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className="focus-ring border-line bg-panel-2 text-ink placeholder:text-faint hover:border-line-strong hover:bg-panel-3 text-body h-9 w-full rounded-lg border pr-3 pl-9 transition-colors duration-150"
          />
        </div>
      )}

      {open && !selected ? (
        <ul
          id={listId}
          role="listbox"
          className="border-line bg-panel-2 shadow-float absolute top-11 left-0 z-30 max-h-72 w-full overflow-auto rounded-xl border py-1.5"
        >
          {search.isPending ? (
            <li className="text-mute text-body px-3.5 py-2">Searching…</li>
          ) : suggestions.length === 0 ? (
            <li className="text-mute text-body px-3.5 py-2">No scripts match “{debounced}”.</li>
          ) : (
            suggestions.map((script, index) => (
              <li key={script.id} role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(script)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3.5 py-2 text-left transition-colors duration-150',
                    index === highlight && 'bg-panel-3',
                  )}
                >
                  <span className="mono text-ink text-body min-w-0 flex-1 truncate">
                    {script.relPath}
                  </span>
                  <span className="text-faint text-micro shrink-0">{script.format}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
