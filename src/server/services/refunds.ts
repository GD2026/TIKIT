import { AppError } from '../../shared/errors';
import { newId } from '../../shared/ids';
import { refundDeadline } from '../../shared/constants';
import { sha256Hex } from '../../shared/encoding';
import { formatNok } from '../../shared/money';
import type { EventDoc, Order, RefundEntry, Ticket, User } from '../../shared/types';
import type { Deps } from '../context';
import type { Tx } from '../store/types';
import { audit, notify, nowIso } from './common';
import { loadSeatState } from './inventory';
import { releaseOrderTx, isPaidStatus } from './orders';
import { enqueuePaymentJob } from './paymentJobs';
import { requireOrgAccess } from './organizers';
import { notifyWaitlist } from './waitlist';

interface RefundPlan {
  order: Order;
  event: EventDoc;
  tickets: Ticket[];
  ticketOre: number;
  feeOre: number;
  amountOre: number;
  key: string;
}

function feeForTicket(order: Order, ticket: Ticket): number {
  const item = order.items.find((i) => i.ticketTypeId === ticket.ticketTypeId);
  return item?.feeOre ?? 0;
}

async function plan(
  tx: Tx,
  order: Order,
  event: EventDoc,
  tickets: Ticket[],
  includeFees: boolean,
  keyPrefix: string,
): Promise<RefundPlan> {
  const ticketOre = tickets.reduce((s, t) => s + t.pricePaidOre, 0);
  const feeOre = includeFees ? tickets.reduce((s, t) => s + feeForTicket(order, t), 0) : 0;
  const remaining = Math.max(0, order.totalOre - order.refundedOre);
  const amountOre = Math.min(ticketOre + feeOre, remaining);
  const key = `${keyPrefix}-${order.id}-${(await sha256Hex(tickets.map((t) => t.id).sort().join(','))).slice(0, 16)}-${includeFees ? 'f' : 'n'}`;
  void tx;
  return { order, event, tickets, ticketOre: Math.min(ticketOre, amountOre), feeOre: Math.max(0, amountOre - Math.min(ticketOre, amountOre)), amountOre, key };
}

/** Marks tickets refunded, frees capacity and seats, records the refund on the order. */
async function applyRefundTx(
  tx: Tx,
  deps: Deps,
  p: RefundPlan,
  kind: RefundEntry['kind'],
  reason: string,
  by: string | null,
): Promise<Order> {
  const nowS = nowIso(deps);
  const order = await tx.get('orders', p.order.id, { forUpdate: true });
  if (!order) throw new AppError('not_found');
  const refundedTickets: Ticket[] = [];
  for (const planned of p.tickets) {
    const t = await tx.get('tickets', planned.id, { forUpdate: true });
    if (!t || (t.status !== 'valid' && t.status !== 'used') || t.orderId !== order.id) continue;
    await tx.update('tickets', t.id, { status: 'refunded', transferId: null, resaleListingId: null, updatedAt: nowS });
    refundedTickets.push(t);
    if (t.transferId) {
      const tr = await tx.get('transfers', t.transferId);
      if (tr && tr.status === 'pending') await tx.update('transfers', tr.id, { status: 'cancelled' });
    }
    if (t.resaleListingId) {
      const l = await tx.get('resaleListings', t.resaleListingId);
      if (l && (l.status === 'active' || l.status === 'reserved')) await tx.update('resaleListings', l.id, { status: 'cancelled' });
    }
  }
  // Capacity: each refunded ticket frees one place of its type.
  const perType = new Map<string, number>();
  for (const t of refundedTickets) perType.set(t.ticketTypeId, (perType.get(t.ticketTypeId) ?? 0) + 1);
  for (const [typeId, n] of [...perType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const tt = await tx.get('ticketTypes', typeId, { forUpdate: true });
    if (tt) await tx.update('ticketTypes', typeId, { sold: Math.max(0, tt.sold - n), updatedAt: nowS });
  }
  const seated = refundedTickets.filter((t) => t.seat);
  if (seated.length > 0) {
    const state = await loadSeatState(tx, order.eventId, nowS, true);
    const seats = { ...state.seats };
    for (const t of seated) if (seats[t.seat!.id]?.ticketId === t.id) delete seats[t.seat!.id];
    await tx.put('seatStates', { ...state, seats, updatedAt: nowS });
  }
  const amount = refundedTickets.length === p.tickets.length ? p.amountOre : Math.min(p.amountOre, refundedTickets.reduce((s, t) => s + t.pricePaidOre + (p.feeOre > 0 ? feeForTicket(order, t) : 0), 0));
  const entry: RefundEntry = {
    id: newId(),
    amountOre: amount,
    ticketOre: Math.min(p.ticketOre, amount),
    feeOre: Math.max(0, amount - Math.min(p.ticketOre, amount)),
    kind,
    ticketIds: refundedTickets.map((t) => t.id),
    reason,
    by,
    at: nowS,
  };
  const refundedOre = order.refundedOre + amount;
  const remainingTickets = (await tx.find('tickets', { orderId: order.id })).filter((t) => t.status === 'valid' || t.status === 'used');
  const status: Order['status'] = remainingTickets.length === 0 ? 'refunded' : 'partially_refunded';
  const updated = await tx.update('orders', order.id, {
    refundedOre,
    refunds: amount > 0 || refundedTickets.length > 0 ? [...order.refunds, entry] : order.refunds,
    status: amount > 0 || refundedTickets.length > 0 ? status : order.status,
    updatedAt: nowS,
  });
  if (refundedTickets.length > 0 && kind !== 'event_cancelled' && p.event.status === 'published') await notifyWaitlist(tx, deps, p.event);
  return updated;
}

export async function refundTickets(
  deps: Deps,
  actor: User,
  args: { orderId: string; ticketIds: string[]; includeFees: boolean; reason: string; mode: 'organizer' | 'self' },
): Promise<{ refundedOre: number; tickets: number }> {
  const nowS = nowIso(deps);
  // One transaction with the order row locked: two refunds of the same order (buyer and organizer at the
  // same moment, a double tap, overlapping ticket sets) run one after the other, and the second only sees
  // what is still refundable. The money itself moves through a payment job that is retried until the
  // provider confirms, so TIKIT never records a refund the provider didn't make, or pays one out twice.
  return deps.store.tx(async (tx) => {
    const order = await tx.get('orders', args.orderId, { forUpdate: true });
    if (!order) throw new AppError('not_found');
    const event = await tx.get('events', order.eventId);
    if (!event) throw new AppError('not_found');
    if (args.mode === 'organizer') {
      await requireOrgAccess(tx, actor, order.organizerId, 'admin');
    }
    if (!isPaidStatus(order.status)) throw new AppError('ticket_not_refundable', { message: 'Bestillingen er ikke betalt.' });
    let tickets = (await tx.find('tickets', { orderId: order.id })).filter((t) => t.status === 'valid' || (args.mode === 'organizer' && t.status === 'used'));
    if (args.ticketIds.length > 0) tickets = tickets.filter((t) => args.ticketIds.includes(t.id));
    if (args.mode === 'self') {
      const deadline = refundDeadline(event.settings.refundPolicy, event.startsAt);
      if (!deadline || deadline.toISOString() <= nowS) throw new AppError('ticket_not_refundable');
      if (tickets.some((t) => t.ownerId !== actor.id || t.purchaserId !== actor.id || t.status !== 'valid' || t.transferId || t.resaleListingId)) {
        throw new AppError('ticket_not_refundable');
      }
    }
    if (tickets.length === 0) throw new AppError('ticket_not_refundable', { message: 'Ingen billetter å refundere.' });
    const p = await plan(tx, order, event, tickets, args.mode === 'organizer' ? args.includeFees : false, args.mode);

    const o = await applyRefundTx(tx, deps, p, 'ticket', args.reason || (args.mode === 'self' ? 'Refundert av kjøper' : 'Refundert av arrangør'), actor.id);
    const refundedOre = o.refundedOre - order.refundedOre;
    const entry = o.refunds[o.refunds.length - 1];
    if (refundedOre > 0 && order.paymentId && entry) {
      const payment = await tx.get('payments', order.paymentId);
      if (payment) {
        await enqueuePaymentJob(tx, deps, { payment, kind: 'refund', amountOre: refundedOre, idempotencyKey: `refund-${entry.id}`, reason: `Refusjon ${order.ref}` });
      }
    }
    const owners = [...new Set(p.tickets.map((t) => t.ownerId))];
    for (const ownerId of owners) {
      await notify(tx, deps, ownerId, {
        kind: 'refund_issued',
        title: `Refusjon: ${p.event.title}`,
        body: refundedOre > 0 ? `${formatNok(refundedOre)} refunderes til betalingsmåten som ble brukt.` : 'Billetten er kansellert.',
        link: `/ordre/${o.id}`,
        email:
          refundedOre > 0 && ownerId === o.userId
            ? {
                subject: `Refusjon for ${p.event.title}`,
                heading: 'Refusjonen er på vei',
                paragraphs: [`${formatNok(refundedOre)} refunderes for ordre ${o.ref}. Det kan ta 3–5 virkedager før beløpet vises på kontoen.`],
              }
            : null,
        transactional: true,
      });
    }
    await audit(tx, deps, actor.id, `refund.${args.mode}`, 'orders', o.id, { amountOre: refundedOre, tickets: p.tickets.length });
    return { refundedOre, tickets: p.tickets.length };
  });
}

/** Full refund (tickets + fees) of everything left on an order. Used when an event is cancelled. */
export async function refundOrderFull(deps: Deps, orderId: string, reason: string, by: string | null, opts: { runNow?: boolean } = {}): Promise<boolean> {
  try {
    await deps.store.tx(async (tx) => {
      const order = await tx.get('orders', orderId, { forUpdate: true });
      if (!order || !isPaidStatus(order.status)) return;
      const event = await tx.get('events', order.eventId);
      if (!event) return;
      const tickets = (await tx.find('tickets', { orderId })).filter((t) => t.status === 'valid' || t.status === 'used');
      const remaining = Math.max(0, order.totalOre - order.refundedOre);
      if (remaining === 0 && tickets.length === 0) return;
      const base = await plan(tx, order, event, tickets, true, 'cancel');
      // Everything left on the order goes back. The fee part is only the fee not refunded yet; the rest is
      // ticket money – also for tickets that moved on through resale – so the settlement stays right.
      const feesRefunded = order.refunds.reduce((s, r) => s + r.feeOre, 0);
      const feeLeft = Math.max(0, order.feeOre - feesRefunded);
      const ticketPart = Math.max(0, remaining - feeLeft);
      const p = { ...base, amountOre: remaining, ticketOre: ticketPart, feeOre: remaining - ticketPart };
      await applyRefundTx(tx, deps, p, 'event_cancelled', reason, by);
      const o = await tx.get('orders', order.id, { forUpdate: true });
      if (o && o.refundedOre < o.totalOre) {
        // applyRefundTx caps at ticket amounts; make sure the order is fully settled.
        const extra = o.totalOre - o.refundedOre;
        const entry: RefundEntry = { id: newId(), amountOre: extra, ticketOre: 0, feeOre: extra, kind: 'event_cancelled', ticketIds: [], reason, by, at: nowIso(deps) };
        await tx.update('orders', o.id, { refundedOre: o.totalOre, refunds: [...o.refunds, entry], status: 'refunded' });
      } else if (o) {
        await tx.update('orders', o.id, { status: 'refunded' });
      }
      if (remaining > 0 && order.paymentId) {
        const payment = await tx.get('payments', order.paymentId);
        if (payment) {
          await enqueuePaymentJob(tx, deps, { payment, kind: 'refund', amountOre: remaining, idempotencyKey: `cancel-${order.id}`, reason: `Avlyst arrangement: ${order.ref}`, runNow: opts.runNow });
        }
      }
    });
    return true;
  } catch (err) {
    deps.log.error('Kunne ikke refundere bestilling', { orderId, error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export async function cancelEvent(deps: Deps, user: User, organizerId: string, eventId: string, reason: string): Promise<{ refunded: number; failed: number }> {
  const nowS = nowIso(deps);
  await deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const event = await tx.get('events', eventId, { forUpdate: true });
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    if (event.status === 'cancelled') throw new AppError('event_cancelled');
    await tx.update('events', eventId, { status: 'cancelled', cancelledAt: nowS, cancelReason: reason, featured: false, updatedAt: nowS });
    const orders = await tx.find('orders', { eventId });
    for (const o of orders) {
      if (o.status !== 'reserved' && o.status !== 'pending_payment') continue;
      // Re-read under a lock: a payment may have completed this very moment (it then counts as paid below).
      const locked = await tx.get('orders', o.id, { forUpdate: true });
      if (!locked || (locked.status !== 'reserved' && locked.status !== 'pending_payment')) continue;
      await releaseOrderTx(tx, deps, locked, 'cancelled', 'event_cancelled');
      // A payment still open at the provider must not go through for a cancelled event.
      const payment = locked.paymentId ? await tx.get('payments', locked.paymentId, { forUpdate: true }) : null;
      if (payment && payment.status === 'pending') {
        await tx.update('payments', payment.id, { status: 'cancelled', updatedAt: nowS });
        await enqueuePaymentJob(tx, deps, { payment, kind: 'reverse', amountOre: 0, idempotencyKey: `reverse-${payment.id}`, reason: 'Avlyst arrangement', runNow: false });
      }
    }
    const listings = await tx.find('resaleListings', { eventId });
    for (const l of listings) if (l.status === 'active' || l.status === 'reserved') await tx.update('resaleListings', l.id, { status: 'cancelled' });
    const transfers = await tx.find('transfers', { eventId, status: 'pending' });
    for (const t of transfers) await tx.update('transfers', t.id, { status: 'cancelled' });
    await tx.deleteWhere('waitlist', { eventId });
    await tx.deleteWhere('saleAlerts', { eventId });
    const tickets = await tx.find('tickets', { eventId });
    const owners = [...new Set(tickets.filter((t) => t.status === 'valid').map((t) => t.ownerId))];
    const event2 = { ...event, cancelReason: reason };
    for (const ownerId of owners) {
      await notify(tx, deps, ownerId, {
        kind: 'event_cancelled',
        title: `Avlyst: ${event2.title}`,
        body: 'Arrangementet er avlyst. Du får pengene tilbake automatisk, inkludert gebyr.',
        link: '/billetter',
        email: {
          subject: `Avlyst: ${event2.title}`,
          heading: `${event2.title} er avlyst`,
          paragraphs: [`Arrangøren skriver: «${reason}»`, 'Du får hele beløpet tilbake, inkludert servicegebyr, til betalingsmåten du brukte. Du trenger ikke gjøre noe.'],
        },
        transactional: true,
      });
    }
    await audit(tx, deps, user.id, 'event.cancelled', 'events', eventId, { reason });
  });
  // Paid orders are read again after the cancellation committed, so none that were paid in the meantime is missed.
  const paid = await deps.store.read(async (tx) =>
    (await tx.find('orders', { eventId })).filter((o) => isPaidStatus(o.status) && o.status !== 'refunded' && o.totalOre - o.refundedOre > 0).map((o) => o.id),
  );
  let refunded = 0;
  let failed = 0;
  for (const id of paid) {
    // The money is sent by payment jobs in the background (cron), so a large event cancels quickly.
    const ok = await refundOrderFull(deps, id, `Avlyst: ${reason}`, user.id, { runNow: false });
    if (ok) refunded++;
    else failed++;
  }
  return { refunded, failed };
}

/** Cron: retries refunds for cancelled events that failed earlier. */
export async function retryCancelledEventRefunds(deps: Deps): Promise<number> {
  const ids = await deps.store.read(async (tx) => {
    const events = await tx.find('events', { status: 'cancelled' });
    const out: string[] = [];
    for (const e of events) {
      const orders = await tx.find('orders', { eventId: e.id });
      for (const o of orders) if (isPaidStatus(o.status) && o.status !== 'refunded' && o.totalOre - o.refundedOre > 0) out.push(o.id);
    }
    return out;
  });
  let n = 0;
  for (const id of ids) if (await refundOrderFull(deps, id, 'Arrangementet er avlyst', null)) n++;
  return n;
}
