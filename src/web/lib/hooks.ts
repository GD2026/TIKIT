import { useEffect, useRef, useState } from 'react';
import { useConfig } from '../api/hooks';
import { safeStorage } from './storage';

/** Re-renders on an interval and returns the current time. */
export function useNow(intervalMs = 1000, enabled = true): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}

/** Milliseconds left until `target` (never negative), ticking every second. */
export function useCountdown(target: string | null | undefined): number {
  const now = useNow(1000, !!target);
  if (!target) return 0;
  return Math.max(0, new Date(target).getTime() - now.getTime());
}

export function useDebounced<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Keeps the screen awake while `active` (door scanning, showing a ticket). Silently ignored when refused. */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    const request = async () => {
      try {
        const s = await navigator.wakeLock.request('screen');
        if (disposed) void s.release().catch(() => {});
        else sentinel = s;
      } catch {
        /* not allowed (battery saver, frame policy) */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !disposed) void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}

const OFFSET_KEY = 'tikit-clock-offset';

/**
 * Difference between the server clock and this device (ms). Live ticket codes are computed with it,
 * so a phone with a wrong clock still shows a code the door accepts. Remembered for offline use.
 */
export function useClockOffset(): number {
  const config = useConfig();
  const [offset, setOffset] = useState(() => {
    const saved = safeStorage.getJSON<{ offset: number; at: number } | null>(OFFSET_KEY, null);
    return saved && Date.now() - saved.at < 7 * 86400000 ? saved.offset : 0;
  });
  useEffect(() => {
    if (!config.data || config.isFetching || !config.dataUpdatedAt) return;
    const measured = Date.parse(config.data.serverTime) - config.dataUpdatedAt;
    if (!Number.isFinite(measured)) return;
    // Ignore network latency noise; only correct clocks that are clearly off.
    const next = Math.abs(measured) < 2500 ? 0 : measured;
    setOffset(next);
    safeStorage.setJSON(OFFSET_KEY, { offset: next, at: Date.now() });
  }, [config.data, config.isFetching, config.dataUpdatedAt]);
  return offset;
}

/** True once the element has been scrolled into view (used for lazy work, not for hiding content). */
export function useInView<T extends Element>(rootMargin = '200px'): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setInView(true);
        io.disconnect();
      }
    }, { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin, inView]);
  return [ref, inView];
}

/** Sets the document title for full-screen routes that do not use <Page>. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title === 'TIKIT' ? 'TIKIT' : `${title} · TIKIT`;
  }, [title]);
}
