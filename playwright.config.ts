import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests against the real Node server (production build, PGlite database, demo providers).
 * Run: npm run build && npm run test:e2e
 *
 * Each device project gets its own server and fresh database: the flows buy tickets, and purchase limits
 * are per person, so projects sharing one database would change each other's results.
 */
const PROJECTS = [
  { name: 'iphone', port: 8898, use: { ...devices['iPhone 15'], browserName: 'chromium' as const } },
  { name: 'iphone-dark', port: 8899, use: { ...devices['iPhone 15'], browserName: 'chromium' as const, colorScheme: 'dark' as const } },
  { name: 'desktop', port: 8900, use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
];

/**
 * `ios-web`: the iOS app's web bundle (vite --mode native) served from its own origin and talking to the API
 * cross-origin with a bearer token, like the app does from capacitor://localhost. Only tests/e2e/ios-app.spec.ts.
 */
const IOS_WEB = { port: 8902, apiPort: 8901 };

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    locale: 'nb-NO',
    timezoneId: 'Europe/Oslo',
    trace: 'retain-on-failure',
  },
  projects: [
    ...PROJECTS.map((p) => ({ name: p.name, testIgnore: /ios-app\.spec\.ts/, use: { ...p.use, baseURL: `http://localhost:${p.port}` } })),
    { name: 'ios-web', testMatch: /ios-app\.spec\.ts/, use: { ...devices['iPhone 15'], browserName: 'chromium' as const, baseURL: `http://localhost:${IOS_WEB.port}` } },
  ],
  webServer: [
    ...PROJECTS.map((p) => ({
      command: `node scripts/e2e-server.mjs ${p.port}`,
      url: `http://localhost:${p.port}/healthz`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    })),
    {
      command: `node scripts/e2e-server.mjs ${IOS_WEB.apiPort}`,
      url: `http://localhost:${IOS_WEB.apiPort}/healthz`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: { APP_CORS_ORIGINS: `http://localhost:${IOS_WEB.port}` },
    },
    {
      command: `node scripts/e2e-native.mjs ${IOS_WEB.port} ${IOS_WEB.apiPort}`,
      url: `http://localhost:${IOS_WEB.port}/`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
