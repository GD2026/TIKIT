import * as oidc from 'openid-client';
import { SignJWT, importPKCS8 } from 'jose';
import type { ExternalProfile, OAuthAdapter } from '../server/adapters/types';
import type { Logger } from '../server/adapters/types';
import { VIPPS_SYSTEM_HEADERS } from './vippsCommon';

/**
 * Real identity providers, all OpenID Connect via openid-client:
 *  - Vipps Login: verified name, phone, e-mail and birth date (from the National Population Register)
 *  - Google: e-mail + name from the ID token
 *  - Sign in with Apple: form_post callback, name only on the very first login, ES256 client secret
 */

function toE164(phone: unknown): string | null {
  if (typeof phone !== 'string' || !phone.trim()) return null;
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  // Vipps returns numbers with country code and no plus, e.g. "4712345678".
  if (digits.length === 10 && digits.startsWith('47')) return `+${digits}`;
  if (digits.length === 8) return `+47${digits}`;
  return `+${digits}`;
}

function bool(v: unknown): boolean {
  return v === true || v === 'true';
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function isoDate(v: unknown): string | null {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/**
 * Behind a TLS-terminating proxy the request URL can say http:// or an internal host, so the
 * callback URL is rebuilt from the public redirect URI and the query the provider sent.
 */
function callbackUrl(request: Request, redirectUri: string): URL {
  const url = new URL(redirectUri);
  url.search = new URL(request.url).search;
  return url;
}

function withHeaders(config: oidc.Configuration, extra: Record<string, string>): void {
  config[oidc.customFetch] = (url, options) => {
    const headers = new Headers(options.headers as ConstructorParameters<typeof Headers>[0]);
    for (const [k, v] of Object.entries(extra)) headers.set(k, v);
    return fetch(url, { ...options, headers } as RequestInit);
  };
}

// ── Vipps ────────────────────────────────────────────────────────────────────

export interface VippsLoginConfig {
  clientId: string;
  clientSecret: string;
  /** e.g. https://api.vipps.no/access-management-1.0/access/ (test: https://apitest.vipps.no/...) */
  issuer: string;
  merchantSerialNumber: string | null;
  /** 'client_secret_basic' is Vipps' default; switchable to post in the business portal. */
  authMethod: 'client_secret_basic' | 'client_secret_post';
}

export async function createVippsLogin(cfg: VippsLoginConfig): Promise<OAuthAdapter> {
  const auth = cfg.authMethod === 'client_secret_post' ? oidc.ClientSecretPost(cfg.clientSecret) : oidc.ClientSecretBasic(cfg.clientSecret);
  const config = await oidc.discovery(new URL(cfg.issuer), cfg.clientId, undefined, auth);
  withHeaders(config, { ...VIPPS_SYSTEM_HEADERS, ...(cfg.merchantSerialNumber ? { 'Merchant-Serial-Number': cfg.merchantSerialNumber } : {}) });
  const usesPkce = config.serverMetadata().supportsPKCE();
  return {
    provider: 'vipps',
    responseMode: 'query',
    usesPkce,
    async createAuthorizationUrl({ redirectUri, state, nonce, codeVerifier }) {
      const params: Record<string, string> = {
        redirect_uri: redirectUri,
        scope: 'openid name email phoneNumber birthDate',
        response_type: 'code',
        state,
        nonce,
      };
      if (usesPkce && codeVerifier) {
        params.code_challenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
        params.code_challenge_method = 'S256';
      }
      return oidc.buildAuthorizationUrl(config, params).href;
    },
    async finishAuthorization({ request, redirectUri, txn }) {
      const tokens = await oidc.authorizationCodeGrant(
        config,
        callbackUrl(request, redirectUri),
        {
          expectedState: txn.state,
          expectedNonce: txn.nonce,
          pkceCodeVerifier: usesPkce && txn.codeVerifier ? txn.codeVerifier : undefined,
          idTokenExpected: true,
        },
        { redirect_uri: redirectUri },
      );
      const claims = tokens.claims();
      if (!claims?.sub) throw new Error('Vipps svarte uten brukeridentitet');
      const info = await oidc.fetchUserInfo(config, tokens.access_token, claims.sub);
      const name = str(info.name) ?? ([str(info.given_name), str(info.family_name)].filter(Boolean).join(' ') || null);
      return {
        provider: 'vipps',
        subject: claims.sub,
        email: str(info.email)?.toLowerCase() ?? null,
        emailVerified: bool(info.email_verified),
        name,
        phone: toE164(info.phone_number),
        phoneVerified: info.phone_number ? info.phone_number_verified === undefined || bool(info.phone_number_verified) : false,
        // Name and birth date come from the National Population Register (Folkeregisteret).
        birthdate: isoDate(info.birthdate),
        birthdateVerified: !!isoDate(info.birthdate),
        demo: false,
      } satisfies ExternalProfile;
    },
  };
}

// ── Google ───────────────────────────────────────────────────────────────────

export async function createGoogleLogin(cfg: { clientId: string; clientSecret: string }): Promise<OAuthAdapter> {
  const config = await oidc.discovery(new URL('https://accounts.google.com'), cfg.clientId, undefined, oidc.ClientSecretPost(cfg.clientSecret));
  return {
    provider: 'google',
    responseMode: 'query',
    usesPkce: true,
    async createAuthorizationUrl({ redirectUri, state, nonce, codeVerifier }) {
      return oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        response_type: 'code',
        state,
        nonce,
        prompt: 'select_account',
        code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier!),
        code_challenge_method: 'S256',
      }).href;
    },
    async finishAuthorization({ request, redirectUri, txn }) {
      const tokens = await oidc.authorizationCodeGrant(
        config,
        callbackUrl(request, redirectUri),
        {
          expectedState: txn.state,
          expectedNonce: txn.nonce,
          pkceCodeVerifier: txn.codeVerifier ?? undefined,
          idTokenExpected: true,
        },
        { redirect_uri: redirectUri },
      );
      const c = tokens.claims();
      if (!c?.sub) throw new Error('Google svarte uten brukeridentitet');
      return {
        provider: 'google',
        subject: c.sub,
        email: str(c.email)?.toLowerCase() ?? null,
        emailVerified: bool(c.email_verified),
        name: str(c.name),
        phone: null,
        phoneVerified: false,
        birthdate: null,
        birthdateVerified: false,
        demo: false,
      } satisfies ExternalProfile;
    },
  };
}

// ── Sign in with Apple ───────────────────────────────────────────────────────

export interface AppleLoginConfig {
  /** The Services ID (e.g. no.tikit.web), not the App ID. */
  clientId: string;
  teamId: string;
  keyId: string;
  /** Contents of the AuthKey_XXXX.p8 file (PEM, PKCS#8). */
  privateKey: string;
}

export async function createAppleLogin(cfg: AppleLoginConfig, log: Logger): Promise<OAuthAdapter> {
  const key = await importPKCS8(cfg.privateKey.replace(/\\n/g, '\n'), 'ES256');
  let secret = '';
  let secretExpires = 0;
  const refreshSecret = async () => {
    const now = Math.floor(Date.now() / 1000);
    if (secret && now < secretExpires - 3600) return;
    // Apple accepts client secrets valid for up to six months; we use 30 days and renew early.
    secretExpires = now + 30 * 86400;
    secret = await new SignJWT({})
      .setProtectedHeader({ alg: 'ES256', kid: cfg.keyId })
      .setIssuer(cfg.teamId)
      .setIssuedAt(now)
      .setExpirationTime(secretExpires)
      .setAudience('https://appleid.apple.com')
      .setSubject(cfg.clientId)
      .sign(key);
  };
  await refreshSecret();
  // Apple only supports client_secret_post; the secret is read at request time so it can rotate.
  const auth: oidc.ClientAuth = (_as, client, body) => {
    body.set('client_id', client.client_id);
    body.set('client_secret', secret);
  };
  const config = await oidc.discovery(new URL('https://appleid.apple.com'), cfg.clientId, undefined, auth);
  return {
    provider: 'apple',
    responseMode: 'form_post',
    usesPkce: false,
    async createAuthorizationUrl({ redirectUri, state, nonce }) {
      return oidc.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid name email',
        response_type: 'code',
        // Required by Apple whenever name or email is requested.
        response_mode: 'form_post',
        state,
        nonce,
      }).href;
    },
    async finishAuthorization({ request, redirectUri, txn }) {
      await refreshSecret();
      // The user's name is only sent once, as a JSON form field on the very first authorization.
      let firstName: string | null = null;
      let lastName: string | null = null;
      // Behind a TLS-terminating proxy request.url is http://…; openid-client derives redirect_uri from the URL
      // it is given, so rebuild it from the public redirect URI plus the fields Apple posted.
      const url = new URL(redirectUri);
      try {
        const form = await request.clone().formData();
        for (const [k, v] of form) if (k !== 'user' && typeof v === 'string') url.searchParams.set(k, v);
        const user = form.get('user');
        if (typeof user === 'string') {
          const parsed = JSON.parse(user) as { name?: { firstName?: string; lastName?: string } };
          firstName = str(parsed.name?.firstName);
          lastName = str(parsed.name?.lastName);
        }
      } catch (err) {
        log.warn('Kunne ikke lese navn fra Apple', { error: String(err) });
      }
      const tokens = await oidc.authorizationCodeGrant(
        config,
        url,
        { expectedState: txn.state, expectedNonce: txn.nonce, idTokenExpected: true },
        { redirect_uri: redirectUri },
      );
      const c = tokens.claims();
      if (!c?.sub) throw new Error('Apple svarte uten brukeridentitet');
      const name = [firstName, lastName].filter(Boolean).join(' ') || null;
      return {
        provider: 'apple',
        subject: c.sub,
        email: str(c.email)?.toLowerCase() ?? null,
        emailVerified: bool(c.email_verified),
        name,
        phone: null,
        phoneVerified: false,
        birthdate: null,
        birthdateVerified: false,
        demo: false,
      } satisfies ExternalProfile;
    },
  };
}
