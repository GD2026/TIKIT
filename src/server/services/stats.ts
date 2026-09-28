import { AppError } from '../../shared/errors';
import { addDays, osloDateKey } from '../../shared/time';
import type { Order, Payout, User } from '../../shared/types';
import type { Deps } from '../context';
import { requireOrgAccess, roleAtLeast } from './organizers';
import { isPaidStatus } from './orders';

/** Organizer's ticket revenue from an order (resale orders pass through to the seller). */
export function orderTicketRevenue(o: Order): number {
  if (!isPaidStatus(o.status) || o.kind !== 'standard') return 0;
  return o.subtotalOre - o.discountOre;
}

/** Ticket money that went back to buyers and is borne by the organizer. */
export function orderTicketRefunds(o: Order): number {
  return o.refunds.filter((r) => r.kind === 'ticket' || r.kind === 'event_cancelled').reduce((s, r) => s + r.ticketOre, 0);
}

export function orderTickets(o: Order): number {
  return o.items.reduce((s, i) => s + i.qty, 0);
}

function daySeries(days: number, now: Date): string[] {
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) out.push(osloDateKey(addDays(now, -i)));
  return [...new Set(out)];
}

export interface DashboardData {
  kpis: {
    revenueOre: number;
    ticketsSold: number;
    orders: number;
    upcomingEvents: number;
    todayRevenueOre: number;
    todayTickets: number;
    avgOrderOre: number;
  };
  series: { date: string; revenueOre: number; tickets: number }[];
  topEvents: { id: string; title: string; slug: string; startsAt: string; sold: number; capacity: number; revenueOre: number; status: string }[];
  recentOrders: { id: string; ref: string; buyerName: string; eventTitle: string; ticketOre: number; tickets: number; at: string; kind: Order['kind'] }[];
  canSeeRevenue: boolean;
}

export async function orgDashboard(deps: Deps, user: User, organizerId: string, days = 30): Promise<DashboardData> {
  const now = deps.clock();
  const nowS = now.toISOString();
  return deps.store.read(async (tx) => {
    const access = await requireOrgAccess(tx, user, organizerId, 'staff');
    const canSeeRevenue = roleAtLeast(access.role, 'admin');
    const events = await tx.find('events', { organizerId });
    const orders = (await tx.find('orders', { organizerId })).filter((o) => isPaidStatus(o.status) && o.paidAt);
    const types = events.length ? await tx.find('ticketTypes', { eventId: { in: events.map((e) => e.id) } }) : [];
    const today = osloDateKey(now);
    const keys = daySeries(days, now);
    const series = keys.map((date) => ({ date, revenueOre: 0, tickets: 0 }));
    const byDate = new Map(series.map((s) => [s.date, s]));
    let revenue = 0;
    let tickets = 0;
    let todayRevenue = 0;
    let todayTickets = 0;
    for (const o of orders) {
      const rev = orderTicketRevenue(o) - orderTicketRefunds(o);
      const qty = o.kind === 'resale' ? 0 : orderTickets(o);
      revenue += rev;
      tickets += qty;
      const key = osloDateKey(o.paidAt!);
      const slot = byDate.get(key);
      if (slot) {
        slot.revenueOre += orderTicketRevenue(o);
        slot.tickets += qty;
      }
      if (key === today) {
        todayRevenue += orderTicketRevenue(o);
        todayTickets += qty;
      }
    }
    const standardOrders = orders.filter((o) => o.kind === 'standard');
    const topEvents = events
      .map((e) => {
        const et = types.filter((t) => t.eventId === e.id);
        const eo = orders.filter((o) => o.eventId === e.id);
        return {
          id: e.id,
          title: e.title,
          slug: e.slug,
          startsAt: e.startsAt,
          sold: et.reduce((s, t) => s + t.sold, 0),
          capacity: et.reduce((s, t) => s + t.capacity, 0),
          revenueOre: eo.reduce((s, o) => s + orderTicketRevenue(o) - orderTicketRefunds(o), 0),
          status: e.status,
        };
      })
      .filter((e) => e.status !== 'draft')
      .sort((a, b) => (a.startsAt >= nowS ? 0 : 1) - (b.startsAt >= nowS ? 0 : 1) || a.startsAt.localeCompare(b.startsAt))
      .slice(0, 6);
    const eventTitle = new Map(events.map((e) => [e.id, e.title]));
    const recentOrders = [...orders]
      .sort((a, b) => (b.paidAt ?? '').localeCompare(a.paidAt ?? ''))
      .slice(0, 8)
      .map((o) => ({
        id: o.id,
        ref: o.ref,
        buyerName: o.buyer.name,
        eventTitle: eventTitle.get(o.eventId) ?? '',
        ticketOre: canSeeRevenue ? orderTicketRevenue(o) : 0,
        tickets: orderTickets(o),
        at: o.paidAt!,
        kind: o.kind,
      }));
    return {
      kpis: {
        revenueOre: canSeeRevenue ? revenue : 0,
        ticketsSold: tickets,
        orders: standardOrders.length,
        upcomingEvents: events.filter((e) => e.status === 'published' && e.endsAt > nowS).length,
        todayRevenueOre: canSeeRevenue ? todayRevenue : 0,
        todayTickets,
        avgOrderOre: canSeeRevenue && standardOrders.length ? Math.round(standardOrders.reduce((s, o) => s + orderTicketRevenue(o), 0) / standardOrders.length) : 0,
      },
      series: canSeeRevenue ? series : series.map((s) => ({ ...s, revenueOre: 0 })),
      topEvents: canSeeRevenue ? topEvents : topEvents.map((e) => ({ ...e, revenueOre: 0 })),
      recentOrders,
      canSeeRevenue,
    };
  });
}

export interface EventStatsData {
  sold: number;
  capacity: number;
  revenueOre: number;
  refundsOre: number;
  orders: number;
  avgOrderOre: number;
  checkedIn: number;
  compTickets: number;
  feesOre: number;
  byType: { id: string; name: string; sold: number; capacity: number; revenueOre: number; priceOre: number }[];
  series: { date: string; tickets: number; revenueOre: number }[];
  discounts: { code: string; uses: number; discountOre: number }[];
  resale: { active: number; sold: number };
  waitlist: number;
  saleAlerts: number;
  queue: { total: number } | null;
}

export async function eventStats(deps: Deps, user: User, organizerId: string, eventId: string): Promise<EventStatsData> {
  const now = deps.clock();
  return deps.store.read(async (tx) => {
    const access = await requireOrgAccess(tx, user, organizerId, 'staff');
    const canSeeRevenue = roleAtLeast(access.role, 'admin');
    const event = await tx.get('events', eventId);
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    const types = await tx.find('ticketTypes', { eventId });
    const orders = (await tx.find('orders', { eventId })).filter((o) => isPaidStatus(o.status));
    const tickets = await tx.find('tickets', { eventId });
    const listings = await tx.find('resaleListings', { eventId });
    const start = orders.reduce((min, o) => (o.paidAt && o.paidAt < min ? o.paidAt : min), now.toISOString());
    const spanDays = Math.min(90, Math.max(7, Math.ceil((now.getTime() - new Date(start).getTime()) / 86400000) + 1));
    const series = daySeries(spanDays, now).map((date) => ({ date, tickets: 0, revenueOre: 0 }));
    const byDate = new Map(series.map((s) => [s.date, s]));
    for (const o of orders) {
      if (!o.paidAt || o.kind === 'resale') continue;
      const slot = byDate.get(osloDateKey(o.paidAt));
      if (slot) {
        slot.tickets += orderTickets(o);
        slot.revenueOre += canSeeRevenue ? orderTicketRevenue(o) : 0;
      }
    }
    const discountMap = new Map<string, { code: string; uses: number; discountOre: number }>();
    for (const o of orders) {
      if (!o.discount) continue;
      const d = discountMap.get(o.discount.code) ?? { code: o.discount.code, uses: 0, discountOre: 0 };
      d.uses++;
      d.discountOre += o.discountOre;
      discountMap.set(o.discount.code, d);
    }
    const standard = orders.filter((o) => o.kind === 'standard');
    const revenue = orders.reduce((s, o) => s + orderTicketRevenue(o) - orderTicketRefunds(o), 0);
    const byType = types
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((t) => {
        const rev = standard.reduce((s, o) => s + o.items.filter((i) => i.ticketTypeId === t.id).reduce((a, i) => a + i.qty * i.unitPriceOre, 0), 0);
        return { id: t.id, name: t.name, sold: t.sold, capacity: t.capacity, revenueOre: canSeeRevenue ? rev : 0, priceOre: t.priceOre };
      });
    return {
      sold: types.reduce((s, t) => s + t.sold, 0),
      capacity: types.reduce((s, t) => s + t.capacity, 0),
      revenueOre: canSeeRevenue ? revenue : 0,
      refundsOre: canSeeRevenue ? orders.reduce((s, o) => s + orderTicketRefunds(o), 0) : 0,
      orders: standard.length,
      avgOrderOre: canSeeRevenue && standard.length ? Math.round(standard.reduce((s, o) => s + orderTicketRevenue(o), 0) / standard.length) : 0,
      checkedIn: tickets.filter((t) => t.status === 'used').length,
      compTickets: tickets.filter((t) => t.kind === 'comp' && (t.status === 'valid' || t.status === 'used')).length,
      feesOre: canSeeRevenue ? orders.reduce((s, o) => s + o.feeOre, 0) : 0,
      byType,
      series,
      discounts: [...discountMap.values()].sort((a, b) => b.uses - a.uses),
      resale: { active: listings.filter((l) => l.status === 'active' || l.status === 'reserved').length, sold: listings.filter((l) => l.status === 'sold').length },
      waitlist: await tx.count('waitlist', { eventId, status: 'waiting' }),
      saleAlerts: await tx.count('saleAlerts', { eventId }),
      queue: event.settings.queueEnabled ? { total: await tx.count('queueEntries', { eventId }) } : null,
    };
  });
}

export interface SettlementData {
  events: { id: string; title: string; startsAt: string; status: string; tickets: number; grossOre: number; refundsOre: number; netOre: number; feesPaidByBuyersOre: number }[];
  totals: { grossOre: number; refundsOre: number; netOre: number; paidOutOre: number; balanceOre: number; pendingOre: number };
  payouts: Payout[];
  payoutAccount: string | null;
}

/** Organizer settlement: ticket revenue (net of ticket refunds) minus payouts made. Buyer fees belong to TIKIT. */
export async function settlement(deps: Deps, user: User, organizerId: string): Promise<SettlementData> {
  const nowS = deps.clock().toISOString();
  return deps.store.read(async (tx) => {
    const access = await requireOrgAccess(tx, user, organizerId, 'admin');
    const events = await tx.find('events', { organizerId });
    const orders = await tx.find('orders', { organizerId });
    const payouts = (await tx.find('payouts', { organizerId })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const rows = events
      .map((e) => {
        const eo = orders.filter((o) => o.eventId === e.id);
        const gross = eo.reduce((s, o) => s + orderTicketRevenue(o), 0);
        const refunds = eo.reduce((s, o) => s + orderTicketRefunds(o), 0);
        return {
          id: e.id,
          title: e.title,
          startsAt: e.startsAt,
          status: e.status === 'cancelled' ? 'cancelled' : e.endsAt <= nowS ? 'ended' : e.status,
          tickets: eo.filter((o) => isPaidStatus(o.status) && o.kind === 'standard').reduce((s, o) => s + orderTickets(o), 0),
          grossOre: gross,
          refundsOre: refunds,
          netOre: gross - refunds,
          feesPaidByBuyersOre: eo.filter((o) => isPaidStatus(o.status)).reduce((s, o) => s + o.feeOre, 0),
        };
      })
      .filter((r) => r.grossOre > 0 || r.refundsOre > 0)
      .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
    const grossOre = rows.reduce((s, r) => s + r.grossOre, 0);
    const refundsOre = rows.reduce((s, r) => s + r.refundsOre, 0);
    const netOre = grossOre - refundsOre;
    const paidOutOre = payouts.reduce((s, p) => s + p.amountOre, 0);
    // Revenue for events that haven't ended yet is not payable (refund risk).
    const pendingOre = rows.filter((r) => r.status !== 'ended').reduce((s, r) => s + r.netOre, 0);
    const acct = access.org.payoutAccount;
    return {
      events: rows,
      totals: { grossOre, refundsOre, netOre, paidOutOre, balanceOre: netOre - paidOutOre, pendingOre },
      payouts,
      payoutAccount: acct ? `•••• •• ${acct.slice(-5)}` : null,
    };
  });
}
