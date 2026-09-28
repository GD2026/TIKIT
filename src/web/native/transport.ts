import type { Transport } from '../api/client';
import { API_ORIGIN } from './config';
import { isOfflineCached, offlineClear, offlineGet, offlinePut } from './offline';
import { currentToken, saveSession } from './session';

/** Responses that start a session hand the app its token (demo login, App Review code, door scanner code, app logins). */
const SESSION_STARTS = /^\/(auth\/(demo|review|native\/exchange|native\/apple)|scanner\/login)(\?|$)/;

/** API calls from the iOS app: absolute URLs, bearer token, no cookies. */
export function createNativeTransport(): Transport {
  return {
    kind: 'http',
    async request(path, init) {
      const headers = new Headers(init.headers);
      const token = currentToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const method = (init.method ?? 'GET').toUpperCase();
      const cacheable = isOfflineCached(method, path);
      let res: Response;
      try {
        res = await fetch(`${API_ORIGIN}/api${path}`, { ...init, headers, credentials: 'omit' });
      } catch (err) {
        // No network: tickets and the signed-in person come from the offline copy (offline.ts).
        const cached = cacheable ? offlineGet(path) : null;
        if (cached !== null) return new Response(cached, { status: 200, headers: { 'Content-Type': 'application/json', 'X-Tikit-Offline': '1' } });
        throw err;
      }
      if (cacheable && res.ok) offlinePut(path, await res.clone().text());
      if (res.ok && SESSION_STARTS.test(path)) {
        const data = (await res
          .clone()
          .json()
          .catch(() => null)) as { token?: unknown } | null;
        if (typeof data?.token === 'string') {
          offlineClear();
          await saveSession(data.token);
        }
      }
      if (res.ok && (path === '/auth/logout' || path === '/scanner/logout' || (path === '/me' && method === 'DELETE'))) {
        offlineClear();
        await saveSession(null);
      }
      return res;
    },
    setToken(t) {
      void saveSession(t);
    },
    // Event images and other /api resources live on the server, not in the app bundle.
    async resolveUrl(url) {
      return url.startsWith('/') ? `${API_ORIGIN}${url}` : url;
    },
  };
}
