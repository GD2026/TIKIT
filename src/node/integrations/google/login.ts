import * as oidc from 'openid-client';
import type { ExternalProfile, OAuthAdapter } from '../../../server/adapters/types';
import { bool, callbackUrl, str } from '../oidc';

/** Google (OpenID Connect): e-mail and name from the ID token. Keys: docs/oppsett.md §2. */

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
