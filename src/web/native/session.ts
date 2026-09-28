import { TikitNative } from './plugin';

/**
 * The app signs in with a bearer token instead of a cookie (the web view at capacitor://localhost can't
 * keep TIKIT's cookies). The token lives in the Keychain and in memory while the app runs.
 */

let token: string | null = null;

export async function loadSession(): Promise<string | null> {
  try {
    token = (await TikitNative.getSession()).token ?? null;
  } catch {
    token = null;
  }
  return token;
}

export function currentToken(): string | null {
  return token;
}

export async function saveSession(next: string | null): Promise<void> {
  token = next;
  try {
    if (next) await TikitNative.setSession({ token: next });
    else await TikitNative.clearSession();
  } catch {
    /* the in-memory token still works until the app is closed */
  }
}
