import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { sha256Hex, timingSafeEqual } from '../../shared/encoding';
import { newToken } from '../../shared/ids';
import { body, limit, requireUser, type AppEnv, type Ctx } from '../middleware/core';
import { signToken, verifyToken } from '../services/common';
import { isChallenge, redeemHandoff } from '../services/nativeAuth';
import { createSession, findOrCreateReviewUser, getMe, loginWithProfile } from '../services/users';
import type { Deps } from '../context';
import { setSessionCookie } from './auth';

/**
 * Sign-in for the iOS app (mounted under /api/auth). The app authenticates with a bearer token kept in the
 * Keychain; these endpoints are the only ones that hand one out:
 *
 *   POST /native/exchange      code + verifier from a browser login (Vipps, Google, Apple web) → session token
 *   POST /native/link-ticket   (signed in) a short-lived ticket to link another login method from the app
 *   POST /native/apple/nonce   nonce for the native Sign in with Apple button
 *   POST /native/apple         Apple identity token → session token
 *   POST /review               App Review access code → session (only while REVIEW_LOGIN_CODE is set)
 */

const exchangeSchema = z
  .object({
    code: z.string().min(20).max(200),
    verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  })
  .strict();

const appleSchema = z
  .object({
    nonce: z.string().min(10).max(500),
    identityToken: z.string().min(20).max(5000),
    authorizationCode: z.string().max(500).nullable().optional(),
    givenName: z.string().trim().max(60).nullable().optional(),
    familyName: z.string().trim().max(60).nullable().optional(),
    mode: z.enum(['login', 'link']).default('login'),
  })
  .strict();

export function nativeAuthRoutes(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  const newUserSession = async (c: Ctx, userId: string) => {
    const { token } = await deps.store.tx((tx) => createSession(deps, tx, { userId, kind: 'user', userAgent: c.req.header('user-agent') ?? null }));
    return token;
  };

  app.post('/native/exchange', limit('native-exchange', 30, 60_000), async (c) => {
    const { code, verifier } = await body(c, exchangeSchema);
    const handoff = await redeemHandoff(deps, code, verifier);
    if (handoff.kind === 'link') {
      const user = requireUser(c);
      if (user.id !== handoff.linkUserId || !handoff.openedProfile) throw new AppError('unauthorized');
      await loginWithProfile(deps, handoff.openedProfile, { linkToUserId: user.id });
      return c.json({ linked: true, me: await getMe(deps, user.id), returnTo: handoff.returnTo });
    }
    const token = await newUserSession(c, handoff.userId);
    return c.json({ token, me: await getMe(deps, handoff.userId), returnTo: handoff.returnTo });
  });

  app.post('/native/link-ticket', limit('native-link', 20, 60_000), async (c) => {
    const user = requireUser(c);
    const { challenge } = await body(c, z.object({ challenge: z.string() }).strict());
    if (!isChallenge(challenge)) throw new AppError('bad_request');
    const ticket = await signToken(deps.config.sessionSecret, 'native-link', { u: user.id, c: challenge }, deps.clock().getTime() + 5 * 60_000);
    return c.json({ ticket });
  });

  app.post('/native/apple/nonce', limit('apple-nonce', 30, 60_000), async (c) => {
    if (!deps.appleNative?.nativeSignIn) throw new AppError('provider_unavailable');
    const nonce = await signToken(deps.config.sessionSecret, 'apple-nonce', { r: newToken(16) }, deps.clock().getTime() + 10 * 60_000);
    return c.json({ nonce });
  });

  app.post('/native/apple', limit('login', 30, 60_000), async (c) => {
    const input = await body(c, appleSchema);
    const apple = deps.appleNative;
    if (!apple?.nativeSignIn) throw new AppError('provider_unavailable');
    if (!(await verifyToken(deps.config.sessionSecret, 'apple-nonce', input.nonce, deps.clock().getTime()))) throw new AppError('login_failed');
    let profile;
    try {
      profile = await apple.verify({
        identityToken: input.identityToken,
        authorizationCode: input.authorizationCode ?? null,
        expectedNonceHash: await sha256Hex(input.nonce),
        givenName: input.givenName ?? null,
        familyName: input.familyName ?? null,
      });
    } catch (err) {
      deps.log.warn('Sign in with Apple i appen feilet', { error: err instanceof Error ? err.message : String(err) });
      throw new AppError('login_failed');
    }
    if (input.mode === 'link') {
      const user = requireUser(c);
      await loginWithProfile(deps, profile, { linkToUserId: user.id });
      return c.json({ linked: true, me: await getMe(deps, user.id) });
    }
    const { user } = await loginWithProfile(deps, profile);
    const token = await newUserSession(c, user.id);
    return c.json({ token, me: await getMe(deps, user.id) });
  });

  /**
   * App Review access. Apple's reviewers need a working account; TIKIT has no passwords, so while
   * REVIEW_LOGIN_EMAIL/REVIEW_LOGIN_CODE are set, this code signs in as that one (non-admin) account.
   * Turn it off after review. Strictly rate limited and written to the audit log.
   */
  app.post('/review', limit('review-login', 5, 10 * 60_000), async (c) => {
    const review = deps.config.review;
    if (!review) throw new AppError('not_found');
    const { code } = await body(c, z.object({ code: z.string().max(200) }).strict());
    if (!timingSafeEqual(review.code, code.trim())) {
      deps.log.warn('Feil App Review-kode');
      throw new AppError('login_failed', { message: 'Koden er ikke riktig.' });
    }
    const user = await findOrCreateReviewUser(deps, review.email);
    const token = await newUserSession(c, user.id);
    setSessionCookie(c, deps, token);
    return c.json({ token, me: await getMe(deps, user.id) });
  });

  return app;
}
