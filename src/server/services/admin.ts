import { AppError } from '../../shared/errors';
import { newId, searchNormalize } from '../../shared/ids';
import { addDays, osloDateKey } from '../../shared/time';
import type { EventCard, Organizer, Payout, PlatformSettings, User } from '../../shared/types';
import type { Deps } from '../context';
import { appLink } from '../context';
import { audit, getSettings, notify, nowIso } from './common';
import { toEventCard } from './dto';
import { isPaidStatus } from './orders';
import { orderTicketRevenue, orderTicketRefunds, orderTickets } from './stats';
import { availableOf } from './inventory';

export function requireAdmin(user: User | null): User {
  if (!user) throw new AppError('unauthorized');
  if (user.role !== 'admin') throw new AppError('forbidden');
  return user;
}

export interface AdminOverview {
  gmvOre: number;
  feesOre: number;
  ticketsSold: number;
  users: number;
  organizers: { pending: number; approved: number; total: number };
  events: { published: number; upcoming: number; drafts: number };
  series: { date: string; gmvOre: number; feesOre: number; tickets: number }[];
  pendingOrganizers: Organizer[];
}

export async function adminOverview(deps: Deps, admin: User): Promise<AdminOverview> {
  requireAdmin(admin);
  const now = deps.clock();
  const nowS = now.toISOString();
  return deps.store.read(async (tx) => {
    const orders = (await tx.find('orders')).filter((o) => isPaidStatus(o.status));
    const organizers = await tx.find('organizers');
    const events = await tx.find('events');
    const users = await tx.count('users');
    const keys: string[] = [];
    for (let i = 29; i >= 0; i--) keys.push(osloDateKey(addDays(now, -i)));
    const series = [...new Set(keys)].map((date) => ({ date, gmvOre: 0, feesOre: 0, tickets: 0 }));
    const byDate = new Map(series.map((s) => [s.date, s]));
    let gmv = 0;
    let fees = 0;
    let tickets = 0;
    for (const o of orders) {
      const net = o.totalOre - o.refundedOre;
      gmv += net;
      fees += o.feeOre - o.refunds.reduce((s, r) => s + r.feeOre, 0);
      const t = o.kind === 'resale' ? 0 : orderTickets(o);
      tickets += t;
      const slot = o.paidAt ? byDate.get(osloDateKey(o.paidAt)) : undefined;
      if (slot) {
        slot.gmvOre += o.totalOre;
        slot.feesOre += o.feeOre;
        slot.tickets += t;
      }
    }
    return {
      gmvOre: gmv,
      feesOre: fees,
      ticketsSold: tickets,
      users,
      organizers: {
        pending: organizers.filter((o) => o.status === 'pending').length,
        approved: organizers.filter((o) => o.status === 'approved').length,
        total: organizers.length,
      },
      events: {
        published: events.filter((e) => e.status === 'published').length,
        upcoming: events.filter((e) => e.status === 'published' && e.endsAt > nowS).length,
        drafts: events.filter((e) => e.status === 'draft').length,
      },
      series,
      pendingOrganizers: organizers.filter((o) => o.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    };
  });
}

export interface AdminOrganizerRow extends Organizer {
  members: number;
  events: number;
  netRevenueOre: number;
  paidOutOre: number;
}

export async function adminOrganizers(deps: Deps, admin: User, status: Organizer['status'] | null): Promise<AdminOrganizerRow[]> {
  requireAdmin(admin);
  return deps.store.read(async (tx) => {
    const orgs = status ? await tx.find('organizers', { status }) : await tx.find('organizers');
    const out: AdminOrganizerRow[] = [];
    for (const org of orgs) {
      const orders = await tx.find('orders', { organizerId: org.id });
      const payouts = await tx.find('payouts', { organizerId: org.id });
      out.push({
        ...org,
        members: await tx.count('orgMembers', { organizerId: org.id }),
        events: await tx.count('events', { organizerId: org.id }),
        netRevenueOre: orders.reduce((s, o) => s + orderTicketRevenue(o) - orderTicketRefunds(o), 0),
        paidOutOre: payouts.reduce((s, p) => s + p.amountOre, 0),
      });
    }
    return out.sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0) || b.createdAt.localeCompare(a.createdAt));
  });
}

export async function reviewOrganizer(
  deps: Deps,
  admin: User,
  organizerId: string,
  input: { status: 'approved' | 'rejected' | 'suspended'; note: string | null; verified?: boolean | undefined },
): Promise<Organizer> {
  requireAdmin(admin);
  const nowS = nowIso(deps);
  return deps.store.tx(async (tx) => {
    const org = await tx.get('organizers', organizerId, { forUpdate: true });
    if (!org) throw new AppError('not_found');
    const updated = await tx.update('organizers', organizerId, {
      status: input.status,
      statusNote: input.note,
      verified: input.verified ?? org.verified,
      approvedAt: input.status === 'approved' ? (org.approvedAt ?? nowS) : org.approvedAt,
      updatedAt: nowS,
    });
    const owners = await tx.find('orgMembers', { organizerId, role: 'owner' });
    const text =
      input.status === 'approved'
        ? { title: `${org.name} er godkjent`, body: 'Du kan nå publisere arrangementer og selge billetter på TIKIT.' }
        : input.status === 'rejected'
          ? { title: `Søknaden for ${org.name} ble avslått`, body: input.note ?? 'Ta kontakt med TIKIT for mer informasjon.' }
          : { title: `${org.name} er midlertidig stengt`, body: input.note ?? 'Ta kontakt med TIKIT for mer informasjon.' };
    if (org.status !== input.status) {
      for (const m of owners) {
        await notify(tx, deps, m.userId, {
          kind: 'organizer_status',
          title: text.title,
          body: text.body,
          link: `/arrangor/${organizerId}`,
          email: { subject: text.title, heading: text.title, paragraphs: [text.body], cta: { label: 'Åpne arrangørpanelet', url: appLink(deps.config, `/arrangor/${organizerId}`) } },
          transactional: true,
        });
      }
    }
    if (input.status === 'suspended') {
      const events = await tx.find('events', { organizerId, status: 'published' });
      for (const e of events) if (e.featured) await tx.update('events', e.id, { featured: false });
    }
    await audit(tx, deps, admin.id, `organizer.${input.status}`, 'organizers', organizerId, { note: input.note });
    return updated;
  });
}

export interface AdminEventRow {
  card: EventCard;
  sold: number;
  capacity: number;
  gmvOre: number;
}

export async function adminEvents(deps: Deps, admin: User, q: string | null): Promise<AdminEventRow[]> {
  requireAdmin(admin);
  const now = deps.clock();
  const nowS = now.toISOString();
  return deps.store.read(async (tx) => {
    let events = await tx.find('events');
    events = events.filter((e) => e.status !== 'draft');
    if (q) {
      const needle = searchNormalize(q);
      events = events.filter((e) => searchNormalize(`${e.title} ${e.city} ${e.venue.name}`).includes(needle));
    }
    const orgs = await tx.getMany(
      'organizers',
      [...new Set(events.map((e) => e.organizerId))],
    );
    const ids = events.map((e) => e.id);
    const types = ids.length ? await tx.find('ticketTypes', { eventId: { in: ids } }) : [];
    const holds = ids.length ? await tx.find('holds', { eventId: { in: ids } }) : [];
    const orders = ids.length ? await tx.find('orders', { eventId: { in: ids } }) : [];
    const held = new Map<string, number>();
    for (const h of holds) if (h.expiresAt > nowS) held.set(h.ticketTypeId, (held.get(h.ticketTypeId) ?? 0) + h.qty);
    return events
      .map((e) => {
        const org = orgs.find((o) => o.id === e.organizerId);
        if (!org) return null;
        const et = types.filter((t) => t.eventId === e.id).map((tt) => ({ tt, available: availableOf(tt, held) }));
        return {
          card: toEventCard(e, org, et, now),
          sold: et.reduce((s, t) => s + t.tt.sold, 0),
          capacity: et.reduce((s, t) => s + t.tt.capacity, 0),
          gmvOre: orders.filter((o) => o.eventId === e.id && isPaidStatus(o.status)).reduce((s, o) => s + o.totalOre - o.refundedOre, 0),
        };
      })
      .filter((x): x is AdminEventRow => x !== null)
      .sort((a, b) => (a.card.endsAt > nowS ? 0 : 1) - (b.card.endsAt > nowS ? 0 : 1) || a.card.startsAt.localeCompare(b.card.startsAt));
  });
}

export async function setFeatured(deps: Deps, admin: User, eventId: string, featured: boolean): Promise<void> {
  requireAdmin(admin);
  await deps.store.tx(async (tx) => {
    const e = await tx.get('events', eventId, { forUpdate: true });
    if (!e) throw new AppError('not_found');
    await tx.update('events', eventId, { featured });
    await audit(tx, deps, admin.id, featured ? 'event.featured' : 'event.unfeatured', 'events', eventId);
  });
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: User['role'];
  banned: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  providers: string[];
  tickets: number;
}

export async function adminUsers(deps: Deps, admin: User, q: string | null): Promise<AdminUserRow[]> {
  requireAdmin(admin);
  return deps.store.read(async (tx) => {
    let users = (await tx.find('users')).filter((u) => !u.deletedAt);
    if (q) {
      const needle = searchNormalize(q);
      users = users.filter((u) => searchNormalize(`${u.name} ${u.email ?? ''} ${u.phone ?? ''}`).includes(needle));
    }
    users = users.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
    const out: AdminUserRow[] = [];
    for (const u of users) {
      const identities = await tx.find('identities', { userId: u.id });
      out.push({
        id: u.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        banned: u.banned,
        createdAt: u.createdAt,
        lastLoginAt: u.lastLoginAt,
        providers: [...new Set(identities.map((i) => i.provider))],
        tickets: await tx.count('tickets', { ownerId: u.id, status: 'valid' }),
      });
    }
    return out;
  });
}

export async function setUserBanned(deps: Deps, admin: User, userId: string, banned: boolean): Promise<void> {
  requireAdmin(admin);
  if (admin.id === userId) throw new AppError('forbidden', { message: 'Du kan ikke sperre deg selv.' });
  await deps.store.tx(async (tx) => {
    const u = await tx.get('users', userId, { forUpdate: true });
    if (!u) throw new AppError('not_found');
    await tx.update('users', userId, { banned, updatedAt: nowIso(deps) });
    if (banned) await tx.deleteWhere('sessions', { userId });
    await audit(tx, deps, admin.id, banned ? 'user.banned' : 'user.unbanned', 'users', userId);
  });
}

export async function getPlatformSettings(deps: Deps, admin: User): Promise<PlatformSettings> {
  requireAdmin(admin);
  return deps.store.read((tx) => getSettings(tx, deps));
}

export async function updatePlatformSettings(
  deps: Deps,
  admin: User,
  input: { feeFixedOre: number; feePercentBp: number; feeMaxOre: number; resaleFeePercentBp: number },
): Promise<PlatformSettings> {
  requireAdmin(admin);
  return deps.store.tx(async (tx) => {
    const current = await getSettings(tx, deps);
    const next: PlatformSettings = { ...current, ...input, updatedAt: nowIso(deps) };
    await tx.put('settings', next);
    await audit(tx, deps, admin.id, 'settings.updated', 'settings', 'platform', input);
    return next;
  });
}

export async function recordPayout(deps: Deps, admin: User, organizerId: string, input: { amountOre: number; reference: string; note: string }): Promise<Payout> {
  requireAdmin(admin);
  return deps.store.tx(async (tx) => {
    const org = await tx.get('organizers', organizerId);
    if (!org) throw new AppError('not_found');
    const payout: Payout = { id: newId(), organizerId, amountOre: input.amountOre, reference: input.reference, note: input.note, createdBy: admin.id, createdAt: nowIso(deps) };
    await tx.insert('payouts', payout);
    await audit(tx, deps, admin.id, 'payout.recorded', 'organizers', organizerId, { amountOre: input.amountOre });
    return payout;
  });
}
