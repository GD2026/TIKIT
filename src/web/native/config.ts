/**
 * Build-time settings for the iOS app (see vite.config.ts and docs/ios.md):
 *   TIKIT_API_ORIGIN=https://tikit.no npm run ios:build
 */

/** The TIKIT server the app talks to. The app itself is served from capacitor://localhost. */
export const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/+$/, '');

/** Must match CFBundleURLSchemes in ios/App/App/Info.plist and APP_URL_SCHEME on the server. */
export const URL_SCHEME = import.meta.env.VITE_APP_URL_SCHEME ?? 'tikit';
