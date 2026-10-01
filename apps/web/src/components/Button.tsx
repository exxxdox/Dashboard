import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader } from 'lucide-react';
import { cn } from '../lib/cn';

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger' | 'success';
export type ButtonSize = 'sm' | 'md';

// Hover is a lift in surface plus a lift in elevation, not just a colour swap:
// the button has to read as pressable before the pointer is on it.
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  // The primary action carries a gradient rather than a flat fill: on a dark
  // page it is what separates "press this" from every other bordered control.
  primary:
    'bg-linear-to-b from-[color-mix(in_oklab,var(--accent)_92%,white)] to-accent text-accent-ink border-transparent shadow-card hover:shadow-glow hover:brightness-105',
  default:
    'bg-panel-2 text-ink border-line hover:border-line-strong hover:bg-panel-3 hover:shadow-card',
  // Green, and filled rather than outlined: this is the control that starts
  // something on another machine, so it has to be findable without reading. It
  // is not `primary` because a page may hold both, and two accent buttons of
  // equal weight would make "run" and "save" look like the same decision.
  success:
    'bg-linear-to-b from-[color-mix(in_oklab,var(--ok)_90%,white)] to-ok text-ok-ink border-transparent shadow-card hover:brightness-110',
  ghost: 'bg-transparent text-mute border-transparent hover:bg-panel-2 hover:text-ink',
  danger: 'bg-transparent text-danger border-line hover:border-danger hover:bg-danger/12',
};

// Both steps moved up with the type scale: a 36px control under 17px text
// reads as a link, and the taller step is what makes a primary action look
// like the thing to press.
const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-10 px-4 gap-2 text-meta',
  md: 'h-11 px-5 gap-2.5 text-body',
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
        'focus-ring btn-sheen inline-flex items-center justify-center rounded-[10px] border font-medium whitespace-nowrap',
        // Pressing is a 1px drop; the light crossing the face on hover is
        // `.btn-sheen`, which is a keyframe so it always travels the same way.
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
        'icon-glow rounded-lg border border-transparent transition-all duration-150 ease-out',
        'disabled:pointer-events-none disabled:opacity-45',
        className,
      )}
    >
      {children}
    </button>
  );
}
