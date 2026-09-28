import type { Context, MiddlewareHandler } from 'hono';

/**
 * Everything the web server does for the iOS app (see docs/ios.md):
 *
 *  - /.well-known/apple-app-site-association: which paths open the app (universal links).
 *  - /app/*: where Vipps/Stripe send the buyer back after paying in the app. With universal links iOS opens
 *    the app before this page loads; if it doesn't (in Safari or an in-app browser), this page offers a button.
 *  - CORS for the app's web view (capacitor://localhost), which calls the API with a bearer token.
 */

export interface AppLinkConfig {
  /** `<TEAM_ID>.<bundle id>` for each iOS app. */
  appIds: string[];
  urlScheme: string;
  corsOrigins: string[];
}

/** Paths that open in the app when the app is installed. Everything else stays on the web. */
const APP_PATHS = ['/app/*', '/e/*', '/a/*', '/overfor/*', '/billetter', '/billetter/*'];

export function appleAppSiteAssociation(cfg: AppLinkConfig) {
  return {
    applinks: {
      details: [{ appIDs: cfg.appIds, components: APP_PATHS.map((p) => ({ '/': p })) }],
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

/** Small static page (no scripts – the CSP forbids inline ones) that sends the person back into the app. */
export function appReturnPage(c: Context, cfg: AppLinkConfig): Response {
  const url = new URL(c.req.url);
  const inner = url.pathname.replace(/^\/app/, '') || '/';
  // Only the in-app routes the payment flow uses; anything else goes to the front page.
  const safe = /^\/(ordre|kasse)\/[A-Za-z0-9_-]{1,64}$/.test(inner) ? `${inner}${url.search}` : '/';
  const appLink = `${cfg.urlScheme}://open${safe}`;
  const html = `<!doctype html>
<html lang="nb">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex" />
<title>Tilbake til TIKIT</title>
<style>
  :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
  main { max-width: 360px; padding: 32px 24px; text-align: center; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  p { font-size: 16px; line-height: 1.45; opacity: .75; margin: 0 0 24px; }
  a.btn { display: block; padding: 15px 20px; border-radius: 14px; background: #3b4cf2; color: #fff; font-weight: 600; text-decoration: none; }
  a.web { display: inline-block; margin-top: 16px; color: inherit; opacity: .7; font-size: 15px; }
</style>
</head>
<body>
<main>
  <h1>Nesten ferdig</h1>
  <p>Betalingen er sendt. Gå tilbake til TIKIT-appen for å se billettene dine.</p>
  <a class="btn" href="${escapeHtml(appLink)}">Åpne TIKIT</a>
  <a class="web" href="${escapeHtml(safe)}">Fortsett på nettsiden i stedet</a>
</main>
</body>
</html>`;
  return c.html(html, 200, { 'Cache-Control': 'no-store' });
}

/** CORS for the app's web view. No cookies are involved (Allow-Credentials is never sent). */
export function nativeCors(origins: string[]): MiddlewareHandler {
  const allowed = new Set(origins);
  return async (c, next) => {
    const origin = c.req.header('origin');
    if (!origin || !allowed.has(origin)) return next();
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, X-Tikit',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Expose-Headers': 'X-Request-Id, Retry-After',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
    if (c.req.method === 'OPTIONS') return c.body(null, 204, headers);
    await next();
    for (const [k, v] of Object.entries(headers)) {
      try {
        c.res.headers.set(k, v);
      } catch {
        /* immutable response – leave as is */
      }
    }
  };
}
