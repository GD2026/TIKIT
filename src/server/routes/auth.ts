import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { LIMITS } from '../../shared/constants';
import { newToken } from '../../shared/ids';
import type { ProviderId } from '../../shared/types';
import type { ExternalProfile, OAuthTransaction } from '../adapters/types';
import { OAUTH_COOKIE, SESSION_COOKIE, body, limit, requireUser, safeReturnTo, type AppEnv, type Ctx } from '../middleware/core';
import { signToken, verifyToken } from '../services/common';
import { createLinkHandoff, createLoginHandoff, isChallenge } from '../services/nativeAuth';
import { createSession, destroySession, getMe, loginWithProfile } from '../services/users';
import type { Deps } from '../context';

const PROVIDERS: ProviderId[] = ['vipps', 'google', 'apple'];

export function setSessionCookie(c: Ctx, deps: Deps, token: string, maxAgeSeconds = LIMITS.sessionDays * 86400): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: deps.config.cookieSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

function redirectUri(deps: Deps, provider: ProviderId): string {
  return `${deps.config.publicUrl}/api/auth/callback/${provider}`;
}

function loginErrorRedirect(deps: Deps, code: string): string {
  const path = `/logg-inn?feil=${encodeURIComponent(code)}`;
  return deps.config.linkStyle === 'hash' ? `${deps.config.publicUrl}#${path}` : path;
}

/** Demo personas map to seeded accounts (matched on verified e-mail). */
const DEMO_PERSONAS = {
  buyer: { name: 'Emma Hansen', email: 'emma.hansen@example.no', phone: '+4791234567', birthdate: '2007-03-14' },
  organizer: { name: 'Jonas Berg', email: 'jonas.berg@example.no', phone: '+4798765432', birthdate: '2001-08-02' },
  admin: { name: 'Mari Admin', email: 'admin@tikit.example', phone: '+4790000000', birthdate: '1995-01-20' },
} as const;

const demoLoginSchema = z
  .object({
    provider: z.enum(['vipps', 'google', 'apple']),
    persona: z.enum(['buyer', 'organizer', 'admin', 'new']).default('buyer'),
    name: z.string().trim().min(2).max(80).optional(),
  })
  .strict();

export function demoProfile(provider: ProviderId, persona: keyof typeof DEMO_PERSONAS | 'new', name?: string): ExternalProfile {
  if (persona === 'new') {
    const id = newToken(8);
    return {
      provider,
      subject: `demo-new-${id}`,
      email: provider === 'apple' ? `${id.toLowerCase()}@privaterelay.appleid.example` : null,
      emailVerified: provider === 'apple',
      name: name ?? 'Ny bruker',
      phone: provider === 'vipps' ? '+4741234567' : null,
      phoneVerified: provider === 'vipps',
      birthdate: provider === 'vipps' ? '2007-06-01' : null,
      birthdateVerified: provider === 'vipps',
      demo: true,
    };
  }
  const p = DEMO_PERSONAS[persona];
  return {
    provider,
    subject: `demo-${persona}-${provider}`,
    email: p.email,
    emailVerified: true,
    name: p.name,
    phone: provider === 'vipps' ? p.phone : null,
    phoneVerified: provider === 'vipps',
    birthdate: provider === 'vipps' ? p.birthdate : null,
    birthdateVerified: provider === 'vipps',
    demo: true,
  };
}

export function authRoutes(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get('/providers', (c) =>
    c.json(
      PROVIDERS.map((id) => ({ id, enabled: !!deps.oauth[id] || deps.config.demoMode, demo: !deps.oauth[id] && deps.config.demoMode })).filter((p) => p.enabled),
    ),
  );

  app.get('/login/:provider', limit('login', 30, 60_000), async (c) => {
    const provider = c.req.param('provider') as ProviderId;
    if (!PROVIDERS.includes(provider)) throw new AppError('not_found');
    const adapter = deps.oauth[provider];
    if (!adapter) return c.redirect(loginErrorRedirect(deps, 'provider_unavailable'));
    const mode = c.req.query('mode') === 'link' ? 'link' : 'login';
    // Started by the iOS app (see services/nativeAuth.ts). The app has no cookie here: linking proves who it is
    // with a short-lived ticket bound to the same challenge.
    const native = c.req.query('native');
    if (native !== undefined && !isChallenge(native)) throw new AppError('bad_request');
    let linkUserId: string | null = null;
    if (mode === 'link') {
      if (native) {
        const ticket = await verifyToken<{ u: string; c: string }>(deps.config.sessionSecret, 'native-link', c.req.query('linkTicket'), deps.clock().getTime());
        linkUserId = ticket && ticket.c === native ? ticket.u : null;
      } else {
        linkUserId = c.get('user')?.id ?? null;
      }
      if (!linkUserId) return c.redirect(loginErrorRedirect(deps, 'unauthorized'));
    }
    const txn: OAuthTransaction = {
      provider,
      state: newToken(24),
      nonce: newToken(24),
      codeVerifier: adapter.usesPkce ? newToken(48) : null,
      returnTo: safeReturnTo(c.req.query('returnTo'), mode === 'link' ? '/profil/innlogging' : '/'),
      mode,
      linkUserId,
      native: native ?? null,
      createdAt: deps.clock().getTime(),
    };
    let url: string;
    try {
      url = await adapter.createAuthorizationUrl({ redirectUri: redirectUri(deps, provider), state: txn.state, nonce: txn.nonce, codeVerifier: txn.codeVerifier });
    } catch (err) {
      deps.log.error('Kunne ikke starte innlogging', { provider, error: err instanceof Error ? err.message : String(err) });
      return c.redirect(loginErrorRedirect(deps, 'provider_unavailable'));
    }
    const cookie = await signToken(deps.config.sessionSecret, 'oauth', txn as unknown as Record<string, unknown>, deps.clock().getTime() + 10 * 60_000);
    const crossSitePost = adapter.responseMode === 'form_post' && deps.config.cookieSecure;
    setCookie(c, OAUTH_COOKIE, cookie, {
      httpOnly: true,
      secure: deps.config.cookieSecure,
      sameSite: crossSitePost ? 'None' : 'Lax',
      path: '/api/auth',
      maxAge: 600,
    });
    return c.redirect(url);
  });

  const callback = async (c: Ctx) => {
    const provider = c.req.param('provider') as ProviderId;
    const adapter = PROVIDERS.includes(provider) ? deps.oauth[provider] : undefined;
    const raw = getCookie(c, OAUTH_COOKIE);
    deleteCookie(c, OAUTH_COOKIE, { path: '/api/auth', secure: deps.config.cookieSecure });
    const txn = await verifyToken<OAuthTransaction & Record<string, unknown>>(deps.config.sessionSecret, 'oauth', raw, deps.clock().getTime());
    if (!adapter || !txn || txn.provider !== provider) return c.redirect(loginErrorRedirect(deps, 'login_failed'));
    if (txn.native) return nativeCallback(c, adapter, txn, txn.native);
    try {
      const profile = await adapter.finishAuthorization({ request: c.req.raw, redirectUri: redirectUri(deps, provider), txn });
      if (txn.mode === 'link') {
        const sessionUser = c.get('user');
        const linkUserId = txn.linkUserId ?? sessionUser?.id ?? null;
        // No account to link to – or the browser is now signed in as someone else than when linking started.
        if (!linkUserId || (sessionUser && sessionUser.id !== linkUserId)) return c.redirect(loginErrorRedirect(deps, 'unauthorized'), 303);
        await loginWithProfile(deps, profile, { linkToUserId: linkUserId });
      } else {
        const { user } = await loginWithProfile(deps, profile);
        const { token } = await deps.store.tx((tx) => createSession(deps, tx, { userId: user.id, kind: 'user', userAgent: c.req.header('user-agent') ?? null }));
        setSessionCookie(c, deps, token);
      }
      const target = safeReturnTo(txn.returnTo);
      return c.redirect(deps.config.linkStyle === 'hash' ? `${deps.config.publicUrl}#${target}` : target, 303);
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'login_failed';
      deps.log.warn('Innlogging feilet', { provider, error: err instanceof Error ? err.message : String(err) });
      return c.redirect(loginErrorRedirect(deps, code), 303);
    }
  };
  /** The iOS app's login ends here: a one-time code for the app instead of a cookie. */
  const nativeCallback = async (c: Ctx, adapter: NonNullable<Deps['oauth'][ProviderId]>, txn: OAuthTransaction, challenge: string) => {
    const back = (params: Record<string, string>) => `${deps.config.native?.urlScheme ?? 'tikit'}://auth/callback?${new URLSearchParams(params).toString()}`;
    try {
      const profile = await adapter.finishAuthorization({ request: c.req.raw, redirectUri: redirectUri(deps, txn.provider), txn });
      const returnTo = safeReturnTo(txn.returnTo);
      if (txn.mode === 'link') {
        if (!txn.linkUserId) return c.redirect(back({ error: 'unauthorized' }), 303);
        return c.redirect(back({ code: await createLinkHandoff(deps, { linkUserId: txn.linkUserId, profile, challenge, returnTo }) }), 303);
      }
      const { user } = await loginWithProfile(deps, profile);
      return c.redirect(back({ code: await createLoginHandoff(deps, { userId: user.id, challenge, returnTo }) }), 303);
    } catch (err) {
      const code = err instanceof AppError ? err.code : 'login_failed';
      deps.log.warn('Innlogging i appen feilet', { provider: txn.provider, error: err instanceof Error ? err.message : String(err) });
      return c.redirect(back({ error: code }), 303);
    }
  };

  app.get('/callback/:provider', limit('login-cb', 30, 60_000), callback);
  app.post('/callback/:provider', limit('login-cb', 30, 60_000), callback);

  /** Demo login: only when demo mode is on and the provider has no real keys. */
  app.post('/demo', limit('demo-login', 30, 60_000), async (c) => {
    if (!deps.config.demoMode) throw new AppError('not_found');
    const input = await body(c, demoLoginSchema);
    if (deps.oauth[input.provider]) throw new AppError('provider_unavailable', { message: 'Denne innloggingen bruker ekte nøkler og kan ikke simuleres.' });
    const current = c.get('user');
    const mode = c.req.query('mode') === 'link' ? 'link' : 'login';
    if (mode === 'link') {
      const user = requireUser(c);
      const profile = demoProfile(input.provider, 'new', user.name);
      await loginWithProfile(deps, { ...profile, subject: `demo-link-${user.id}-${input.provider}`, email: user.email, emailVerified: false }, { linkToUserId: user.id });
      return c.json({ me: await getMe(deps, user.id) });
    }
    void current;
    // A public demo site must not hand out platform admin to whoever asks for it.
    if (input.persona === 'admin' && deps.config.production) throw new AppError('forbidden');
    const profile = demoProfile(input.provider, input.persona, input.name);
    const { user } = await loginWithProfile(deps, profile);
    const { token } = await deps.store.tx((tx) => createSession(deps, tx, { userId: user.id, kind: 'user', userAgent: c.req.header('user-agent') ?? null }));
    setSessionCookie(c, deps, token);
    return c.json({ token, me: await getMe(deps, user.id) });
  });

  app.post('/logout', async (c) => {
    await destroySession(deps, c.get('token'));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: deps.config.cookieSecure });
    return c.json({ ok: true });
  });

  return app;
}
