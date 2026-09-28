import { createApp } from '../../src/server/app';
import type { Deps, ServerConfig } from '../../src/server/context';
import { MemoryStore } from '../../src/server/store/memory';
import type { Store } from '../../src/server/store/types';
import { createDemoPaymentAdapter, createOutboxMailer } from '../../src/server/adapters/demo';
import type { Logger } from '../../src/server/adapters/types';
import { seedDemoData } from '../../src/server/seed';

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: (msg, data) => {
    if (process.env.TIKIT_TEST_LOG) console.error(msg, data);
  },
};

export interface Harness {
  deps: Deps;
  app: ReturnType<typeof createApp>;
  now: () => Date;
  setNow: (d: Date) => void;
  advance: (ms: number) => void;
  call: <T = any>(method: string, path: string, body?: unknown, token?: string | null, headers?: Record<string, string>) => Promise<{ status: number; json: T; headers: Headers }>;
  login: (persona: 'buyer' | 'organizer' | 'admin' | 'new', provider?: 'vipps' | 'google' | 'apple', name?: string) => Promise<string>;
}

export function testConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    publicUrl: 'http://localhost:5173',
    demoMode: true,
    production: false,
    sessionSecret: 'test-secret-that-is-long-enough-1234567890',
    cookieSecure: false,
    adminEmails: [],
    cronSecret: 'cron-secret',
    linkStyle: 'path',
    ...overrides,
  };
}

/**
 * The API tests run against the in-memory store by default. Set TIKIT_TEST_STORE=pglite, or
 * TIKIT_TEST_STORE=postgres together with TIKIT_TEST_DATABASE_URL, to run the same flows on SQL.
 */
async function testStore(): Promise<Store> {
  const kind = process.env.TIKIT_TEST_STORE ?? 'memory';
  if (kind === 'memory') return new MemoryStore();
  const { SqlStore, createPgliteDriver, createPostgresDriver, migrate } = await import('../../src/node/db/sqlStore');
  if (kind === 'pglite') {
    const driver = await createPgliteDriver(undefined);
    await migrate(driver);
    return new SqlStore(driver);
  }
  const url = process.env.TIKIT_TEST_DATABASE_URL;
  if (!url) throw new Error('TIKIT_TEST_DATABASE_URL mangler');
  const driver = await createPostgresDriver(url, { max: 4 });
  await migrate(driver);
  await driver.query(
    "DO $$ DECLARE r record; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename LIKE 'tikit\\_%' AND tablename <> 'tikit_meta' LOOP EXECUTE 'TRUNCATE ' || quote_ident(r.tablename); END LOOP; END $$",
  );
  return new SqlStore(driver);
}

export async function makeHarness(opts: { seed?: boolean; now?: Date; store?: Store; config?: Partial<ServerConfig> } = {}): Promise<Harness> {
  let now = opts.now ?? new Date('2026-09-23T10:00:00.000Z');
  const store = opts.store ?? (await testStore());
  const config = testConfig(opts.config);
  const deps: Deps = {
    store,
    config,
    clock: () => now,
    oauth: {},
    payments: {},
    mailer: createOutboxMailer(store),
    log: silentLogger,
    wallet: null,
    clientIp: () => '127.0.0.1',
  };
  deps.payments = { vipps: createDemoPaymentAdapter('vipps', store, config), card: createDemoPaymentAdapter('card', store, config) };
  if (opts.seed !== false) await seedDemoData(deps);
  const app = createApp(deps);
  const call: Harness['call'] = async (method, path, body, token, headers = {}) => {
    const res = await app.fetch(
      new Request(`http://localhost:5173/api${path}`, {
        method,
        headers: Object.fromEntries(
          Object.entries({
            'content-type': 'application/json',
            'x-tikit': '1',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...headers,
          }).filter(([, v]) => v !== ''),
        ),
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    const text = await res.text();
    let json: any;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, json, headers: res.headers };
  };
  const login: Harness['login'] = async (persona, provider = 'vipps', name) => {
    const res = await call('POST', '/auth/demo', { provider, persona, ...(name ? { name } : {}) });
    if (res.status !== 200) throw new Error(`login failed: ${JSON.stringify(res.json)}`);
    return res.json.token as string;
  };
  return {
    deps,
    app,
    now: () => now,
    setNow: (d) => {
      now = d;
    },
    advance: (ms) => {
      now = new Date(now.getTime() + ms);
    },
    call,
    login,
  };
}

/** Approves the simulated payment behind a redirect URL and syncs the order. */
export async function completeDemoPayment(h: Harness, token: string, orderId: string, redirectUrl: string, action: 'approve' | 'decline' = 'approve') {
  const ref = decodeURIComponent(redirectUrl.split('/demo/betal/')[1]!);
  const r = await h.call('POST', `/demo/payments/${encodeURIComponent(ref)}/${action}`, {}, token);
  if (r.status !== 200) throw new Error(`demo payment ${action} failed: ${JSON.stringify(r.json)}`);
  return h.call('POST', `/orders/${orderId}/sync`, {}, token);
}
