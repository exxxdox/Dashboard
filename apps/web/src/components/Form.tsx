import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from 'react';
import { Children, isValidElement, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

// Styling lives in the components layer (see index.css) so a caller's width
// utility always wins over the default full width.
const CONTROL_CLASS = 'control';

export type FieldProps = {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  /** Rendered on the right of the label row — e.g. a "required" marker. */
  aside?: ReactNode;
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode;
};

/** Label + control + hint, wired for screen readers in one place. */
export function Field({ label, hint, error, aside, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    // `content-start` because Field is often a grid item beside another Field:
    // a column that carries a hint (or an error after a failed submit) is taller,
    // and a stretched grid item otherwise hands the extra height to its own rows,
    // growing the input and pushing it out of line with its neighbour's.
    <div className="grid content-start gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label className="label" htmlFor={id}>
          {label}
        </label>
        {aside}
      </div>
      {children({ id, describedBy })}
      {error ? (
        <p id={errorId} className="text-danger text-meta">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-mute text-meta">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { ref?: Ref<HTMLInputElement> }) {
  return <input {...rest} className={cn(CONTROL_CLASS, className)} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(CONTROL_CLASS, 'resize-y leading-relaxed', className)} />;
}

export type SelectProps = {
  value: string;
  /** The `<option>` elements to choose from. */
  children: ReactNode;
  onValueChange: (value: string) => void;
  className?: string;
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'aria-describedby'?: string;
};

type SelectOption = { value: string; label: ReactNode };

function readOptions(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; children?: ReactNode }>(child)) return [];
    const { value, children: label } = child.props;
    return [{ value: String(value ?? (typeof label === 'string' ? label : '')), label }];
  });
}

/**
 * A listbox with a `<select>`'s call shape, not a native `<select>`.
 *
 * The native popup is drawn by the browser and opens with the selected row
 * under the pointer, so the first item the mouse crosses is the current one,
 * and hovering it previews a choice the user did not make. Here the list lives
 * in the page: hover moves only the highlight, and a click picks.
 */
export function Select({
  value,
  children,
  onValueChange,
  className,
  id,
  disabled,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const options = readOptions(children);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function openList(): void {
    setHighlight(Math.max(0, selectedIndex));
    setOpen(true);
  }

  function choose(index: number): void {
    const option = options[index];
    if (option) onValueChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>): void {
    const last = options.length - 1;
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
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-activedescendant={open ? `${listId}-${highlight}` : undefined}
        disabled={disabled}
        className={cn(CONTROL_CLASS, 'flex cursor-pointer items-center justify-between gap-2 text-left')}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
      >
        <span className="truncate">{selected?.label}</span>
        <ChevronDown
          className={cn('text-faint size-4 shrink-0 transition-transform', open && 'rotate-180')}
          aria-hidden
        />
      </button>

      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="border-line bg-panel-2 shadow-float absolute top-11 left-0 z-30 max-h-72 w-full overflow-auto rounded-xl border py-1.5"
        >
          {options.map((option, index) => (
            <li
              key={`${option.value}-${index}`}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              // Keep focus on the trigger so the click lands before `onBlur` closes the list.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(index)}
              onClick={() => choose(index)}
              className={cn(
                'text-body flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2',
                index === highlight && 'bg-panel-3',
              )}
            >
              {option.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  id?: string;
  disabled?: boolean;
};

/** A boolean script parameter is a shell flag, so it reads as on/off. */
export function Switch({ checked, onChange, label, id, disabled }: SwitchProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        // `w-fit` because a grid parent stretches its items: without it the
        // switch spans the whole row and stops reading as a control.
        'focus-ring inline-flex h-7 w-fit items-center gap-2 rounded-full border px-1.5 transition-colors duration-150 ease-out',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked
          ? 'border-accent/55 bg-accent-soft'
          : 'border-line bg-panel-2 hover:border-line-strong',
      )}
    >
      <span
        className={cn(
          'size-4 rounded-full transition-all duration-150 ease-out',
          checked ? 'bg-accent translate-x-0.5' : 'bg-faint',
        )}
        aria-hidden
      />
      <span className={cn('mono text-meta pr-0.5', checked ? 'text-accent' : 'text-mute')}>
        {checked ? 'true' : 'false'}
      </span>
    </button>
  );
}
