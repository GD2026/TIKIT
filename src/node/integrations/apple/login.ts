import * as oidc from 'openid-client';
import type { ExternalProfile, Logger, OAuthAdapter } from '../../../server/adapters/types';
import { bool, str } from '../oidc';
import { createAppleClientSecret, type AppleKeyConfig } from './clientSecret';

/**
 * Sign in with Apple on the web (and in the iOS app's system browser): form_post callback, the name only
 * arrives on the very first login, ES256 client secret. The native iOS button is in ./native.ts.
 * Keys: docs/oppsett.md §4.
 */

export interface AppleLoginConfig extends AppleKeyConfig {
  /** The Services ID (e.g. no.tikit.web), not the App ID. */
  clientId: string;
}

export async function createAppleLogin(cfg: AppleLoginConfig, log: Logger): Promise<OAuthAdapter> {
  const clientSecret = createAppleClientSecret(cfg, cfg.clientId);
  let secret = await clientSecret(); // fails early on a broken key
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
      secret = await clientSecret();
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
        // Kept (encrypted) so the grant can be revoked at Apple when the account is deleted.
        revocation: tokens.refresh_token ? { clientId: cfg.clientId, token: tokens.refresh_token } : null,
      } satisfies ExternalProfile;
    },
  };
}
