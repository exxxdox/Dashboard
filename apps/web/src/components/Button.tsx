import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader } from 'lucide-react';
import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

// Hover is a lift in surface plus a lift in elevation, not just a colour swap:
// the button has to read as pressable before the pointer is on it.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-ink border-transparent shadow-card hover:brightness-110 hover:shadow-glow',
  default:
    'bg-panel-2 text-ink border-line hover:border-line-strong hover:bg-panel-3 hover:shadow-card',
  ghost: 'bg-transparent text-mute border-transparent hover:bg-panel-2 hover:text-ink',
  danger: 'bg-transparent text-danger border-line hover:border-danger hover:bg-danger/12',
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 gap-2 text-meta',
  md: 'h-10 px-4 gap-2 text-body',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
};

export function Button({
  variant = 'default',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      className={cn(
        'focus-ring inline-flex items-center justify-center rounded-lg border font-medium whitespace-nowrap',
        'transition-all duration-150 ease-out active:translate-y-px',
        'disabled:pointer-events-none disabled:opacity-45',
        SIZE_CLASS[size],
        VARIANT_CLASS[variant],
        className,
      )}
    >
      {loading ? <Loader className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
};

export function IconButton({ label, className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'focus-ring text-mute hover:text-ink hover:bg-panel-3 inline-flex size-9 items-center justify-center',
        'rounded-lg border border-transparent transition-colors duration-150 ease-out',
        'disabled:pointer-events-none disabled:opacity-45',
        className,
      )}
    >
      {children}
    </button>
  );
}
