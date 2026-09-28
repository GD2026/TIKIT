import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * The iOS app's web view has no CSP header from our server, so the policy goes in a meta tag: our own
 * scripts only, and network access only to the TIKIT server.
 */
function nativeCsp(apiOrigin: string): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${apiOrigin}`,
    "font-src 'self' data:",
    `connect-src 'self' ${apiOrigin}`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-src 'none'",
  ].join('; ');
  return {
    name: 'tikit-native-csp',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`),
  };
}

/**
 * Three builds from one codebase:
 *  - default: the production PWA (talks to the Node API at /api)
 *  - `--mode native`: the iOS app (Capacitor) in dist/native – talks to VITE_API_ORIGIN (see docs/ios.md)
 *  - `--mode demo`: a single self-contained HTML file with the whole API running in the browser
 */
export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  const native = mode === 'native';
  const apiOrigin = native ? (loadEnv(mode, process.cwd(), 'VITE_').VITE_API_ORIGIN ?? '').replace(/\/+$/, '') : '';
  if (native && !/^https:\/\/[^/]+$|^http:\/\/(localhost|127\.0\.0\.1|192\.168\.[0-9.]+)(:\d+)?$/.test(apiOrigin)) {
    throw new Error('iOS-bygget trenger serveradressen: VITE_API_ORIGIN=https://tikit.no (bare http mot localhost/lokalnett under utvikling). Se docs/ios.md.');
  }
  return {
    base: demo ? './' : '/',
    // The demo and the app have no service worker; main.tsx only imports this for the PWA, but the dev server resolves it anyway.
    resolve: demo || native ? { alias: { 'virtual:pwa-register': fileURLToPath(new URL('./src/web/lib/pwa-register-stub.ts', import.meta.url)) } } : {},
    plugins: [
      react(),
      tailwindcss(),
      ...(demo
        ? [viteSingleFile({ removeViteModuleLoader: true })]
        : native
          ? [nativeCsp(apiOrigin)]
          : [
            VitePWA({
              registerType: 'autoUpdate',
              injectRegister: false,
              includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
              manifest: {
                name: 'TIKIT',
                short_name: 'TIKIT',
                description: 'Billetter til russetreff, fester, busslanseringer og revyer.',
                lang: 'nb',
                start_url: '/',
                scope: '/',
                display: 'standalone',
                orientation: 'portrait',
                background_color: '#f2f2f7',
                theme_color: '#3b4cf2',
                categories: ['entertainment', 'lifestyle'],
                icons: [
                  { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
                  { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
                  { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
                shortcuts: [
                  { name: 'Mine billetter', short_name: 'Billetter', url: '/billetter', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
                  { name: 'Skann billetter', short_name: 'Skann', url: '/skann', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
                ],
              },
              workbox: {
                navigateFallback: '/index.html',
                navigateFallbackDenylist: [/^\/api\//],
                globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
                // The link-preview image is for crawlers, not for the app.
                globIgnores: ['og.png'],
                cleanupOutdatedCaches: true,
                // A new version takes over right away (with injectRegister:false the plugin doesn't set these).
                skipWaiting: true,
                clientsClaim: true,
                runtimeCaching: [
                  {
                    urlPattern: ({ url }) => url.pathname.startsWith('/api/images/'),
                    handler: 'CacheFirst',
                    options: { cacheName: 'tikit-images', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 } },
                  },
                  {
                    // Tickets – and who is signed in – stay available offline at the door (the QR code is generated
                    // on the device). Ticket URLs carry the user id (?u=), so cached entries are per person; the
                    // app clears this cache on sign-out and when a different person signs in.
                    urlPattern: ({ url }) => url.pathname === '/api/me' || url.pathname === '/api/tickets' || url.pathname.startsWith('/api/tickets/'),
                    handler: 'NetworkFirst',
                    options: { cacheName: 'tikit-tickets', networkTimeoutSeconds: 4, expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 14 } },
                  },
                ],
              },
            }),
          ]),
    ],
    build: {
      outDir: demo ? 'dist-demo' : native ? 'dist/native' : 'dist/web',
      emptyOutDir: true,
      target: 'es2022',
      // Maps are written for error tracking but not referenced from the shipped files.
      sourcemap: demo ? false : 'hidden',
      assetsInlineLimit: demo ? 100_000_000 : 4096,
      chunkSizeWarningLimit: demo ? 5000 : 800,
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: demo ? undefined : { '/api': { target: 'http://127.0.0.1:8787', changeOrigin: false } },
    },
    preview: { port: 4173 },
  };
});
