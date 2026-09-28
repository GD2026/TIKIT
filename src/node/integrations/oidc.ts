import * as oidc from 'openid-client';

/** Helpers shared by the OpenID Connect logins (Vipps, Google, Apple). */

export function toE164(phone: unknown): string | null {
  if (typeof phone !== 'string' || !phone.trim()) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  // Vipps returns numbers with country code and no plus, e.g. "4712345678".
  if (digits.length === 10 && digits.startsWith('47')) return `+${digits}`;
  if (digits.length === 8) return `+47${digits}`;
  return `+${digits}`;
}

export function bool(v: unknown): boolean {
  return v === true || v === 'true';
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function isoDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Behind a TLS-terminating proxy the request URL can say http:// or an internal host, so the
 * callback URL is rebuilt from the public redirect URI and the query the provider sent.
 */
export function callbackUrl(request: Request, redirectUri: string): URL {
  const url = new URL(redirectUri);
  url.search = new URL(request.url).search;
  return url;
}

export function withHeaders(config: oidc.Configuration, extra: Record<string, string>): void {
  config[oidc.customFetch] = (url, options) => {
    const headers = new Headers(options.headers as ConstructorParameters<typeof Headers>[0]);
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    return fetch(url, { ...options, headers } as RequestInit);
  };
}
