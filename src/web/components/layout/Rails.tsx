import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

export function SectionHeader({ title, subtitle, to, linkLabel = 'Se alle', className, id }: { title: string; subtitle?: string; to?: string; linkLabel?: string; className?: string; id?: string }) {
  return (
    <div className={cn('flex items-end justify-between gap-3 px-4 pb-2.5', className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-title2 font-bold tracking-[-0.01em]">
          {title}
        </h2>
        {subtitle && <p className="text-subhead text-label-2">{subtitle}</p>}
      </div>
      {to && (
        <Link to={to} className="inline-flex h-11 shrink-0 items-center gap-0.5 text-body text-tint no-underline" aria-label={`${linkLabel}: ${title}`}>
          {linkLabel}
          <ChevronRight className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/** Horizontally scrolling rail with snap points; keeps the page gutter on both ends. */
export function Rail({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    <div
      role="list"
      aria-label={label}
      className={cn('no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-4 pb-3 pt-0.5 [scroll-padding-inline:16px] [&>*]:snap-start', className)}
    >
      {children}
    </div>
  );
}

export function RailItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="listitem" className={cn('shrink-0', className)}>
      {children}
    </div>
  );
}
