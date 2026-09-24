import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useDragControls, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false));
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const handler = () => setMatch(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);
  return match;
}

let lockCount = 0;
function lockScroll(): () => void {
  lockCount++;
  const html = document.documentElement;
  if (lockCount === 1) {
    html.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  return () => {
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      html.style.overflow = '';
      document.body.style.overflow = '';
    }
  };
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(open: boolean, ref: React.RefObject<HTMLElement | null>, onEscape: () => void) {
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusFirst = () => {
      const el = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node;
      el?.focus({ preventScroll: true });
    };
    const t = window.setTimeout(focusFirst, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        escapeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, ref]);
}

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  /** Shown left in the header (e.g. Avbryt). */
  leading?: ReactNode;
  /** Shown right in the header (e.g. Ferdig). Replaces the close button. */
  trailing?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Prevent closing by drag/scrim/escape (e.g. while submitting). */
  locked?: boolean;
  size?: 'auto' | 'large';
  className?: string;
  bodyClassName?: string;
  hideClose?: boolean;
  ariaLabel?: string;
}

/**
 * Bottom sheet on phones (grabber, swipe down to dismiss), centred form sheet on larger screens.
 */
export function Sheet({ open, onClose, title, leading, trailing, children, footer, locked, size = 'auto', className, bodyClassName, hideClose, ariaLabel }: SheetProps) {
  const desktop = useMediaQuery('(min-width: 768px)');
  const reduced = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const drag = useDragControls();
  const close = () => {
    if (!locked) onClose();
  };
  useFocusTrap(open, panelRef, close);
  useEffect(() => (open ? lockScroll() : undefined), [open]);

  const mobileMotion = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } };
  const desktopMotion = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, scale: 0.96, y: 12 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.97, y: 8 } };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center md:p-6" role="presentation">
          <motion.div
            className="absolute inset-0"
            style={{ background: 'var(--scrim)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={close}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : ariaLabel}
            tabIndex={-1}
            className={cn(
              'relative flex w-full flex-col overflow-hidden bg-grouped outline-none',
              desktop ? 'max-h-[min(88vh,860px)] max-w-[560px] rounded-[26px] shadow-[var(--lift-shadow)]' : 'rounded-t-[26px]',
              !desktop && (size === 'large' ? 'h-[calc(100dvh-var(--safe-top)-12px)]' : 'max-h-[calc(100dvh-var(--safe-top)-12px)]'),
              className,
            )}
            {...(desktop ? desktopMotion : mobileMotion)}
            transition={reduced ? { duration: 0.15 } : desktop ? { type: 'spring', damping: 30, stiffness: 380 } : { type: 'spring', damping: 34, stiffness: 360 }}
            drag={!desktop && !locked ? 'y' : false}
            dragListener={false}
            dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.9 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 700) close();
            }}
          >
            <div className="shrink-0 touch-none" onPointerDown={(e) => !desktop && drag.start(e)}>
              {!desktop && (
                <div className="flex justify-center pt-2" aria-hidden="true">
                  <span className="h-[5px] w-9 rounded-full bg-label-4" />
                </div>
              )}
              {(title || leading || trailing || !hideClose) && (
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 pb-2 pt-2.5">
                  <div className="flex justify-start">{leading}</div>
                  <h2 id={titleId} className="truncate text-center text-headline font-semibold">
                    {title}
                  </h2>
                  <div className="flex justify-end">
                    {trailing ??
                      (!hideClose && (
                        <button
                          type="button"
                          aria-label="Lukk"
                          onClick={close}
                          disabled={locked}
                          className="press relative flex h-[30px] w-[30px] items-center justify-center rounded-full bg-fill-3 text-label-2 before:absolute before:-inset-[7px] before:content-[''] disabled:opacity-40"
                        >
                          <X className="h-4 w-4" strokeWidth={2.75} />
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
            <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4', bodyClassName)}>{children}</div>
            {footer && <div className="shrink-0 px-4 pb-[calc(16px+var(--safe-bottom))] pt-3 hairline-t bg-grouped">{footer}</div>}
            {!footer && !desktop && <div className="h-[var(--safe-bottom)] shrink-0" />}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
