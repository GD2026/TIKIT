import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { IncomingMessage } from 'node:http';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from '../server/app';
import type { Deps, ServerConfig } from '../server/context';
import type { Logger, Mailer, OAuthAdapter, PaymentAdapter } from '../server/adapters/types';
import { createDemoPaymentAdapter, createOutboxMailer } from '../server/adapters/demo';
import type { PaymentMethodId, ProviderId } from '../shared/types';
import { isSeeded, seedDemoData } from '../server/seed';
import { runCron } from '../server/services/misc';
import { formatDateLong, formatTime } from '../shared/time';
import type { NodeConfig } from './config';
import { SqlStore, createPgliteDriver, createPostgresDriver, migrate, type SqlDriver } from './sqlStore';
import { createAppleLogin, createGoogleLogin, createVippsLogin } from './oauth';
import { createStripePayments, createVippsPayments } from './payments';
import { createResendMailer } from './mailer';
import { securityHeaders } from './security';

export interface TikitServer {
  app: Hono;
  deps: Deps;
  driver: SqlDriver;
  startCron(): void;
  /** Stops scheduling background jobs and waits for a running one to finish. */
  stopCron(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Identity providers are discovered lazily: a provider that is unreachable at start-up is retried on
 * the next login instead of being switched off until a restart.
 */
function lazyOAuth(provider: ProviderId, responseMode: 'query' | 'form_post', factory: () => Promise<OAuthAdapter>, log: Logger): OAuthAdapter {
  let inner: Promise<OAuthAdapter> | null = null;
  const get = () => {
    if (!inner) {
      inner = factory().catch((err: unknown) => {
        inner = null;
        log.error(`Innlogging med ${provider} er ikke tilgjengelig`, { error: String(err) });
        throw err;
      });
    }
    return inner;
  };
  void get().catch(() => {});
  return {
    provider,
    responseMode,
    // A verifier is always created; adapters for providers without PKCE simply ignore it.
    usesPkce: true,
    createAuthorizationUrl: async (args) => (await get()).createAuthorizationUrl(args),
    finishAuthorization: async (args) => (await get()).finishAuthorization(args),
  };
}

/**
 * Client IP for rate limiting.
 *  - CLIENT_IP_HEADER (e.g. cf-connecting-ip on Render) names a header the edge proxy always overwrites – used first.
 *  - With TRUST_PROXY=n the n-th address from the right of X-Forwarded-For is used.
 */
function clientIpResolver(trustProxy: number, header: string | null): Deps['clientIp'] {
  return (req, raw) => {
    if (header) {
      const value = req.headers.get(header)?.split(',')[0]?.trim();
      if (value) return value;
    }
    if (trustProxy > 0) {
      const xff = req.headers.get('x-forwarded-for');
      if (xff) {
        const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
        const ip = parts[Math.max(0, parts.length - trustProxy)];
        if (ip) return ip;
      }
    }
    const incoming = (raw as { incoming?: IncomingMessage } | undefined)?.incoming;
    return incoming?.socket?.remoteAddress ?? 'unknown';
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function setMeta(html: string, property: string, content: string, attr: 'property' | 'name' = 'property'): string {
  const tag = `<meta ${attr}="${property}" content="${escapeHtml(content)}" />`;
  const re = new RegExp(`<meta ${attr}="${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}" content="[^"]*"\\s*/?>`);
  // Replacer functions: organizer text may contain `$&`, `$'` … which string replacements would expand.
  return re.test(html) ? html.replace(re, () => tag) : html.replace('</head>', () => `    ${tag}\n  </head>`);
}

export async function createTikitServer(cfg: NodeConfig, log: Logger): Promise<TikitServer> {
  const env = cfg.env;

  // ── Database ────────────────────────────────────────────────────────────
  let driver: SqlDriver;
  if (env.DATABASE_URL) {
    const ssl = env.DATABASE_SSL === 'require' ? 'require' : env.DATABASE_SSL === 'prefer' ? 'prefer' : env.DATABASE_SSL === 'disable' ? false : undefined;
    driver = await createPostgresDriver(env.DATABASE_URL, { max: env.DATABASE_POOL_MAX, ssl });
    log.info('Database: Postgres');
  } else {
    if (cfg.production) log.warn('DATABASE_URL mangler – bruker innebygd PGlite. Greit for testing, men bruk Postgres i drift.');
    const dir = path.resolve(env.DATA_DIR, 'pglite');
    mkdirSync(dir, { recursive: true });
    driver = await createPgliteDriver(dir);
    log.info(`Database: PGlite (${dir})`);
  }
  await migrate(driver);
  const store = new SqlStore(driver, { onError: (err) => log.error('Feil etter commit', { error: String(err) }) });

  const config: ServerConfig = {
    publicUrl: cfg.publicUrl,
    demoMode: cfg.demoMode,
    production: cfg.production,
    sessionSecret: cfg.sessionSecret,
    cookieSecure: cfg.publicUrl.startsWith('https://'),
    adminEmails: env.ADMIN_EMAILS.split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    cronSecret: env.CRON_SECRET,
    linkStyle: 'path',
    operatorName: env.OPERATOR_NAME ?? 'TIKIT',
    operatorOrgNumber: env.OPERATOR_ORG_NUMBER,
    supportEmail: env.SUPPORT_EMAIL,
  };

  // ── Identity providers ──────────────────────────────────────────────────
  const oauth: Partial<Record<ProviderId, OAuthAdapter>> = {};
  if (cfg.vipps && env.VIPPS_LOGIN_ENABLED) {
    const v = cfg.vipps;
    oauth.vipps = lazyOAuth(
      'vipps',
      'query',
      () => createVippsLogin({ clientId: v.clientId, clientSecret: v.clientSecret, issuer: v.issuer, merchantSerialNumber: v.msn, authMethod: env.VIPPS_LOGIN_AUTH_METHOD }),
      log,
    );
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    const g = { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
    oauth.google = lazyOAuth('google', 'query', () => createGoogleLogin(g), log);
  }
  if (env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY) {
    const a = { clientId: env.APPLE_CLIENT_ID, teamId: env.APPLE_TEAM_ID, keyId: env.APPLE_KEY_ID, privateKey: env.APPLE_PRIVATE_KEY };
    oauth.apple = lazyOAuth('apple', 'form_post', () => createAppleLogin(a, log), log);
  }

  // ── Payments ────────────────────────────────────────────────────────────
  const payments: Partial<Record<PaymentMethodId, PaymentAdapter>> = {};
  if (cfg.vipps && env.VIPPS_PAYMENTS_ENABLED) {
    const v = cfg.vipps;
    payments.vipps = createVippsPayments(
      { baseUrl: v.baseUrl, clientId: v.clientId, clientSecret: v.clientSecret, subscriptionKey: v.subscriptionKey, merchantSerialNumber: v.msn, webhookSecret: env.VIPPS_WEBHOOK_SECRET, publicUrl: cfg.publicUrl },
      log,
    );
  }
  if (env.STRIPE_SECRET_KEY) payments.card = createStripePayments({ secretKey: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET }, log);
  if (cfg.demoMode) {
    if (!payments.vipps) payments.vipps = createDemoPaymentAdapter('vipps', store, config);
    if (!payments.card) payments.card = createDemoPaymentAdapter('card', store, config);
  }

  // ── E-mail ──────────────────────────────────────────────────────────────
  const mailer: Mailer = env.RESEND_API_KEY
    ? createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM!, replyTo: env.MAIL_REPLY_TO ?? env.SUPPORT_EMAIL }, log)
    : createOutboxMailer(store, (m) => log.info(m));

  const deps: Deps = {
    store,
    config,
    clock: () => new Date(),
    oauth,
    payments,
    mailer,
    log,
    wallet: null,
    clientIp: clientIpResolver(env.TRUST_PROXY, env.CLIENT_IP_HEADER?.toLowerCase() ?? null),
  };

  if (cfg.demoMode && env.SEED_DEMO_DATA && !(await isSeeded(deps))) {
    log.info('Legger inn demodata …');
    await seedDemoData(deps);
  }

  // ── HTTP ────────────────────────────────────────────────────────────────
  const staticRoot = path.resolve(env.STATIC_DIR);
  let indexHtml: string | null = null;
  const loadIndex = async () => {
    if (indexHtml === null || !cfg.production) {
      try {
        indexHtml = await readFile(path.join(staticRoot, 'index.html'), 'utf8');
      } catch {
        indexHtml = '';
      }
    }
    return indexHtml;
  };

  const renderIndex = async (c: Context): Promise<Response> => {
    let html = await loadIndex();
    if (!html) return c.text('Webappen er ikke bygget. Kjør npm run build.', 503);
    const m = /^\/e\/([a-z0-9-]{1,80})\/?$/.exec(c.req.path);
    if (m) {
      try {
        const event = await store.read((tx) => tx.findOne('events', { slug: m[1]! }));
        if (event && (event.status === 'published' || event.status === 'cancelled')) {
          const when = `${formatDateLong(event.startsAt)} kl. ${formatTime(event.startsAt)}`;
          const desc = `${when} · ${event.venue.name}, ${event.city}${event.status === 'cancelled' ? ' · AVLYST' : ''}`;
          const url = `${cfg.publicUrl}/e/${event.slug}`;
          const title = `<title>${escapeHtml(event.title)} · TIKIT</title>`;
          html = html.replace(/<title>[^<]*<\/title>/, () => title);
          html = setMeta(html, 'description', desc, 'name');
          html = setMeta(html, 'og:title', event.title);
          html = setMeta(html, 'og:description', desc);
          html = setMeta(html, 'og:url', url);
          html = setMeta(html, 'og:image', event.coverImageId ? `${cfg.publicUrl}/api/images/${event.coverImageId}` : `${cfg.publicUrl}/og.png`);
          html = setMeta(html, 'twitter:card', 'summary_large_image', 'name');
          if (event.visibility === 'unlisted') html = setMeta(html, 'robots', 'noindex', 'name');
        }
      } catch (err) {
        log.warn('Kunne ikke lage forhåndsvisning', { path: c.req.path, error: String(err) });
      }
    }
    return c.html(html, 200, { 'Cache-Control': 'no-cache' });
  };

  const api = createApp(deps);
  const app = new Hono();
  app.use('*', securityHeaders({ production: cfg.production, https: config.cookieSecure }));
  app.get('/healthz', async (c) => {
    try {
      await driver.query('SELECT 1');
      return c.json({ ok: true });
    } catch {
      return c.json({ ok: false }, 503);
    }
  });
  // Bodies are capped before anything buffers them (webhooks are small; image uploads are the largest JSON bodies).
  const tooLarge = (c: Context) => c.json({ error: { code: 'bad_request', message: 'Forespørselen er for stor.' } }, 413);
  app.use('/api/webhooks/*', bodyLimit({ maxSize: 256 * 1024, onError: tooLarge }));
  app.use('/api/*', bodyLimit({ maxSize: 4 * 1024 * 1024, onError: tooLarge }));
  app.route('/', api);
  app.all('/api/*', (c) => c.json({ error: { code: 'not_found', message: 'Fant ikke det du lette etter.' } }, 404));
  // Source maps are built for error tracking, not for the public.
  app.get('*', async (c, next) => (c.req.path.endsWith('.map') ? c.text('Fant ikke siden.', 404) : next()));

  // SPA routes (anything without a file extension) get index.html.
  app.get('*', async (c, next) => {
    if (/\.[a-z0-9]{1,8}$/i.test(c.req.path)) return next();
    return renderIndex(c);
  });
  app.use(
    '*',
    serveStatic({
      root: path.relative(process.cwd(), staticRoot) || '.',
      onFound: (p, c) => {
        const file = p.replace(/\\/g, '/');
        if (file.includes('/assets/')) c.header('Cache-Control', 'public, max-age=31536000, immutable');
        else if (/(sw\.js|registerSW\.js|workbox-[^/]+\.js|manifest\.webmanifest)$/.test(file)) c.header('Cache-Control', 'no-cache');
        else c.header('Cache-Control', 'public, max-age=86400');
      },
    }),
  );
  app.notFound((c) => c.text('Fant ikke siden.', 404));
  app.onError((err, c) => {
    log.error('Uventet feil', { path: c.req.path, error: err instanceof Error ? (err.stack ?? err.message) : String(err) });
    return c.text('Noe gikk galt.', 500);
  });

  // ── Background jobs ─────────────────────────────────────────────────────
  let timer: ReturnType<typeof setInterval> | null = null;
  let running: Promise<void> | null = null;
  const instance = Math.random().toString(36).slice(2, 10);
  const tick = async () => {
    // Only one instance runs the jobs at a time (lease in the database).
    const leased = await store
      .tx(async (tx) => {
        const now = Date.now();
        const lease = await tx.get('kv', 'cron-lease', { forUpdate: true });
        const held = lease?.value as { until: number; holder: string } | undefined;
        if (held && held.until > now && held.holder !== instance) return false;
        await tx.put('kv', { id: 'cron-lease', value: { until: now + Math.max(20, env.CRON_INTERVAL_SECONDS) * 2000, holder: instance }, updatedAt: new Date(now).toISOString() });
        return true;
      })
      .catch(() => false);
    if (leased) await runCron(deps);
  };
  const runTick = () => {
    if (running) return; // never overlap two runs on one instance
    running = tick()
      .catch((err: unknown) => log.error('Bakgrunnsjobb feilet', { error: String(err) }))
      .finally(() => {
        running = null;
      });
  };

  return {
    app,
    deps,
    driver,
    startCron() {
      if (env.CRON_INTERVAL_SECONDS <= 0 || timer) return;
      timer = setInterval(runTick, env.CRON_INTERVAL_SECONDS * 1000);
      timer.unref?.();
      runTick();
    },
    async stopCron() {
      if (timer) clearInterval(timer);
      timer = null;
      if (running) await running;
    },
    async close() {
      if (timer) clearInterval(timer);
      timer = null;
      if (running) await running;
      await store.close();
    },
  };
}
