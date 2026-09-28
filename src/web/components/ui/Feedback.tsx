import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** iOS-style activity indicator. */
export function Spinner({ size = 20, className, label = 'Laster' }: { size?: number; className?: string; label?: string }) {
  const bars = Array.from({ length: 8 }, (_, i) => i);
  return (
    <span role="status" aria-label={label} className={cn('inline-block text-label-2', className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} style={{ animation: 'tikit-spin 0.8s steps(8) infinite' }} aria-hidden="true">
        {bars.map((i) => (
          <rect
            key={i}
            x="11"
            y="1.5"
            width="2"
            height="6"
            rx="1"
            fill="currentColor"
            opacity={0.25 + (i / 8) * 0.75}
            transform={`rotate(${i * 45} 12 12)`}
          />
        ))}
      </svg>
    </span>
  );
}

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden="true" className={cn('skeleton', className)} style={style} />;
}

export function EmptyState({
  icon,
  title,
  message,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  message?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-8 py-14 text-center', className)}>
      {icon && <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-fill-3 text-label-2 [&_svg]:h-8 [&_svg]:w-8">{icon}</div>}
      <h2 className="text-title3 font-semibold">{title}</h2>
      {message && <p className="mt-2 max-w-sm text-subhead text-label-2">{message}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center px-8 py-12 text-center', className)}>
      <p className="text-headline font-semibold">Noe gikk galt</p>
      <p className="mt-2 max-w-sm text-subhead text-label-2">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="press mt-5 h-11 rounded-full bg-fill-3 px-5 text-headline font-semibold text-tint">
          Prøv igjen
        </button>
      )}
    </div>
  );
}

export type PillTone = 'neutral' | 'tint' | 'green' | 'orange' | 'red' | 'dark' | 'glass';

const pillTones: Record<PillTone, string> = {
  neutral: 'bg-fill-3 text-label-2',
  tint: 'bg-tint-soft text-tint',
  green: 'bg-green-soft text-green',
  orange: 'bg-orange-soft text-orange',
  red: 'bg-red-soft text-red',
  dark: 'bg-black/70 text-white',
  glass: 'glass-clear',
};

/** Small status label. Always carries text – colour is never the only signal. */
export function Pill({ tone = 'neutral', children, className, icon }: { tone?: PillTone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-[3px] text-caption1 font-semibold [&_svg]:h-3.5 [&_svg]:w-3.5', pillTones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Chip({
  selected,
  onClick,
  children,
  icon,
  className,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "press relative inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-4 text-subhead font-semibold transition-colors [&_svg]:h-4 [&_svg]:w-4 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']",
        selected ? 'bg-label text-bg' : 'bg-fill-3 text-label hover:bg-fill-2',
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function ProgressBar({ value, max, className, tone = 'tint', label }: { value: number; max: number; className?: string; tone?: 'tint' | 'green' | 'orange'; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color = tone === 'green' ? 'bg-green-fill' : tone === 'orange' ? 'bg-orange-fill' : 'bg-tint-fill';
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-fill-3', className)}
    >
      <div className={cn('h-full rounded-full transition-[width] duration-500', color)} style={{ width: `${pct}%` }} />
    </div>
  );
}
