type HapticKind = 'light' | 'success' | 'warning' | 'error';

let nativeImpl: ((kind: HapticKind) => void) | null = null;

/** The iOS app plugs in the Taptic Engine (src/web/native/device.ts). */
export function setNativeHaptics(fn: (kind: HapticKind) => void): void {
  nativeImpl = fn;
}

/**
 * Light haptic feedback. In the iOS app it uses the Taptic Engine; in browsers Android (Vibration API)
 * vibrates, while iOS Safari has no web haptics API, so there we rely on the visual response alone.
 */
export function haptic(kind: HapticKind = 'light'): void {
  if (nativeImpl) {
    nativeImpl(kind);
    return;
  }
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const pattern = kind === 'success' ? [12, 40, 18] : kind === 'error' ? [40, 60, 40, 60, 40] : kind === 'warning' ? [30, 50, 30] : 8;
    navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}
