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

  STRIPE_SECRET_KEY: optional,
  STRIPE_WEBHOOK_SECRET: optional,

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
  warnings: string[];
}

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

  if (errors.length > 0) throw new Error(`Konfigurasjonen er ikke klar for oppstart:\n${errors.map((e) => `  • ${e}`).join('\n')}`);
  return { env, production, publicUrl, sessionSecret, demoMode, vipps, warnings };
}
