import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Switch } from './Controls';

export function Section({
  header,
  footer,
  children,
  className,
  plain,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Not inset (edge to edge) – used inside sheets. */
  plain?: boolean;
}) {
  return (
    <section className={cn('mb-7', className)}>
      {header && <h2 className="mb-1.5 px-4 text-footnote font-normal uppercase tracking-[0.02em] text-label-2">{header}</h2>}
      <div className={cn('overflow-hidden bg-grouped-2 [&>*+*]:hairline-t', plain ? '' : 'rounded-md')}>{children}</div>
      {footer && <p className="mt-1.5 px-4 text-footnote text-label-2">{footer}</p>}
    </section>
  );
}

export function IconTile({ color, children, className }: { color: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-white [&_svg]:h-[18px] [&_svg]:w-[18px]', className)} style={{ background: color }}>
      {children}
    </span>
  );
}

interface RowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  accessory?: ReactNode;
  chevron?: boolean;
  to?: string;
  href?: string;
  onClick?: () => void;
  destructive?: boolean;
  tint?: boolean;
  className?: string;
  disabled?: boolean;
  multiline?: boolean;
}

export function Row({ icon, title, subtitle, value, accessory, chevron, to, href, onClick, destructive, tint, className, disabled, multiline }: RowProps) {
  const interactive = !!(to || href || onClick) && !disabled;
  const content = (
    <>
      {icon && <span className="flex shrink-0 items-center">{icon}</span>}
      <span className="min-w-0 flex-1 py-[11px]">
        <span className={cn('block text-body', destructive ? 'text-red' : tint ? 'text-tint' : 'text-label', !multiline && 'truncate')}>{title}</span>
        {subtitle && <span className={cn('mt-0.5 block text-subhead text-label-2', !multiline && 'truncate')}>{subtitle}</span>}
      </span>
      {value !== undefined && value !== null && <span className="shrink-0 text-body text-label-2 tabular">{value}</span>}
      {accessory}
      {(chevron ?? (interactive && !accessory)) && <ChevronRight aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-label-3" strokeWidth={2.5} />}
    </>
  );
  const cls = cn(
    'flex min-h-11 w-full items-center gap-3 px-4 text-left',
    interactive && 'transition-colors hover:bg-fill-4 active:bg-fill-3',
    disabled && 'opacity-50',
    className,
  );
  if (to && !disabled)
    return (
      <Link to={to} className={cn(cls, 'no-underline')}>
        {content}
      </Link>
    );
  if (href && !disabled)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={cn(cls, 'no-underline')}>
        {content}
      </a>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} disabled={disabled} className={cls}>
        {content}
      </button>
    );
  return <div className={cls}>{content}</div>;
}

export function ToggleRow({
  icon,
  title,
  subtitle,
  checked,
  onChange,
  disabled,
  id,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  id: string;
}) {
  return (
    <div className={cn('flex min-h-11 w-full items-center gap-3 px-4', disabled && 'opacity-50')}>
      {icon && <span className="flex shrink-0 items-center">{icon}</span>}
      <label htmlFor={id} className="min-w-0 flex-1 py-[11px]">
        <span className="block text-body">{title}</span>
        {subtitle && <span className="mt-0.5 block text-subhead text-label-2">{subtitle}</span>}
      </label>
      <Switch id={id} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}
