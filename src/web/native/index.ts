import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import type { Transport } from '../api/client';
import { setNativeHaptics } from '../lib/haptics';
import { setNativeShare } from '../lib/share';
import { setNativeFileSaver, setPublicOrigin } from '../lib/links';
import { setNativeWalletAdder } from '../lib/wallet';
import { routeForUrl } from './deepLinks';
import { API_ORIGIN } from './config';
import { nativeAddWalletPass, nativeHaptic, nativeSaveText, nativeShare } from './device';
import { loadSession } from './session';
import { createNativeTransport } from './transport';

/**
 * Start-up for the iOS app (Capacitor). Loaded only by the `native` build – see main.tsx.
 * Everything iOS-specific lives in this folder; the screens are the same as on the web.
 */

export async function prepareNative(): Promise<Transport> {
  await loadSession();
  setNativeHaptics(nativeHaptic);
  setNativeShare(nativeShare);
  setNativeFileSaver(nativeSaveText);
  setNativeWalletAdder(nativeAddWalletPass);
  // Links people share (events, transfers) point at the website, not at capacitor://localhost.
  setPublicOrigin(API_ORIGIN);
  return createNativeTransport();
}

export function startNative(router: { navigate: (to: string) => unknown }): void {
  // Universal links (https://tikit.no/e/…, /app/ordre/… after paying) and tikit://open/… links.
  void App.addListener('appUrlOpen', ({ url }) => {
    const to = routeForUrl(url);
    if (!to) return;
    void Browser.close().catch(() => {});
    void router.navigate(to);
  });

  // Status bar text follows light/dark mode, like the rest of the app.
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const applyStatusBar = () => void StatusBar.setStyle({ style: dark.matches ? Style.Dark : Style.Light }).catch(() => {});
  applyStatusBar();
  dark.addEventListener('change', applyStatusBar);

  // The launch screen stays until the first screen has rendered.
  window.requestAnimationFrame(() => void SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {}));
}
