import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CircleAlert, CircleCheck, Info } from 'lucide-react';
import { cn } from '../../lib/cn';
import { haptic } from '../../lib/haptics';
import { useFocusTrap } from './Sheet';

// ── Confirm (iOS-style alert) ─────────────────────────────────────────────────

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Optional text input (e.g. a reason). The promise resolves to the text. */
  input?: { label: string; placeholder?: string; minLength?: number };
}

type ConfirmResult = boolean | string;
type ConfirmFn = (opts: ConfirmOptions) => Promise<ConfirmResult>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('ConfirmProvider mangler');
  return fn;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: ConfirmResult) => void }) | null>(null);
  const confirm = useCallback<ConfirmFn>((opts) => new Promise((resolve) => setState({ ...opts, resolve })), []);
  const close = (value: ConfirmResult) => {
    state?.resolve(value);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog state={state} onClose={close} />
    </ConfirmContext.Provider>
  );
}

function AlertDialog({ state, onClose }: { state: (ConfirmOptions & { resolve: (v: ConfirmResult) => void }) | null; onClose: (v: ConfirmResult) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [text, setText] = useState('');
  const reduced = useReducedMotion();
  useEffect(() => {
    if (state) setText('');
  }, [state]);
  useFocusTrap(!!state, ref, () => onClose(false));
  const minLength = state?.input?.minLength ?? 0;
  const canConfirm = !state?.input || text.trim().length >= minLength;
  return createPortal(
    <AnimatePresence>
      {state && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-6">
          <motion.div className="absolute inset-0" style={{ background: 'var(--scrim)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            ref={ref}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.08 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', damping: 28, stiffness: 420 }}
            className="glass relative w-full max-w-[300px] overflow-hidden rounded-[22px] text-center outline-none"
            style={{ background: 'var(--glass-bg-strong)' }}
          >
            <div className="px-5 pb-4 pt-5">
              <h2 id={titleId} className="text-headline font-semibold">
                {state.title}
              </h2>
              {state.message && <div className="mt-1.5 text-footnote text-label-2">{state.message}</div>}
              {state.input && (
                <label className="mt-3 block text-left">
                  <span className="sr-only">{state.input.label}</span>
                  <textarea
                    data-autofocus
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={state.input.placeholder ?? state.input.label}
                    rows={3}
                    className="w-full resize-none rounded-[10px] bg-fill-3 px-3 py-2 text-subhead outline-none focus:shadow-[0_0_0_2px_var(--tint)]"
                  />
                </label>
              )}
            </div>
            <div className="grid grid-cols-2 hairline-t">
              <button type="button" onClick={() => onClose(false)} className="h-12 text-headline text-tint hairline-b [box-shadow:inset_-0.5px_0_0_var(--separator)] active:bg-fill-4">
                {state.cancelLabel ?? 'Avbryt'}
              </button>
              <button
                type="button"
                data-autofocus={state.input ? undefined : true}
                disabled={!canConfirm}
                onClick={() => {
                  haptic(state.destructive ? 'warning' : 'light');
                  onClose(state.input ? text.trim() : true);
                }}
                className={cn('h-12 text-headline font-semibold active:bg-fill-4 disabled:opacity-40', state.destructive ? 'text-red' : 'text-tint')}
              >
                {state.confirmLabel ?? 'OK'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

// ── Toasts (HUD capsule) ──────────────────────────────────────────────────────

export interface ToastInput {
  message: string;
  tone?: 'success' | 'error' | 'info';
  icon?: ReactNode;
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);

export function useToast(): (t: ToastInput) => void {
  const fn = useContext(ToastContext);
  if (!fn) throw new Error('ToastProvider mangler');
  return fn;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);
  const show = useCallback((t: ToastInput) => {
    const id = ++counter.current;
    if (t.tone === 'success') haptic('success');
    if (t.tone === 'error') haptic('error');
    setItems((prev) => [...prev.slice(-2), { ...t, id }]);
    window.setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== id)), t.duration ?? (t.tone === 'error' ? 5000 : 3000));
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {createPortal(
        <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-x-0 top-[calc(var(--safe-top)+10px)] z-[90] flex flex-col items-center gap-2 px-4">
          <AnimatePresence>
            {items.map((t) => (
              <motion.div
                key={t.id}
                data-toast
                role={t.tone === 'error' ? 'alert' : 'status'}
                initial={{ opacity: 0, y: -16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.98 }}
                transition={{ type: 'spring', damping: 26, stiffness: 380 }}
                className="glass pointer-events-auto flex max-w-[92vw] items-center gap-2.5 rounded-full py-2.5 pl-3.5 pr-5 text-subhead font-semibold"
                style={{ background: 'var(--glass-bg-strong)' }}
              >
                <span className={cn('shrink-0 [&_svg]:h-5 [&_svg]:w-5', t.tone === 'error' ? 'text-red' : t.tone === 'success' ? 'text-green' : 'text-tint')}>
                  {t.icon ?? (t.tone === 'error' ? <CircleAlert /> : t.tone === 'success' ? <CircleCheck /> : <Info />)}
                </span>
                <span>{t.message}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
