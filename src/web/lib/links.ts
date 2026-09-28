import type { Venue } from '../../shared/types';
import { toIcsUtc } from '../../shared/time';
import { isDemoBuild, isIOS } from './device';

/** Absolute URL of an in-app route, for sharing and copying (hash style in the single-file demo). */
export function appUrl(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  if (isDemoBuild) return `${window.location.href.split('#')[0]}#${clean}`;
  return `${window.location.origin}${clean}`;
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
    if (!isDemoBuild && u.origin === window.location.origin && !u.pathname.startsWith('/api/')) {
      navigate(`${u.pathname}${u.search}`, { replace });
      return;
    }
  } catch {
    /* fall through */
  }
  window.location.assign(url);
}

/** Direct API resource (downloads). Only meaningful against the real server. */
export function apiUrl(path: string): string {
  return `/api${path}`;
}

/** Downloads are refused inside the single-file demo's sandbox, so file actions are hidden there. */
export const canDownload = !isDemoBuild;
