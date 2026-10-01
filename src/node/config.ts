import { z } from 'zod';

/**
 * Environment configuration for the Node server. Every variable is documented in `.env.example`.
 * In production the server refuses to start with unsafe settings (missing secrets, http URL, …).
 */

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase())));

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : null));

const envSchema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_URL: optional,
  /** Set automatically by Render (https://<service>.onrender.com); used when PUBLIC_URL is empty. */
  RENDER_EXTERNAL_URL: optional,
  SESSION_SECRET: optional,
  DATABASE_URL: optional,
  /** Production refuses to run on the embedded PGlite database unless this is set (data lives on local disk). */
  ALLOW_EMBEDDED_DB: bool(false),
  DATABASE_SSL: z.enum(['', 'require', 'prefer', 'disable']).optional(),
  /** PEM of the database server's CA (Supabase: Database Settings → SSL). Turns on full certificate verification. */
  DATABASE_CA_CERT: optional,
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATA_DIR: z.string().default('./data'),
  DEMO_MODE: optional,
  SEED_DEMO_DATA: bool(false),
  ADMIN_EMAILS: z.string().default(''),
  CRON_SECRET: optional,
  CRON_INTERVAL_SECONDS: z.coerce.number().int().min(0).max(3600).default(30),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  /** Header set by the edge proxy with the real client IP (Render/Cloudflare: cf-connecting-ip). Wins over TRUST_PROXY. */
  CLIENT_IP_HEADER: optional,
  STATIC_DIR: z.string().default('./dist/web'),
  OPERATOR_NAME: optional,
  OPERATOR_ORG_NUMBER: optional,
  SUPPORT_EMAIL: optional,

  VIPPS_ENV: z.enum(['test', 'production']).default('test'),
  VIPPS_CLIENT_ID: optional,
  VIPPS_CLIENT_SECRET: optional,
  VIPPS_SUBSCRIPTION_KEY: optional,
  VIPPS_MSN: optional,
  VIPPS_WEBHOOK_SECRET: optional,
  VIPPS_API_BASE: optional,
  VIPPS_LOGIN_ENABLED: bool(true),
  VIPPS_PAYMENTS_ENABLED: bool(true),
  VIPPS_LOGIN_AUTH_METHOD: z.enum(['client_secret_basic', 'client_secret_post']).default('client_secret_basic'),

  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,

  APPLE_CLIENT_ID: optional,
  APPLE_TEAM_ID: optional,
  APPLE_KEY_ID: optional,
  APPLE_PRIVATE_KEY: optional,

  /** iOS app: bundle IDs (comma separated, e.g. no.tikit.app). Enables universal links and native Sign in with Apple. */
  APPLE_BUNDLE_IDS: z.string().default(''),
  /** URL scheme registered by the iOS app (Info.plist → CFBundleURLSchemes). */
  APP_URL_SCHEME: z
    .string()
    .regex(/^[a-z][a-z0-9+.-]{1,30}$/, 'APP_URL_SCHEME må være små bokstaver, for eksempel tikit')
    .default('tikit'),
  /** Origins of the native app's web view, allowed to call the API with a bearer token (CORS). */
  APP_CORS_ORIGINS: z.string().default('capacitor://localhost'),
  /** App Review access: signing in with this code logs in as this (pre-created) account. Leave empty except during review. */
  REVIEW_LOGIN_EMAIL: optional,
  REVIEW_LOGIN_CODE: optional,

  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,

  /** Apple Wallet: Pass Type ID certificate and its key (PEM, `\n` escapes allowed). The pass type and team come from the certificate. */
  APPLE_WALLET_CERT: optional,
  APPLE_WALLET_KEY: optional,
  APPLE_WALLET_KEY_PASSPHRASE: optional,
  /** Only if Apple moves pass certificates off the WWDR G4 intermediate that is built in. */
  APPLE_WALLET_WWDR_CERT: optional,
  /** Google Wallet: issuer ID from the Google Pay & Wallet Console and the service account's JSON key. */
  GOOGLE_WALLET_ISSUER_ID: optional,
  GOOGLE_WALLET_SERVICE_ACCOUNT: optional,

  RESEND_API_KEY: optional,
  MAIL_FROM: optional,
  MAIL_REPLY_TO: optional,
});

export type Env = z.infer<typeof envSchema>;

export interface NodeConfig {
  env: Env;
  production: boolean;
  publicUrl: string;
  sessionSecret: string;
  demoMode: boolean;
  vipps: { baseUrl: string; issuer: string; clientId: string; clientSecret: string; subscriptionKey: string; msn: string } | null;
  /** The iOS app (see ios/ and docs/ios.md). */
  native: { bundleIds: string[]; appIds: string[]; urlScheme: string; corsOrigins: string[] };
  /** App Review access (docs/app-store/review-notes.md). Null when off. */
  review: { email: string; code: string } | null;
  /** Wallet passes (docs/oppsett.md §9). Null when not set up. */
  wallet: {
    apple: { certificate: string; privateKey: string; passphrase: string | null; wwdr: string | null; teamId: string | null } | null;
    google: { issuerId: string; serviceAccount: string } | null;
  };
  warnings: string[];
}

const list = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

export function loadConfig(source: Record<string, string | undefined> = process.env): NodeConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Ugyldig konfigurasjon:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  const production = env.NODE_ENV === 'production';
  const warnings: string[] = [];
  const errors: string[] = [];

  const publicUrl = (env.PUBLIC_URL ?? env.RENDER_EXTERNAL_URL ?? (production ? '' : `http://localhost:5173`)).replace(/\/+$/, '');
  if (!publicUrl) errors.push('PUBLIC_URL må settes i produksjon (for eksempel https://tikit.no).');
  else {
    try {
      const u = new URL(publicUrl);
      if (production && u.protocol !== 'https:') errors.push('PUBLIC_URL må bruke https:// i produksjon.');
      if (u.pathname !== '/' || u.search || u.hash) errors.push('PUBLIC_URL skal bare være opprinnelsen, uten sti (for eksempel https://tikit.no).');
    } catch {
      errors.push('PUBLIC_URL er ikke en gyldig URL.');
    }
  }

  let sessionSecret = env.SESSION_SECRET ?? '';
  if (sessionSecret.length < 32) {
    // The public development key is only acceptable when NODE_ENV says so explicitly (not "staging", typos, …).
    if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') {
      sessionSecret = 'dev-only-session-secret-change-me-0123456789';
      warnings.push('SESSION_SECRET mangler – bruker en utviklingsnøkkel. Aldri bruk dette i produksjon.');
    } else errors.push('SESSION_SECRET må være minst 32 tegn (lag en med: openssl rand -base64 48).');
  }

  if (production && !env.DATABASE_URL && !env.ALLOW_EMBEDDED_DB) {
    errors.push('DATABASE_URL må settes i produksjon. Uten den havner alle data på serverens lokale disk og forsvinner ved neste utrulling (sett ALLOW_EMBEDDED_DB=true bare for en ren demo).');
  }

  const vippsBase = env.VIPPS_API_BASE ?? (env.VIPPS_ENV === 'production' ? 'https://api.vipps.no' : 'https://apitest.vipps.no');
  const vippsKeys = [env.VIPPS_CLIENT_ID, env.VIPPS_CLIENT_SECRET, env.VIPPS_SUBSCRIPTION_KEY, env.VIPPS_MSN];
  const vipps = vippsKeys.every(Boolean)
    ? {
        baseUrl: vippsBase.replace(/\/+$/, ''),
        issuer: `${vippsBase.replace(/\/+$/, '')}/access-management-1.0/access/`,
        clientId: env.VIPPS_CLIENT_ID!,
        clientSecret: env.VIPPS_CLIENT_SECRET!,
        subscriptionKey: env.VIPPS_SUBSCRIPTION_KEY!,
        msn: env.VIPPS_MSN!,
      }
    : null;
  if (!vipps && vippsKeys.some(Boolean)) warnings.push('Vipps er delvis konfigurert: VIPPS_CLIENT_ID, VIPPS_CLIENT_SECRET, VIPPS_SUBSCRIPTION_KEY og VIPPS_MSN må alle settes.');
  if (production && vipps && env.VIPPS_ENV !== 'production') warnings.push('VIPPS_ENV=test i produksjon – betalinger går mot Vipps sitt testmiljø.');

  const appleKeys = [env.APPLE_CLIENT_ID, env.APPLE_TEAM_ID, env.APPLE_KEY_ID, env.APPLE_PRIVATE_KEY];
  if (appleKeys.some(Boolean) && !appleKeys.every(Boolean)) warnings.push('Sign in with Apple er delvis konfigurert: APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID og APPLE_PRIVATE_KEY må alle settes.');
  if ((env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET) && !(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)) warnings.push('Google er delvis konfigurert: både GOOGLE_CLIENT_ID og GOOGLE_CLIENT_SECRET må settes.');

  // Demo mode: simulated login/payments for providers without keys. Default on in development only.
  const demoMode = env.DEMO_MODE === null ? !production : ['1', 'true', 'yes', 'on'].includes(env.DEMO_MODE.toLowerCase());
  const realProviders = [
    vipps ? 'Vipps' : null,
    env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET ? 'Google' : null,
    appleKeys.some(Boolean) ? 'Apple' : null,
    env.STRIPE_SECRET_KEY ? 'Stripe' : null,
  ].filter((x): x is string => x !== null);
  if (production && demoMode) {
    // Mixing real providers with simulated ones lets anyone "pay" with the fake method and get real tickets.
    if (realProviders.length > 0) errors.push(`DEMO_MODE=true kan ikke kombineres med ekte nøkler i produksjon (${realProviders.join(', ')}). Slå av DEMO_MODE før ekte salg.`);
    else warnings.push('DEMO_MODE er på i produksjon: all innlogging og betaling er simulert. Bare for demo – ingen ekte salg.');
  }

  // Webhooks are the only thing that notices a payment completed after the buyer closed the tab.
  const webhookRequired = production && !demoMode;
  if (vipps && env.VIPPS_PAYMENTS_ENABLED && !env.VIPPS_WEBHOOK_SECRET) {
    const msg = 'VIPPS_WEBHOOK_SECRET mangler – kjør npm run vipps:webhook og legg inn hemmeligheten.';
    if (webhookRequired) errors.push(msg);
    else warnings.push(`${msg} Uten den bekreftes betalinger bare ved retur og polling.`);
  }
  if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) {
    const msg = 'STRIPE_WEBHOOK_SECRET mangler – opprett et webhook-endepunkt i Stripe og legg inn hemmeligheten.';
    if (webhookRequired) errors.push(msg);
    else warnings.push(`${msg} Uten den bekreftes kortbetalinger bare ved retur og polling.`);
  }
  if (production && !demoMode && !vipps && !(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) && !appleKeys.every(Boolean)) {
    errors.push('Ingen innloggingsmetode er satt opp. Legg inn nøkler for Vipps, Google eller Apple (se docs/oppsett.md).');
  }
  if (production && !env.RESEND_API_KEY) {
    // Receipts and transfers to people without an account depend on e-mail.
    if (demoMode) warnings.push('RESEND_API_KEY mangler – e-post blir bare lagt i demo-innboksen.');
    else errors.push('RESEND_API_KEY og MAIL_FROM må settes i produksjon – ellers når verken kvitteringer eller billettoverføringer fram.');
  }
  if (env.RESEND_API_KEY && !env.MAIL_FROM) errors.push('MAIL_FROM må settes når RESEND_API_KEY er satt (for eksempel "TIKIT <billetter@tikit.no>").');
  if (production && !env.OPERATOR_NAME) warnings.push('OPERATOR_NAME mangler – kjøpsvilkår og kvitteringer viser «TIKIT» som selger/formidler.');

  // ── iOS app ──
  const bundleIds = list(env.APPLE_BUNDLE_IDS);
  const badBundle = bundleIds.find((b) => !/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(b));
  if (badBundle) errors.push(`APPLE_BUNDLE_IDS har en ugyldig bundle ID: ${badBundle} (for eksempel no.tikit.app).`);
  if (bundleIds.length > 0 && !env.APPLE_TEAM_ID) warnings.push('APPLE_BUNDLE_IDS er satt, men APPLE_TEAM_ID mangler – universal links til iOS-appen blir ikke publisert.');
  const appIds = env.APPLE_TEAM_ID ? bundleIds.map((b) => `${env.APPLE_TEAM_ID}.${b}`) : [];
  const corsOrigins = list(env.APP_CORS_ORIGINS);
  for (const o of corsOrigins) {
    if (!/^[a-z][a-z0-9+.-]*:\/\/[^/]+$/.test(o)) errors.push(`APP_CORS_ORIGINS: «${o}» er ikke en opprinnelse (for eksempel capacitor://localhost).`);
    else if (production && o.startsWith('http://') && !o.startsWith('http://localhost')) errors.push(`APP_CORS_ORIGINS: «${o}» bruker http i produksjon.`);
  }

  // ── App Review access ──
  let review: NodeConfig['review'] = null;
  if (env.REVIEW_LOGIN_EMAIL || env.REVIEW_LOGIN_CODE) {
    if (!env.REVIEW_LOGIN_EMAIL || !env.REVIEW_LOGIN_CODE) warnings.push('App Review-tilgang er delvis satt opp: både REVIEW_LOGIN_EMAIL og REVIEW_LOGIN_CODE må settes.');
    else if (env.REVIEW_LOGIN_CODE.length < 16) errors.push('REVIEW_LOGIN_CODE må være minst 16 tegn (lag en med: openssl rand -hex 12).');
    else review = { email: env.REVIEW_LOGIN_EMAIL.toLowerCase(), code: env.REVIEW_LOGIN_CODE };
    if (review && production) warnings.push('App Review-tilgang er PÅ. Slå den av (tøm REVIEW_LOGIN_CODE) når Apple er ferdig med gjennomgangen.');
  }

  // ── Wallet passes ──
  const appleWallet =
    env.APPLE_WALLET_CERT && env.APPLE_WALLET_KEY
      ? { certificate: env.APPLE_WALLET_CERT, privateKey: env.APPLE_WALLET_KEY, passphrase: env.APPLE_WALLET_KEY_PASSPHRASE, wwdr: env.APPLE_WALLET_WWDR_CERT, teamId: env.APPLE_TEAM_ID }
      : null;
  if (!appleWallet && (env.APPLE_WALLET_CERT || env.APPLE_WALLET_KEY)) warnings.push('Apple Wallet er delvis konfigurert: både APPLE_WALLET_CERT og APPLE_WALLET_KEY må settes.');
  const googleWallet = env.GOOGLE_WALLET_ISSUER_ID && env.GOOGLE_WALLET_SERVICE_ACCOUNT ? { issuerId: env.GOOGLE_WALLET_ISSUER_ID, serviceAccount: env.GOOGLE_WALLET_SERVICE_ACCOUNT } : null;
  if (!googleWallet && (env.GOOGLE_WALLET_ISSUER_ID || env.GOOGLE_WALLET_SERVICE_ACCOUNT)) warnings.push('Google Wallet er delvis konfigurert: både GOOGLE_WALLET_ISSUER_ID og GOOGLE_WALLET_SERVICE_ACCOUNT må settes.');
  if (googleWallet && !/^\d{10,25}$/.test(googleWallet.issuerId)) errors.push('GOOGLE_WALLET_ISSUER_ID skal bare være tall (Issuer ID fra Google Pay & Wallet Console).');

  if (errors.length > 0) throw new Error(`Konfigurasjonen er ikke klar for oppstart:\n${errors.map((e) => `  • ${e}`).join('\n')}`);
  return {
    env,
    production,
    publicUrl,
    sessionSecret,
    demoMode,
    vipps,
    native: { bundleIds, appIds, urlScheme: env.APP_URL_SCHEME, corsOrigins },
    review,
    wallet: { apple: appleWallet, google: googleWallet },
    warnings,
  };
}
