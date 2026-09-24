import { createApp } from '../../server/app';
import type { Deps, ServerConfig } from '../../server/context';
import { MemoryStore, type MemorySnapshot } from '../../server/store/memory';
import { createDemoPaymentAdapter, createOutboxMailer } from '../../server/adapters/demo';
import { consoleLogger } from '../../server/adapters/types';
import { seedDemoData } from '../../server/seed';
import { runCron } from '../../server/services/misc';
import type { Transport } from '../api/client';

/**
 * The live demo runs the complete TIKIT API inside the browser: same routes, same services,
 * same validation – with an in-memory store (saved to IndexedDB) and simulated Vipps/Apple/Google.
 */

const DB_NAME = 'tikit-demo';
const STORE = 'kv';
const DATA_KEY = 'state';
const TOKEN_KEY = 'tikit-demo-token';
const DATA_VERSION = 10;
const MAX_AGE_DAYS = 10;

interface Persisted {
  version: number;
  seededAt: string;
  snapshot: MemorySnapshot;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* storage unavailable (private mode, blocked) – the demo still works in memory */
  }
}

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export interface DemoBackend {
  transport: Transport;
  deps: Deps;
  reset(): Promise<void>;
  seededAt: string;
}

function pageUrl(): string {
  return window.location.href.split('#')[0]!.replace(/\/$/, '');
}

export async function createDemoBackend(): Promise<DemoBackend> {
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let store: MemoryStore;
  let seededAt: string;

  const persist = () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      void idbSet(DATA_KEY, { version: DATA_VERSION, seededAt, snapshot: store.snapshot() } satisfies Persisted);
    }, 400);
  };

  const saved = await idbGet<Persisted>(DATA_KEY);
  const fresh = !saved || saved.version !== DATA_VERSION || Date.now() - Date.parse(saved.seededAt) > MAX_AGE_DAYS * 86400000;
  store = new MemoryStore({ initial: fresh ? undefined : saved!.snapshot, onCommit: persist });
  seededAt = fresh ? new Date().toISOString() : saved!.seededAt;

  const config: ServerConfig = {
    publicUrl: pageUrl(),
    demoMode: true,
    production: false,
    sessionSecret: 'tikit-demo-only-secret-not-for-production-use',
    cookieSecure: false,
    adminEmails: [],
    cronSecret: null,
    linkStyle: 'hash',
  };
  const deps: Deps = {
    store,
    config,
    clock: () => new Date(),
    oauth: {},
    payments: {},
    mailer: createOutboxMailer(store),
    log: { ...consoleLogger, info: () => {} },
    wallet: null,
    clientIp: () => 'demo',
  };
  deps.payments = { vipps: createDemoPaymentAdapter('vipps', store, config), card: createDemoPaymentAdapter('card', store, config) };

  if (fresh) {
    await seedDemoData(deps);
    writeToken(null);
    persist();
  }

  let app = createApp(deps);
  let token = readToken();
  const imageUrls = new Map<string, string>();

  const transport: Transport = {
    kind: 'local',
    async request(path, init) {
      const headers = new Headers(init.headers);
      if (token) headers.set('Authorization', `Bearer ${token}`);
      const res = await app.fetch(new Request(`http://tikit.local/api${path}`, { ...init, headers }));
      if (res.ok && (path.startsWith('/auth/demo') || path === '/scanner/login')) {
        const data = (await res.clone().json()) as { token?: string };
        if (data.token) {
          token = data.token;
          writeToken(token);
        }
      }
      if (path === '/auth/logout' || path === '/scanner/logout' || (path === '/me' && init.method === 'DELETE' && res.ok)) {
        token = null;
        writeToken(null);
      }
      return res;
    },
    setToken(t) {
      token = t;
      writeToken(t);
    },
    async resolveUrl(url) {
      if (!url.startsWith('/api/')) return url;
      const cached = imageUrls.get(url);
      if (cached) return cached;
      const res = await app.fetch(new Request(`http://tikit.local${url}`));
      if (!res.ok) return '';
      const objectUrl = URL.createObjectURL(await res.blob());
      imageUrls.set(url, objectUrl);
      return objectUrl;
    },
  };

  // Background work (expiring reservations, sale alerts, reminders) – every 20 s while open.
  setInterval(() => {
    void runCron(deps);
  }, 20_000);

  return {
    transport,
    deps,
    seededAt,
    async reset() {
      const next = new MemoryStore({ onCommit: persist });
      store = next;
      deps.store = next;
      deps.mailer = createOutboxMailer(next);
      deps.payments = { vipps: createDemoPaymentAdapter('vipps', next, config), card: createDemoPaymentAdapter('card', next, config) };
      seededAt = new Date().toISOString();
      await seedDemoData(deps);
      app = createApp(deps);
      token = null;
      writeToken(null);
      imageUrls.clear();
      await idbSet(DATA_KEY, { version: DATA_VERSION, seededAt, snapshot: next.snapshot() } satisfies Persisted);
    },
  };
}
