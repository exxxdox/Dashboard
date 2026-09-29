import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';
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

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cn(CONTROL_CLASS, className)} />;
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cn(CONTROL_CLASS, 'resize-y leading-relaxed', className)} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} className={cn(CONTROL_CLASS, 'cursor-pointer pr-8', className)} />;
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
