/**
 * Offline copies of who is signed in and their tickets, so a ticket opens at the door without coverage.
 * The web app gets this from its service worker (vite.config.ts); the iOS app has none, so the transport
 * keeps the last good answer here. Ticket URLs carry the user id (?u=), so one person's tickets are never
 * served to someone else; everything is wiped at sign-out and sign-in (clearOfflineTicketCache).
 */

const PREFIX = 'tikit-offline:';
const CACHED = /^\/(me|tickets(\/[A-Za-z0-9_-]+)?)(\?|$)/;

export function isOfflineCached(method: string, path: string): boolean {
  return method === 'GET' && CACHED.test(path);
}

export function offlinePut(path: string, body: string): void {
  try {
    localStorage.setItem(PREFIX + path, JSON.stringify({ at: Date.now(), body }));
  } catch {
    /* storage full or unavailable – the app still works online */
  }
}

export function offlineGet(path: string): string | null {
  try {
    const raw = localStorage.getItem(PREFIX + path);
    if (!raw) return null;
    const { at, body } = JSON.parse(raw) as { at: number; body: string };
    // Same lifetime as the service worker cache on the web.
    return Date.now() - at < 14 * 86_400_000 ? body : null;
  } catch {
    return null;
  }
}

export function offlineClear(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
