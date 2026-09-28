/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** iOS app build only: the TIKIT server the app talks to, e.g. https://tikit.no (vite.config.ts). */
  readonly VITE_API_ORIGIN?: string;
  /** iOS app build only: the URL scheme in Info.plist (default tikit). */
  readonly VITE_APP_URL_SCHEME?: string;
}
