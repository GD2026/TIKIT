import { AppError } from '../../shared/errors';
import { newId, searchNormalize } from '../../shared/ids';
import { sha256Hex } from '../../shared/encoding';
import { LIMITS } from '../../shared/constants';
import { osloDateKey, weekendWindow, addDays } from '../../shared/time';
import type {
  EventCard,
  EventDetail,
  EventDoc,
  Organizer,
  SeatMap,
  TicketType,
  User,
} from '../../shared/types';
import type { EventInput, SeatMapInput, TicketTypeInput } from '../../shared/schemas';
import type { Deps } from '../context';
import type { Tx } from '../store/types';
import { audit, getSettings, notify, nowIso, signToken, verifyToken } from './common';
import { toEventCard, toOrganizerPublic, toTicketTypePublic } from './dto';
import { activeHeld, availableOf, indexSeats, loadSeatState, loadTicketTypes, seatIdFor, seatIsFree, typesWithAvailability } from './inventory';
import { requireOrgAccess, roleAtLeast, uniqueSlug } from './organizers';
import { queueStatusFor } from './queue';
import { notifyWaitlist } from './waitlist';
import { feeForPrice } from '../../shared/pricing';

// ── Access codes for hidden ticket types ─────────────────────────────────────

export function normalizeAccessCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function hashAccessCode(eventId: string, code: string): Promise<string> {
  return sha256Hex(`access:${eventId}:${normalizeAccessCode(code)}`);
}

export async function unlockedTypeIds(deps: Deps, eventId: string, token: string | null | undefined): Promise<Set<string>> {
  const payload = await verifyToken<{ e: string; t: string[] }>(deps.config.sessionSecret, 'unlock', token, deps.clock().getTime());
  if (!payload || payload.e !== eventId || !Array.isArray(payload.t)) return new Set();
  return new Set(payload.t);
}

export async function unlockTicketTypes(deps: Deps, eventId: string, code: string, existingToken: string | null): Promise<{ token: string; unlocked: string[] }> {
  const hash = await hashAccessCode(eventId, code);
  const matched = await deps.store.read(async (tx) => {
    const types = await tx.find('ticketTypes', { eventId, hidden: true });
    return types.filter((t) => t.accessCodeHash === hash).map((t) => t.id);
  });
  if (matched.length === 0) throw new AppError('invalid_access_code');
  const previous = await unlockedTypeIds(deps, eventId, existingToken);
  const all = [...new Set([...previous, ...matched])];
  const token = await signToken(deps.config.sessionSecret, 'unlock', { e: eventId, t: all }, deps.clock().getTime() + 12 * 3600000);
  return { token, unlocked: all };
}

// ── Public catalogue ─────────────────────────────────────────────────────────

export interface EventQuery {
  q?: string;
  city?: string;
  category?: string;
  when?: 'today' | 'weekend' | 'week' | 'month';
  organizerId?: string;
  sort?: 'date' | 'popular';
  limit?: number;
  includePast?: boolean;
}

async function cardsFor(tx: Tx, deps: Deps, events: EventDoc[]): Promise<{ card: EventCard; sold: number; capacity: number }[]> {
  if (events.length === 0) return [];
  const now = deps.clock();
  const nowS = now.toISOString();
  const ids = events.map((e) => e.id);
  const [orgs, types, holds] = await Promise.all([
    tx.getMany(
      'organizers',
      events.map((e) => e.organizerId),
    ),
    tx.find('ticketTypes', { eventId: { in: ids } }),
    tx.find('holds', { eventId: { in: ids } }),
  ]);
  const held = new Map<string, number>();
  for (const h of holds) if (h.expiresAt > nowS) held.set(h.ticketTypeId, (held.get(h.ticketTypeId) ?? 0) + h.qty);
  const out: { card: EventCard; sold: number; capacity: number }[] = [];
  for (const e of events) {
    const org = orgs.find((o) => o.id === e.organizerId);
    if (!org) continue;
    const et = types
      .filter((t) => t.eventId === e.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((tt) => ({ tt, available: availableOf(tt, held) }));
    out.push({
      card: toEventCard(e, org, et, now),
      sold: et.reduce((s, t) => s + t.tt.sold, 0),
      capacity: et.reduce((s, t) => s + t.tt.capacity, 0),
    });
  }
  return out;
}

function inWindow(e: EventDoc, when: EventQuery['when'], now: Date): boolean {
  if (!when) return true;
  const start = new Date(e.startsAt);
  const end = new Date(e.endsAt);
  if (when === 'today') return osloDateKey(start) === osloDateKey(now) || (start <= now && end > now);
  if (when === 'weekend') {
    const w = weekendWindow(now);
    return start < w.to && end > w.from;
  }
  if (when === 'week') return start < addDays(now, 7);
  if (when === 'month') return start < addDays(now, 31);
  return true;
}

export async function listEvents(deps: Deps, query: EventQuery = {}): Promise<EventCard[]> {
  const now = deps.clock();
  const nowS = now.toISOString();
  return deps.store.read(async (tx) => {
    let events = await tx.find('events', { status: 'published' });
    events = events.filter((e) => e.visibility === 'public' && (query.includePast || e.endsAt > nowS));
    const orgs = await tx.getMany(
      'organizers',
      [...new Set(events.map((e) => e.organizerId))],
    );
    const approved = new Set(orgs.filter((o) => o.status === 'approved').map((o) => o.id));
    events = events.filter((e) => approved.has(e.organizerId));
    if (query.organizerId) events = events.filter((e) => e.organizerId === query.organizerId);
    if (query.city) {
      const c = searchNormalize(query.city);
      events = events.filter((e) => searchNormalize(e.city) === c);
    }
    if (query.category) events = events.filter((e) => e.category === query.category);
    if (query.when) events = events.filter((e) => inWindow(e, query.when, now));
    if (query.q) {
      const terms = searchNormalize(query.q).split(' ').filter(Boolean);
      const orgName = new Map(orgs.map((o) => [o.id, o.name]));
      events = events.filter((e) => {
        const hay = searchNormalize(
          [e.title, e.subtitle, e.venue.name, e.city, orgName.get(e.organizerId) ?? '', ...e.tags, ...e.lineup.map((l) => l.name)].join(' '),
        );
        return terms.every((t) => hay.includes(t));
      });
    }
    const cards = await cardsFor(tx, deps, events);
    if (query.sort === 'popular') {
      cards.sort((a, b) => b.sold - a.sold || a.card.startsAt.localeCompare(b.card.startsAt));
    } else {
      cards.sort((a, b) => a.card.startsAt.localeCompare(b.card.startsAt));
    }
    const limit = Math.min(query.limit ?? 100, 200);
    return cards.slice(0, limit).map((c) => c.card);
  });
}

export interface HomeSection {
  id: string;
  title: string;
  subtitle?: string;
  style: 'hero' | 'row' | 'countdown' | 'list';
  events: EventCard[];
}

/**
 * The Discover page, kept short on purpose: a few featured events, ticket drops that open soon,
 * news from organizers you follow, then everything else by date. A chosen city filters all of it.
 */
export async function getHome(deps: Deps, viewer: User | null, city: string | null): Promise<HomeSection[]> {
  const everywhere = await listEvents(deps, { limit: 200 });
  const all = city ? everywhere.filter((e) => searchNormalize(e.city) === searchNormalize(city)) : everywhere;
  const now = deps.clock();
  const sections: HomeSection[] = [];
  if (all.length === 0) return sections;

  const featured = all.filter((e) => e.featured && e.saleState !== 'past');
  const heroes = (featured.length > 0 ? featured : all.filter((e) => e.saleState === 'on_sale')).slice(0, 6);
  if (heroes.length > 0) sections.push({ id: 'featured', title: 'Utvalgt', style: 'hero', events: heroes });

  const soon = all
    .filter((e) => e.saleState === 'upcoming' && e.salesStartAt && new Date(e.salesStartAt) > now)
    .sort((a, b) => (a.salesStartAt ?? '').localeCompare(b.salesStartAt ?? ''));
  if (soon.length > 0) sections.push({ id: 'drops', title: 'Billettslipp', subtitle: 'Salget åpner snart', style: 'countdown', events: soon.slice(0, 8) });

  if (viewer) {
    const follows = await deps.store.read((tx) => tx.find('follows', { userId: viewer.id }));
    const followed = new Set(follows.map((f) => f.organizerId));
    if (followed.size > 0) {
      const orgEvents = await deps.store.read(async (tx) => {
        const events = await tx.find('events', { status: 'published' });
        return events.filter((e) => followed.has(e.organizerId) && e.visibility === 'public' && e.endsAt > now.toISOString());
      });
      const ids = new Set(orgEvents.map((e) => e.id));
      const fromFollowed = all.filter((e) => ids.has(e.id));
      if (fromFollowed.length > 0) sections.push({ id: 'following', title: 'Fra arrangører du følger', style: 'row', events: fromFollowed.slice(0, 12) });
    }
  }

  sections.push({ id: 'all', title: city ? `Alt i ${city}` : 'Alle arrangementer', style: 'list', events: all.slice(0, 40) });
  return sections;
}

async function findEventBySlugOrId(tx: Tx, slugOrId: string): Promise<EventDoc | null> {
  const bySlug = await tx.findOne('events', { slug: slugOrId });
  if (bySlug) return bySlug;
  return tx.get('events', slugOrId);
}

async function isOrgMember(tx: Tx, user: User | null, organizerId: string): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return !!(await tx.findOne('orgMembers', { organizerId, userId: user.id }));
}

export async function getEventDetail(deps: Deps, slugOrId: string, viewer: User | null, unlockToken: string | null): Promise<EventDetail> {
  const now = deps.clock();
  const nowS = now.toISOString();
  return deps.store.read(async (tx) => {
    const event = await findEventBySlugOrId(tx, slugOrId);
    if (!event) throw new AppError('not_found');
    const org = await tx.get('organizers', event.organizerId);
    if (!org) throw new AppError('not_found');
    const member = await isOrgMember(tx, viewer, event.organizerId);
    if ((event.status === 'draft' || org.status !== 'approved') && !member) throw new AppError('not_found');

    const settings = await getSettings(tx, deps);
    const withAvail = await typesWithAvailability(tx, event, nowS);
    const unlocked = await unlockedTypeIds(deps, event.id, unlockToken);
    const seatMap = event.seated ? await tx.get('seatMaps', event.id) : null;
    const seatedTypes = new Set(seatMap?.sections.map((s) => s.ticketTypeId) ?? []);
    const visible = withAvail.filter((t) => !t.tt.hidden || unlocked.has(t.tt.id));
    const followers = await tx.count('follows', { organizerId: org.id });
    const resale = (await tx.find('resaleListings', { eventId: event.id })).filter(
      (l) => l.status === 'active' || (l.status === 'reserved' && !!l.reservedUntil && l.reservedUntil <= nowS),
    );

    let viewerInfo: EventDetail['viewer'] = { favorite: false, onWaitlist: false, saleAlert: false, ticketCount: 0, queue: null };
    if (viewer) {
      const [fav, wait, alert, tickets] = await Promise.all([
        tx.get('favorites', `${viewer.id}:${event.id}`),
        tx.findOne('waitlist', { eventId: event.id, userId: viewer.id }),
        tx.get('saleAlerts', `${viewer.id}:${event.id}`),
        tx.find('tickets', { eventId: event.id, ownerId: viewer.id }),
      ]);
      viewerInfo = {
        favorite: !!fav,
        onWaitlist: !!wait && wait.status !== 'removed',
        saleAlert: !!alert,
        ticketCount: tickets.filter((t) => t.status === 'valid' || t.status === 'used').length,
        queue: event.settings.queueEnabled ? await queueStatusFor(tx, deps, event, viewer.id) : null,
      };
    }

    const card = toEventCard(event, org, withAvail, now);
    return {
      event: {
        ...card,
        description: event.description,
        venue: event.venue,
        doorsAt: event.doorsAt,
        salesEndAt: event.salesEndAt,
        lineup: event.lineup,
        tags: event.tags,
        settings: {
          maxPerOrder: event.settings.maxPerOrder,
          personalizedTickets: event.settings.personalizedTickets,
          transfersAllowed: event.settings.transfersAllowed,
          resaleAllowed: event.settings.resaleAllowed,
          refundPolicy: event.settings.refundPolicy,
          queueEnabled: event.settings.queueEnabled,
          waitlistEnabled: event.settings.waitlistEnabled,
          requireVerifiedAge: event.settings.requireVerifiedAge,
        },
        seated: event.seated,
        cancelReason: event.cancelReason,
        visibility: event.visibility,
      },
      organizer: toOrganizerPublic(org, followers),
      ticketTypes: visible.map((t) => ({
        ...toTicketTypePublic(t.tt, event, t.available, settings, now, unlocked.has(t.tt.id)),
        seated: seatedTypes.has(t.tt.id),
      })),
      hasHiddenTypes: withAvail.some((t) => t.tt.hidden && !unlocked.has(t.tt.id) && !t.tt.paused),
      resale: {
        count: resale.length,
        fromPriceOre: resale.reduce<number | null>((m, l) => (m === null || l.priceOre < m ? l.priceOre : m), null),
      },
      viewer: viewerInfo,
    };
  });
}

export interface PublicSeatMap {
  eventId: string;
  stageLabel: string;
  sections: {
    id: string;
    name: string;
    ticketTypeId: string;
    priceOre: number;
    feeOre: number;
    rows: { label: string; offset: number; seats: { id: string; number: number; accessible: boolean; state: 'free' | 'taken' | 'blocked' }[] }[];
  }[];
}

export async function getPublicSeatMap(deps: Deps, eventId: string, forOrderId: string | null = null): Promise<PublicSeatMap> {
  const nowS = nowIso(deps);
  return deps.store.read(async (tx) => {
    const map = await tx.get('seatMaps', eventId);
    if (!map) throw new AppError('not_found');
    const state = await loadSeatState(tx, eventId, nowS);
    const types = await loadTicketTypes(tx, eventId);
    const settings = await getSettings(tx, deps);
    return {
      eventId,
      stageLabel: map.stageLabel,
      sections: map.sections.map((s) => {
        const tt = types.find((t) => t.id === s.ticketTypeId);
        const price = tt?.priceOre ?? 0;
        return {
          id: s.id,
          name: s.name,
          ticketTypeId: s.ticketTypeId,
          priceOre: price,
          feeOre: feeForPrice(price, settings),
          rows: s.rows.map((r) => ({
            label: r.label,
            offset: r.offset,
            seats: r.seats.map((seat) => {
              const entry = state.seats[seat.id];
              const st = entry?.status === 'blocked' ? 'blocked' : seatIsFree(entry, nowS, forOrderId) ? 'free' : 'taken';
              return { id: seat.id, number: seat.number, accessible: seat.accessible, state: st };
            }),
          })),
        };
      }),
    };
  });
}

// ── Favourites, alerts ───────────────────────────────────────────────────────

export async function setFavorite(deps: Deps, userId: string, eventId: string, on: boolean): Promise<void> {
  const id = `${userId}:${eventId}`;
  await deps.store.tx(async (tx) => {
    if (!(await tx.get('events', eventId))) throw new AppError('not_found');
    const existing = await tx.get('favorites', id);
    if (on && !existing) await tx.insert('favorites', { id, userId, eventId, createdAt: nowIso(deps) });
    if (!on && existing) await tx.delete('favorites', id);
  });
}

export async function setSaleAlert(deps: Deps, userId: string, eventId: string, on: boolean): Promise<void> {
  const id = `${userId}:${eventId}`;
  await deps.store.tx(async (tx) => {
    if (!(await tx.get('events', eventId))) throw new AppError('not_found');
    const existing = await tx.get('saleAlerts', id);
    if (on && !existing) await tx.insert('saleAlerts', { id, userId, eventId, createdAt: nowIso(deps), notifiedAt: null });
    if (!on && existing) await tx.delete('saleAlerts', id);
  });
}

export async function listFavorites(deps: Deps, userId: string): Promise<EventCard[]> {
  return deps.store.read(async (tx) => {
    const favs = await tx.find('favorites', { userId });
    const events = (await tx.getMany(
      'events',
      favs.map((f) => f.eventId),
    )).filter((e) => e.status !== 'draft');
    const cards = await cardsFor(tx, deps, events);
    return cards.map((c) => c.card).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  });
}

// ── Organizer: event management ──────────────────────────────────────────────

export interface OrgEventSummary {
  card: EventCard;
  sold: number;
  capacity: number;
  revenueOre: number;
  checkedIn: number;
}

export async function listOrgEvents(deps: Deps, user: User, organizerId: string): Promise<OrgEventSummary[]> {
  return deps.store.read(async (tx) => {
    const access = await requireOrgAccess(tx, user, organizerId, 'staff');
    const seesRevenue = roleAtLeast(access.role, 'admin');
    const events = await tx.find('events', { organizerId });
    const cards = await cardsFor(tx, deps, events);
    const ids = events.map((e) => e.id);
    const orders = ids.length ? await tx.find('orders', { eventId: { in: ids } }) : [];
    const used = ids.length ? await tx.find('tickets', { eventId: { in: ids }, status: 'used' }) : [];
    return cards
      .map((c) => {
        const paid = orders.filter((o) => o.eventId === c.card.id && (o.status === 'paid' || o.status === 'partially_refunded' || o.status === 'refunded'));
        const revenueOre = paid.reduce((s, o) => s + (o.subtotalOre - o.discountOre) - Math.max(0, o.refundedOre - 0), 0);
        return {
          card: c.card,
          sold: c.sold,
          capacity: c.capacity,
          // Door staff see tickets and check-ins, not money.
          revenueOre: seesRevenue ? Math.max(0, revenueOre) : 0,
          checkedIn: used.filter((t) => t.eventId === c.card.id).length,
        };
      })
      .sort((a, b) => b.card.startsAt.localeCompare(a.card.startsAt));
  });
}

export interface OrgTicketType extends TicketType {
  held: number;
  available: number;
  hasAccessCode: boolean;
}

export interface OrgEventDetail {
  event: EventDoc;
  ticketTypes: OrgTicketType[];
  seatMap: SeatMap | null;
  role: string;
  organizer: Pick<Organizer, 'id' | 'name' | 'status' | 'slug'>;
  hasSales: boolean;
}

export async function getOrgEvent(deps: Deps, user: User, organizerId: string, eventId: string): Promise<OrgEventDetail> {
  const nowS = nowIso(deps);
  return deps.store.read(async (tx) => {
    const access = await requireOrgAccess(tx, user, organizerId, 'staff');
    const event = await tx.get('events', eventId);
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    const types = await loadTicketTypes(tx, eventId);
    const held = await activeHeld(tx, eventId, nowS);
    const seatMap = await tx.get('seatMaps', eventId);
    return {
      event,
      ticketTypes: types.map((t) => ({
        ...t,
        accessCodeHash: null,
        hasAccessCode: !!t.accessCodeHash,
        held: held.get(t.id) ?? 0,
        available: availableOf(t, held),
      })),
      seatMap,
      role: access.role,
      organizer: { id: access.org.id, name: access.org.name, status: access.org.status, slug: access.org.slug },
      hasSales: types.some((t) => t.sold > 0),
    };
  });
}

function eventFromInput(input: EventInput, base: Partial<EventDoc>): Omit<EventDoc, 'id' | 'organizerId' | 'slug' | 'status' | 'createdAt' | 'updatedAt' | 'publishedAt' | 'cancelledAt' | 'cancelReason' | 'featured' | 'seated'> {
  return {
    title: input.title,
    subtitle: input.subtitle,
    description: input.description,
    category: input.category,
    visibility: input.visibility,
    startsAt: new Date(input.startsAt).toISOString(),
    endsAt: new Date(input.endsAt).toISOString(),
    doorsAt: input.doorsAt ? new Date(input.doorsAt).toISOString() : null,
    salesStartAt: input.salesStartAt ? new Date(input.salesStartAt).toISOString() : null,
    salesEndAt: input.salesEndAt ? new Date(input.salesEndAt).toISOString() : null,
    venue: input.venue,
    city: input.venue.city,
    ageLimit: input.ageLimit,
    poster: input.poster,
    coverImageId: input.coverImageId,
    lineup: input.lineup,
    tags: input.tags,
    settings: input.settings,
    ...base,
  };
}

export async function createEvent(deps: Deps, user: User, organizerId: string, input: EventInput, types: TicketTypeInput[]): Promise<EventDoc> {
  const now = nowIso(deps);
  if (types.length > LIMITS.ticketTypesMax) throw new AppError('validation', { message: `Maks ${LIMITS.ticketTypesMax} billettyper.` });
  return deps.store.tx(async (tx) => {
    const access = await requireOrgAccess(tx, user, organizerId, 'admin');
    if (access.org.status === 'rejected' || access.org.status === 'suspended') throw new AppError('organizer_not_approved');
    const event: EventDoc = {
      id: newId(),
      organizerId,
      slug: await uniqueSlug(tx, input.title, 'events'),
      status: 'draft',
      featured: false,
      seated: false,
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      cancelledAt: null,
      cancelReason: null,
      ...eventFromInput(input, {}),
    };
    await tx.insert('events', event);
    let order = 0;
    for (const t of types) {
      await insertTicketType(tx, deps, event.id, t, order++);
    }
    await audit(tx, deps, user.id, 'event.created', 'events', event.id, { title: event.title });
    return event;
  });
}

async function insertTicketType(tx: Tx, deps: Deps, eventId: string, t: TicketTypeInput, sortOrder: number): Promise<TicketType> {
  const now = nowIso(deps);
  const tt: TicketType = {
    id: newId(),
    eventId,
    name: t.name,
    description: t.description,
    priceOre: t.priceOre,
    capacity: t.capacity,
    sold: 0,
    maxPerOrder: t.maxPerOrder,
    salesStartAt: t.salesStartAt ? new Date(t.salesStartAt).toISOString() : null,
    salesEndAt: t.salesEndAt ? new Date(t.salesEndAt).toISOString() : null,
    hidden: t.hidden,
    accessCodeHash: t.hidden && t.accessCode ? await hashAccessCode(eventId, t.accessCode) : null,
    vatRate: t.vatRate,
    sortOrder: t.sortOrder || sortOrder,
    paused: t.paused,
    createdAt: now,
    updatedAt: now,
  };
  await tx.insert('ticketTypes', tt);
  return tt;
}

export async function updateEvent(deps: Deps, user: User, organizerId: string, eventId: string, input: EventInput): Promise<EventDoc> {
  const now = nowIso(deps);
  return deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const event = await tx.get('events', eventId, { forUpdate: true });
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    if (event.status === 'cancelled') throw new AppError('event_cancelled');
    const next = eventFromInput(input, {});
    const timeChanged = next.startsAt !== event.startsAt || next.venue.name !== event.venue.name;
    const patch: Partial<EventDoc> = { ...next, updatedAt: now };
    if (input.title !== event.title && event.status === 'draft') patch.slug = await uniqueSlug(tx, input.title, 'events', eventId);
    const updated = await tx.update('events', eventId, patch);
    if (timeChanged && event.status === 'published') {
      const tickets = await tx.find('tickets', { eventId, status: 'valid' });
      const owners = [...new Set(tickets.map((t) => t.ownerId))];
      for (const ownerId of owners) {
        await notify(tx, deps, ownerId, {
          kind: 'event_changed',
          title: `Endring: ${updated.title}`,
          body: 'Tid eller sted er endret. Sjekk detaljene på billetten din.',
          link: `/billetter`,
          email: {
            subject: `Endring i ${updated.title}`,
            heading: `${updated.title} er endret`,
            paragraphs: ['Arrangøren har endret tid eller sted. Billetten din gjelder fortsatt.', 'Åpne billetten i TIKIT for oppdaterte detaljer.'],
          },
          transactional: true,
        });
      }
    }
    await audit(tx, deps, user.id, 'event.updated', 'events', eventId);
    return updated;
  });
}

export async function saveTicketTypes(deps: Deps, user: User, organizerId: string, eventId: string, types: TicketTypeInput[]): Promise<void> {
  if (types.length > LIMITS.ticketTypesMax) throw new AppError('validation', { message: `Maks ${LIMITS.ticketTypesMax} billettyper.` });
  const now = nowIso(deps);
  await deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const event = await tx.get('events', eventId, { forUpdate: true });
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    if (event.status === 'cancelled') throw new AppError('event_cancelled');
    const existing = await loadTicketTypes(tx, eventId, true);
    const seatMap = event.seated ? await tx.get('seatMaps', eventId) : null;
    const seatedTypeIds = new Set(seatMap?.sections.map((s) => s.ticketTypeId) ?? []);
    const keep = new Set(types.filter((t) => t.id).map((t) => t.id!));
    for (const old of existing) {
      if (!keep.has(old.id)) {
        if (old.sold > 0) throw new AppError('ticket_type_has_sales');
        if (seatedTypeIds.has(old.id)) throw new AppError('validation', { message: 'Billettypen brukes i salkartet. Fjern den fra salkartet først.' });
        const holds = await tx.find('holds', { ticketTypeId: old.id });
        if (holds.some((h) => h.expiresAt > now)) throw new AppError('conflict', { message: 'Noen holder på å kjøpe denne billettypen. Prøv igjen om noen minutter.' });
        await tx.deleteWhere('holds', { ticketTypeId: old.id });
        await tx.delete('ticketTypes', old.id);
      }
    }
    let order = 0;
    for (const t of types) {
      const sortOrder = order++;
      if (t.id) {
        const current = existing.find((e) => e.id === t.id);
        if (!current) throw new AppError('invalid_ticket_type');
        const capacity = seatedTypeIds.has(current.id) ? current.capacity : t.capacity;
        if (capacity < current.sold) throw new AppError('capacity_below_sold');
        const patch: Partial<TicketType> = {
          name: t.name,
          description: t.description,
          priceOre: t.priceOre,
          capacity,
          maxPerOrder: t.maxPerOrder,
          salesStartAt: t.salesStartAt ? new Date(t.salesStartAt).toISOString() : null,
          salesEndAt: t.salesEndAt ? new Date(t.salesEndAt).toISOString() : null,
          hidden: t.hidden,
          vatRate: t.vatRate,
          paused: t.paused,
          sortOrder,
          updatedAt: now,
        };
        if (!t.hidden) patch.accessCodeHash = null;
        else if (t.accessCode) patch.accessCodeHash = await hashAccessCode(eventId, t.accessCode);
        await tx.update('ticketTypes', current.id, patch);
        // Capacity increase on a sold-out event: let the waitlist know.
        if (capacity > current.capacity && current.sold >= current.capacity) {
          await notifyWaitlist(tx, deps, event);
        }
      } else {
        await insertTicketType(tx, deps, eventId, t, sortOrder);
      }
    }
    await tx.update('events', eventId, { updatedAt: now });
    await audit(tx, deps, user.id, 'event.ticket_types_saved', 'events', eventId);
  });
}

export async function publishEvent(deps: Deps, user: User, organizerId: string, eventId: string): Promise<EventDoc> {
  const now = nowIso(deps);
  return deps.store.tx(async (tx) => {
    const access = await requireOrgAccess(tx, user, organizerId, 'admin');
    if (access.org.status !== 'approved') throw new AppError('organizer_not_approved');
    const event = await tx.get('events', eventId, { forUpdate: true });
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    if (event.status === 'cancelled') throw new AppError('event_cancelled');
    if (event.endsAt <= now) throw new AppError('event_ended');
    const types = await loadTicketTypes(tx, eventId);
    if (types.length === 0) throw new AppError('publish_incomplete');
    const updated = await tx.update('events', eventId, { status: 'published', publishedAt: event.publishedAt ?? now, updatedAt: now });
    await audit(tx, deps, user.id, 'event.published', 'events', eventId);
    return updated;
  });
}

export async function unpublishEvent(deps: Deps, user: User, organizerId: string, eventId: string): Promise<EventDoc> {
  return deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const event = await tx.get('events', eventId, { forUpdate: true });
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    const types = await loadTicketTypes(tx, eventId);
    if (types.some((t) => t.sold > 0)) throw new AppError('event_has_sales', { message: 'Arrangementet har solgte billetter. Avlys det i stedet for å skjule det.' });
    const updated = await tx.update('events', eventId, { status: 'draft', updatedAt: nowIso(deps) });
    await audit(tx, deps, user.id, 'event.unpublished', 'events', eventId);
    return updated;
  });
}

export async function duplicateEvent(deps: Deps, user: User, organizerId: string, eventId: string): Promise<EventDoc> {
  const now = nowIso(deps);
  return deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const src = await tx.get('events', eventId);
    if (!src || src.organizerId !== organizerId) throw new AppError('not_found');
    const shift = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() + 7 * 86400000).toISOString() : null);
    const title = `${src.title} (kopi)`.slice(0, LIMITS.titleMax);
    const copy: EventDoc = {
      ...src,
      id: newId(),
      slug: await uniqueSlug(tx, title, 'events'),
      title,
      status: 'draft',
      featured: false,
      seated: false,
      startsAt: shift(src.startsAt)!,
      endsAt: shift(src.endsAt)!,
      doorsAt: shift(src.doorsAt),
      salesStartAt: shift(src.salesStartAt),
      salesEndAt: shift(src.salesEndAt),
      createdAt: now,
      updatedAt: now,
      publishedAt: null,
      cancelledAt: null,
      cancelReason: null,
      poster: { ...src.poster, seed: (src.poster.seed + 7919) % 1_000_000 },
    };
    await tx.insert('events', copy);
    const types = await loadTicketTypes(tx, eventId);
    for (const t of types) {
      await tx.insert('ticketTypes', { ...t, id: newId(), eventId: copy.id, sold: 0, salesStartAt: shift(t.salesStartAt), salesEndAt: shift(t.salesEndAt), createdAt: now, updatedAt: now });
    }
    await audit(tx, deps, user.id, 'event.duplicated', 'events', copy.id, { from: eventId });
    return copy;
  });
}

export async function saveSeatMap(deps: Deps, user: User, organizerId: string, eventId: string, input: SeatMapInput): Promise<SeatMap> {
  const now = nowIso(deps);
  return deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const event = await tx.get('events', eventId, { forUpdate: true });
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    const state = await loadSeatState(tx, eventId, now, true);
    const taken = Object.values(state.seats).some((s) => s.status === 'sold' || (s.status === 'held' && !!s.until && s.until > now));
    if (taken) throw new AppError('event_has_sales', { message: 'Salkartet kan ikke endres etter at seter er solgt eller reservert.' });
    const types = await loadTicketTypes(tx, eventId, true);
    const sectionIds = new Set<string>();
    const map: SeatMap = {
      id: eventId,
      eventId,
      stageLabel: input.stageLabel,
      updatedAt: now,
      sections: input.sections.map((s) => {
        if (sectionIds.has(s.id)) throw new AppError('validation', { message: 'To seksjoner har samme id.' });
        sectionIds.add(s.id);
        if (!types.some((t) => t.id === s.ticketTypeId)) throw new AppError('invalid_ticket_type');
        const rowLabels = new Set<string>();
        return {
          id: s.id,
          name: s.name,
          ticketTypeId: s.ticketTypeId,
          rows: s.rows.map((r) => {
            const label = r.label.toUpperCase();
            if (rowLabels.has(label)) throw new AppError('validation', { message: `Rad ${label} finnes to ganger i ${s.name}.` });
            rowLabels.add(label);
            const accessible = new Set(r.accessible);
            return {
              label,
              offset: r.offset,
              seats: Array.from({ length: r.seats }, (_, i) => ({ id: seatIdFor(s.id, label, i + 1), number: i + 1, accessible: accessible.has(i + 1) })),
            };
          }),
        };
      }),
    };
    const total = map.sections.reduce((s, sec) => s + sec.rows.reduce((a, r) => a + r.seats.length, 0), 0);
    if (total > LIMITS.maxSeatsPerMap) throw new AppError('validation', { message: `Et salkart kan ha maks ${LIMITS.maxSeatsPerMap} seter.` });
    // Seated ticket types get their capacity from the seat map.
    const perType = new Map<string, number>();
    for (const sec of map.sections) perType.set(sec.ticketTypeId, (perType.get(sec.ticketTypeId) ?? 0) + sec.rows.reduce((a, r) => a + r.seats.length, 0));
    for (const [typeId, capacity] of perType) {
      const tt = types.find((t) => t.id === typeId)!;
      if (capacity < tt.sold) throw new AppError('capacity_below_sold');
      await tx.update('ticketTypes', typeId, { capacity, updatedAt: now });
    }
    // Keep blocked seats that still exist.
    const index = indexSeats(map);
    const kept: typeof state.seats = {};
    for (const [id, entry] of Object.entries(state.seats)) if (index.has(id) && entry.status === 'blocked') kept[id] = entry;
    await tx.put('seatStates', { ...state, seats: kept, updatedAt: now });
    await tx.put('seatMaps', map);
    await tx.update('events', eventId, { seated: true, updatedAt: now });
    await audit(tx, deps, user.id, 'event.seatmap_saved', 'events', eventId, { seats: total });
    return map;
  });
}

export async function deleteSeatMap(deps: Deps, user: User, organizerId: string, eventId: string): Promise<void> {
  const now = nowIso(deps);
  await deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const event = await tx.get('events', eventId, { forUpdate: true });
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    const state = await loadSeatState(tx, eventId, now, true);
    if (Object.values(state.seats).some((s) => s.status === 'sold')) throw new AppError('event_has_sales');
    await tx.delete('seatMaps', eventId);
    await tx.delete('seatStates', eventId);
    await tx.update('events', eventId, { seated: false, updatedAt: now });
  });
}

export async function setSeatsBlocked(deps: Deps, user: User, organizerId: string, eventId: string, seatIds: string[], blocked: boolean): Promise<void> {
  const now = nowIso(deps);
  await deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const map = await tx.get('seatMaps', eventId);
    if (!map || map.eventId !== eventId) throw new AppError('not_found');
    const event = await tx.get('events', eventId);
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    const index = indexSeats(map);
    const state = await loadSeatState(tx, eventId, now, true);
    const seats = { ...state.seats };
    const typeDelta = new Map<string, number>();
    for (const id of seatIds) {
      const info = index.get(id);
      if (!info) continue;
      const entry = seats[id];
      if (blocked) {
        if (!seatIsFree(entry, now)) continue;
        seats[id] = { status: 'blocked', orderId: null, until: null, ticketId: null };
        typeDelta.set(info.ticketTypeId, (typeDelta.get(info.ticketTypeId) ?? 0) - 1);
      } else if (entry?.status === 'blocked') {
        delete seats[id];
        typeDelta.set(info.ticketTypeId, (typeDelta.get(info.ticketTypeId) ?? 0) + 1);
      }
    }
    for (const [typeId, delta] of typeDelta) {
      const tt = await tx.get('ticketTypes', typeId, { forUpdate: true });
      if (tt) await tx.update('ticketTypes', typeId, { capacity: Math.max(tt.sold, tt.capacity + delta), updatedAt: now });
    }
    await tx.put('seatStates', { ...state, seats, updatedAt: now });
  });
}
