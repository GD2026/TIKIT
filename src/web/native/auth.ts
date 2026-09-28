import type { ProviderId } from '../../shared/types';
import { ERROR_MESSAGES, type ErrorCode } from '../../shared/errors';
import { bytesToBase64Url, randomBytes, utf8 } from '../../shared/encoding';
import { ApiError, type Api } from '../api/client';
import { API_ORIGIN, URL_SCHEME } from './config';
import { TikitNative, isCancelled } from './plugin';

/**
 * Signing in from the iOS app.
 *
 * Vipps, Google and Apple (web) run in ASWebAuthenticationSession – Google refuses logins inside an
 * app's own web view. The login is bound to a random verifier that never leaves the app; the server
 * answers with a one-time code (tikit://auth/callback?code=…) which only that verifier can exchange for
 * a session token. See src/server/services/nativeAuth.ts for the server side.
 *
 * With `appleNative` the Apple button uses the native Sign in with Apple sheet instead.
 */

export interface NativeLoginResult {
  returnTo: string | null;
  linked: boolean;
}

async function s256(value: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest('SHA-256', utf8(value) as unknown as ArrayBuffer);
    return bytesToBase64Url(new Uint8Array(digest));
  }
  return (await TikitNative.sha256({ value })).base64url;
}

function loginError(code: string | null): ApiError {
  const known = code && code in ERROR_MESSAGES ? (code as ErrorCode) : 'login_failed';
  return new ApiError(known, ERROR_MESSAGES[known], 400);
}

/** Resolves null when the person cancels. */
export async function nativeLogin(api: Api, provider: ProviderId, opts: { returnTo?: string; mode?: 'login' | 'link'; appleNative: boolean }): Promise<NativeLoginResult | null> {
  if (provider === 'apple' && opts.appleNative) return nativeApple(api, opts.mode ?? 'login');

  const verifier = bytesToBase64Url(randomBytes(48));
  const challenge = await s256(verifier);
  const qs = new URLSearchParams({ native: challenge, returnTo: opts.returnTo ?? '/' });
  if (opts.mode === 'link') {
    const { ticket } = await api.post<{ ticket: string }>('/auth/native/link-ticket', { challenge });
    qs.set('mode', 'link');
    qs.set('linkTicket', ticket);
  }

  let callback: string;
  try {
    callback = (await TikitNative.authenticate({ url: `${API_ORIGIN}/api/auth/login/${provider}?${qs.toString()}`, callbackScheme: URL_SCHEME })).url;
  } catch (err) {
    if (isCancelled(err)) return null;
    throw loginError(null);
  }

  const url = new URL(callback);
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  if (error || !code) throw loginError(error);
  const res = await api.post<{ returnTo?: string; linked?: boolean }>('/auth/native/exchange', { code, verifier });
  return { returnTo: res.returnTo ?? null, linked: !!res.linked };
}

async function nativeApple(api: Api, mode: 'login' | 'link'): Promise<NativeLoginResult | null> {
  const { nonce } = await api.post<{ nonce: string }>('/auth/native/apple/nonce');
  let cred: Awaited<ReturnType<typeof TikitNative.signInWithApple>>;
  try {
    cred = await TikitNative.signInWithApple({ nonce });
  } catch (err) {
    if (isCancelled(err)) return null;
    throw loginError(null);
  }
  const res = await api.post<{ linked?: boolean }>('/auth/native/apple', {
    nonce,
    identityToken: cred.identityToken,
    authorizationCode: cred.authorizationCode,
    givenName: cred.givenName || null,
    familyName: cred.familyName || null,
    mode,
  });
  return { returnTo: null, linked: !!res.linked };
}
