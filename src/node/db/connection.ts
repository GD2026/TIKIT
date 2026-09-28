import type { PostgresOptions } from './sqlStore';

/**
 * Turns DATABASE_URL (+ DATABASE_SSL / DATABASE_CA_CERT) into driver options, with provider-specific
 * defaults. Supabase is detected from the host name:
 *
 *  - `db.<ref>.supabase.co:5432`            direct connection – IPv6 only unless the IPv4 add-on is bought.
 *                                          Hosts without IPv6 (Render, most PaaS) can't reach it.
 *  - `aws-0-<region>.pooler.supabase.com:5432`  Session pooler (Supavisor) – IPv4, behaves like a direct
 *                                          connection. Recommended for TIKIT.
 *  - `aws-0-<region>.pooler.supabase.com:6543`  Transaction pooler – works, but named prepared statements
 *                                          must be off (each transaction may land on another connection).
 *
 * Supabase always requires TLS. Its certificates are signed by Supabase's own CA, so full verification needs
 * that CA (DATABASE_CA_CERT, downloaded from the dashboard); without it TLS is still used, unverified.
 */

export type DatabaseProvider = 'supabase' | 'render' | 'neon' | 'postgres';

export interface DatabaseSetup {
  provider: DatabaseProvider;
  options: PostgresOptions;
  /** Human-readable description for the start-up log (never contains the password). */
  description: string;
  warnings: string[];
}

export function databaseSetup(url: string, env: { DATABASE_SSL?: '' | 'require' | 'prefer' | 'disable' | undefined; DATABASE_CA_CERT?: string | null; DATABASE_POOL_MAX: number }): DatabaseSetup {
  const warnings: string[] = [];
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    // postgres.js reports a useful error on connect.
  }
  const host = parsed?.hostname ?? '';
  const port = Number(parsed?.port || 5432);
  const provider: DatabaseProvider = /\.supabase\.(co|com)$/.test(host)
    ? 'supabase'
    : /\.render\.com$/.test(host) || /^dpg-/.test(host)
      ? 'render'
      : /\.neon\.tech$/.test(host)
        ? 'neon'
        : 'postgres';

  const options: PostgresOptions = { max: env.DATABASE_POOL_MAX };
  const ca = env.DATABASE_CA_CERT?.replace(/\\n/g, '\n').trim() || null;
  if (ca) options.ssl = { ca };
  else if (env.DATABASE_SSL === 'require' || env.DATABASE_SSL === 'prefer') options.ssl = env.DATABASE_SSL;
  else if (env.DATABASE_SSL === 'disable') options.ssl = false;

  let mode = '';
  if (provider === 'supabase') {
    const pooler = host.endsWith('.pooler.supabase.com');
    if (pooler && port === 6543) {
      mode = 'transaction pooler';
      options.prepare = false;
      // Supavisor in transaction mode caps connections per client; a smaller pool avoids "max clients" errors.
      options.max = Math.min(options.max ?? 10, 10);
    } else if (pooler) {
      mode = 'session pooler';
    } else {
      mode = 'direkte tilkobling';
      warnings.push(
        'DATABASE_URL peker på Supabase sin direkte adresse (db.<ref>.supabase.co), som bare har IPv6. Render og de fleste andre verter når den ikke. Bruk «Session pooler»-adressen fra Supabase (Connect → Session pooler).',
      );
    }
    if (options.ssl === undefined) options.ssl = 'require';
    if (options.ssl === false) warnings.push('DATABASE_SSL=disable virker ikke mot Supabase – Supabase krever kryptert tilkobling.');
    if (!ca) warnings.push('Supabase: tilkoblingen er kryptert, men sertifikatet sjekkes ikke. Last ned CA-sertifikatet (Database Settings → SSL) og legg det i DATABASE_CA_CERT for full verifisering.');
  }

  const where = host ? `${host}:${port}` : 'ukjent vert';
  const description = `${provider === 'postgres' ? 'Postgres' : provider[0]!.toUpperCase() + provider.slice(1)}${mode ? ` (${mode})` : ''} – ${where}`;
  return { provider, options, description, warnings };
}
