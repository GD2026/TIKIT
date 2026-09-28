import type { Venue } from '../../shared/types';
import type { Api } from '../api/client';
import { toIcsUtc } from '../../shared/time';
import { isDemoBuild, isIOS } from './device';

/** In the iOS app the page origin is capacitor://localhost; shared links must point at the website. */
let publicOrigin: string | null = null;
export function setPublicOrigin(origin: string): void {
  publicOrigin = origin.replace(/\/+$/, '') || null;
}

/** Absolute URL of an in-app route, for sharing and copying (hash style in the single-file demo). */
export function appUrl(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (isDemoBuild) return `${window.location.href.split('#')[0]}#${clean}`;
  return `${publicOrigin ?? window.location.origin}${clean}`;
}

/** href for a plain <a> pointing at an in-app route. Prefer <Link> inside React Router. */
export function routeHref(path: string): string {
  return isDemoBuild ? `#${path}` : path;
}

/** Opens the venue in Apple Maps on Apple devices and Google Maps elsewhere. */
export function mapsUrl(venue: Venue): string {
  const q = [venue.name, venue.address, [venue.postalCode, venue.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return isIOS() ? `https://maps.apple.com/?q=${encodeURIComponent(q)}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function googleCalendarUrl(e: { title: string; startsAt: string; endsAt: string; venue: Venue; details?: string }): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${toIcsUtc(e.startsAt)}/${toIcsUtc(e.endsAt)}`,
    location: [e.venue.name, e.venue.address, e.venue.city].filter(Boolean).join(', '),
    details: e.details ?? '',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Follows a URL from the server (payment redirect, return link). Links back into this app are routed
 * in-app; anything else (Vipps, Stripe) is a full navigation.
 */
export function followUrl(url: string, navigate: (to: string, opts?: { replace?: boolean }) => void, replace = false): void {
  const base = window.location.href.split('#')[0]!.replace(/\/$/, '');
  const hashAt = url.indexOf('#/');
  if (hashAt >= 0 && url.slice(0, hashAt).replace(/\/$/, '') === base) {
    navigate(url.slice(hashAt + 1), { replace });
    return;
  }
  try {
    const u = new URL(url, window.location.href);
    const ours = u.origin === window.location.origin || (!!publicOrigin && u.origin === publicOrigin);
    if (!isDemoBuild && ours && !u.pathname.startsWith('/api/')) {
      // /app/… is where payment providers return buyers of the iOS app; in the app it's the same route.
      navigate(`${u.pathname.replace(/^\/app(?=\/)/, '')}${u.search}`, { replace });
      return;
    }
  } catch {
    /* fall through */
  }
  window.location.assign(url);
}

/** True when a URL leaves TIKIT (payment providers, other sites). */
export function isExternalUrl(url: string): boolean {
  try {
    const u = new URL(url, window.location.href);
    return u.origin !== window.location.origin && u.origin !== publicOrigin;
  } catch {
    return false;
  }
}

/** Direct API resource (downloads). Only meaningful against the real server. */
export function apiUrl(path: string): string {
  return `/api${path}`;
}

/** Downloads are refused inside the single-file demo's sandbox, so file actions are hidden there. */
export const canDownload = !isDemoBuild;

type FileSaver = (filename: string, text: string) => Promise<void>;
let nativeSaver: FileSaver | null = null;

/** The iOS app saves files through the share sheet (src/web/native/device.ts). */
export function setNativeFileSaver(fn: FileSaver): void {
  nativeSaver = fn;
}

/** True in the iOS app, where file links must be fetched with the session token (downloadApiFile). */
export function filesViaApp(): boolean {
  return nativeSaver !== null;
}

/** Saves text as a file: a normal download in the browser, the share sheet in the iOS app. */
export async function saveTextFile(filename: string, text: string, mime: string): Promise<void> {
  if (nativeSaver) return nativeSaver(filename, text);
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** An API file (calendar entry, CSV). The browser follows the link with its cookie; the app fetches it with its token. */
export async function downloadApiFile(api: Api, path: string, filename: string): Promise<void> {
  if (!nativeSaver) {
    window.location.assign(apiUrl(path));
    return;
  }
  const res = await api.raw(path);
  if (!res.ok) throw new Error('Filen kunne ikke hentes. Prøv igjen.');
  await nativeSaver(filename, await res.text());
}
