/**
 * Light haptic feedback. Android (Vibration API) vibrates; iOS Safari has no web haptics API,
 * so there we rely on the visual response alone.
 */
export function haptic(kind: 'light' | 'success' | 'warning' | 'error' = 'light'): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const pattern = kind === 'success' ? [12, 40, 18] : kind === 'error' ? [40, 60, 40, 60, 40] : kind === 'warning' ? [30, 50, 30] : 8;
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
