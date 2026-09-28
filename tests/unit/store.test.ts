import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryStore } from '../../src/server/store/memory';
import { DocNotFound, UniqueViolation, type Store } from '../../src/server/store/types';
import { SqlStore, createPgliteDriver, createPostgresDriver, migrate } from '../../src/node/db/sqlStore';
import type { Identity, KvDoc, Ticket } from '../../src/shared/types';

/**
 * One contract, three implementations: the in-memory store (browser demo), PGlite and – when
 * TIKIT_TEST_DATABASE_URL points at a Postgres server – real Postgres.
 */

type Factory = { name: string; make: () => Promise<Store>; cleanup?: (s: Store) => Promise<void> };

const factories: Factory[] = [
  { name: 'memory', make: async () => new MemoryStore() },
  {
    name: 'pglite',
    make: async () => {
      const driver = await createPgliteDriver(undefined);
      await migrate(driver);
      return new SqlStore(driver);
    },
    cleanup: (s) => s.close(),
  },
];

if (process.env.TIKIT_TEST_DATABASE_URL) {
  factories.push({
    name: 'postgres',
    make: async () => {
      const driver = await createPostgresDriver(process.env.TIKIT_TEST_DATABASE_URL!, { max: 4 });
      await migrate(driver);
      // Fresh tables for every run.
      await driver.query("DO $$ DECLARE r record; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE tablename LIKE 'tikit\\_%' AND tablename <> 'tikit_meta' LOOP EXECUTE 'TRUNCATE ' || quote_ident(r.tablename); END LOOP; END $$");
      return new SqlStore(driver);
    },
    cleanup: (s) => s.close(),
  });
}

function kv(id: string, value: unknown, updatedAt = '2026-01-01T00:00:00.000Z'): KvDoc {
  return { id, value, updatedAt };
}

function ident(id: string, provider: Identity['provider'], subject: string): Identity {
  return {
    id,
    userId: `u-${id}`,
    provider,
    subject,
    email: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: '2026-01-01T00:00:00.000Z',
  } as Identity;
}

function ticket(id: string, fields: Partial<Ticket>): Ticket {
  return {
    id,
    number: `TK-${id}`,
    orderId: 'o1',
    originalOrderId: 'o1',
    eventId: 'e1',
    organizerId: 'org1',
    ticketTypeId: 'tt1',
    typeName: 'Ordinær',
    pricePaidOre: 10000,
    purchaserId: 'u1',
    ownerId: 'u1',
    holderName: 'Test',
    seat: null,
    kind: 'paid',
    status: 'valid',
    secret: 'x',
    checkedInAt: null,
    checkedInBy: null,
    transferId: null,
    resaleListingId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...fields,
  } as Ticket;
}

for (const f of factories) {
  describe(`store contract: ${f.name}`, () => {
    let store: Store;
    beforeAll(async () => {
      store = await f.make();
    });
    afterAll(async () => {
      await f.cleanup?.(store);
    });

    it('inserts, reads and round-trips JSON (undefined dropped)', async () => {
      await store.tx(async (tx) => {
        await tx.insert('kv', { id: 'a', value: { n: 1, nested: { ok: true }, gone: undefined }, updatedAt: '2026-01-01T00:00:00.000Z' });
      });
      const doc = await store.read((tx) => tx.get('kv', 'a'));
      expect(doc).toEqual({ id: 'a', value: { n: 1, nested: { ok: true } }, updatedAt: '2026-01-01T00:00:00.000Z' });
      expect(await store.read((tx) => tx.get('kv', 'missing'))).toBeNull();
    });

    it('rejects duplicate ids and unique keys, allows null keys', async () => {
      await expect(store.tx((tx) => tx.insert('kv', kv('a', 2)))).rejects.toBeInstanceOf(UniqueViolation);
      await store.tx((tx) => tx.insert('identities', ident('i1', 'vipps', 'sub-1')));
      const err = await store.tx((tx) => tx.insert('identities', ident('i2', 'vipps', 'sub-1'))).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UniqueViolation);
      expect((err as UniqueViolation).fields).toEqual(['provider', 'subject']);
      // Same subject at another provider is fine.
      await store.tx((tx) => tx.insert('identities', ident('i3', 'google', 'sub-1')));
      // Null members of a unique key never collide (orders.idemKey is null for most orders).
      await store.tx(async (tx) => {
        await tx.insert('orders', { id: 'o-a', ref: 'TK-AAAAAA', idemKey: null } as never);
        await tx.insert('orders', { id: 'o-b', ref: 'TK-BBBBBB', idemKey: null } as never);
      });
    });

    it('rolls back everything when the transaction throws', async () => {
      await expect(
        store.tx(async (tx) => {
          await tx.insert('kv', kv('rb1', 1));
          await tx.update('kv', 'a', { value: 'changed' });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await store.read((tx) => tx.get('kv', 'rb1'))).toBeNull();
      expect((await store.read((tx) => tx.get('kv', 'a')))?.value).toEqual({ n: 1, nested: { ok: true } });
    });

    it('update merges shallowly, removes keys set to undefined, keeps id', async () => {
      await store.tx((tx) => tx.insert('tickets', ticket('t-up', { checkedInBy: 'Dør A', seat: { id: 's', section: 'A', row: '1', number: 2 } as never })));
      const updated = await store.tx((tx) => tx.update('tickets', 't-up', { status: 'used', checkedInBy: undefined, id: 'hacked' } as never));
      expect(updated.id).toBe('t-up');
      expect(updated.status).toBe('used');
      expect('checkedInBy' in updated).toBe(false);
      expect(updated.seat).toEqual({ id: 's', section: 'A', row: '1', number: 2 });
      await expect(store.tx((tx) => tx.update('tickets', 'nope', { status: 'used' }))).rejects.toBeInstanceOf(DocNotFound);
    });

    it('put inserts or replaces', async () => {
      await store.tx((tx) => tx.put('kv', kv('p', 1)));
      await store.tx((tx) => tx.put('kv', kv('p', 2)));
      expect((await store.read((tx) => tx.get('kv', 'p')))?.value).toBe(2);
    });

    it('filters on equality, null/missing, in-lists and combinations', async () => {
      await store.tx(async (tx) => {
        await tx.insert('tickets', ticket('f1', { eventId: 'ev', status: 'valid', checkedInAt: null, pricePaidOre: 100 }));
        await tx.insert('tickets', ticket('f2', { eventId: 'ev', status: 'used', checkedInAt: '2026-02-01T20:00:00.000Z', pricePaidOre: 200 }));
        await tx.insert('tickets', ticket('f3', { eventId: 'ev', status: 'refunded', checkedInAt: null, pricePaidOre: 300 }));
        await tx.insert('tickets', ticket('f4', { eventId: 'other', status: 'valid', pricePaidOre: 100 }));
        const t5 = ticket('f5', { eventId: 'ev', status: 'valid', pricePaidOre: 50 }) as unknown as Record<string, unknown>;
        delete t5.transferId; // missing field behaves like null
        await tx.insert('tickets', t5 as unknown as Ticket);
      });
      const ids = (docs: { id: string }[]) => docs.map((d) => d.id).sort();
      await store.read(async (tx) => {
        expect(ids(await tx.find('tickets', { eventId: 'ev', status: 'valid' }))).toEqual(['f1', 'f5']);
        expect(ids(await tx.find('tickets', { eventId: 'ev', status: { in: ['used', 'refunded'] } }))).toEqual(['f2', 'f3']);
        expect(ids(await tx.find('tickets', { eventId: 'ev', checkedInAt: null }))).toEqual(['f1', 'f3', 'f5']);
        expect(ids(await tx.find('tickets', { eventId: 'ev', transferId: null }))).toEqual(['f1', 'f2', 'f3', 'f5']);
        expect(ids(await tx.find('tickets', { eventId: 'ev', pricePaidOre: 100 }))).toEqual(['f1']);
        expect(await tx.find('tickets', { eventId: 'ev', status: { in: [] } })).toEqual([]);
        expect(await tx.count('tickets', { eventId: 'ev' })).toBe(4);
        expect(await tx.count('tickets', { eventId: 'ev', status: 'valid' })).toBe(2);
        expect((await tx.findOne('tickets', { eventId: 'other' }))?.id).toBe('f4');
        expect(await tx.findOne('tickets', { eventId: 'none' })).toBeNull();
      });
    });

    it('orders with nulls last and id tie-break; numeric ordering; limit; insertion order by default', async () => {
      await store.read(async (tx) => {
        const byCheckin = await tx.find('tickets', { eventId: 'ev' }, { orderBy: { field: 'checkedInAt', dir: 'desc' } });
        expect(byCheckin.map((t) => t.id)).toEqual(['f2', 'f1', 'f3', 'f5']);
        const byPrice = await tx.find('tickets', { eventId: 'ev' }, { orderBy: { field: 'pricePaidOre', dir: 'desc', numeric: true }, limit: 2 });
        expect(byPrice.map((t) => t.id)).toEqual(['f3', 'f2']);
        const asc = await tx.find('tickets', { eventId: 'ev' }, { orderBy: { field: 'pricePaidOre', numeric: true } });
        expect(asc.map((t) => t.id)).toEqual(['f5', 'f1', 'f2', 'f3']);
        const inserted = await tx.find('tickets', { eventId: 'ev' });
        expect(inserted.map((t) => t.id)).toEqual(['f1', 'f2', 'f3', 'f5']);
      });
    });

    it('getMany keeps the order asked for and skips unknown ids', async () => {
      const docs = await store.read((tx) => tx.getMany('tickets', ['f3', 'nope', 'f1', 'f3']));
      expect(docs.map((d) => d.id)).toEqual(['f3', 'f1']);
    });

    it('deletes by id and by filter', async () => {
      await store.tx(async (tx) => {
        expect(await tx.delete('tickets', 'f4')).toBe(true);
        expect(await tx.delete('tickets', 'f4')).toBe(false);
        expect(await tx.deleteWhere('tickets', { eventId: 'ev', status: 'valid' })).toBe(2);
      });
      expect(await store.read((tx) => tx.count('tickets', { eventId: 'ev' }))).toBe(2);
    });

    it('runs afterCommit only after a successful commit', async () => {
      const calls: string[] = [];
      await store.tx(async (tx) => {
        tx.afterCommit(() => {
          calls.push('ok');
        });
        await tx.insert('kv', kv('ac1', 1));
      });
      await store
        .tx(async (tx) => {
          tx.afterCommit(() => {
            calls.push('never');
          });
          throw new Error('fail');
        })
        .catch(() => {});
      expect(calls).toEqual(['ok']);
    });

    it('serializes concurrent read-modify-write with forUpdate (no lost updates)', async () => {
      await store.tx((tx) => tx.insert('kv', kv('counter', 0)));
      await Promise.all(
        Array.from({ length: 12 }, () =>
          store.tx(async (tx) => {
            const doc = await tx.get('kv', 'counter', { forUpdate: true });
            await tx.update('kv', 'counter', { value: (doc!.value as number) + 1 });
          }),
        ),
      );
      expect((await store.read((tx) => tx.get('kv', 'counter')))?.value).toBe(12);
    });
  });
}
