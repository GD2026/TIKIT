import { API_ORIGIN, URL_SCHEME } from './config';

/**
 * Where a link that opened the app should lead, or null to ignore it:
 *   https://tikit.no/e/russetreff        (universal link)           → /e/russetreff
 *   https://tikit.no/app/ordre/abc?retur=1 (back from Vipps/Stripe)  → /ordre/abc?retur=1
 *   tikit://open/ordre/abc?retur=1       (the "Åpne TIKIT" button)  → /ordre/abc?retur=1
 * Login callbacks (tikit://auth/…) are caught by ASWebAuthenticationSession and never arrive here.
 */
export function routeForUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  let path: string;
  if (url.protocol === `${URL_SCHEME}:`) {
    if (url.host !== 'open') return null;
    path = url.pathname || '/';
  } else if (API_ORIGIN && url.origin === API_ORIGIN) {
    path = url.pathname.replace(/^\/app(?=\/|$)/, '') || '/';
  } else {
    return null;
  }
  // Vipps' app-to-app login returns here while the login sheet is still open – nothing to do.
  if (path === '/vipps-login' || path.startsWith('/api/')) return null;
  return `${path}${url.search}`;
}
