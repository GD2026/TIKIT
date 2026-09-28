import { registerPlugin } from '@capacitor/core';

/**
 * TIKIT's own native plugin: ios/App/App/TikitNativePlugin.swift. Everything the web code can't do
 * itself on iOS.
 */
export interface TikitNativePlugin {
  /**
   * Opens `url` in ASWebAuthenticationSession (the system browser sheet that Google, Vipps and Apple accept)
   * and resolves with the URL the login ended on (`tikit://auth/callback?code=…`).
   * Rejects with code 'CANCELLED' when the person closes the sheet.
   */
  authenticate(options: { url: string; callbackScheme: string }): Promise<{ url: string }>;
  /**
   * The native «Logg på med Apple» sheet. `nonce` is the server's nonce; the plugin hashes it (SHA-256) for
   * Apple, and the server checks the hash inside the identity token. Rejects with 'CANCELLED' on cancel.
   */
  signInWithApple(options: { nonce: string }): Promise<{ identityToken: string; authorizationCode: string | null; givenName: string | null; familyName: string | null }>;
  /** The session token, kept in the iOS Keychain (this device only, after first unlock). */
  getSession(): Promise<{ token: string | null }>;
  setSession(options: { token: string }): Promise<void>;
  clearSession(): Promise<void>;
  /** SHA-256 of a UTF-8 string as base64url – fallback when Web Crypto isn't available in the web view. */
  sha256(options: { value: string }): Promise<{ base64url: string }>;
}

export const TikitNative = registerPlugin<TikitNativePlugin>('TikitNative', {
  // In a desktop browser (development, tests) a stand-in keeps the session in sessionStorage.
  web: () => import('./plugin.web').then((m) => new m.TikitNativeWeb()),
});

export function isCancelled(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'CANCELLED';
}
