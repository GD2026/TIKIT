import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ChevronLeft } from 'lucide-react';
import { cn } from '../../lib/cn';

export function useScrollY(): number {
  const [y, setY] = useState(0);
  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setY(window.scrollY));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  return y;
}

export function useBack(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  return () => {
    if (location.key !== 'default' && window.history.length > 1) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}

export function BackButton({ fallback = '/', label = 'Tilbake', variant = 'glass', onClick }: { fallback?: string; label?: string; variant?: 'glass' | 'clear' | 'plain'; onClick?: () => void }) {
  const back = useBack(fallback);
  return (
    <button
      type="button"
      onClick={onClick ?? back}
      aria-label={label}
      className={cn(
        'press relative flex h-11 w-11 items-center justify-center rounded-full',
        variant === 'glass' && 'glass text-label',
        variant === 'clear' && 'glass-clear',
        variant === 'plain' && 'text-tint',
      )}
    >
      <ChevronLeft className="-ml-0.5 h-[22px] w-[22px]" strokeWidth={2.5} />
    </button>
  );
}

export interface PageProps {
  title: string;
  /** Large title at the top that collapses into the bar on scroll. */
  large?: boolean;
  back?: string | false;
  actions?: ReactNode;
  children: ReactNode;
  /** Content under the bar (hero images): the bar floats transparently until scrolled. */
  overlay?: boolean;
  overlayThreshold?: number;
  className?: string;
  grouped?: boolean;
  subtitle?: ReactNode;
  largeAccessory?: ReactNode;
  wide?: boolean;
}

/**
 * Standard screen: navigation bar (glass on scroll, scroll-edge fade), optional large title,
 * content column. The document scrolls (keeps mobile browser chrome behaviour natural).
 */
export function Page({ title, large, back, actions, children, overlay, overlayThreshold = 220, className, grouped = true, subtitle, largeAccessory, wide }: PageProps) {
  const y = useScrollY();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [collapseAt, setCollapseAt] = useState(44);
  useEffect(() => {
    if (large && titleRef.current) setCollapseAt(titleRef.current.offsetTop + titleRef.current.offsetHeight - 60);
  }, [large, title]);
  const scrolled = overlay ? y > overlayThreshold : large ? y > collapseAt : y > 4;

  useEffect(() => {
    document.title = title === 'TIKIT' ? 'TIKIT' : `${title} · TIKIT`;
  }, [title]);

  return (
    <div className={cn('min-h-dvh pb-[var(--page-bottom,calc(24px+var(--safe-bottom)))]', grouped ? 'bg-grouped' : 'bg-bg', className)}>
      <header
        className={cn(
          'fixed right-0 top-0 z-40',
          'transition-[background-color,box-shadow,backdrop-filter] duration-200',
          scrolled ? 'glass-bar hairline-b' : 'bg-transparent',
        )}
        style={{ paddingTop: 'var(--safe-top)', left: 'var(--sidebar-w, 0px)' }}
      >
        <div className={cn('mx-auto grid h-[52px] grid-cols-[minmax(44px,1fr)_auto_minmax(44px,1fr)] items-center gap-2 px-3', wide ? 'max-w-6xl' : 'max-w-3xl')}>
          <div className="flex items-center">{back !== false && back !== undefined && <BackButton fallback={back} variant={overlay && !scrolled ? 'clear' : 'glass'} />}</div>
          {large ? (
            <div aria-hidden="true" className={cn('truncate text-center text-headline font-semibold transition-opacity duration-200', scrolled ? 'opacity-100' : 'opacity-0')}>
              {title}
            </div>
          ) : (
            <h1 className={cn('truncate text-center text-headline font-semibold transition-opacity duration-200', scrolled || !overlay ? 'opacity-100' : 'opacity-0')}>{title}</h1>
          )}
          <div className="flex items-center justify-end gap-2">{actions}</div>
        </div>
      </header>
      {!overlay && <div style={{ height: 'calc(52px + var(--safe-top))' }} aria-hidden="true" />}
      <main id="innhold" className={cn('mx-auto w-full', wide ? 'max-w-6xl' : 'max-w-3xl')}>
        {large && (
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2 px-4 pb-3 pt-1">
            <div className="min-w-0">
              <h1 ref={titleRef} className="text-large-title font-bold tracking-[-0.02em] [text-wrap:balance]">
                {title}
              </h1>
              {subtitle && <div className="mt-0.5 text-subhead text-label-2">{subtitle}</div>}
            </div>
            {largeAccessory && <div className="shrink-0">{largeAccessory}</div>}
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
