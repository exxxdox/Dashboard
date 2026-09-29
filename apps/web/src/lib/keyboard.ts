import { useEffect, useRef, useState, type RefObject } from 'react';

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return EDITABLE_TAGS.has(target.tagName) || target.isContentEditable;
}

export type ListKeyboardOptions = {
  count: number;
  /** Container that holds the rows; used to keep the active row in view. */
  containerRef?: RefObject<HTMLElement | null>;
  /** Focused by `/`. */
  searchRef?: RefObject<HTMLInputElement | null>;
  onOpen: (index: number) => void;
  onEscape?: () => void;
};

export type ListKeyboard = {
  activeIndex: number;
  setActiveIndex: (index: number) => void;
};

/**
 * `j`/`k` to move, `Enter` to open, `/` to search, `Esc` to leave.
 *
 * Registered on the window rather than on a focusable list so the whole page
 * works without first tabbing into it — the usual behaviour of a terminal tool.
 */
export function useListKeyboard({
  count,
  containerRef,
  searchRef,
  onOpen,
  onEscape,
}: ListKeyboardOptions): ListKeyboard {
  const [activeIndex, setActiveIndex] = useState(-1);

  // Handlers read through a ref so the listener is registered exactly once.
  const latest = useRef({ count, onOpen, onEscape, searchRef });
  useEffect(() => {
    latest.current = { count, onOpen, onEscape, searchRef };
  });

  const activeRef = useRef(activeIndex);
  useEffect(() => {
    activeRef.current = activeIndex;
  });

  useEffect(() => {
    function move(delta: number): void {
      const total = latest.current.count;
      if (total === 0) return;
      const from = activeRef.current;
      // Entering the list with `j` starts at the top, with `k` at the bottom.
      const next = from === -1 ? (delta > 0 ? 0 : total - 1) : from + delta;
      setActiveIndex(Math.max(0, Math.min(total - 1, next)));
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const typing = isTypingTarget(event.target);

      if (event.key === '/' && !typing) {
        const input = latest.current.searchRef?.current;
        if (!input) return;
        event.preventDefault();
        input.focus();
        input.select();
        return;
      }

      if (event.key === 'Escape') {
        // While typing, `Esc` means "leave the field", not "leave the page".
        if (typing && event.target instanceof HTMLElement) {
          event.target.blur();
          return;
        }
        latest.current.onEscape?.();
        return;
      }

      if (typing) return;

      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        move(1);
        return;
      }
      if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
        return;
      }
      if (event.key === 'Enter' || event.key === 'o') {
        const index = activeRef.current;
        if (index >= 0 && index < latest.current.count) {
          event.preventDefault();
          latest.current.onOpen(index);
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // A shorter list must not keep a pointer to a row that no longer exists.
  useEffect(() => {
    setActiveIndex((current) => (current >= count ? count - 1 : current));
  }, [count]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const row = containerRef?.current?.querySelector<HTMLElement>(`[data-row-index="${activeIndex}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, containerRef]);

  return { activeIndex, setActiveIndex };
}
