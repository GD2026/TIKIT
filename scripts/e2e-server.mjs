// Starts the production server for Playwright with a fresh, seeded PGlite database.
import { rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const port = process.argv[2] ?? '8898';
const dataDir = mkdtempSync(path.join(tmpdir(), 'tikit-e2e-'));
const child = spawn(process.execPath, ['dist/server/main.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: port,
    PUBLIC_URL: `http://localhost:${port}`,
    DATA_DIR: dataDir,
    DEMO_MODE: 'true',
    SEED_DEMO_DATA: 'true',
    CRON_INTERVAL_SECONDS: '0',
    SESSION_SECRET: 'e2e-session-secret-that-is-long-enough-123',
    // Empty values win over .env (process.loadEnvFile never overrides), so a developer's real database and
    // provider keys are never used by the tests – no demo data in Supabase, no real logins, payments or e-mail.
    DATABASE_URL: '',
    VIPPS_CLIENT_ID: '',
    GOOGLE_CLIENT_ID: '',
    APPLE_CLIENT_ID: '',
    APPLE_KEY_ID: '',
    STRIPE_SECRET_KEY: '',
    RESEND_API_KEY: '',
    APPLE_WALLET_CERT: '',
    GOOGLE_WALLET_ISSUER_ID: '',
  },
});
const cleanup = () => {
  child.kill('SIGTERM');
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
};
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
child.on('exit', (code) => process.exit(code ?? 0));
