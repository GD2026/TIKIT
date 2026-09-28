import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '../../lib/cn';
import { Spinner } from './Feedback';

export type ButtonVariant = 'filled' | 'tinted' | 'gray' | 'plain' | 'destructive' | 'glass' | 'dark' | 'overlay' | 'vipps';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'press relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-40';

const variants: Record<ButtonVariant, string> = {
  filled: 'bg-tint-fill text-on-tint hover:brightness-[1.06] active:brightness-95',
  tinted: 'bg-tint-soft text-tint hover:bg-[var(--tint-soft-strong)]',
  gray: 'bg-fill-3 text-label hover:bg-fill-2',
  plain: 'bg-transparent text-tint hover:bg-fill-4',
  destructive: 'bg-red-soft text-red hover:brightness-95',
  glass: 'glass text-label',
  dark: 'bg-label text-bg hover:opacity-90',
  /** For controls that sit on photos, video or other always-dark surfaces (scanner, pass art). */
  overlay: 'bg-white/[0.18] text-white hover:bg-white/25',
  /** Vipps brand orange. White on #FF5B24 is 3.1:1, so the label is set as WCAG "large text" (19 px bold). */
  vipps: 'bg-[var(--vipps)] text-white hover:bg-[var(--vipps-pressed)]',
};

const sizes: Record<ButtonSize, string> = {
  // 34 px visually; the pseudo-element extends the touch target to 44 px.
  sm: "h-[34px] px-3.5 before:absolute before:inset-x-0 before:-inset-y-[5px] before:content-['']",
  md: 'h-11 px-5',
  lg: 'h-[52px] px-6',
};

const textSizes: Record<ButtonSize, string> = { sm: 'text-subhead', md: 'text-headline', lg: 'text-headline' };

function typeClass(variant: ButtonVariant, size: ButtonSize): string {
  return variant === 'vipps' ? 'text-[1.1875rem] font-bold' : `${textSizes[size]} font-semibold`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'filled', size = 'md', full, loading, icon, trailing, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(base, variants[variant], sizes[size], typeClass(variant, size), full && 'w-full', className)}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 16 : 18} className="text-current" /> : icon}
      {children}
      {!loading && trailing}
    </button>
  );
});

export interface LinkButtonProps {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  full?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
  replace?: boolean;
  state?: unknown;
}

export function LinkButton({ to, variant = 'filled', size = 'md', full, icon, className, children, replace, state }: LinkButtonProps) {
  return (
    <Link to={to} replace={replace} state={state} className={cn(base, variants[variant], sizes[size], typeClass(variant, size), full && 'w-full', 'no-underline', className)}>
      {icon}
      {children}
    </Link>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: 'glass' | 'gray' | 'plain' | 'clear' | 'tinted';
  size?: 36 | 44;
}

/** Icon-only control with a 44×44 hit area and an accessible label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'gray', size = 36, className, children, type = 'button', ...rest },
  ref,
) {
  const look = {
    glass: 'glass text-label',
    gray: 'bg-fill-3 text-label hover:bg-fill-2',
    plain: 'text-tint hover:bg-fill-4',
    clear: 'glass-clear',
    tinted: 'bg-tint-soft text-tint',
  }[variant];
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'press relative inline-flex shrink-0 items-center justify-center rounded-full outline-none',
        "before:absolute before:left-1/2 before:top-1/2 before:h-11 before:w-11 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
        look,
        size === 36 ? 'h-9 w-9' : 'h-11 w-11',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
