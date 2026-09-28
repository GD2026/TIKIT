import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppleNativeAdapter, AppleNativeInput, ExternalProfile, Logger } from '../../../server/adapters/types';
import { bool, str } from '../oidc';
import { createAppleClientSecret, type AppleKeyConfig } from './clientSecret';

/**
 * Sign in with Apple from the iOS app's native button (AuthenticationServices).
 *
 * The app sends Apple's identity token (a JWT for the app's bundle ID), the one-time authorization code
 * and – on the very first sign-in only – the person's name. The token is verified against Apple's keys;
 * its nonce must be the SHA-256 of a nonce this server issued, so a token can't be replayed.
 * The authorization code is exchanged for a refresh token, which is what Apple wants revoked when the
 * account is deleted (App Store Review Guideline 5.1.1(v)).
 */

const APPLE_ISSUER = 'https://appleid.apple.com';
const jwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export interface AppleNativeConfig extends AppleKeyConfig {
  /** Bundle IDs of the iOS apps allowed to sign in (e.g. no.tikit.app). */
  bundleIds: string[];
}

export function createAppleNative(cfg: AppleNativeConfig, log: Logger, fetchImpl: typeof fetch = fetch): AppleNativeAdapter {
  const secrets = new Map<string, () => Promise<string>>();
  const secretFor = (clientId: string) => {
    let s = secrets.get(clientId);
    if (!s) {
      s = createAppleClientSecret(cfg, clientId);
      secrets.set(clientId, s);
    }
    return s();
  };

  const post = async (path: string, form: Record<string, string>) =>
    fetchImpl(`${APPLE_ISSUER}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(10_000),
    });

  return {
    nativeSignIn: cfg.bundleIds.length > 0,
    async verify(input: AppleNativeInput) {
      if (cfg.bundleIds.length === 0) throw new Error('APPLE_BUNDLE_IDS mangler');
      const { payload } = await jwtVerify(input.identityToken, jwks, { issuer: APPLE_ISSUER, audience: cfg.bundleIds });
      if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('Apple-token uten brukeridentitet');
      if (payload.nonce !== input.expectedNonceHash) throw new Error('Apple-token har feil nonce');
      const clientId = String(payload.aud);

      let revocation: ExternalProfile['revocation'] = null;
      if (input.authorizationCode) {
        try {
          const res = await post('/auth/token', {
            client_id: clientId,
            client_secret: await secretFor(clientId),
            code: input.authorizationCode,
            grant_type: 'authorization_code',
          });
          if (res.ok) {
            const tokens = (await res.json()) as { refresh_token?: string };
            if (tokens.refresh_token) revocation = { clientId, token: tokens.refresh_token };
          } else {
            log.warn('Apple-koden kunne ikke veksles', { status: res.status });
          }
        } catch (err) {
          // Sign-in still succeeds; only the later revocation is lost.
          log.warn('Apple-koden kunne ikke veksles', { error: String(err) });
        }
      }

      const name = [str(input.givenName), str(input.familyName)].filter(Boolean).join(' ') || null;
      return {
        provider: 'apple',
        subject: payload.sub,
        email: str(payload.email)?.toLowerCase() ?? null,
        emailVerified: bool(payload.email_verified),
        name: name?.slice(0, 80) ?? null,
        phone: null,
        phoneVerified: false,
        birthdate: null,
        birthdateVerified: false,
        demo: false,
        revocation,
      };
    },
    async revoke(clientId, token) {
      const res = await post('/auth/revoke', {
        client_id: clientId,
        client_secret: await secretFor(clientId),
        token,
        token_type_hint: 'refresh_token',
      });
      if (!res.ok) throw new Error(`Apple revoke ${res.status}`);
    },
  };
}
