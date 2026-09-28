import type { MiddlewareHandler } from 'hono';

/**
 * Browser security headers for every response.
 *  - CSP: only our own scripts; inline styles are needed for React style props and the boot screen.
 *  - camera=(self) so the door scanner works; no microphone, location or payment APIs.
 *  - HSTS only when served over https.
 */
export function securityHeaders(opts: { production: boolean; https: boolean }): MiddlewareHandler {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(opts.https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return async (c, next) => {
    await next();
    const h = c.res.headers;
    // Responses can be immutable (e.g. from fetch); only set what's missing.
    const set = (k: string, v: string) => {
      if (!h.has(k)) h.set(k, v);
    };
    try {
      set('Content-Security-Policy', csp);
      set('X-Content-Type-Options', 'nosniff');
      set('X-Frame-Options', 'DENY');
      set('Referrer-Policy', 'strict-origin-when-cross-origin');
      set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
      set('Cross-Origin-Opener-Policy', 'same-origin');
      set('Cross-Origin-Resource-Policy', 'same-origin');
      if (opts.https) set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    } catch {
      /* immutable headers – leave as is */
    }
  };
}
