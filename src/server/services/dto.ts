import type {
  EventCard,
  EventDoc,
  Organizer,
  OrganizerPublic,
  SaleState,
  TicketType,
  TicketTypePublic,
} from '../../shared/types';
import { feeForPrice, type FeeSettings } from '../../shared/pricing';
import { LIMITS } from '../../shared/constants';

export function imageUrl(id: string | null): string | null {
  return id ? `/api/images/${id}` : null;
}

export function toOrganizerPublic(org: Organizer, followers: number): OrganizerPublic {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    type: org.type,
    description: org.description,
    city: org.city,
    verified: org.verified,
    logoUrl: imageUrl(org.logoImageId),
    palette: org.palette,
    followers,
    website: org.website,
  };
}

export type TypeState = TicketTypePublic['state'];

/** Effective sales window of a ticket type (type-level window overrides the event window). */
export function typeSalesWindow(tt: TicketType, event: EventDoc): { start: string | null; end: string } {
  const start = tt.salesStartAt ?? event.salesStartAt;
  const end = tt.salesEndAt ?? event.salesEndAt ?? event.endsAt;
  return { start, end };
}

export function ticketTypeState(tt: TicketType, event: EventDoc, available: number, now: Date): TypeState {
  if (tt.paused) return 'paused';
  const { start, end } = typeSalesWindow(tt, event);
  if (new Date(end) <= now) return 'ended';
  if (available <= 0) return 'sold_out';
  if (start && new Date(start) > now) return 'not_started';
  return 'on_sale';
}

export function isLow(tt: TicketType, available: number): boolean {
  if (available <= 0) return false;
  return available <= Math.max(5, Math.ceil(tt.capacity * 0.1));
}

export function toTicketTypePublic(
  tt: TicketType,
  event: EventDoc,
  available: number,
  fees: FeeSettings,
  now: Date,
  unlocked: boolean,
): TicketTypePublic {
  const state = ticketTypeState(tt, event, available, now);
  return {
    id: tt.id,
    name: tt.name,
    description: tt.description,
    priceOre: tt.priceOre,
    feeOre: feeForPrice(tt.priceOre, fees),
    state,
    available: event.settings.showRemaining ? Math.max(0, available) : null,
    low: isLow(tt, available),
    maxPerOrder: Math.min(tt.maxPerOrder ?? event.settings.maxPerOrder, event.settings.maxPerOrder, LIMITS.maxTicketsPerOrder),
    salesStartAt: tt.salesStartAt ?? event.salesStartAt,
    salesEndAt: tt.salesEndAt ?? event.salesEndAt,
    unlocked: tt.hidden && unlocked,
    seated: event.seated,
  };
}

/** Overall sale state shown on cards and the event page. */
export function eventSaleState(event: EventDoc, types: { tt: TicketType; available: number }[], now: Date): SaleState {
  if (event.status === 'draft') return 'draft';
  if (event.status === 'cancelled') return 'cancelled';
  if (new Date(event.endsAt) <= now) return 'past';
  const visible = types.filter((t) => !t.tt.hidden);
  const relevant = visible.length > 0 ? visible : types;
  if (relevant.length === 0) return 'upcoming';
  const states = relevant.map((t) => ticketTypeState(t.tt, event, t.available, now));
  if (states.includes('on_sale')) return 'on_sale';
  if (states.includes('not_started')) return 'upcoming';
  if (states.every((s) => s === 'ended' || s === 'paused')) {
    return states.includes('paused') ? 'upcoming' : 'ended';
  }
  return 'sold_out';
}

export function toEventCard(
  event: EventDoc,
  org: Organizer,
  types: { tt: TicketType; available: number }[],
  now: Date,
): EventCard {
  const visible = types.filter((t) => !t.tt.hidden && !t.tt.paused);
  const priced = visible.length > 0 ? visible : types.filter((t) => !t.tt.hidden);
  const onSaleOrUpcoming = priced.filter((t) => ticketTypeState(t.tt, event, t.available, now) !== 'ended');
  const priceFrom = (onSaleOrUpcoming.length > 0 ? onSaleOrUpcoming : priced).reduce<number | null>(
    (min, t) => (min === null || t.tt.priceOre < min ? t.tt.priceOre : min),
    null,
  );
  const saleState = eventSaleState(event, types, now);
  const totalCap = visible.reduce((s, t) => s + t.tt.capacity, 0);
  const totalAvail = visible.reduce((s, t) => s + Math.max(0, t.available), 0);
  const firstStart = types
    .filter((t) => !t.tt.hidden && ticketTypeState(t.tt, event, t.available, now) === 'not_started')
    .map((t) => typeSalesWindow(t.tt, event).start)
    .filter((d): d is string => !!d)
    .sort()[0];
  return {
    id: event.id,
    slug: event.slug,
    title: event.title,
    subtitle: event.subtitle,
    category: event.category,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    city: event.city,
    venueName: event.venue.name,
    ageLimit: event.ageLimit,
    poster: event.poster,
    coverUrl: imageUrl(event.coverImageId),
    organizerName: org.name,
    organizerSlug: org.slug,
    organizerVerified: org.verified,
    priceFromOre: priceFrom,
    saleState,
    salesStartAt: saleState === 'upcoming' ? (firstStart ?? event.salesStartAt) : event.salesStartAt,
    lowAvailability: saleState === 'on_sale' && totalCap > 0 && totalAvail <= Math.max(10, Math.ceil(totalCap * 0.1)),
    featured: event.featured,
    status: event.status,
  };
}
