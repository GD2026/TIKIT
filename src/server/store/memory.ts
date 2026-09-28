import {
  COLLECTIONS,
  UNIQUE_KEYS,
  UniqueViolation,
  DocNotFound,
  cloneDoc,
  matchesWhere,
  type CollectionName,
  type DocOf,
  type FindOptions,
  type Store,
  type Tx,
  type Where,
} from './types';

export type MemorySnapshot = Partial<Record<CollectionName, Record<string, unknown>[]>>;

export interface MemoryStoreOptions {
  initial?: MemorySnapshot;
  /** Called after every committed write transaction (debounce persistence in the caller). */
  onCommit?: () => void;
  onError?: (err: unknown) => void;
}

type AnyDoc = Record<string, unknown> & { id: string };

/**
 * In-memory store with serialized transactions and undo-log rollback.
 * Used by the in-browser demo and by tests. Semantics mirror SqlStore: JSON round-trips,
 * unique constraints, rollback on error, afterCommit hooks.
 */
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private readonly data = new Map<CollectionName, Map<string, AnyDoc>>();
  private queue: Promise<void> = Promise.resolve();
  private readonly opts: MemoryStoreOptions;

  constructor(opts: MemoryStoreOptions = {}) {
    this.opts = opts;
    for (const c of COLLECTIONS) this.data.set(c, new Map());
    if (opts.initial) this.load(opts.initial);
  }

  private acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.queue;
    this.queue = prev.then(() => next);
    return prev.then(() => release);
  }

  collection(c: CollectionName): Map<string, AnyDoc> {
    const map = this.data.get(c);
    if (!map) throw new Error(`Unknown collection ${c}`);
    return map;
  }

  async tx<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    return this.run(fn, true);
  }

  async read<R>(fn: (tx: Tx) => Promise<R>): Promise<R> {
    return this.run(fn, false);
  }

  private async run<R>(fn: (tx: Tx) => Promise<R>, write: boolean): Promise<R> {
    const release = await this.acquire();
    const undo: (() => void)[] = [];
    const after: (() => void | Promise<void>)[] = [];
    const tx = new MemoryTx(this, undo, after);
    let result: R;
    try {
      result = await fn(tx);
      tx.closed = true;
    } catch (err) {
      tx.closed = true;
      for (let i = undo.length - 1; i >= 0; i--) undo[i]!();
      release();
      throw err;
    }
    release();
    if (write && undo.length > 0) {
      try {
        this.opts.onCommit?.();
      } catch (err) {
        this.opts.onError?.(err);
      }
    }
    for (const cb of after) {
      try {
        await cb();
      } catch (err) {
        (this.opts.onError ?? console.error)(err);
      }
    }
    return result;
  }

  snapshot(): MemorySnapshot {
    const out: MemorySnapshot = {};
    for (const [c, map] of this.data) {
      if (map.size > 0) out[c] = [...map.values()].map((d) => cloneDoc(d));
    }
    return out;
  }

  load(snapshot: MemorySnapshot): void {
    for (const c of COLLECTIONS) this.collection(c).clear();
    for (const [c, docs] of Object.entries(snapshot) as [CollectionName, AnyDoc[]][]) {
      const map = this.data.get(c);
      if (!map || !Array.isArray(docs)) continue;
      for (const d of docs) if (d && typeof d.id === 'string') map.set(d.id, cloneDoc(d));
    }
  }

  async close(): Promise<void> {
    await this.acquire().then((release) => release());
  }
}

function checkUnique(store: MemoryStore, c: CollectionName, doc: AnyDoc): void {
  const keys = UNIQUE_KEYS[c] as string[][] | undefined;
  if (!keys) return;
  const map = store.collection(c);
  for (const fields of keys) {
    const values = fields.map((f) => doc[f]);
    if (values.some((v) => v === null || v === undefined)) continue;
    for (const other of map.values()) {
      if (other.id === doc.id) continue;
      if (fields.every((f, i) => other[f] === values[i])) throw new UniqueViolation(c, fields);
    }
  }
}

class MemoryTx implements Tx {
  closed = false;

  constructor(
    private readonly store: MemoryStore,
    private readonly undo: (() => void)[],
    private readonly after: (() => void | Promise<void>)[],
  ) {}

  private ensureOpen(): void {
    if (this.closed) throw new Error('Transaction is closed');
  }

  async get<C extends CollectionName>(c: C, id: string): Promise<DocOf<C> | null> {
    this.ensureOpen();
    const doc = this.store.collection(c).get(id);
    return doc ? (cloneDoc(doc) as unknown as DocOf<C>) : null;
  }

  async getMany<C extends CollectionName>(c: C, ids: readonly string[]): Promise<DocOf<C>[]> {
    this.ensureOpen();
    const map = this.store.collection(c);
    const out: DocOf<C>[] = [];
    for (const id of new Set(ids)) {
      const doc = map.get(id);
      if (doc) out.push(cloneDoc(doc) as unknown as DocOf<C>);
    }
    return out;
  }

  async find<C extends CollectionName>(c: C, where?: Where<DocOf<C>>, opts: FindOptions<DocOf<C>> = {}): Promise<DocOf<C>[]> {
    this.ensureOpen();
    let docs = [...this.store.collection(c).values()].filter((d) => matchesWhere(d, where as Record<string, unknown>));
    if (opts.orderBy) {
      const { field, dir = 'asc', numeric } = opts.orderBy;
      const sign = dir === 'desc' ? -1 : 1;
      docs = docs.sort((a, b) => {
        const av = a[field];
        const bv = b[field];
        if (av === bv) return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        if (numeric) return (Number(av) - Number(bv)) * sign;
        return (String(av) < String(bv) ? -1 : 1) * sign;
      });
    }
    if (opts.limit !== undefined) docs = docs.slice(0, opts.limit);
    return docs.map((d) => cloneDoc(d) as unknown as DocOf<C>);
  }

  async findOne<C extends CollectionName>(c: C, where: Where<DocOf<C>>): Promise<DocOf<C> | null> {
    const [first] = await this.find(c, where, { limit: 1 });
    return first ?? null;
  }

  async count<C extends CollectionName>(c: C, where?: Where<DocOf<C>>): Promise<number> {
    this.ensureOpen();
    let n = 0;
    for (const d of this.store.collection(c).values()) if (matchesWhere(d, where as Record<string, unknown>)) n++;
    return n;
  }

  async insert<C extends CollectionName>(c: C, doc: DocOf<C>): Promise<DocOf<C>> {
    this.ensureOpen();
    const map = this.store.collection(c);
    const clean = cloneDoc(doc) as unknown as AnyDoc;
    if (!clean.id) throw new Error(`Document in ${c} is missing id`);
    if (map.has(clean.id)) throw new UniqueViolation(c, ['id']);
    checkUnique(this.store, c, clean);
    map.set(clean.id, clean);
    this.undo.push(() => map.delete(clean.id));
    return cloneDoc(clean) as unknown as DocOf<C>;
  }

  async put<C extends CollectionName>(c: C, doc: DocOf<C>): Promise<DocOf<C>> {
    this.ensureOpen();
    const map = this.store.collection(c);
    const clean = cloneDoc(doc) as unknown as AnyDoc;
    checkUnique(this.store, c, clean);
    const prev = map.get(clean.id);
    map.set(clean.id, clean);
    this.undo.push(() => {
      if (prev) map.set(clean.id, prev);
      else map.delete(clean.id);
    });
    return cloneDoc(clean) as unknown as DocOf<C>;
  }

  async update<C extends CollectionName>(c: C, id: string, patch: Partial<DocOf<C>>): Promise<DocOf<C>> {
    this.ensureOpen();
    const map = this.store.collection(c);
    const prev = map.get(id);
    if (!prev) throw new DocNotFound(c, id);
    const next = cloneDoc({ ...prev, ...patch, id }) as AnyDoc;
    checkUnique(this.store, c, next);
    map.set(id, next);
    this.undo.push(() => map.set(id, prev));
    return cloneDoc(next) as unknown as DocOf<C>;
  }

  async delete<C extends CollectionName>(c: C, id: string): Promise<boolean> {
    this.ensureOpen();
    const map = this.store.collection(c);
    const prev = map.get(id);
    if (!prev) return false;
    map.delete(id);
    this.undo.push(() => map.set(id, prev));
    return true;
  }

  async deleteWhere<C extends CollectionName>(c: C, where: Where<DocOf<C>>): Promise<number> {
    const docs = await this.find(c, where);
    for (const d of docs) await this.delete(c, (d as unknown as AnyDoc).id);
    return docs.length;
  }

  afterCommit(fn: () => void | Promise<void>): void {
    this.after.push(fn);
  }
}
