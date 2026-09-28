import { newId, newToken, slugify } from '../shared/ids';
import { sha256Hex } from '../shared/encoding';
import { osloLocalToUtc, osloParts, addDays } from '../shared/time';
import { feeForPrice } from '../shared/pricing';
import { DEFAULT_PLATFORM_SETTINGS, type CategoryId, type PosterPaletteId, type PosterStyle } from '../shared/constants';
import type {
  EventDoc,
  EventSettings,
  Order,
  Organizer,
  SeatMap,
  Ticket,
  TicketType,
  User,
} from '../shared/types';
import type { Deps } from './context';
import type { Tx } from './store/types';
import { mulberry32 } from './services/common';
import { DEFAULT_PREFS } from './services/users';
import { hashAccessCode } from './services/events';
import { seatIdFor } from './services/inventory';

/**
 * Demo data – every organizer, venue, artist and person here is fictional.
 * Dates are generated relative to "now", so the demo always looks current.
 */

export const DEMO_SCANNER_CODE = '4242-4242-4242';

const pad = (n: number) => String(n).padStart(2, '0');

function osloAt(now: Date, daysAhead: number, hh: number, mm = 0): string {
  const d = addDays(now, daysAhead);
  const p = osloParts(d);
  return osloLocalToUtc(`${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(hh)}:${pad(mm)}`).toISOString();
}

/** Next given weekday (0=Sun..6=Sat) at least `minDays` ahead. */
function nextWeekday(now: Date, weekday: number, minDays: number): number {
  for (let i = minDays; i < minDays + 7; i++) if (osloParts(addDays(now, i)).weekday === weekday) return i;
  return minDays;
}

const FIRST = ['Emil', 'Nora', 'Jakob', 'Sara', 'Oliver', 'Ingrid', 'Lukas', 'Maja', 'Filip', 'Thea', 'Henrik', 'Ella', 'Aksel', 'Selma', 'Magnus', 'Frida', 'Tobias', 'Julie', 'Elias', 'Amalie', 'Sander', 'Vilde', 'Mathias', 'Hedda', 'Kasper', 'Tiril', 'Adrian', 'Aurora', 'Isak', 'Live', 'William', 'Emma', 'Noah', 'Olivia', 'Johannes', 'Sofie', 'Sebastian', 'Leah', 'Theodor', 'Astrid', 'Ludvig', 'Mathilde', 'Kristian', 'Iben', 'Benjamin', 'Linnea', 'Markus', 'Hanna', 'Sindre', 'Mia', 'Eirik', 'Ida', 'Vetle', 'Marte', 'Håkon', 'Signe', 'Ola', 'Karoline', 'Even', 'Ronja'];
const LAST = ['Larsen', 'Olsen', 'Johansen', 'Nilsen', 'Andersen', 'Pedersen', 'Kristiansen', 'Jensen', 'Karlsen', 'Berg', 'Haugen', 'Hagen', 'Eriksen', 'Dahl', 'Lie', 'Moen', 'Solberg', 'Tveit', 'Vik', 'Aasen', 'Hansen', 'Johnsen', 'Halvorsen', 'Jacobsen', 'Strand', 'Bakken', 'Sæther', 'Iversen', 'Lunde', 'Myhre', 'Rønning', 'Kvalheim', 'Holm', 'Fjeld', 'Eide', 'Nygård', 'Bjørnstad', 'Mikkelsen', 'Aune', 'Sørensen'];

interface SeedCtx {
  tx: Tx;
  deps: Deps;
  now: Date;
  nowS: string;
  rand: () => number;
  users: User[];
  /** Cover pictures by event slug (Node server only – see src/node/demoImages.ts). */
  covers: ReadonlyMap<string, SeedImage>;
}

function makeUser(ctx: SeedCtx, name: string, email: string | null, extra: Partial<User> = {}): User {
  const u: User = {
    id: newId(),
    name,
    email,
    emailVerified: !!email,
    phone: null,
    phoneVerified: false,
    birthdate: null,
    birthdateVerified: false,
    city: null,
    role: 'user',
    prefs: { ...DEFAULT_PREFS },
    banned: false,
    createdAt: addDays(ctx.now, -60 - Math.floor(ctx.rand() * 200)).toISOString(),
    updatedAt: ctx.nowS,
    lastLoginAt: ctx.nowS,
    deletedAt: null,
    ...extra,
  };
  return u;
}

function settings(overrides: Partial<EventSettings> = {}): EventSettings {
  return {
    maxPerOrder: 8,
    personalizedTickets: false,
    transfersAllowed: true,
    resaleAllowed: true,
    refundPolicy: 'until-48h',
    queueEnabled: false,
    queueRatePerMinute: 200,
    waitlistEnabled: true,
    showRemaining: false,
    requireVerifiedAge: false,
    ...overrides,
  };
}

interface EventSpec {
  org: Organizer;
  title: string;
  subtitle: string;
  description: string;
  category: CategoryId;
  city: string;
  venue: { name: string; address: string; postalCode: string };
  startsAt: string;
  endsAt: string;
  doorsAt?: string | null;
  salesStartAt?: string | null;
  ageLimit: number | null;
  poster: { style: PosterStyle; palette: PosterPaletteId };
  lineup?: { name: string; time: string | null }[];
  tags?: string[];
  settings?: Partial<EventSettings>;
  featured?: boolean;
  status?: EventDoc['status'];
  createdDaysAgo?: number;
}

/** A picture to use as an event cover in the demo data. */
export interface SeedImage {
  mime: 'image/jpeg' | 'image/png';
  /** base64 */
  data: string;
  width: number;
  height: number;
  bytes: number;
}

export interface SeedOptions {
  /** Cover pictures by event slug. Without them the events use generated posters. */
  covers?: ReadonlyMap<string, SeedImage>;
}

async function makeEvent(ctx: SeedCtx, spec: EventSpec): Promise<EventDoc> {
  const created = addDays(ctx.now, -(spec.createdDaysAgo ?? 30)).toISOString();
  const slug = slugify(spec.title);
  const cover = ctx.covers.get(slug);
  let coverImageId: string | null = null;
  if (cover) {
    coverImageId = newId();
    await ctx.tx.insert('images', { id: coverImageId, ownerId: spec.org.createdBy, createdAt: created, ...cover });
  }
  const e: EventDoc = {
    id: newId(),
    organizerId: spec.org.id,
    slug,
    title: spec.title,
    subtitle: spec.subtitle,
    description: spec.description,
    category: spec.category,
    status: spec.status ?? 'published',
    visibility: 'public',
    startsAt: spec.startsAt,
    endsAt: spec.endsAt,
    doorsAt: spec.doorsAt ?? null,
    salesStartAt: spec.salesStartAt ?? null,
    salesEndAt: null,
    venue: { ...spec.venue, city: spec.city },
    city: spec.city,
    ageLimit: spec.ageLimit,
    poster: { ...spec.poster, seed: Math.floor(ctx.rand() * 1_000_000) },
    coverImageId,
    lineup: spec.lineup ?? [],
    tags: spec.tags ?? [],
    settings: settings(spec.settings),
    seated: false,
    featured: spec.featured ?? false,
    createdAt: created,
    updatedAt: created,
    publishedAt: spec.status === 'draft' ? null : created,
    cancelledAt: null,
    cancelReason: null,
  };
  await ctx.tx.insert('events', e);
  return e;
}

async function makeType(ctx: SeedCtx, event: EventDoc, t: Partial<TicketType> & { name: string; priceOre: number; capacity: number }, sortOrder: number, accessCode?: string): Promise<TicketType> {
  const tt: TicketType = {
    id: newId(),
    eventId: event.id,
    description: '',
    sold: 0,
    maxPerOrder: null,
    salesStartAt: null,
    salesEndAt: null,
    hidden: false,
    accessCodeHash: accessCode ? await hashAccessCode(event.id, accessCode) : null,
    vatRate: 0,
    sortOrder,
    paused: false,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
    ...t,
  };
  await ctx.tx.insert('ticketTypes', tt);
  return tt;
}

function seedRef(rand: () => number): string {
  const alphabet = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
  return `TK-${s}`;
}

interface SaleOptions {
  buyer?: User;
  qty?: number;
  paidAt?: string;
  /** Per-ticket names; a missing entry falls back to the buyer (first ticket) or "X's gjest". */
  holderNames?: (string | undefined)[];
  seatIds?: { id: string; section: string; row: string; number: number }[];
  checkedIn?: boolean;
  discount?: { codeId: string; code: string; percent: number } | null;
}

/** Inserts a paid order with tickets directly (keeps sold counters consistent). */
async function seedSale(ctx: SeedCtx, event: EventDoc, tt: TicketType, opts: SaleOptions = {}): Promise<{ order: Order; tickets: Ticket[] }> {
  const { tx, rand } = ctx;
  const buyer = opts.buyer ?? ctx.users[Math.floor(rand() * ctx.users.length)]!;
  const qty = opts.qty ?? 1 + Math.floor(rand() * 3);
  const settingsDoc = DEFAULT_PLATFORM_SETTINGS;
  const unit = opts.discount ? tt.priceOre - Math.round((tt.priceOre * opts.discount.percent) / 100) : tt.priceOre;
  const fee = feeForPrice(unit, settingsDoc);
  const created = event.createdAt;
  const holderNames = Array.from({ length: qty }, (_, i) => opts.holderNames?.[i] ?? (i === 0 ? buyer.name : `${buyer.name.split(' ')[0]}s gjest ${i}`));
  const paidAt = opts.paidAt ?? new Date(Date.parse(created) + rand() * Math.max(0, Math.min(ctx.now.getTime(), Date.parse(event.startsAt)) - Date.parse(created))).toISOString();
  let ref = seedRef(rand);
  while (await tx.findOne('orders', { ref })) ref = seedRef(rand);
  const order: Order = {
    id: newId(),
    ref,
    userId: buyer.id,
    eventId: event.id,
    organizerId: event.organizerId,
    kind: 'standard',
    status: 'paid',
    items: [{ ticketTypeId: tt.id, name: tt.name, qty, listPriceOre: tt.priceOre, unitPriceOre: unit, feeOre: fee, vatRate: tt.vatRate, seatIds: (opts.seatIds ?? []).map((s) => s.id) }],
    attendeeNames: opts.holderNames ? holderNames : [],
    discount: opts.discount ? { codeId: opts.discount.codeId, code: opts.discount.code, amountOre: (tt.priceOre - unit) * qty } : null,
    subtotalOre: tt.priceOre * qty,
    discountOre: (tt.priceOre - unit) * qty,
    feeOre: fee * qty,
    totalOre: unit * qty + fee * qty,
    refundedOre: 0,
    refunds: [],
    resaleListingId: null,
    paymentId: null,
    paymentMethod: unit === 0 ? 'free' : rand() < 0.78 ? 'vipps' : 'card',
    idemKey: null,
    buyer: { name: buyer.name, email: buyer.email, phone: buyer.phone },
    expiresAt: paidAt,
    createdAt: paidAt,
    updatedAt: paidAt,
    paidAt,
    cancelledAt: null,
    failureReason: null,
  };
  if (order.totalOre > 0) {
    const paymentId = newId();
    order.paymentId = paymentId;
    await tx.insert('payments', {
      id: paymentId,
      orderId: order.id,
      provider: 'demo',
      method: order.paymentMethod === 'card' ? 'card' : 'vipps',
      providerRef: `tikit-${paymentId}`,
      amountOre: order.totalOre,
      status: 'captured',
      capturedOre: order.totalOre,
      refundedOre: 0,
      redirectUrl: null,
      createdAt: paidAt,
      updatedAt: paidAt,
      lastError: null,
    });
    await tx.put('kv', {
      id: `demopay:tikit-${paymentId}`,
      value: { reference: `tikit-${paymentId}`, method: order.paymentMethod, amountOre: order.totalOre, description: event.title, state: 'captured', capturedOre: order.totalOre, refundedOre: 0, returnUrl: '/', cancelUrl: '/', lines: [], phone: null, createdAt: paidAt },
      updatedAt: paidAt,
    });
  }
  await tx.insert('orders', order);
  const tickets: Ticket[] = [];
  for (let i = 0; i < qty; i++) {
    const seat = opts.seatIds?.[i] ?? null;
    const t: Ticket = {
      id: newId(),
      number: `${ref}-${pad(i + 1)}`,
      orderId: order.id,
      originalOrderId: order.id,
      eventId: event.id,
      organizerId: event.organizerId,
      ticketTypeId: tt.id,
      typeName: tt.name,
      pricePaidOre: unit,
      purchaserId: buyer.id,
      ownerId: buyer.id,
      holderName: holderNames[i]!,
      seat,
      kind: unit === 0 ? 'free' : 'paid',
      status: opts.checkedIn ? 'used' : 'valid',
      secret: newToken(16),
      checkedInAt: opts.checkedIn ? new Date(Date.parse(event.startsAt) + rand() * 90 * 60000).toISOString() : null,
      checkedInBy: opts.checkedIn ? (rand() < 0.5 ? 'Inngang A' : 'Inngang B') : null,
      transferId: null,
      resaleListingId: null,
      createdAt: paidAt,
      updatedAt: paidAt,
    };
    await tx.insert('tickets', t);
    tickets.push(t);
  }
  tt.sold += qty;
  await tx.update('ticketTypes', tt.id, { sold: tt.sold });
  return { order, tickets };
}

async function seedBulkSales(ctx: SeedCtx, event: EventDoc, tt: TicketType, target: number, recentBias = 0.6, opts: Omit<SaleOptions, 'qty'> = {}): Promise<void> {
  const start = Date.parse(event.createdAt);
  const end = Math.min(ctx.now.getTime(), Date.parse(event.startsAt)) - 60_000;
  while (tt.sold < target) {
    const qty = Math.min(target - tt.sold, 1 + Math.floor(ctx.rand() * 4));
    // Skew purchase times towards the recent past (more sales close to the event and today).
    const r = Math.pow(ctx.rand(), recentBias);
    const paidAt = new Date(start + r * Math.max(0, end - start)).toISOString();
    // Russ usually buy for their friend group: most tickets carry a friend's name, not the buyer's.
    const holderNames = Array.from({ length: qty }, (_, i) => (i === 0 && ctx.rand() < 0.3 ? undefined : `${FIRST[Math.floor(ctx.rand() * FIRST.length)]} ${LAST[Math.floor(ctx.rand() * LAST.length)]}`));
    await seedSale(ctx, event, tt, { ...opts, qty, paidAt, holderNames });
  }
}

export async function isSeeded(deps: Deps): Promise<boolean> {
  return deps.store.read(async (tx) => (await tx.count('events')) > 0);
}

export async function seedDemoData(deps: Deps, opts: SeedOptions = {}): Promise<void> {
  const now = deps.clock();
  const nowS = now.toISOString();
  await deps.store.tx(async (tx) => {
    const ctx: SeedCtx = { tx, deps, now, nowS, rand: mulberry32(20270517), users: [], covers: opts.covers ?? new Map() };
    const { rand } = ctx;

    await tx.put('settings', { id: 'platform', ...DEFAULT_PLATFORM_SETTINGS, updatedAt: nowS });

    // ── People (fictional) ───────────────────────────────────────────────
    const emma = makeUser(ctx, 'Emma Hansen', 'emma.hansen@example.no', {
      phone: '+4791234567',
      phoneVerified: true,
      birthdate: '2007-03-14',
      birthdateVerified: true,
      city: 'Stavanger',
    });
    const jonas = makeUser(ctx, 'Jonas Berg', 'jonas.berg@example.no', { phone: '+4798765432', phoneVerified: true, birthdate: '2001-08-02', birthdateVerified: true, city: 'Stavanger' });
    const mari = makeUser(ctx, 'Mari Admin', 'admin@tikit.example', { role: 'admin', birthdate: '1995-01-20' });
    const sofie = makeUser(ctx, 'Sofie Lunde', 'sofie.lunde@example.no', { city: 'Sandnes', birthdate: '2007-11-02', birthdateVerified: true });
    const kari = makeUser(ctx, 'Kari Nordvik', 'kari.nordvik@example.no', { city: 'Haugesund' });
    for (const u of [emma, jonas, mari, sofie, kari]) await tx.insert('users', u);
    for (let i = 0; i < 140; i++) {
      const first = FIRST[i % FIRST.length]!;
      const last = LAST[(i * 7 + Math.floor(i / FIRST.length)) % LAST.length]!;
      const year = 2006 + Math.floor(rand() * 3);
      const u = makeUser(ctx, `${first} ${last}`, `${slugify(first)}.${slugify(last)}${i}@example.no`, {
        birthdate: `${year}-${pad(1 + Math.floor(rand() * 12))}-${pad(1 + Math.floor(rand() * 28))}`,
        birthdateVerified: rand() < 0.8,
        phone: `+479${String(1000000 + Math.floor(rand() * 8999999)).padStart(7, '0')}`,
        phoneVerified: true,
      });
      await tx.insert('users', u);
      ctx.users.push(u);
    }

    // ── Organizers (fictional) ───────────────────────────────────────────
    const mkOrg = async (o: Partial<Organizer> & { name: string; type: Organizer['type']; city: string }, owners: User[], extraMembers: { user: User; role: 'admin' | 'staff' }[] = []) => {
      const org: Organizer = {
        id: newId(),
        slug: slugify(o.name),
        orgNumber: null,
        description: '',
        email: `post@${slugify(o.name).replace(/-/g, '')}.example`,
        phone: null,
        website: null,
        logoImageId: null,
        palette: 'blatime',
        payoutAccount: null,
        status: 'approved',
        verified: true,
        statusNote: null,
        createdBy: owners[0]!.id,
        createdAt: addDays(now, -120).toISOString(),
        updatedAt: nowS,
        approvedAt: addDays(now, -118).toISOString(),
        ...o,
      };
      await tx.insert('organizers', org);
      for (const u of owners) await tx.insert('orgMembers', { id: newId(), organizerId: org.id, userId: u.id, role: 'owner', createdAt: org.createdAt });
      for (const m of extraMembers) await tx.insert('orgMembers', { id: newId(), organizerId: org.id, userId: m.user.id, role: m.role, createdAt: org.createdAt });
      return org;
    };

    const nordlys = await mkOrg(
      {
        name: 'Nordlys Events',
        type: 'company',
        city: 'Stavanger',
        orgNumber: null,
        description: 'Vi lager de største russetreffene på Vestlandet – med lys, lyd og trygghet i fokus.',
        palette: 'blatime',
        payoutAccount: '12345678903',
        website: 'https://nordlys-events.example',
      },
      [jonas],
      [{ user: ctx.users[0]!, role: 'staff' }],
    );
    const revy = await mkOrg(
      { name: 'Russerevyen Stavanger', type: 'school', city: 'Stavanger', description: 'Årets revy – skrevet, spilt og sunget av russen selv.', palette: 'rodruss' },
      [jonas],
    );
    const blatimen = await mkOrg(
      { name: 'Russebussen Blåtimen', type: 'russ', city: 'Sandnes', description: 'Bussen med det blåeste lyset i Sandnes.', palette: 'fjord', verified: false },
      [sofie],
    );
    const ball = await mkOrg({ name: 'Vestland Ballkomité', type: 'association', city: 'Bergen', description: 'Galla for avgangselever i Bergen.', palette: 'syrin' }, [ctx.users[5]!]);
    const idrett = await mkOrg({ name: 'Trøndersk Russeidrett', type: 'association', city: 'Trondheim', description: 'Turneringer og moro for russ i Trøndelag.', palette: 'nordlys' }, [ctx.users[6]!]);
    const live = await mkOrg({ name: 'Sørlandet Live', type: 'venue', city: 'Kristiansand', description: 'Konsertscene i hjertet av Kristiansand.', palette: 'midnattsol' }, [ctx.users[7]!]);
    await mkOrg(
      { name: 'Haugesund Russeforening', type: 'association', city: 'Haugesund', status: 'pending', verified: false, approvedAt: null, description: 'Vi vil arrangere russedåp og treff i Haugesund.', orgNumber: null },
      [kari],
    );

    // ── Events ───────────────────────────────────────────────────────────
    const sat1 = nextWeekday(now, 6, 9);
    const treff = await makeEvent(ctx, {
      org: nordlys,
      title: 'Russetreff Vest',
      subtitle: 'Vestlandets største russetreff',
      description:
        'To scener, lysshow og tre av landets heteste DJ-er under samme tak. Russetreff Vest samler russ fra hele Rogaland til en natt du sent glemmer.\n\nGyldig legitimasjon kreves ved inngang. Ingen gjeninnslipp etter kl. 00:30. Garderobe er inkludert i VIP-billetten.\n\nArrangementet er rusfritt i køområdet, og vi har eget trygghetsteam på plass hele natten.',
      category: 'russetreff',
      city: 'Stavanger',
      venue: { name: 'Havnehallen', address: 'Kaiveien 12', postalCode: '4006' },
      startsAt: osloAt(now, sat1, 20),
      endsAt: osloAt(now, sat1 + 1, 2),
      doorsAt: osloAt(now, sat1, 19),
      ageLimit: 18,
      poster: { style: 'aurora', palette: 'blatime' },
      lineup: [
        { name: 'Nordfall', time: '00:30' },
        { name: 'Kaja Vide', time: '23:00' },
        { name: 'Lysrigg b2b Mørkeblå', time: '21:30' },
      ],
      tags: ['DJ', 'Lysshow', '18 år'],
      featured: true,
      settings: { maxPerOrder: 6, resaleAllowed: true },
      createdDaysAgo: 34,
    });
    const treffEarly = await makeType(ctx, treff, { name: 'Early Bird', priceOre: 34900, capacity: 300, description: 'Begrenset antall til lavere pris.' }, 0);
    const treffOrd = await makeType(ctx, treff, { name: 'Ordinær', priceOre: 44900, capacity: 1200, description: 'Inngang hele kvelden.' }, 1);
    const treffVip = await makeType(ctx, treff, { name: 'VIP + garderobe', priceOre: 69900, capacity: 80, description: 'Egen inngang, garderobe og VIP-område ved scenen.', maxPerOrder: 4 }, 2);
    await makeType(ctx, treff, { name: 'Russestyret', priceOre: 24900, capacity: 40, hidden: true, description: 'Kun for russestyrer – krever kode.' }, 3, 'STYRET27');
    const russ27 = { id: newId(), eventId: treff.id, organizerId: nordlys.id, code: 'RUSS27', kind: 'percent' as const, value: 15, maxUses: 200, used: 0, ticketTypeIds: [treffOrd.id], validFrom: null, validUntil: null, active: true, createdAt: treff.createdAt };
    await tx.insert('discountCodes', russ27);
    await seedBulkSales(ctx, treff, treffEarly, 300, 1.4);
    await seedBulkSales(ctx, treff, treffOrd, 560, 0.55);
    await seedBulkSales(ctx, treff, treffVip, 71, 0.5);
    for (let i = 0; i < 18; i++) {
      await seedSale(ctx, treff, treffOrd, { qty: 2, discount: { codeId: russ27.id, code: 'RUSS27', percent: 15 } });
      russ27.used++;
    }
    await tx.update('discountCodes', russ27.id, { used: russ27.used });
    // Emma: two tickets (one for a friend – great for trying transfer)
    const emmaTreff = await seedSale(ctx, treff, treffOrd, { buyer: emma, qty: 2, paidAt: addDays(now, -3).toISOString(), holderNames: ['Emma Hansen', 'Emma Hansen'] });
    void emmaTreff;
    await tx.insert('scannerCodes', {
      id: newId(),
      eventId: treff.id,
      organizerId: nordlys.id,
      label: 'Inngang A',
      codeHash: await sha256Hex(`scanner:${DEMO_SCANNER_CODE.replace(/\D/g, '')}`),
      createdBy: jonas.id,
      createdAt: nowS,
      revoked: false,
      lastUsedAt: null,
    });

    const fri1 = nextWeekday(now, 5, 3);
    const buss = await makeEvent(ctx, {
      org: blatimen,
      title: 'Blåtimen – Busslansering',
      subtitle: 'Lanseringsfest for Russebussen Blåtimen',
      description: 'Endelig er bussen klar! Bli med når Blåtimen viser frem lys, lyd og årets russelåt for første gang.\n\nAlderen din bekreftes med Vipps ved kjøp – ta med legitimasjon likevel.',
      category: 'buss',
      city: 'Sandnes',
      venue: { name: 'Fjellsalen', address: 'Storgata 40', postalCode: '4307' },
      startsAt: osloAt(now, fri1, 21),
      endsAt: osloAt(now, fri1 + 1, 1, 30),
      ageLimit: 18,
      poster: { style: 'rays', palette: 'fjord' },
      lineup: [{ name: 'Russelåt-premiere', time: '23:00' }],
      tags: ['Busslansering', 'Russelåt'],
      settings: { requireVerifiedAge: true, maxPerOrder: 4 },
      createdDaysAgo: 21,
    });
    const bussTT = await makeType(ctx, buss, { name: 'Inngang', priceOre: 29900, capacity: 450 }, 0);
    await seedBulkSales(ctx, buss, bussTT, 318, 0.5);

    const thu1 = nextWeekday(now, 4, 6);
    const revyEvent = await makeEvent(ctx, {
      org: revy,
      title: 'Russerevyen: Siste skoledag',
      subtitle: 'Årets russerevy – nummererte plasser',
      description: 'Sketsjer, sang og en hel del selvironi. Russerevyen er tilbake med en forestilling om alt vi aldri lærte på skolen.\n\nVelg plass selv i salkartet. Forestillingen varer ca. 2 timer og 30 minutter inkludert pause.',
      category: 'revy',
      city: 'Stavanger',
      venue: { name: 'Sjøsiden kultursal', address: 'Strandkaien 3', postalCode: '4005' },
      startsAt: osloAt(now, thu1, 19),
      endsAt: osloAt(now, thu1, 21, 30),
      doorsAt: osloAt(now, thu1, 18, 15),
      ageLimit: null,
      poster: { style: 'stripes', palette: 'rodruss' },
      tags: ['Revy', 'Nummererte plasser'],
      featured: true,
      settings: { refundPolicy: 'until-7d', maxPerOrder: 8 },
      createdDaysAgo: 18,
    });
    const parkett = await makeType(ctx, revyEvent, { name: 'Parkett', priceOre: 22000, capacity: 0 }, 0);
    const balkong = await makeType(ctx, revyEvent, { name: 'Balkong', priceOre: 18000, capacity: 0 }, 1);
    const rowsParkett = 'ABCDEFGHIJ'.split('');
    const map: SeatMap = {
      id: revyEvent.id,
      eventId: revyEvent.id,
      stageLabel: 'Scene',
      updatedAt: nowS,
      sections: [
        {
          id: 'P',
          name: 'Parkett',
          ticketTypeId: parkett.id,
          rows: rowsParkett.map((label, i) => {
            const count = 14 + Math.min(i, 4);
            return { label, offset: Math.max(0, 4 - Math.min(i, 4)) , seats: Array.from({ length: count }, (_, n) => ({ id: seatIdFor('P', label, n + 1), number: n + 1, accessible: i === 9 && (n === 0 || n === count - 1) })) };
          }),
        },
        {
          id: 'B',
          name: 'Balkong',
          ticketTypeId: balkong.id,
          rows: 'ABCD'.split('').map((label) => ({ label, offset: 0, seats: Array.from({ length: 18 }, (_, n) => ({ id: seatIdFor('B', label, n + 1), number: n + 1, accessible: false })) })),
        },
      ],
    };
    await tx.insert('seatMaps', map);
    const seatCount = (sectionId: string) => map.sections.find((s) => s.id === sectionId)!.rows.reduce((a, r) => a + r.seats.length, 0);
    parkett.capacity = seatCount('P');
    balkong.capacity = seatCount('B');
    await tx.update('ticketTypes', parkett.id, { capacity: parkett.capacity });
    await tx.update('ticketTypes', balkong.id, { capacity: balkong.capacity });
    await tx.update('events', revyEvent.id, { seated: true });
    const seatState: Record<string, { status: 'sold' | 'blocked'; orderId: string | null; until: null; ticketId: string | null }> = {};
    const takeSeats = async (sectionId: string, tt: TicketType, fraction: number) => {
      const section = map.sections.find((s) => s.id === sectionId)!;
      for (const row of section.rows) {
        let n = 0;
        while (n < row.seats.length) {
          const group = 1 + Math.floor(rand() * 4);
          if (rand() < fraction) {
            const seats = row.seats.slice(n, n + group).map((s) => ({ id: s.id, section: section.name, row: row.label, number: s.number }));
            if (seats.length > 0) {
              const { order, tickets } = await seedSale(ctx, revyEvent, tt, { qty: seats.length, seatIds: seats });
              for (const t of tickets) seatState[t.seat!.id] = { status: 'sold', orderId: order.id, until: null, ticketId: t.id };
            }
          }
          n += group;
        }
      }
    };
    await takeSeats('P', parkett, 0.62);
    await takeSeats('B', balkong, 0.35);
    // Emma sits in row F
    const rowF = map.sections[0]!.rows[5]!;
    const freeF = rowF.seats.filter((s) => !seatState[s.id]).slice(0, 1).map((s) => ({ id: s.id, section: 'Parkett', row: 'F', number: s.number }));
    if (freeF.length) {
      const { order, tickets } = await seedSale(ctx, revyEvent, parkett, { buyer: emma, qty: 1, seatIds: freeF, paidAt: addDays(now, -6).toISOString() });
      for (const t of tickets) seatState[t.seat!.id] = { status: 'sold', orderId: order.id, until: null, ticketId: t.id };
    }
    seatState[seatIdFor('P', 'A', 1)] = seatState[seatIdFor('P', 'A', 1)] ?? { status: 'blocked', orderId: null, until: null, ticketId: null };
    if (seatState[seatIdFor('P', 'A', 1)]!.status === 'blocked') {
      parkett.capacity -= 1;
      await tx.update('ticketTypes', parkett.id, { capacity: parkett.capacity });
    }
    await tx.insert('seatStates', { id: revyEvent.id, eventId: revyEvent.id, seats: seatState, updatedAt: nowS });

    const sat2 = nextWeekday(now, 6, 17);
    const strand = await makeEvent(ctx, {
      org: nordlys,
      title: 'Midnattsfest på stranden',
      subtitle: 'Utsolgt – følg med på videresalg',
      description: 'Bål, strandbar og DJ til langt på natt. Midnattsfesten ble utsolgt på 11 minutter.\n\nBilletter kan dukke opp i det trygge videresalget – maks samme pris som originalen. Stå på ventelisten, så varsler vi deg.',
      category: 'fest',
      city: 'Sola',
      venue: { name: 'Solastranden paviljong', address: 'Strandveien 1', postalCode: '4050' },
      startsAt: osloAt(now, sat2, 22),
      endsAt: osloAt(now, sat2 + 1, 3),
      ageLimit: 18,
      poster: { style: 'waves', palette: 'midnattsol' },
      lineup: [{ name: 'Havbris', time: '23:30' }, { name: 'DJ Solnedgang', time: '22:00' }],
      tags: ['Utsolgt', 'Strand'],
      featured: true,
      settings: { waitlistEnabled: true, resaleAllowed: true },
      createdDaysAgo: 40,
    });
    const strandTT = await makeType(ctx, strand, { name: 'Inngang', priceOre: 39900, capacity: 400 }, 0);
    await seedBulkSales(ctx, strand, strandTT, 400, 2.2);
    // Three resale listings from other buyers
    const strandTickets = (await tx.find('tickets', { eventId: strand.id })).filter((t) => t.ownerId !== emma.id).slice(0, 3);
    const prices = [34900, 39900, 37500];
    for (let i = 0; i < strandTickets.length; i++) {
      const t = strandTickets[i]!;
      const listing = { id: newId(), ticketId: t.id, eventId: strand.id, ticketTypeId: strandTT.id, sellerId: t.ownerId, priceOre: prices[i]!, status: 'active' as const, reservedByOrderId: null, reservedUntil: null, buyerOrderId: null, payoutOre: prices[i]!, createdAt: addDays(now, -1).toISOString(), soldAt: null };
      await tx.insert('resaleListings', listing);
      await tx.update('tickets', t.id, { resaleListingId: listing.id });
    }
    await tx.insert('favorites', { id: `${emma.id}:${strand.id}`, userId: emma.id, eventId: strand.id, createdAt: nowS });

    const rave = await makeEvent(ctx, {
      org: nordlys,
      title: 'Rødruss Rave Oslo',
      subtitle: 'Billettslipp med kø – sett alarmen!',
      description: 'Høstens mest ettertraktede rave. Billettslippet har virtuell kø: alle som er i køen før salget åpner får en tilfeldig plass, og slippes inn i jevn takt. Du har 15 minutter på deg når det er din tur.',
      category: 'russetreff',
      city: 'Oslo',
      venue: { name: 'Tårnhuset', address: 'Kirkeveien 99', postalCode: '0364' },
      startsAt: osloAt(now, 38, 21),
      endsAt: osloAt(now, 39, 3),
      salesStartAt: new Date(now.getTime() + 3 * 60_000).toISOString(),
      ageLimit: 18,
      poster: { style: 'grid', palette: 'rodruss' },
      lineup: [{ name: 'Kaja Vide', time: '01:00' }, { name: 'Rødglød', time: '23:30' }],
      tags: ['Kø', 'Billettslipp'],
      featured: true,
      settings: { queueEnabled: true, queueRatePerMinute: 150, maxPerOrder: 4 },
      createdDaysAgo: 7,
    });
    await makeType(ctx, rave, { name: 'Slipp 1', priceOre: 49900, capacity: 900, maxPerOrder: 4 }, 0);
    await tx.insert('queues', { id: rave.id, eventId: rave.id, opensAt: rave.salesStartAt!, ratePerMinute: 150, frozen: false, earlyCount: 0, nextPosition: 1, createdAt: nowS });
    for (let i = 0; i < 260; i++) {
      const u = ctx.users[i % ctx.users.length]!;
      await tx.insert('queueEntries', { id: newId(), eventId: rave.id, userId: `crowd-${i}-${u.id}`, joinedAt: new Date(now.getTime() - rand() * 20 * 60_000).toISOString(), rand: rand(), position: null, status: 'waiting', admittedAt: null });
    }

    const sat3 = nextWeekday(now, 6, 24);
    const gallaEvent = await makeEvent(ctx, {
      org: ball,
      title: 'Avgangsgalla Vg3',
      subtitle: 'Kjole, dress og tre-retters middag',
      description: 'Årets vakreste kveld: velkomstdrink (alkoholfri), tre-retters middag, taler og dans til orkester.\n\nBillettene er personlige – skriv inn navnet på hver gjest ved kjøp.',
      category: 'fest',
      city: 'Bergen',
      venue: { name: 'Bryggesalen', address: 'Bryggen 8', postalCode: '5003' },
      startsAt: osloAt(now, sat3, 18),
      endsAt: osloAt(now, sat3 + 1, 1),
      ageLimit: null,
      poster: { style: 'orbit', palette: 'syrin' },
      tags: ['Galla', 'Middag'],
      settings: { personalizedTickets: true, refundPolicy: 'until-7d', resaleAllowed: false },
      createdDaysAgo: 25,
    });
    const gallaTT = await makeType(ctx, gallaEvent, { name: 'Galla med middag', priceOre: 89000, capacity: 260, vatRate: 0 }, 0);
    await seedBulkSales(ctx, gallaEvent, gallaTT, 131, 0.7);

    const sun4 = nextWeekday(now, 0, 30);
    const cup = await makeEvent(ctx, {
      org: idrett,
      title: 'Russecupen i fotball',
      subtitle: 'Sjuer-fotball for russ – tilskuere gratis',
      description: 'Meld på laget ditt (inntil 7 spillere) eller kom og heie. Grillmat og premier til beste drakt.',
      category: 'annet',
      city: 'Trondheim',
      venue: { name: 'Lerkendal kunstgress', address: 'Klæbuveien 125', postalCode: '7031' },
      startsAt: osloAt(now, sun4, 12),
      endsAt: osloAt(now, sun4, 18),
      ageLimit: null,
      poster: { style: 'rays', palette: 'nordlys' },
      tags: ['Fotball', 'Gratis for tilskuere'],
      settings: { refundPolicy: 'until-start' },
      createdDaysAgo: 12,
    });
    const lag = await makeType(ctx, cup, { name: 'Lagpåmelding', priceOre: 70000, capacity: 32, maxPerOrder: 1, description: 'Én påmelding per lag, inntil 7 spillere.' }, 0);
    const tilskuer = await makeType(ctx, cup, { name: 'Tilskuer', priceOre: 0, capacity: 600, description: 'Gratis – men hent billett så vi vet hvor mange som kommer.' }, 1);
    await seedBulkSales(ctx, cup, lag, 19, 0.8, {});
    await seedBulkSales(ctx, cup, tilskuer, 144, 0.6);

    const konsertDay = nextWeekday(now, 5, 14);
    const konsert = await makeEvent(ctx, {
      org: live,
      title: 'Nordfall – live',
      subtitle: 'Første klubbturné med live-band',
      description: 'Nordfall tar med seg bandet på turné for første gang. Stående konsert, 16-årsgrense.',
      category: 'fest',
      city: 'Kristiansand',
      venue: { name: 'Kaisalen', address: 'Tangen 7', postalCode: '4608' },
      startsAt: osloAt(now, konsertDay, 20),
      endsAt: osloAt(now, konsertDay, 23),
      doorsAt: osloAt(now, konsertDay, 19),
      ageLimit: 16,
      poster: { style: 'orbit', palette: 'midnattsol' },
      tags: ['Konsert', '16 år'],
      settings: { showRemaining: true },
      createdDaysAgo: 45,
    });
    const konsertTT = await makeType(ctx, konsert, { name: 'Ståplass', priceOre: 39900, capacity: 350 }, 0);
    await seedBulkSales(ctx, konsert, konsertTT, 327, 0.7);

    const dap = await makeEvent(ctx, {
      org: nordlys,
      title: 'Russedåpen 2027',
      subtitle: 'Billettsalget åpner snart',
      description: 'Den offisielle russedåpen for Nord-Rogaland. Trykk «Varsle meg», så sier vi fra når salget åpner.',
      category: 'russetreff',
      city: 'Haugesund',
      venue: { name: 'Smedasundet scene', address: 'Smedasundet 97', postalCode: '5528' },
      startsAt: osloAt(now, 47, 20),
      endsAt: osloAt(now, 48, 2),
      salesStartAt: osloAt(now, 6, 12),
      ageLimit: 18,
      poster: { style: 'aurora', palette: 'nordlys' },
      tags: ['Russedåp'],
      createdDaysAgo: 3,
    });
    await makeType(ctx, dap, { name: 'Early Bird', priceOre: 29900, capacity: 200, maxPerOrder: 4 }, 0);
    await makeType(ctx, dap, { name: 'Ordinær', priceOre: 39900, capacity: 800 }, 1);
    await tx.insert('saleAlerts', { id: `${emma.id}:${dap.id}`, userId: emma.id, eventId: dap.id, createdAt: nowS, notifiedAt: null });

    // Past event with a used ticket for Emma
    const past = await makeEvent(ctx, {
      org: nordlys,
      title: 'Høstslipp',
      subtitle: 'Sesongåpning',
      description: 'Sesongåpningen for russen i Stavanger.',
      category: 'fest',
      city: 'Stavanger',
      venue: { name: 'Havnehallen', address: 'Kaiveien 12', postalCode: '4006' },
      startsAt: osloAt(now, -19, 21),
      endsAt: osloAt(now, -18, 2),
      ageLimit: 18,
      poster: { style: 'stripes', palette: 'kobber' },
      createdDaysAgo: 60,
    });
    const pastTT = await makeType(ctx, past, { name: 'Inngang', priceOre: 29900, capacity: 500 }, 0);
    await seedBulkSales(ctx, past, pastTT, 452, 0.8, { checkedIn: true });
    await seedSale(ctx, past, pastTT, { buyer: emma, qty: 1, checkedIn: true, paidAt: addDays(now, -25).toISOString() });

    // Draft (organizer view)
    const draft = await makeEvent(ctx, {
      org: nordlys,
      title: 'Julebord for russen',
      subtitle: 'Utkast',
      description: 'Utkast – ikke publisert ennå.',
      category: 'fest',
      city: 'Stavanger',
      venue: { name: 'Havnehallen', address: 'Kaiveien 12', postalCode: '4006' },
      startsAt: osloAt(now, 80, 19),
      endsAt: osloAt(now, 81, 1),
      ageLimit: 18,
      poster: { style: 'grid', palette: 'sitron' },
      status: 'draft',
      createdDaysAgo: 1,
    });
    await makeType(ctx, draft, { name: 'Inngang', priceOre: 34900, capacity: 400 }, 0);

    // Social graph for Emma
    await tx.insert('follows', { id: `${emma.id}:${nordlys.id}`, userId: emma.id, organizerId: nordlys.id, createdAt: nowS });
    await tx.insert('waitlist', { id: newId(), eventId: strand.id, userId: emma.id, status: 'waiting', createdAt: addDays(now, -2).toISOString(), notifiedAt: null });
    await tx.insert('notifications', {
      id: newId(),
      userId: emma.id,
      kind: 'order_confirmed',
      title: 'Billetter til Russetreff Vest',
      body: '2 billetter ligger klare i appen.',
      link: '/billetter',
      readAt: null,
      createdAt: addDays(now, -3).toISOString(),
    });
    await tx.insert('notifications', {
      id: newId(),
      userId: emma.id,
      kind: 'event_reminder',
      title: 'Snart: Russerevyen',
      body: 'Husk billetten – dørene åpner 18:15.',
      link: '/billetter',
      readAt: addDays(now, -1).toISOString(),
      createdAt: addDays(now, -1).toISOString(),
    });
    void rave;
  });
}
