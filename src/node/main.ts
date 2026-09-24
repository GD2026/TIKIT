import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import type { Logger } from '../server/adapters/types';
import { loadConfig } from './config';
import { createTikitServer } from './server';

function makeLogger(json: boolean): Logger {
  const write = (level: 'info' | 'warn' | 'error', msg: string, data?: Record<string, unknown>) => {
    if (json) {
      const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...(data ?? {}) });
      (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
    } else {
      const extra = data && Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      fn(`[tikit] ${msg}${extra}`);
    }
  };
  return {
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
}

async function main(): Promise<void> {
  if (existsSync('.env')) process.loadEnvFile('.env');
  const cfg = loadConfig();
  const log = makeLogger(cfg.production);
  for (const w of cfg.warnings) log.warn(w);

  const server = await createTikitServer(cfg, log);
  const { env } = cfg;
  const providers = Object.keys(server.deps.oauth);
  const payments = Object.entries(server.deps.payments).map(([k, v]) => `${k}:${v?.provider}`);
  log.info('TIKIT starter', {
    url: cfg.publicUrl,
    demoMode: cfg.demoMode,
    login: providers.length ? providers : cfg.demoMode ? ['demo'] : [],
    payments,
    mail: server.deps.mailer.kind,
  });

  const http = serve({ fetch: server.app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
    log.info(`Lytter på http://${info.address}:${info.port}`);
  });
  server.startCron();

  // Render (and most hosts) send SIGTERM and allow ~30 s: stop taking new work, let requests that are
  // already running finish (a buyer mid-payment), then close the database.
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`Stopper (${signal}) …`);
    const force = setTimeout(() => {
      log.warn('Tvinger avslutning – noen forespørsler ble ikke ferdige');
      process.exit(1);
    }, 28_000);
    force.unref();
    try {
      const closed = new Promise<void>((resolve) => http.close(() => resolve()));
      await server.stopCron();
      await closed;
      await server.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
  process.on('unhandledRejection', (err) => log.error('Uhåndtert feil', { error: String(err) }));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
