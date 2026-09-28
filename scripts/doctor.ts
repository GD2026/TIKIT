/**
 * npm run doctor            – what is connected, what is missing, and which URLs to register where
 * npm run doctor -- --online – also tries every key against the real service (database, Vipps, Google,
 *                             Apple, Stripe, Resend). Nothing is changed anywhere.
 *
 * Reads .env like the server does. Never prints secrets.
 */
import { existsSync } from 'node:fs';
import { loadConfig, type NodeConfig } from '../src/node/config';
import { databaseSetup } from '../src/node/db/connection';

const online = process.argv.includes('--online');
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const OK = '\x1b[32m✓\x1b[0m';
const WARN = '\x1b[33m!\x1b[0m';
const OFF = '\x1b[2m○\x1b[0m';
const BAD = '\x1b[31m✗\x1b[0m';

type Row = { mark: string; name: string; detail: string; todo?: string[] };
const rows: Row[] = [];
const add = (mark: string, name: string, detail: string, todo: string[] = []) => rows.push({ mark, name, detail, todo });

async function probe(name: string, fn: () => Promise<string>): Promise<void> {
  try {
    const msg = await Promise.race([fn(), new Promise<string>((_, reject) => setTimeout(() => reject(new Error('tidsavbrudd etter 10 s')), 10_000))]);
    console.log(`  ${OK} ${name}: ${msg}`);
  } catch (err) {
    console.log(`  ${BAD} ${name}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function report(cfg: NodeConfig): void {
  const e = cfg.env;
  const url = cfg.publicUrl;
  const has = (...keys: (string | null | undefined)[]) => keys.every(Boolean);
  const some = (...keys: (string | null | undefined)[]) => keys.some(Boolean);

  // ── Drift ──
  add(cfg.production ? OK : OFF, 'Miljø', `${cfg.production ? 'produksjon' : e.NODE_ENV} · ${url}${cfg.demoMode ? ' · DEMOMODUS (simulert innlogging og betaling)' : ''}`);

  // ── Database ──
  if (e.DATABASE_URL) {
    const db = databaseSetup(e.DATABASE_URL, e);
    add(db.warnings.length ? WARN : OK, 'Database', db.description, db.warnings);
  } else {
    add(cfg.production ? BAD : OFF, 'Database', `innebygd PGlite i ${e.DATA_DIR} (bare for utvikling)`, ['Supabase: Project → Connect → «Session pooler» → kopier URI-en til DATABASE_URL (se docs/oppsett.md §1)']);
  }

  // ── Innlogging ──
  const vippsKeys = [e.VIPPS_CLIENT_ID, e.VIPPS_CLIENT_SECRET, e.VIPPS_SUBSCRIPTION_KEY, e.VIPPS_MSN];
  if (cfg.vipps) {
    add(OK, 'Vipps', `${e.VIPPS_ENV} · innlogging ${e.VIPPS_LOGIN_ENABLED ? 'på' : 'av'} · betaling ${e.VIPPS_PAYMENTS_ENABLED ? 'på' : 'av'}`, [
      `Redirect URI i Vipps-portalen: ${url}/api/auth/callback/vipps`,
      ...(e.VIPPS_PAYMENTS_ENABLED && !e.VIPPS_WEBHOOK_SECRET ? ['Kjør npm run vipps:webhook og legg inn VIPPS_WEBHOOK_SECRET'] : []),
    ]);
  } else {
    add(some(...vippsKeys) ? WARN : OFF, 'Vipps', some(...vippsKeys) ? 'delvis satt opp' : 'ikke satt opp', ['VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET, VIPPS_SUBSCRIPTION_KEY, VIPPS_MSN (portal.vippsmobilepay.com)']);
  }

  if (has(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET)) add(OK, 'Google', 'klar', [`Authorized redirect URI: ${url}/api/auth/callback/google`]);
  else add(some(e.GOOGLE_CLIENT_ID, e.GOOGLE_CLIENT_SECRET) ? WARN : OFF, 'Google', 'ikke satt opp', ['GOOGLE_CLIENT_ID og GOOGLE_CLIENT_SECRET (console.cloud.google.com)']);

  const appleWeb = has(e.APPLE_CLIENT_ID, e.APPLE_TEAM_ID, e.APPLE_KEY_ID, e.APPLE_PRIVATE_KEY);
  if (appleWeb) add(OK, 'Apple (nett)', `Services ID ${e.APPLE_CLIENT_ID}`, [`Return URL på Services ID: ${url}/api/auth/callback/apple`, `Domene: ${new URL(url).host}`]);
  else add(some(e.APPLE_CLIENT_ID, e.APPLE_TEAM_ID, e.APPLE_KEY_ID, e.APPLE_PRIVATE_KEY) ? WARN : OFF, 'Apple (nett)', 'ikke satt opp', ['APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (developer.apple.com)']);

  // ── iOS-appen ──
  if (cfg.native.bundleIds.length && cfg.native.appIds.length) {
    add(has(e.APPLE_KEY_ID, e.APPLE_PRIVATE_KEY) ? OK : WARN, 'iOS-app', `${cfg.native.appIds.join(', ')} · skjema ${cfg.native.urlScheme}://`, [
      `Universal links publiseres på ${url}/.well-known/apple-app-site-association`,
      'Associated Domains i Xcode: applinks:' + new URL(url).host,
      ...(has(e.APPLE_KEY_ID, e.APPLE_PRIVATE_KEY) ? [] : ['APPLE_KEY_ID og APPLE_PRIVATE_KEY trengs for innebygd «Logg på med Apple»']),
    ]);
  } else {
    add(OFF, 'iOS-app', 'ikke koblet til', ['APPLE_BUNDLE_IDS=no.tikit.app og APPLE_TEAM_ID (se docs/ios.md)']);
  }

  // ── Betaling ──
  if (e.STRIPE_SECRET_KEY) {
    const live = e.STRIPE_SECRET_KEY.startsWith('sk_live_');
    add(e.STRIPE_WEBHOOK_SECRET ? OK : WARN, 'Stripe (kort)', live ? 'live-nøkkel' : 'testnøkkel', [
      `Webhook: ${url}/api/webhooks/stripe (checkout.session.completed, .async_payment_succeeded, .async_payment_failed, .expired)`,
      ...(e.STRIPE_WEBHOOK_SECRET ? [] : ['STRIPE_WEBHOOK_SECRET mangler']),
    ]);
  } else add(OFF, 'Stripe (kort)', 'ikke satt opp (valgfritt)', ['STRIPE_SECRET_KEY og STRIPE_WEBHOOK_SECRET (dashboard.stripe.com)']);

  // ── E-post ──
  if (e.RESEND_API_KEY) add(e.MAIL_FROM ? OK : BAD, 'E-post (Resend)', e.MAIL_FROM ?? 'MAIL_FROM mangler');
  else add(cfg.production ? BAD : OFF, 'E-post (Resend)', 'ikke satt opp – e-post havner i demo-innboksen', ['RESEND_API_KEY og MAIL_FROM (resend.com, verifisert domene)']);

  // ── Selskap og admin ──
  add(has(e.OPERATOR_NAME, e.OPERATOR_ORG_NUMBER, e.SUPPORT_EMAIL) ? OK : WARN, 'Selskap', [e.OPERATOR_NAME, e.OPERATOR_ORG_NUMBER, e.SUPPORT_EMAIL].filter(Boolean).join(' · ') || 'mangler', [
    ...(e.SUPPORT_EMAIL ? [] : ['SUPPORT_EMAIL – vises i appen og får rapporter om innhold (App Store 1.2)']),
  ]);
  add(e.ADMIN_EMAILS ? OK : WARN, 'Administratorer', e.ADMIN_EMAILS || 'ingen', e.ADMIN_EMAILS ? [] : ['ADMIN_EMAILS=deg@firma.no']);
  add(cfg.review ? WARN : OFF, 'App Review-tilgang', cfg.review ? `PÅ for ${cfg.review.email}` : 'av', cfg.review ? ['Slå av etter at Apple har godkjent appen'] : []);
}

async function probes(cfg: NodeConfig): Promise<void> {
  const e = cfg.env;
  console.log(bold('\nTester nøklene mot tjenestene …'));
  if (e.DATABASE_URL) {
    await probe('Database', async () => {
      const { createPostgresDriver } = await import('../src/node/db/sqlStore');
      const driver = await createPostgresDriver(e.DATABASE_URL!, { ...databaseSetup(e.DATABASE_URL!, e).options, max: 1 });
      try {
        const r = await driver.query('SHOW server_version');
        return `Postgres ${String(r.rows[0]?.server_version ?? '?')}`;
      } finally {
        await driver.close();
      }
    });
  }
  if (cfg.vipps) {
    await probe('Vipps', async () => {
      const { createVippsTokenSource } = await import('../src/node/integrations/vipps/common');
      await createVippsTokenSource({ baseUrl: cfg.vipps!.baseUrl, clientId: cfg.vipps!.clientId, clientSecret: cfg.vipps!.clientSecret, subscriptionKey: cfg.vipps!.subscriptionKey, merchantSerialNumber: cfg.vipps!.msn })();
      return `tilgangsnøkkel hentet (${e.VIPPS_ENV})`;
    });
  }
  if (e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET) {
    await probe('Google', async () => {
      const { createGoogleLogin } = await import('../src/node/integrations/google/login');
      await createGoogleLogin({ clientId: e.GOOGLE_CLIENT_ID!, clientSecret: e.GOOGLE_CLIENT_SECRET! });
      return 'OpenID-oppsett hentet (klient-ID-en sjekkes først ved innlogging)';
    });
  }
  if (e.APPLE_TEAM_ID && e.APPLE_KEY_ID && e.APPLE_PRIVATE_KEY) {
    await probe('Apple-nøkkel', async () => {
      const { createAppleClientSecret } = await import('../src/node/integrations/apple/clientSecret');
      await createAppleClientSecret({ teamId: e.APPLE_TEAM_ID!, keyId: e.APPLE_KEY_ID!, privateKey: e.APPLE_PRIVATE_KEY! }, e.APPLE_CLIENT_ID ?? cfg.native.bundleIds[0] ?? 'test')();
      return '.p8-nøkkelen kan signere';
    });
  }
  if (e.STRIPE_SECRET_KEY) {
    await probe('Stripe', async () => {
      const res = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${e.STRIPE_SECRET_KEY}` } });
      if (!res.ok) throw new Error(`svarte ${res.status}`);
      return 'nøkkelen virker';
    });
  }
  if (e.RESEND_API_KEY) {
    await probe('Resend', async () => {
      const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${e.RESEND_API_KEY}` } });
      if (!res.ok) throw new Error(`svarte ${res.status}`);
      const data = (await res.json()) as { data?: { name: string; status: string }[] };
      const from = /@([^>\s]+)/.exec(e.MAIL_FROM ?? '')?.[1];
      const domain = data.data?.find((d) => d.name === from);
      if (from && !domain) throw new Error(`domenet ${from} i MAIL_FROM finnes ikke i Resend`);
      if (domain && domain.status !== 'verified') throw new Error(`domenet ${from} er ${domain.status}, ikke verified`);
      return from ? `${from} er verifisert` : 'nøkkelen virker';
    });
  }
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  console.log(bold('TIKIT – oppsettsjekk'));
  let cfg: NodeConfig;
  try {
    cfg = loadConfig();
  } catch (err) {
    console.log(`\n${BAD} ${err instanceof Error ? err.message : String(err)}\n`);
    console.log(dim('Rett feilene over i .env (eller hos Render) og kjør npm run doctor igjen. Alle variabler: .env.example'));
    process.exitCode = 1;
    return;
  }
  report(cfg);
  console.log('');
  const width = Math.max(...rows.map((r) => r.name.length));
  for (const r of rows) {
    console.log(`${r.mark} ${r.name.padEnd(width)}  ${r.detail}`);
    for (const t of r.todo ?? []) console.log(`  ${' '.repeat(width)}  ${dim('→ ' + t)}`);
  }
  if (cfg.warnings.length) {
    console.log(bold('\nAdvarsler fra serveren:'));
    for (const w of cfg.warnings) console.log(`${WARN} ${w}`);
  }
  if (online) await probes(cfg);
  else console.log(dim('\nKjør npm run doctor -- --online for å teste nøklene mot tjenestene.'));
  console.log(dim('Veiledning: docs/oppsett.md · iOS: docs/ios.md · App Store: docs/app-store/README.md'));
}

void main();
