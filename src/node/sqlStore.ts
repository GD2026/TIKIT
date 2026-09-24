import { createHash } from 'node:crypto';
import { CATEGORY_IDS } from '../shared/constants';
import {
  COLLECTIONS,
  DocNotFound,
  INDEX_FIELDS,
  UNIQUE_KEYS,
  UniqueViolation,
  cloneDoc,
  type CollectionName,
  type DocOf,
  type FindOptions,
  type Store,
  type Tx,
  type Where,
} from '../server/store/types';

/**
 * Postgres-backed document store (Postgres 14+ or PGlite).
 *
 * Each collection is a table `tikit_<name>(id text primary key, seq bigint identity, data jsonb)`.
 * Semantics mirror MemoryStore, which the whole service layer is tested against:
 *  - equality filters on top-level scalar fields (null matches missing), `{ in: [...] }` lists
 *  - ordering with nulls last and `id` as tie-breaker, insertion order when no order is given
 *  - unique constraints from UNIQUE_KEYS (unique expression indexes; nulls never collide)
 *  - `forUpdate` takes row locks; serialization failures and deadlocks retry the transaction
 *  - `afterCommit` callbacks run only after a successful commit
 */

export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

export interface Queryable {
  query(sql: string, params?: unknown[]): Promise<QueryResult>;
}

export interface SqlDriver extends Queryable {
  readonly kind: 'postgres' | 'pglite';
  /** Runs `fn` between BEGIN and COMMIT on a single connection; rolls back when it throws. */
  transaction<R>(fn: (q: Queryable) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function field(name: string): string {
  if (!FIELD_RE.test(name)) throw new Error(`Ugyldig feltnavn: ${name}`);
  return name;
}

function snake(name: string): string {
  return name.replace(/[A-Z]/g, (ch) => `_${ch.toLowerCase()}`);
}

export function tableName(c: CollectionName): string {
  return `tikit_${snake(c)}`;
}

function uniqueIndexName(c: CollectionName, fields: string[]): string {
  // Postgres truncates identifiers at 63 bytes – keep names short and deterministic.
  return `${tableName(c)}_u_${fields.map(snake).join('_')}`.slice(0, 63);
}

/** Every DDL statement of the current schema, in order. */
function schemaStatements(): string[] {
  const out: string[] = ['CREATE TABLE IF NOT EXISTS tikit_meta (key text PRIMARY KEY, value jsonb NOT NULL)'];
  for (const c of COLLECTIONS) {
    const t = tableName(c);
    out.push(`CREATE TABLE IF NOT EXISTS ${t} (id text PRIMARY KEY, seq bigint GENERATED ALWAYS AS IDENTITY, data jsonb NOT NULL)`);
    out.push(`CREATE INDEX IF NOT EXISTS ${t}_seq ON ${t} (seq)`);
    if (c !== 'images') out.push(`CREATE INDEX IF NOT EXISTS ${t}_gin ON ${t} USING gin (data jsonb_path_ops)`);
    for (const f of (INDEX_FIELDS[c] as string[] | undefined) ?? []) {
      out.push(`CREATE INDEX IF NOT EXISTS ${t}_f_${snake(f)} ON ${t} ((data->>'${field(f)}'))`);
    }
    for (const fields of (UNIQUE_KEYS[c] as string[][] | undefined) ?? []) {
      const cols = fields.map((f) => `(data->>'${field(f)}')`).join(', ');
      out.push(`CREATE UNIQUE INDEX IF NOT EXISTS ${uniqueIndexName(c, fields)} ON ${t} (${cols})`);
    }
  }
  // Useful sort keys.
  out.push(`CREATE INDEX IF NOT EXISTS tikit_events_starts ON tikit_events ((data->>'startsAt'))`);
  out.push(`CREATE INDEX IF NOT EXISTS tikit_orders_created ON tikit_orders ((data->>'createdAt'))`);
  return out;
}

const SCHEMA_VERSION = 2;

async function storedFingerprint(q: Queryable): Promise<string | null> {
  const r = await q.query(`SELECT value FROM tikit_meta WHERE key = 'schema'`);
  const raw = r.rows[0]?.value;
  const value = (typeof raw === 'string' ? JSON.parse(raw) : raw) as { fingerprint?: string } | undefined;
  return value?.fingerprint ?? null;
}

/**
 * Idempotent schema setup, run on every start. When the stored fingerprint matches, nothing is touched:
 * even `CREATE INDEX IF NOT EXISTS` takes a table lock, which would stall the running instance's writes
 * during a zero-downtime deploy. Concurrent starts serialize on an advisory lock.
 */
export async function migrate(driver: SqlDriver): Promise<void> {
  const statements = schemaStatements();
  const fingerprint = `${SCHEMA_VERSION}:${createHash('sha256').update(statements.join(';\n')).digest('hex').slice(0, 32)}`;
  try {
    if ((await storedFingerprint(driver)) === fingerprint) return;
  } catch {
    // tikit_meta doesn't exist yet – first start.
  }
  await driver.transaction(async (q) => {
    await q.query('SELECT pg_advisory_xact_lock(727274811)');
    await q.query(statements[0]!);
    if ((await storedFingerprint(q)) === fingerprint) return; // another instance just did it
    for (const stmt of statements.slice(1)) await q.query(stmt);
    // Data migrations (idempotent). v2: categories were cut to four – anything else becomes "annet".
    await q.query(
      `UPDATE tikit_events SET data = jsonb_set(data, '{category}', '"annet"'::jsonb)
         WHERE (data->>'category') NOT IN (SELECT jsonb_array_elements_text($1::text::jsonb))`,
      [JSON.stringify(CATEGORY_IDS)],
    );
    await q.query(
      `INSERT INTO tikit_meta (key, value) VALUES ('schema', $1::text::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ version: SCHEMA_VERSION, fingerprint })],
    );
  });
}

function buildWhere(where: Record<string, unknown> | undefined, params: unknown[]): string {
  if (!where) return 'TRUE';
  const conds: string[] = [];
  const contains: Record<string, unknown> = {};
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    const f = field(key);
    if (cond === null) {
      conds.push(`(data->'${f}' IS NULL OR data->'${f}' = 'null'::jsonb)`);
    } else if (typeof cond === 'object' && 'in' in (cond as object)) {
      const list = (cond as { in: readonly unknown[] }).in;
      if (list.length === 0) {
        conds.push('FALSE');
        continue;
      }
      const ph = list.map((v) => {
        params.push(JSON.stringify(v));
        return `$${params.length}::text::jsonb`;
      });
      conds.push(`(data->'${f}') IN (${ph.join(', ')})`);
    } else {
      contains[f] = cond;
    }
  }
  if (Object.keys(contains).length > 0) {
    params.push(JSON.stringify(contains));
    conds.push(`data @> $${params.length}::text::jsonb`);
  }
  return conds.length > 0 ? conds.join(' AND ') : 'TRUE';
}

function orderClause(opts: FindOptions<unknown> | undefined): string {
  const o = opts?.orderBy as { field: string; dir?: 'asc' | 'desc'; numeric?: boolean } | undefined;
  if (!o) return 'ORDER BY seq';
  const f = field(o.field);
  const expr = o.numeric ? `(data->>'${f}')::numeric` : `(data->>'${f}') COLLATE "C"`;
  return `ORDER BY ${expr} ${o.dir === 'desc' ? 'DESC' : 'ASC'} NULLS LAST, id COLLATE "C" ASC`;
}

interface PgError {
  code?: string;
  constraint?: string;
  constraint_name?: string;
}

function toUniqueViolation(c: CollectionName, err: unknown): UniqueViolation | null {
  const e = err as PgError;
  if (e?.code !== '23505') return null;
  const name = e.constraint_name ?? e.constraint ?? '';
  for (const fields of (UNIQUE_KEYS[c] as string[][] | undefined) ?? []) {
    if (name === uniqueIndexName(c, fields)) return new UniqueViolation(c, fields);
  }
  return new UniqueViolation(c, ['id']);
}

function isRetryable(err: unknown): boolean {
  const code = (err as PgError)?.code;
  return code === '40001' || code === '40P01';
}

function parseData(row: Record<string, unknown>): Record<string, unknown> {
  const d = row.data;
  return (typeof d === 'string' ? JSON.parse(d) : d) as Record<string, unknown>;
}

class SqlTx implements Tx {
  closed = false;
  constructor(
    private readonly q: Queryable,
    private readonly readOnly: boolean,
    private readonly after: (() => void | Promise<void>)[],
  ) {}

  private open(): void {
    if (this.closed) throw new Error('Transaction is closed');
  }

  private lock(forUpdate: boolean | undefined): string {
    return forUpdate && !this.readOnly ? ' FOR UPDATE' : '';
  }

  async get<C extends CollectionName>(c: C, id: string, opts?: { forUpdate?: boolean }): Promise<DocOf<C> | null> {
    this.open();
    const r = await this.q.query(`SELECT data FROM ${tableName(c)} WHERE id = $1${this.lock(opts?.forUpdate)}`, [id]);
    return r.rows[0] ? (parseData(r.rows[0]) as unknown as DocOf<C>) : null;
  }

  async getMany<C extends CollectionName>(c: C, ids: readonly string[]): Promise<DocOf<C>[]> {
    this.open();
    const unique = [...new Set(ids)];
    const byId = new Map<string, DocOf<C>>();
    for (let i = 0; i < unique.length; i += 500) {
      const chunk = unique.slice(i, i + 500);
      const ph = chunk.map((_, j) => `$${j + 1}`).join(', ');
      const r = await this.q.query(`SELECT id, data FROM ${tableName(c)} WHERE id IN (${ph})`, chunk);
      for (const row of r.rows) byId.set(String(row.id), parseData(row) as unknown as DocOf<C>);
    }
    // Same order as the ids asked for (like MemoryStore).
    return unique.map((id) => byId.get(id)).filter((d): d is DocOf<C> => d !== undefined);
  }

  async find<C extends CollectionName>(c: C, where?: Where<DocOf<C>>, opts?: FindOptions<DocOf<C>>): Promise<DocOf<C>[]> {
    this.open();
    const params: unknown[] = [];
    const cond = buildWhere(where as Record<string, unknown> | undefined, params);
    let sql = `SELECT data FROM ${tableName(c)} WHERE ${cond} ${orderClause(opts as FindOptions<unknown> | undefined)}`;
    if (opts?.limit !== undefined) {
      params.push(Math.max(0, Math.floor(opts.limit)));
      sql += ` LIMIT $${params.length}`;
    }
    sql += this.lock(opts?.forUpdate);
    const r = await this.q.query(sql, params);
    return r.rows.map((row) => parseData(row) as unknown as DocOf<C>);
  }

  async findOne<C extends CollectionName>(c: C, where: Where<DocOf<C>>, opts?: { forUpdate?: boolean }): Promise<DocOf<C> | null> {
    const [first] = await this.find(c, where, { limit: 1, forUpdate: opts?.forUpdate });
    return first ?? null;
  }

  async count<C extends CollectionName>(c: C, where?: Where<DocOf<C>>): Promise<number> {
    this.open();
    const params: unknown[] = [];
    const cond = buildWhere(where as Record<string, unknown> | undefined, params);
    const r = await this.q.query(`SELECT count(*)::int AS n FROM ${tableName(c)} WHERE ${cond}`, params);
    return Number(r.rows[0]?.n ?? 0);
  }

  private writable(): void {
    this.open();
    if (this.readOnly) throw new Error('Skriving i en lesetransaksjon');
  }

  async insert<C extends CollectionName>(c: C, doc: DocOf<C>): Promise<DocOf<C>> {
    this.writable();
    const clean = cloneDoc(doc) as unknown as Record<string, unknown> & { id: string };
    if (!clean.id) throw new Error(`Document in ${c} is missing id`);
    try {
      await this.q.query(`INSERT INTO ${tableName(c)} (id, data) VALUES ($1, $2::text::jsonb)`, [clean.id, JSON.stringify(clean)]);
    } catch (err) {
      throw toUniqueViolation(c, err) ?? err;
    }
    return cloneDoc(clean) as unknown as DocOf<C>;
  }

  async put<C extends CollectionName>(c: C, doc: DocOf<C>): Promise<DocOf<C>> {
    this.writable();
    const clean = cloneDoc(doc) as unknown as Record<string, unknown> & { id: string };
    if (!clean.id) throw new Error(`Document in ${c} is missing id`);
    try {
      await this.q.query(
        `INSERT INTO ${tableName(c)} (id, data) VALUES ($1, $2::text::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        [clean.id, JSON.stringify(clean)],
      );
    } catch (err) {
      throw toUniqueViolation(c, err) ?? err;
    }
    return cloneDoc(clean) as unknown as DocOf<C>;
  }

  async update<C extends CollectionName>(c: C, id: string, patch: Partial<DocOf<C>>): Promise<DocOf<C>> {
    this.writable();
    const raw = patch as Record<string, unknown>;
    // `{ ...prev, key: undefined }` drops the key in MemoryStore – do the same here.
    const removed = Object.keys(raw).filter((k) => raw[k] === undefined && k !== 'id');
    const clean = cloneDoc(raw);
    delete clean.id;
    const minus = removed.map((k) => ` - '${field(k)}'`).join('');
    let r: QueryResult;
    try {
      r = await this.q.query(`UPDATE ${tableName(c)} SET data = (data${minus}) || $2::text::jsonb WHERE id = $1 RETURNING data`, [id, JSON.stringify(clean)]);
    } catch (err) {
      throw toUniqueViolation(c, err) ?? err;
    }
    if (!r.rows[0]) throw new DocNotFound(c, id);
    return parseData(r.rows[0]) as unknown as DocOf<C>;
  }

  async delete<C extends CollectionName>(c: C, id: string): Promise<boolean> {
    this.writable();
    const r = await this.q.query(`DELETE FROM ${tableName(c)} WHERE id = $1`, [id]);
    return r.rowCount > 0;
  }

  async deleteWhere<C extends CollectionName>(c: C, where: Where<DocOf<C>>): Promise<number> {
    this.writable();
    const params: unknown[] = [];
    const cond = buildWhere(where as Record<string, unknown>, params);
    const r = await this.q.query(`DELETE FROM ${tableName(c)} WHERE ${cond}`, params);
    return r.rowCount;
  }

  afterCommit(fn: () => void | Promise<void>): void {
    this.after.push(fn);
  }
}

export interface SqlStoreOptions {
  onError?: (err: unknown) => void;
  /** Attempts for transactions that hit a serialization failure or deadlock. */
  maxAttempts?: number;
}

export class SqlStore implements Store {
  readonly kind = 'sql' as const;
  constructor(
    readonly driver: SqlDriver,
    private readonly opts: SqlStoreOptions = {},
  ) {}

  tx<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    return this.run(fn, false);
  }

  read<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    return this.run(fn, true);
  }

  private async run<R>(fn: (tx: Tx) => Promise<R>, readOnly: boolean): Promise<R> {
    const attempts = this.opts.maxAttempts ?? 4;
    for (let attempt = 1; ; attempt++) {
      const after: (() => void | Promise<void>)[] = [];
      let tx: SqlTx | null = null;
      try {
        const result = await this.driver.transaction(async (q) => {
          // A consistent snapshot for multi-query reads.
          if (readOnly) await q.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
          tx = new SqlTx(q, readOnly, after);
          try {
            return await fn(tx);
          } finally {
            tx.closed = true;
          }
        });
        for (const cb of after) {
          try {
            await cb();
          } catch (err) {
            (this.opts.onError ?? console.error)(err);
          }
        }
        return result;
      } catch (err) {
        if (isRetryable(err) && attempt < attempts) {
          await new Promise((r) => setTimeout(r, 15 * attempt + Math.random() * 25));
          continue;
        }
        throw err;
      }
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}

// ── Drivers ──────────────────────────────────────────────────────────────────

/** postgres.js driver (production: Neon, Supabase, Render, RDS, …). */
export async function createPostgresDriver(url: string, opts: { max?: number; ssl?: boolean | 'require' | 'prefer' } = {}): Promise<SqlDriver> {
  const { default: postgres } = await import('postgres');
  const sql = postgres(url, {
    max: opts.max ?? 10,
    idle_timeout: 30,
    connect_timeout: 15,
    ssl: opts.ssl === undefined ? undefined : opts.ssl === true ? 'require' : opts.ssl === false ? false : opts.ssl,
    onnotice: () => {},
    // JSON parameters are sent as text and cast in SQL ($1::text::jsonb): the driver must never
    // re-serialize them (a jsonb-typed parameter would be JSON-encoded a second time).
    prepare: true,
  });
  const wrap = (runner: { unsafe: (q: string, p?: never[]) => Promise<unknown> }): Queryable => ({
    async query(text, params = []) {
      const res = (await runner.unsafe(text, params as never[])) as unknown as Record<string, unknown>[] & { count: number };
      return { rows: [...res], rowCount: res.count ?? res.length };
    },
  });
  const root = wrap(sql as never);
  return {
    kind: 'postgres',
    query: root.query,
    async transaction(fn) {
      return (await sql.begin(async (tx) => fn(wrap(tx as never)))) as never;
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}

/** PGlite driver: a real Postgres compiled to WASM, stored in a folder. No database server needed. */
export async function createPgliteDriver(dataDir: string | undefined): Promise<SqlDriver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
  const wrap = (runner: { query: (q: string, p?: unknown[]) => Promise<{ rows: unknown[]; affectedRows?: number }> }): Queryable => ({
    async query(text, params = []) {
      const res = await runner.query(text, params);
      return { rows: res.rows as Record<string, unknown>[], rowCount: res.affectedRows ?? res.rows.length };
    },
  });
  const root = wrap(db as never);
  return {
    kind: 'pglite',
    query: root.query,
    async transaction(fn) {
      return db.transaction(async (tx) => fn(wrap(tx as never)));
    },
    async close() {
      await db.close();
    },
  };
}
