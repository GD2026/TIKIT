import type * as T from '../../shared/types';

/**
 * Document store abstraction. Every collection holds JSON documents keyed by `id`.
 * Implementations: MemoryStore (browser demo + tests) and SqlStore (Postgres / PGlite).
 * All read-modify-write logic runs inside `store.tx()`; rows that are modified based on
 * what was read must be fetched with `{ forUpdate: true }` (row lock in Postgres).
 */
export interface Collections {
  users: T.User;
  identities: T.Identity;
  sessions: T.Session;
  organizers: T.Organizer;
  orgMembers: T.OrgMember;
  orgInvites: T.OrgInvite;
  events: T.EventDoc;
  ticketTypes: T.TicketType;
  holds: T.Hold;
  orders: T.Order;
  payments: T.Payment;
  paymentJobs: T.PaymentJob;
  tickets: T.Ticket;
  transfers: T.Transfer;
  resaleListings: T.ResaleListing;
  discountCodes: T.DiscountCode;
  waitlist: T.WaitlistEntry;
  saleAlerts: T.SaleAlert;
  queues: T.QueueState;
  queueEntries: T.QueueEntry;
  checkins: T.CheckinLog;
  scannerCodes: T.ScannerCode;
  notifications: T.AppNotification;
  favorites: T.Favorite;
  follows: T.Follow;
  images: T.ImageDoc;
  seatMaps: T.SeatMap;
  seatStates: T.SeatState;
  payouts: T.Payout;
  settings: T.PlatformSettings;
  outbox: T.OutboxEmail;
  audit: T.AuditEntry;
  kv: T.KvDoc;
}

export type CollectionName = keyof Collections;
export type DocOf<C extends CollectionName> = Collections[C];

export const COLLECTIONS: CollectionName[] = [
  'users',
  'identities',
  'sessions',
  'organizers',
  'orgMembers',
  'orgInvites',
  'events',
  'ticketTypes',
  'holds',
  'orders',
  'payments',
  'paymentJobs',
  'tickets',
  'transfers',
  'resaleListings',
  'discountCodes',
  'waitlist',
  'saleAlerts',
  'queues',
  'queueEntries',
  'checkins',
  'scannerCodes',
  'notifications',
  'favorites',
  'follows',
  'images',
  'seatMaps',
  'seatStates',
  'payouts',
  'settings',
  'outbox',
  'audit',
  'kv',
];

type Scalar = string | number | boolean | null;

/** Equality filters on top-level scalar fields, or `{ in: [...] }` for string/number/boolean fields. */
export type Where<D> = {
  [K in keyof D]?: D[K] extends Scalar ? D[K] | { in: readonly NonNullable<D[K]>[] } : never;
};

export interface FindOptions<D> {
  forUpdate?: boolean;
  orderBy?: { field: keyof D & string; dir?: 'asc' | 'desc'; numeric?: boolean };
  limit?: number;
}

export interface Tx {
  get<C extends CollectionName>(c: C, id: string, opts?: { forUpdate?: boolean }): Promise<DocOf<C> | null>;
  getMany<C extends CollectionName>(c: C, ids: readonly string[]): Promise<DocOf<C>[]>;
  find<C extends CollectionName>(c: C, where?: Where<DocOf<C>>, opts?: FindOptions<DocOf<C>>): Promise<DocOf<C>[]>;
  findOne<C extends CollectionName>(c: C, where: Where<DocOf<C>>, opts?: { forUpdate?: boolean }): Promise<DocOf<C> | null>;
  count<C extends CollectionName>(c: C, where?: Where<DocOf<C>>): Promise<number>;
  /** Throws UniqueViolation on duplicate id or unique key. */
  insert<C extends CollectionName>(c: C, doc: DocOf<C>): Promise<DocOf<C>>;
  /** Insert or replace by id. */
  put<C extends CollectionName>(c: C, doc: DocOf<C>): Promise<DocOf<C>>;
  /** Shallow merge. Throws if the document doesn't exist. */
  update<C extends CollectionName>(c: C, id: string, patch: Partial<DocOf<C>>): Promise<DocOf<C>>;
  delete<C extends CollectionName>(c: C, id: string): Promise<boolean>;
  deleteWhere<C extends CollectionName>(c: C, where: Where<DocOf<C>>): Promise<number>;
  /** Runs after a successful commit (emails, logging). Errors are logged, never thrown. */
  afterCommit(fn: () => void | Promise<void>): void;
}

export interface Store {
  readonly kind: 'memory' | 'sql';
  tx<R>(fn: (tx: Tx) => Promise<R>): Promise<R>;
  /** Read-only work. Implementations may skip locking. */
  read<R>(fn: (tx: Tx) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

/** Unique constraints per collection (fields that together must be unique; null values are ignored). */
export const UNIQUE_KEYS: { [C in CollectionName]?: (keyof DocOf<C> & string)[][] } = {
  identities: [['provider', 'subject']],
  organizers: [['slug']],
  orgMembers: [['organizerId', 'userId']],
  events: [['slug']],
  orders: [['idemKey'], ['ref']],
  payments: [['provider', 'providerRef']],
  tickets: [['number']],
  discountCodes: [['eventId', 'code']],
  waitlist: [['eventId', 'userId']],
  queueEntries: [['eventId', 'userId']],
};

/** Fields worth a dedicated btree expression index in Postgres (beyond the GIN containment index). */
export const INDEX_FIELDS: { [C in CollectionName]?: (keyof DocOf<C> & string)[] } = {
  identities: ['userId'],
  sessions: ['userId'],
  orgMembers: ['userId', 'organizerId'],
  events: ['organizerId', 'status'],
  ticketTypes: ['eventId'],
  holds: ['ticketTypeId', 'orderId'],
  orders: ['userId', 'eventId', 'organizerId'],
  payments: ['orderId'],
  paymentJobs: ['status', 'paymentId'],
  tickets: ['ownerId', 'eventId', 'orderId'],
  transfers: ['ticketId', 'tokenHash'],
  resaleListings: ['eventId', 'ticketId'],
  discountCodes: ['eventId'],
  waitlist: ['eventId'],
  queueEntries: ['eventId'],
  checkins: ['eventId'],
  scannerCodes: ['eventId'],
  notifications: ['userId'],
  favorites: ['userId'],
  follows: ['userId', 'organizerId'],
};

export class UniqueViolation extends Error {
  constructor(
    readonly collection: string,
    readonly fields: string[],
  ) {
    super(`Unique violation on ${collection}(${fields.join(',')})`);
    this.name = 'UniqueViolation';
  }
}

export class DocNotFound extends Error {
  constructor(
    readonly collection: string,
    readonly id: string,
  ) {
    super(`Document ${collection}/${id} not found`);
    this.name = 'DocNotFound';
  }
}

/** JSON round-trip: drops undefined, copies deeply. Both stores persist exactly this shape. */
export function cloneDoc<D>(doc: D): D {
  return JSON.parse(JSON.stringify(doc)) as D;
}

export function matchesWhere(doc: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries(where)) {
    if (cond === undefined) continue;
    const value = doc[key] === undefined ? null : doc[key];
    if (cond !== null && typeof cond === 'object' && 'in' in cond) {
      const list = (cond as { in: readonly unknown[] }).in;
      if (!list.includes(value)) return false;
    } else if (value !== cond) {
      return false;
    }
  }
  return true;
}
