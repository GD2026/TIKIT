import * as oidc from 'openid-client';
import type { ExternalProfile, OAuthAdapter } from '../../../server/adapters/types';
import { bool, callbackUrl, isoDate, str, toE164, withHeaders } from '../oidc';
import { VIPPS_SYSTEM_HEADERS } from './common';

/**
 * Logg inn med Vipps (OpenID Connect): verified name, phone, e-mail and birth date
 * (from the National Population Register). Keys: docs/oppsett.md §2.
 */

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
