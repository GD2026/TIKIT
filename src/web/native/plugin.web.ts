import { WebPlugin } from '@capacitor/core';
import type { TikitNativePlugin } from './plugin';

/**
 * Browser stand-in for TikitNativePlugin.swift, used when the iOS bundle runs in a desktop browser
 * (development and the `ios-web` Playwright tests). The session lives in sessionStorage instead of the
 * Keychain; the system-browser login and native Apple sheet don't exist here.
 */
export class TikitNativeWeb extends WebPlugin implements TikitNativePlugin {
  private readonly key = 'tikit-native-session';

  async authenticate(): Promise<{ url: string }> {
    throw this.unavailable('Innlogging i systemnettleseren finnes bare i iOS-appen.');
  }

  async signInWithApple(): Promise<never> {
    throw this.unavailable('Logg på med Apple finnes bare i iOS-appen.');
  }

  async getSession(): Promise<{ token: string | null }> {
    return { token: sessionStorage.getItem(this.key) };
  }

  async setSession(options: { token: string }): Promise<void> {
    sessionStorage.setItem(this.key, options.token);
  }

  async clearSession(): Promise<void> {
    sessionStorage.removeItem(this.key);
  }

  async sha256(options: { value: string }): Promise<{ base64url: string }> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(options.value)));
    const base64url = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return { base64url };
  }
}
