import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The TIKIT iOS app: the same React app as the website, bundled into a native shell (Capacitor 8).
 * Build and open in Xcode:  TIKIT_API_ORIGIN=https://tikit.no npm run ios
 * Everything about the app – bundle ID, signing, universal links, App Store – is in docs/ios.md.
 */
const config: CapacitorConfig = {
  // Must match the App ID in Apple Developer and APPLE_BUNDLE_IDS on the server.
  appId: 'no.tikit.app',
  appName: 'TIKIT',
  webDir: 'dist/native',
  ios: {
    // The web app handles safe areas itself (env(safe-area-inset-*)).
    contentInset: 'never',
    // Swipe back/forward belongs to the app's own navigation, not the web view's history.
    allowsLinkPreview: false,
    scrollEnabled: true,
    backgroundColor: '#00000000',
  },
  plugins: {
    SplashScreen: {
      // Hidden by the app once the first screen has rendered (src/web/native/index.ts).
      launchAutoHide: false,
      launchShowDuration: 3000,
      backgroundColor: '#0b0a24',
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
    },
  },
};

export default config;
