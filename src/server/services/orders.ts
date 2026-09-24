import { AppError } from '../../shared/errors';
import { humanRef, newId, newToken } from '../../shared/ids';
import { enqueuePaymentJob } from './paymentJobs';
import { LIMITS } from '../../shared/constants';
import { ageOn } from '../../shared/time';
import { computeTotals, discountedPrice, feeForPrice, resalePayout } from '../../shared/pricing';
import type {
  DiscountCode,
  EventDoc,
  Hold,
  Order,
  OrderDTO,
  OrderItem,
  Payment,
  PaymentMethodId,
  SeatRef,
  Ticket,
  TicketKind,
  TicketType,
  User,
} from '../../shared/types';
import type { OrderCreateInput } from '../../shared/schemas';
import type { Deps } from '../context';
import { appLink } from '../context';
import type { Tx } from '../store/types';
import type { PaymentAdapter, ProviderPaymentStatus } from '../adapters/types';
import { audit, getSettings, notify, nowIso } from './common';
import { toEventCard, ticketTypeState } from './dto';
import { activeHeld, availableOf, indexSeats, loadSeatState, loadTicketTypes, seatIsFree } from './inventory';
import { unlockedTypeIds } from './events';
import { verifyQueueToken } from './queue';
import { formatEventWhen } from '../../shared/time';
import { formatNok } from '../../shared/money';

const OPEN_STATUSES: Order['status'][] = ['reserved', 'pending_payment'];
const PAID_STATUSES: Order['status'][] = ['paid', 'partially_refunded', 'refunded'];

export function isPaidStatus(status: Order['status']): boolean {
  return PAID_STATUSES.includes(status);
}

// ── Eligibility ──────────────────────────────────────────────────────────────

export function checkAge(event: EventDoc, user: Pick<User, 'birthdate' | 'birthdateVerified'>): void {
  if (!event.ageLimit || event.ageLimit <= 0) return;
  if (event.settings.requireVerifiedAge && !user.birthdateVerified) throw new AppError('age_verification_required');
  if (!user.birthdate) throw new AppError('age_required');
  if (ageOn(user.birthdate, event.startsAt) < event.ageLimit) throw new AppError('age_too_young');
}

function assertEventOpen(event: EventDoc, nowS: string): void {
  if (event.status === 'cancelled') throw new AppError('event_cancelled');
  if (event.status !== 'published') throw new AppError('event_not_on_sale');
  if (event.endsAt <= nowS) throw new AppError('event_ended');
}

async function uniqueOrderRef(tx: Tx): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const ref = humanRef('TK', 6);
    if (!(await tx.findOne('orders', { ref }))) return ref;
  }
  return humanRef('TK', 8);
}

// ── Discounts ────────────────────────────────────────────────────────────────

export async function resolveDiscount(tx: Tx, eventId: string, code: string, nowS: string): Promise<DiscountCode> {
  const normalized = code.trim().toUpperCase();
  const dc = await tx.findOne('discountCodes', { eventId, code: normalized }, { forUpdate: true });
  if (!dc || !dc.active) throw new AppError('invalid_discount_code');
  if (dc.validFrom && dc.validFrom > nowS) throw new AppError('invalid_discount_code');
  if (dc.validUntil && dc.validUntil <= nowS) throw new AppError('discount_expired');
  if (dc.maxUses !== null && dc.used >= dc.maxUses) throw new AppError('discount_used_up');
  return dc;
}

function discountApplies(dc: DiscountCode | null, ticketTypeId: string): boolean {
  if (!dc) return false;
  return dc.ticketTypeIds.length === 0 || dc.ticketTypeIds.includes(ticketTypeId);
}

// ── Create order (reservation) ───────────────────────────────────────────────

interface RequestedLine {
  tt: TicketType;
  qty: number;
  seatIds: string[];
}

export async function createOrder(deps: Deps, user: User, input: OrderCreateInput): Promise<Order> {
  if (input.resaleListingId) return createResaleOrder(deps, user, input);
  const now = deps.clock();
  const nowS = now.toISOString();
  const idemKey = input.idempotencyKey ? `${user.id}:${input.idempotencyKey}` : null;

  return deps.store.tx(async (tx) => {
    if (idemKey) {
      const existing = await tx.findOne('orders', { idemKey });
      if (existing) return existing;
    }
    const event = await tx.get('events', input.eventId);
    if (!event) throw new AppError('not_found');
    assertEventOpen(event, nowS);
    const org = await tx.get('organizers', event.organizerId);
    if (!org || org.status !== 'approved') throw new AppError('event_not_on_sale');
    checkAge(event, user);

    if (event.settings.queueEnabled && !(await verifyQueueToken(deps, input.queueToken, event.id, user.id))) {
      throw new AppError(input.queueToken ? 'queue_token_invalid' : 'queue_required');
    }

    // Lock ticket types in a stable order (prevents deadlocks between concurrent buyers).
    const types = (await loadTicketTypes(tx, event.id, true)).sort((a, b) => a.id.localeCompare(b.id));
    const unlocked = await unlockedTypeIds(deps, event.id, input.unlockToken);
    const seatMap = event.seated ? await tx.get('seatMaps', event.id) : null;
    const seatIndex = seatMap ? indexSeats(seatMap) : new Map();
    const seatedTypeIds = new Set(seatMap?.sections.map((s) => s.ticketTypeId) ?? []);

    const lines = new Map<string, RequestedLine>();
    const addLine = (tt: TicketType, qty: number, seatId: string | null) => {
      const line = lines.get(tt.id) ?? { tt, qty: 0, seatIds: [] };
      line.qty += qty;
      if (seatId) line.seatIds.push(seatId);
      lines.set(tt.id, line);
    };

    const seatIds = [...new Set(input.seatIds)];
    for (const seatId of seatIds) {
      const info = seatIndex.get(seatId);
      if (!info) throw new AppError('seat_unavailable', { details: { seatIds: [seatId] } });
      const tt = types.find((t) => t.id === info.ticketTypeId);
      if (!tt) throw new AppError('invalid_ticket_type');
      addLine(tt, 1, seatId);
    }
    for (const item of input.items) {
      const tt = types.find((t) => t.id === item.ticketTypeId);
      if (!tt) throw new AppError('invalid_ticket_type');
      if (seatedTypeIds.has(tt.id)) throw new AppError('seats_required');
      addLine(tt, item.qty, null);
    }
    if (lines.size === 0) throw new AppError('bad_request', { message: 'Velg minst én billett.' });

    const held = await activeHeld(tx, event.id, nowS);
    let totalQty = 0;
    for (const line of lines.values()) {
      const { tt, qty } = line;
      if (tt.hidden && !unlocked.has(tt.id)) throw new AppError('ticket_type_locked');
      const available = availableOf(tt, held);
      const state = ticketTypeState(tt, event, available, now);
      if (state === 'not_started' || state === 'ended' || state === 'paused') throw new AppError('event_not_on_sale');
      const perTypeMax = Math.min(tt.maxPerOrder ?? LIMITS.maxTicketsPerOrder, event.settings.maxPerOrder);
      if (qty > perTypeMax) throw new AppError('too_many_tickets');
      if (available < qty) {
        if (available <= 0) throw new AppError('sold_out');
        throw new AppError('not_enough_tickets', { details: { ticketTypeId: tt.id, available } });
      }
      totalQty += qty;
    }
    const maxPerPerson = Math.min(event.settings.maxPerOrder, LIMITS.maxTicketsPerOrder);
    if (totalQty > maxPerPerson) throw new AppError('too_many_tickets');
    // The limits are per person, not per order: several orders (one queue admission, a free event) must not
    // add up to more. Tickets bought earlier count even if they were passed on since.
    const bought = (await tx.find('tickets', { eventId: event.id, purchaserId: user.id })).filter((t) => t.status === 'valid' || t.status === 'used');
    const openOrders = (await tx.find('orders', { eventId: event.id, userId: user.id })).filter(
      (o) => o.kind === 'standard' && OPEN_STATUSES.includes(o.status) && o.expiresAt > nowS,
    );
    const already = (typeId?: string) =>
      bought.filter((t) => !typeId || t.ticketTypeId === typeId).length +
      openOrders.reduce((s, o) => s + o.items.filter((i) => !typeId || i.ticketTypeId === typeId).reduce((a, i) => a + i.qty, 0), 0);
    if (already() + totalQty > maxPerPerson) {
      const left = Math.max(0, maxPerPerson - already());
      throw new AppError('too_many_tickets', {
        message: left > 0 ? `Du kan kjøpe maks ${maxPerPerson} billetter til dette arrangementet – ${left} til.` : `Du har allerede ${maxPerPerson} billetter (det meste man kan kjøpe) til dette arrangementet.`,
      });
    }
    for (const line of lines.values()) {
      const perTypeMax = Math.min(line.tt.maxPerOrder ?? LIMITS.maxTicketsPerOrder, event.settings.maxPerOrder);
      if (already(line.tt.id) + line.qty > perTypeMax) {
        throw new AppError('too_many_tickets', { message: `Du kan kjøpe maks ${perTypeMax} av «${line.tt.name}».` });
      }
    }

    let seatState = null as Awaited<ReturnType<typeof loadSeatState>> | null;
    if (seatIds.length > 0) {
      seatState = await loadSeatState(tx, event.id, nowS, true);
      const taken = seatIds.filter((id) => !seatIsFree(seatState!.seats[id], nowS));
      if (taken.length > 0) throw new AppError('seat_unavailable', { details: { seatIds: taken } });
    }

    let discount: DiscountCode | null = null;
    if (input.discountCode) {
      discount = await resolveDiscount(tx, event.id, input.discountCode, nowS);
      if (![...lines.values()].some((l) => discountApplies(discount, l.tt.id))) throw new AppError('invalid_discount_code');
    }

    const settings = await getSettings(tx, deps);
    const items: OrderItem[] = [...lines.values()]
      .sort((a, b) => a.tt.sortOrder - b.tt.sortOrder)
      .map((l) => {
        const unit = discountApplies(discount, l.tt.id) ? discountedPrice(l.tt.priceOre, discount) : l.tt.priceOre;
        return {
          ticketTypeId: l.tt.id,
          name: l.tt.name,
          qty: l.qty,
          listPriceOre: l.tt.priceOre,
          unitPriceOre: unit,
          feeOre: feeForPrice(unit, settings),
          vatRate: l.tt.vatRate,
          seatIds: l.seatIds,
        };
      });
    const totals = computeTotals(
      items.map((i) => ({ qty: i.qty, listPriceOre: i.listPriceOre, unitPriceOre: i.unitPriceOre, feeOre: i.feeOre, vatRate: i.vatRate })),
      settings.feeVatRate,
    );
    const expiresAt = new Date(now.getTime() + LIMITS.holdMinutes * 60000).toISOString();
    const order: Order = {
      id: newId(),
      ref: await uniqueOrderRef(tx),
      userId: user.id,
      eventId: event.id,
      organizerId: event.organizerId,
      kind: 'standard',
      status: 'reserved',
      items,
      attendeeNames: [],
      discount: discount ? { codeId: discount.id, code: discount.code, amountOre: totals.discountOre } : null,
      subtotalOre: totals.subtotalOre,
      discountOre: totals.discountOre,
      feeOre: totals.feeOre,
      totalOre: totals.totalOre,
      refundedOre: 0,
      refunds: [],
      resaleListingId: null,
      paymentId: null,
      paymentMethod: null,
      idemKey,
      buyer: { name: user.name, email: user.email, phone: user.phone },
      expiresAt,
      createdAt: nowS,
      updatedAt: nowS,
      paidAt: null,
      cancelledAt: null,
      failureReason: null,
    };
    await tx.insert('orders', order);
    for (const item of items) {
      const hold: Hold = { id: newId(), orderId: order.id, eventId: event.id, ticketTypeId: item.ticketTypeId, qty: item.qty, seatIds: item.seatIds, expiresAt, createdAt: nowS };
      await tx.insert('holds', hold);
    }
    if (seatState && seatIds.length > 0) {
      const seats = { ...seatState.seats };
      for (const id of seatIds) seats[id] = { status: 'held', orderId: order.id, until: expiresAt, ticketId: null };
      await tx.put('seatStates', { ...seatState, seats, updatedAt: nowS });
    }
    if (discount) await tx.update('discountCodes', discount.id, { used: discount.used + 1 });
    return order;
  });
}

async function createResaleOrder(deps: Deps, user: User, input: OrderCreateInput): Promise<Order> {
  const now = deps.clock();
  const nowS = now.toISOString();
  return deps.store.tx(async (tx) => {
    const listing = await tx.get('resaleListings', input.resaleListingId!, { forUpdate: true });
    if (!listing || listing.eventId !== input.eventId) throw new AppError('resale_unavailable');
    const reservedExpired = listing.status === 'reserved' && !!listing.reservedUntil && listing.reservedUntil <= nowS;
    if (listing.status !== 'active' && !reservedExpired) throw new AppError('resale_unavailable');
    if (listing.sellerId === user.id) throw new AppError('own_resale');
    const event = await tx.get('events', listing.eventId);
    if (!event) throw new AppError('not_found');
    assertEventOpen(event, nowS);
    if (event.startsAt <= nowS) throw new AppError('resale_unavailable');
    checkAge(event, user);
    const ticket = await tx.get('tickets', listing.ticketId);
    if (!ticket || ticket.status !== 'valid' || ticket.resaleListingId !== listing.id) throw new AppError('resale_unavailable');
    // Release a stale reservation from someone else.
    if (reservedExpired && listing.reservedByOrderId) {
      const stale = await tx.get('orders', listing.reservedByOrderId, { forUpdate: true });
      if (stale && OPEN_STATUSES.includes(stale.status)) await tx.update('orders', stale.id, { status: 'expired', updatedAt: nowS });
    }
    const settings = await getSettings(tx, deps);
    const fee = feeForPrice(listing.priceOre, settings);
    const expiresAt = new Date(now.getTime() + LIMITS.holdMinutes * 60000).toISOString();
    const tt = await tx.get('ticketTypes', listing.ticketTypeId);
    const order: Order = {
      id: newId(),
      ref: await uniqueOrderRef(tx),
      userId: user.id,
      eventId: event.id,
      organizerId: event.organizerId,
      kind: 'resale',
      status: 'reserved',
      items: [
        {
          ticketTypeId: listing.ticketTypeId,
          name: `${tt?.name ?? ticket.typeName} (videresalg)`,
          qty: 1,
          listPriceOre: listing.priceOre,
          unitPriceOre: listing.priceOre,
          feeOre: fee,
          vatRate: tt?.vatRate ?? 0,
          seatIds: ticket.seat ? [ticket.seat.id] : [],
        },
      ],
      attendeeNames: [],
      discount: null,
      subtotalOre: listing.priceOre,
      discountOre: 0,
      feeOre: fee,
      totalOre: listing.priceOre + fee,
      refundedOre: 0,
      refunds: [],
      resaleListingId: listing.id,
      paymentId: null,
      paymentMethod: null,
      idemKey: input.idempotencyKey ? `${user.id}:${input.idempotencyKey}` : null,
      buyer: { name: user.name, email: user.email, phone: user.phone },
      expiresAt,
      createdAt: nowS,
      updatedAt: nowS,
      paidAt: null,
      cancelledAt: null,
      failureReason: null,
    };
    await tx.insert('orders', order);
    await tx.update('resaleListings', listing.id, { status: 'reserved', reservedByOrderId: order.id, reservedUntil: expiresAt });
    return order;
  });
}

// ── Updating a reservation ───────────────────────────────────────────────────

export async function updateOrder(
  deps: Deps,
  user: User,
  orderId: string,
  input: { attendeeNames?: string[] | undefined; discountCode?: string | null | undefined },
): Promise<Order> {
  const nowS = nowIso(deps);
  return deps.store.tx(async (tx) => {
    const order = await tx.get('orders', orderId, { forUpdate: true });
    if (!order || order.userId !== user.id) throw new AppError('not_found');
    if (order.status !== 'reserved') throw new AppError('order_not_payable');
    if (order.expiresAt <= nowS) throw new AppError('order_expired');
    const patch: Partial<Order> = { updatedAt: nowS };
    const totalQty = order.items.reduce((s, i) => s + i.qty, 0);
    if (input.attendeeNames) patch.attendeeNames = input.attendeeNames.slice(0, totalQty).map((n) => n.trim());
    if (input.discountCode !== undefined && order.kind === 'standard') {
      const currentCode = order.discount?.code ?? null;
      const nextCode = input.discountCode ? input.discountCode.trim().toUpperCase() : null;
      if (currentCode !== nextCode) {
        let dc: DiscountCode | null = null;
        if (nextCode) {
          dc = await resolveDiscount(tx, order.eventId, nextCode, nowS);
          if (!order.items.some((i) => discountApplies(dc, i.ticketTypeId))) throw new AppError('invalid_discount_code');
        }
        if (order.discount) {
          const prev = await tx.get('discountCodes', order.discount.codeId, { forUpdate: true });
          if (prev) await tx.update('discountCodes', prev.id, { used: Math.max(0, prev.used - 1) });
        }
        if (dc) await tx.update('discountCodes', dc.id, { used: dc.used + 1 });
        const settings = await getSettings(tx, deps);
        const items = order.items.map((i) => {
          const unit = discountApplies(dc, i.ticketTypeId) ? discountedPrice(i.listPriceOre, dc) : i.listPriceOre;
          return { ...i, unitPriceOre: unit, feeOre: feeForPrice(unit, settings) };
        });
        const totals = computeTotals(items, settings.feeVatRate);
        Object.assign(patch, {
          items,
          discount: dc ? { codeId: dc.id, code: dc.code, amountOre: totals.discountOre } : null,
          subtotalOre: totals.subtotalOre,
          discountOre: totals.discountOre,
          feeOre: totals.feeOre,
          totalOre: totals.totalOre,
        });
      }
    }
    return tx.update('orders', orderId, patch);
  });
}

// ── Releasing reservations ───────────────────────────────────────────────────

/** Frees holds, seats, discount usage and resale reservation of an unpaid order. */
export async function releaseOrderTx(tx: Tx, deps: Deps, order: Order, status: 'expired' | 'cancelled', reason: string | null = null): Promise<Order> {
  const nowS = nowIso(deps);
  await tx.deleteWhere('holds', { orderId: order.id });
  const seatIds = order.items.flatMap((i) => i.seatIds);
  if (seatIds.length > 0 && order.kind === 'standard') {
    const state = await loadSeatState(tx, order.eventId, nowS, true);
    const seats = { ...state.seats };
    let changed = false;
    for (const id of seatIds) {
      const entry = seats[id];
      if (entry?.status === 'held' && entry.orderId === order.id) {
        delete seats[id];
        changed = true;
      }
    }
    if (changed) await tx.put('seatStates', { ...state, seats, updatedAt: nowS });
  }
  if (order.discount) {
    const dc = await tx.get('discountCodes', order.discount.codeId, { forUpdate: true });
    if (dc) await tx.update('discountCodes', dc.id, { used: Math.max(0, dc.used - 1) });
  }
  if (order.resaleListingId) {
    const listing = await tx.get('resaleListings', order.resaleListingId, { forUpdate: true });
    if (listing && listing.status === 'reserved' && listing.reservedByOrderId === order.id) {
      await tx.update('resaleListings', listing.id, { status: 'active', reservedByOrderId: null, reservedUntil: null });
    }
  }
  return tx.update('orders', order.id, {
    status,
    cancelledAt: status === 'cancelled' ? nowS : order.cancelledAt,
    failureReason: reason ?? order.failureReason,
    discount: order.discount,
    updatedAt: nowS,
  });
}

export async function cancelOrder(deps: Deps, user: User, orderId: string): Promise<Order> {
  return deps.store.tx(async (tx) => {
    const o = await tx.get('orders', orderId, { forUpdate: true });
    if (!o || o.userId !== user.id) throw new AppError('not_found');
    if (!OPEN_STATUSES.includes(o.status)) return o;
    if (o.paymentId) {
      const payment = await tx.get('payments', o.paymentId, { forUpdate: true });
      if (payment && (payment.status === 'pending' || payment.status === 'creating')) {
        await tx.update('payments', payment.id, { status: 'cancelled', updatedAt: nowIso(deps) });
        // Closed at the provider (retried until it is), so the buyer can't still approve it in Vipps.
        if (payment.status === 'pending') {
          await enqueuePaymentJob(tx, deps, { payment, kind: 'reverse', amountOre: 0, idempotencyKey: `reverse-${payment.id}`, reason: `Avbrutt av kjøper: ${o.ref}` });
        }
      }
    }
    return releaseOrderTx(tx, deps, o, 'cancelled');
  });
}

/** Sweeps unpaid reservations whose hold has expired. */
export async function expireStaleOrders(deps: Deps): Promise<number> {
  const nowS = nowIso(deps);
  const stale = await deps.store.read(async (tx) => {
    const open = await tx.find('orders', { status: { in: ['reserved', 'pending_payment'] } });
    return open.filter((o) => o.expiresAt <= nowS).map((o) => o.id);
  });
  let count = 0;
  for (const id of stale) {
    const expired = await deps.store.tx(async (tx) => {
      const o = await tx.get('orders', id, { forUpdate: true });
      if (!o || !OPEN_STATUSES.includes(o.status) || o.expiresAt > nowS) return false;
      await releaseOrderTx(tx, deps, o, 'expired');
      return true;
    });
    if (expired) count++;
  }
  return count;
}

// ── Payment ──────────────────────────────────────────────────────────────────

function paymentAdapter(deps: Deps, method: PaymentMethodId): PaymentAdapter {
  const adapter = deps.payments[method];
  if (!adapter) throw new AppError('payment_method_unavailable');
  return adapter;
}

export async function payOrder(
  deps: Deps,
  user: User,
  orderId: string,
  input: { method: 'vipps' | 'card' | 'free'; phone?: string | null | undefined },
): Promise<{ order: Order; redirectUrl: string | null }> {
  const now = deps.clock();
  const nowS = now.toISOString();

  // Free orders are fulfilled immediately.
  const prepared = await deps.store.tx(async (tx) => {
    const order = await tx.get('orders', orderId, { forUpdate: true });
    if (!order || order.userId !== user.id) throw new AppError('not_found');
    if (isPaidStatus(order.status)) throw new AppError('order_already_paid');
    if (!OPEN_STATUSES.includes(order.status)) throw new AppError(order.status === 'expired' ? 'order_expired' : 'order_not_payable');
    if (order.expiresAt <= nowS) {
      await releaseOrderTx(tx, deps, order, 'expired');
      return { expired: true as const };
    }
    const event = await tx.get('events', order.eventId);
    if (!event) throw new AppError('not_found');
    if (event.settings.personalizedTickets && order.kind === 'standard') {
      const totalQty = order.items.reduce((s, i) => s + i.qty, 0);
      const names = order.attendeeNames.filter((n) => n.trim().length >= 2);
      if (names.length < totalQty) throw new AppError('attendee_names_required');
    }
    if (order.totalOre === 0) {
      if (input.method !== 'free') throw new AppError('bad_request', { message: 'Denne bestillingen er gratis.' });
      const result = await fulfillOrderTx(tx, deps, order, null);
      if (!result.ok) throw new AppError('sold_out');
      return { free: true as const, order: result.order };
    }
    if (input.method === 'free') throw new AppError('bad_request', { message: 'Velg en betalingsmåte.' });
    const adapter = paymentAdapter(deps, input.method);
    // Paying again can't keep tickets reserved forever: there is a fixed ceiling from when the order was made.
    const holdCeiling = new Date(Date.parse(order.createdAt) + (LIMITS.holdMinutes + LIMITS.paymentHoldMinutes) * 60000).toISOString();
    if (holdCeiling <= nowS) {
      await releaseOrderTx(tx, deps, order, 'expired');
      return { expired: true as const };
    }
    // A previous payment attempt is superseded – and closed at the provider, so it can't be completed later.
    if (order.paymentId) {
      const prev = await tx.get('payments', order.paymentId, { forUpdate: true });
      if (prev && (prev.status === 'pending' || prev.status === 'creating')) {
        await tx.update('payments', prev.id, { status: 'cancelled', updatedAt: nowS });
        if (prev.status === 'pending') {
          await enqueuePaymentJob(tx, deps, { payment: prev, kind: 'reverse', amountOre: 0, idempotencyKey: `reverse-${prev.id}`, reason: `Ny betaling for ${order.ref}` });
        }
      }
    }
    const paymentId = newId();
    const payment: Payment = {
      id: paymentId,
      orderId: order.id,
      provider: adapter.provider,
      method: input.method,
      providerRef: `tikit-${paymentId}`,
      amountOre: order.totalOre,
      status: 'creating',
      capturedOre: 0,
      refundedOre: 0,
      redirectUrl: null,
      createdAt: nowS,
      updatedAt: nowS,
      lastError: null,
    };
    await tx.insert('payments', payment);
    const extended = new Date(now.getTime() + LIMITS.paymentHoldMinutes * 60000).toISOString();
    const holdUntil = extended < holdCeiling ? extended : holdCeiling;
    await extendHoldsTx(tx, deps, order, holdUntil);
    const updated = await tx.update('orders', order.id, {
      status: 'pending_payment',
      paymentId,
      paymentMethod: input.method,
      expiresAt: holdUntil,
      updatedAt: nowS,
      buyer: { ...order.buyer, phone: input.phone ?? order.buyer.phone },
    });
    return { payment, order: updated, event, adapter };
  });

  if ('expired' in prepared) throw new AppError('order_expired');
  if ('free' in prepared) return { order: prepared.order, redirectUrl: null };

  const { payment, order, event, adapter } = prepared;
  const returnUrl = appLink(deps.config, `/ordre/${order.id}?retur=1`);
  try {
    const created = await adapter.createPayment({
      paymentId: payment.id,
      reference: payment.providerRef,
      amountOre: order.totalOre,
      description: `${event.title} – ${order.ref}`.slice(0, 95),
      returnUrl,
      cancelUrl: appLink(deps.config, `/kasse/${order.id}?avbrutt=1`),
      customerPhone: input.phone ?? user.phone,
      customerEmail: user.email,
      lines: [
        ...order.items.map((i) => ({ name: i.name, qty: i.qty, unitAmountOre: i.unitPriceOre })),
        ...(order.feeOre > 0 ? [{ name: 'Servicegebyr', qty: 1, unitAmountOre: order.feeOre }] : []),
      ],
    });
    await deps.store.tx(async (tx) => {
      await tx.update('payments', payment.id, { providerRef: created.providerRef, redirectUrl: created.redirectUrl, status: 'pending', updatedAt: nowIso(deps) });
    });
    return { order, redirectUrl: created.redirectUrl };
  } catch (err) {
    deps.log.error('Opprettelse av betaling feilet', { orderId: order.id, provider: adapter.provider, error: String(err) });
    await deps.store.tx(async (tx) => {
      await tx.update('payments', payment.id, { status: 'failed', lastError: String(err).slice(0, 300), updatedAt: nowIso(deps) });
      const o = await tx.get('orders', order.id, { forUpdate: true });
      if (o && o.status === 'pending_payment' && o.paymentId === payment.id) {
        await tx.update('orders', o.id, { status: 'reserved', updatedAt: nowIso(deps) });
      }
    });
    throw new AppError('payment_provider_error');
  }
}

async function extendHoldsTx(tx: Tx, deps: Deps, order: Order, until: string): Promise<void> {
  const holds = await tx.find('holds', { orderId: order.id });
  for (const h of holds) await tx.update('holds', h.id, { expiresAt: until });
  const seatIds = order.items.flatMap((i) => i.seatIds);
  if (seatIds.length > 0 && order.kind === 'standard') {
    const state = await loadSeatState(tx, order.eventId, nowIso(deps), true);
    const seats = { ...state.seats };
    for (const id of seatIds) {
      const e = seats[id];
      if (e?.status === 'held' && e.orderId === order.id) seats[id] = { ...e, until };
    }
    await tx.put('seatStates', { ...state, seats, updatedAt: nowIso(deps) });
  }
  if (order.resaleListingId) {
    const listing = await tx.get('resaleListings', order.resaleListingId, { forUpdate: true });
    if (listing && listing.reservedByOrderId === order.id) await tx.update('resaleListings', listing.id, { reservedUntil: until });
  }
}

// ── Fulfilment ───────────────────────────────────────────────────────────────

export function ticketNumber(ref: string, index: number): string {
  return `${ref}-${String(index + 1).padStart(2, '0')}`;
}

/**
 * A fresh ticket number for a ticket that changed owner (transfer). The old owner's number – printed on
 * their receipt and screenshots – must stop working. 7 characters never collide with order refs (6).
 */
export async function freshTicketNumber(tx: Tx): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const number = ticketNumber(humanRef('TK', 7), 0);
    if (!(await tx.findOne('tickets', { number }))) return number;
  }
  return ticketNumber(humanRef('TK', 8), 0);
}

export async function createTickets(
  tx: Tx,
  deps: Deps,
  order: Order,
  opts: { ownerId: string; purchaserId: string; kind: TicketKind; holderFallback: string; seatRefs: Map<string, SeatRef> },
): Promise<Ticket[]> {
  const nowS = nowIso(deps);
  const out: Ticket[] = [];
  let index = 0;
  for (const item of order.items) {
    for (let n = 0; n < item.qty; n++) {
      const seatId = item.seatIds[n] ?? null;
      const ticket: Ticket = {
        id: newId(),
        number: ticketNumber(order.ref, index),
        orderId: order.id,
        originalOrderId: order.id,
        eventId: order.eventId,
        organizerId: order.organizerId,
        ticketTypeId: item.ticketTypeId,
        typeName: item.name,
        pricePaidOre: item.unitPriceOre,
        purchaserId: opts.purchaserId,
        ownerId: opts.ownerId,
        holderName: (order.attendeeNames[index] ?? '').trim() || opts.holderFallback,
        seat: seatId ? (opts.seatRefs.get(seatId) ?? null) : null,
        kind: opts.kind,
        status: 'valid',
        secret: newToken(16),
        checkedInAt: null,
        checkedInBy: null,
        transferId: null,
        resaleListingId: null,
        createdAt: nowS,
        updatedAt: nowS,
      };
      await tx.insert('tickets', ticket);
      out.push(ticket);
      index++;
    }
  }
  return out;
}

type FulfillResult = { ok: true; order: Order; tickets: Ticket[] } | { ok: false; reason: string };

/**
 * Converts a reservation into tickets. Honours the order's own holds; if they expired it re-checks
 * capacity (a late payment can still succeed when tickets remain). Must run inside a transaction.
 */
export async function fulfillOrderTx(tx: Tx, deps: Deps, order: Order, payment: Payment | null): Promise<FulfillResult> {
  const now = deps.clock();
  const nowS = now.toISOString();
  if (isPaidStatus(order.status)) return { ok: true, order, tickets: await tx.find('tickets', { orderId: order.id }) };
  // Locked: a payment completing while the organizer cancels the event waits for (or blocks) the cancellation,
  // so an order can never end up paid with valid tickets for a cancelled event.
  const event = await tx.get('events', order.eventId, { forUpdate: true });
  if (!event || event.status === 'cancelled') return { ok: false, reason: 'event_cancelled' };
  const buyer = await tx.get('users', order.userId);
  if (!buyer) return { ok: false, reason: 'buyer_missing' };

  if (order.kind === 'resale') return fulfillResaleTx(tx, deps, order, payment, event, buyer);

  const types = (await loadTicketTypes(tx, order.eventId, true)).sort((a, b) => a.id.localeCompare(b.id));
  const ownHolds = await tx.find('holds', { orderId: order.id });
  const ownActive = new Map<string, number>();
  for (const h of ownHolds) if (h.expiresAt > nowS) ownActive.set(h.ticketTypeId, (ownActive.get(h.ticketTypeId) ?? 0) + h.qty);
  const othersHeld = await activeHeld(tx, order.eventId, nowS, order.id);
  for (const item of order.items) {
    const tt = types.find((t) => t.id === item.ticketTypeId);
    if (!tt) return { ok: false, reason: 'ticket_type_missing' };
    const covered = Math.min(item.qty, ownActive.get(tt.id) ?? 0);
    const needed = item.qty - covered;
    // Capacity check: what others hold is untouchable; our own active holds are already counted as ours.
    const free = tt.capacity - tt.sold - (othersHeld.get(tt.id) ?? 0) - covered;
    if (needed > 0 && free < needed) return { ok: false, reason: 'sold_out_after_payment' };
    if (tt.capacity - tt.sold < item.qty) return { ok: false, reason: 'sold_out_after_payment' };
  }

  const seatIds = order.items.flatMap((i) => i.seatIds);
  let seatRefs = new Map<string, SeatRef>();
  if (seatIds.length > 0) {
    const map = await tx.get('seatMaps', order.eventId);
    if (!map) return { ok: false, reason: 'seatmap_missing' };
    const index = indexSeats(map);
    seatRefs = new Map([...index.entries()].map(([id, info]) => [id, info.ref]));
    const state = await loadSeatState(tx, order.eventId, nowS, true);
    for (const id of seatIds) {
      if (!seatIsFree(state.seats[id], nowS, order.id)) return { ok: false, reason: 'seat_taken_after_payment' };
    }
  }

  for (const item of order.items) {
    const tt = types.find((t) => t.id === item.ticketTypeId)!;
    await tx.update('ticketTypes', tt.id, { sold: tt.sold + item.qty, updatedAt: nowS });
  }
  await tx.deleteWhere('holds', { orderId: order.id });
  // A late payment on an expired reservation: its discount use was released on expiry – count it again.
  if (order.status === 'expired' && order.discount) {
    const dc = await tx.get('discountCodes', order.discount.codeId, { forUpdate: true });
    if (dc) await tx.update('discountCodes', dc.id, { used: dc.used + 1 });
  }

  const kind: TicketKind = order.kind === 'comp' ? 'comp' : order.totalOre === 0 ? 'free' : 'paid';
  const tickets = await createTickets(tx, deps, order, { ownerId: order.userId, purchaserId: order.userId, kind, holderFallback: buyer.name, seatRefs });

  if (seatIds.length > 0) {
    const state = await loadSeatState(tx, order.eventId, nowS, true);
    const seats = { ...state.seats };
    for (const t of tickets) if (t.seat) seats[t.seat.id] = { status: 'sold', orderId: order.id, until: null, ticketId: t.id };
    await tx.put('seatStates', { ...state, seats, updatedAt: nowS });
  }

  const updated = await tx.update('orders', order.id, {
    status: 'paid',
    paidAt: nowS,
    paymentMethod: order.totalOre === 0 && order.kind !== 'comp' ? 'free' : order.paymentMethod,
    updatedAt: nowS,
  });
  if (payment) await tx.update('payments', payment.id, { status: payment.status === 'captured' ? 'captured' : 'authorized', updatedAt: nowS });

  if (order.kind !== 'comp') {
    const org = await tx.get('organizers', order.organizerId);
    await notify(tx, deps, order.userId, {
      kind: 'order_confirmed',
      title: `Billetter til ${event.title}`,
      body: `${tickets.length} ${tickets.length === 1 ? 'billett' : 'billetter'} ligger klare i appen.`,
      link: '/billetter',
      email: {
        subject: `Kvittering ${order.ref} – ${event.title}`,
        heading: 'Takk for kjøpet!',
        paragraphs: [
          `Du har kjøpt ${tickets.length} ${tickets.length === 1 ? 'billett' : 'billetter'} til ${event.title}, ${formatEventWhen(event.startsAt)}, ${event.venue.name}.`,
          `Totalt betalt: ${formatNok(order.totalOre)}. Ordrenummer: ${order.ref}.`,
          'Billettene finner du under Billetter i TIKIT. Vis QR-koden i appen ved inngangen – skjermbilder fungerer ikke.',
          ...(org ? [`Selger: ${org.name}${org.orgNumber ? `, org.nr. ${org.orgNumber}` : ''}. Spørsmål om arrangementet? Kontakt arrangøren på ${org.email}.`] : []),
        ],
        cta: { label: 'Vis billettene', url: appLink(deps.config, '/billetter') },
      },
      transactional: true,
    });
  }
  await audit(tx, deps, order.userId, 'order.paid', 'orders', order.id, { totalOre: order.totalOre, tickets: tickets.length });
  return { ok: true, order: updated, tickets };
}

async function fulfillResaleTx(tx: Tx, deps: Deps, order: Order, payment: Payment | null, event: EventDoc, buyer: User): Promise<FulfillResult> {
  const nowS = nowIso(deps);
  const listing = order.resaleListingId ? await tx.get('resaleListings', order.resaleListingId, { forUpdate: true }) : null;
  if (!listing) return { ok: false, reason: 'resale_unavailable' };
  const ownsReservation = listing.status === 'reserved' && listing.reservedByOrderId === order.id;
  const stillActive = listing.status === 'active';
  if (!ownsReservation && !stillActive) return { ok: false, reason: 'resale_unavailable' };
  const ticket = await tx.get('tickets', listing.ticketId, { forUpdate: true });
  if (!ticket || ticket.status !== 'valid' || ticket.resaleListingId !== listing.id) return { ok: false, reason: 'resale_unavailable' };

  const sellerOrder = await tx.get('orders', ticket.orderId, { forUpdate: true });
  const settings = await getSettings(tx, deps);
  const payout = Math.min(resalePayout(listing.priceOre, settings.resaleFeePercentBp), ticket.pricePaidOre);

  const newTicket: Ticket = {
    ...ticket,
    // New owner, new number: the seller's old number (receipt, screenshots) must stop working at the door.
    number: ticketNumber(order.ref, 0),
    orderId: order.id,
    ownerId: buyer.id,
    purchaserId: buyer.id,
    holderName: buyer.name,
    pricePaidOre: listing.priceOre,
    kind: 'resale',
    secret: newToken(16),
    resaleListingId: null,
    transferId: null,
    updatedAt: nowS,
  };
  await tx.put('tickets', newTicket);
  await tx.update('resaleListings', listing.id, { status: 'sold', buyerOrderId: order.id, soldAt: nowS, payoutOre: payout, reservedByOrderId: order.id });
  const updated = await tx.update('orders', order.id, { status: 'paid', paidAt: nowS, updatedAt: nowS });
  if (payment) await tx.update('payments', payment.id, { status: payment.status === 'captured' ? 'captured' : 'authorized', updatedAt: nowS });

  // Pay the seller by refunding their original purchase (never above what they paid).
  if (sellerOrder && payout > 0) {
    const entry = { id: newId(), amountOre: payout, ticketOre: payout, feeOre: 0, kind: 'resale_payout' as const, ticketIds: [ticket.id], reason: 'Billett solgt via videresalg', by: null, at: nowS };
    await tx.update('orders', sellerOrder.id, {
      refundedOre: sellerOrder.refundedOre + payout,
      refunds: [...sellerOrder.refunds, entry],
      status: 'partially_refunded',
      updatedAt: nowS,
    });
    if (sellerOrder.paymentId) {
      const sellerPayment = await tx.get('payments', sellerOrder.paymentId);
      if (sellerPayment) {
        await enqueuePaymentJob(tx, deps, { payment: sellerPayment, kind: 'refund', amountOre: payout, idempotencyKey: `resale-${listing.id}`, reason: `Videresalg av ${ticket.number}` });
      }
    }
  }
  await notify(tx, deps, listing.sellerId, {
    kind: 'resale_sold',
    title: 'Billetten din er solgt',
    body: `${event.title}: ${formatNok(payout)} refunderes til betalingsmåten du brukte.`,
    link: '/billetter',
    email: {
      subject: `Billetten din til ${event.title} er solgt`,
      heading: 'Billetten er solgt',
      paragraphs: [`Billetten din til ${event.title} er solgt via TIKIT videresalg.`, `${formatNok(payout)} refunderes til betalingsmåten du brukte da du kjøpte billetten. Det kan ta noen dager før beløpet vises.`],
    },
    transactional: true,
  });
  await notify(tx, deps, buyer.id, {
    kind: 'resale_bought',
    title: `Billett til ${event.title}`,
    body: 'Billetten fra videresalg ligger klar i appen din.',
    link: '/billetter',
    email: {
      subject: `Kvittering ${order.ref} – ${event.title}`,
      heading: 'Du har kjøpt en billett via videresalg',
      paragraphs: [`Billetten til ${event.title} er overført til deg og har fått ny QR-kode.`, `Totalt betalt: ${formatNok(order.totalOre)}. Ordrenummer: ${order.ref}.`],
      cta: { label: 'Vis billetten', url: appLink(deps.config, '/billetter') },
    },
    transactional: true,
  });
  await audit(tx, deps, buyer.id, 'resale.sold', 'resaleListings', listing.id, { priceOre: listing.priceOre, payout });
  return { ok: true, order: updated, tickets: [newTicket] };
}

// ── Confirming payments (return page, polling, webhooks) ─────────────────────

async function applyProviderStatus(deps: Deps, paymentId: string, status: ProviderPaymentStatus): Promise<Order | null> {
  const nowS = nowIso(deps);
  let captureNeeded = false;
  const result = await deps.store.tx(async (tx) => {
    const payment = await tx.get('payments', paymentId, { forUpdate: true });
    if (!payment) return null;
    const order = await tx.get('orders', payment.orderId, { forUpdate: true });
    if (!order) return null;
    /** Money we must not keep goes back through a retried payment job (cancel if authorized, refund if captured). */
    const giveBack = (reason: string) =>
      enqueuePaymentJob(tx, deps, { payment, kind: 'reverse', amountOre: 0, idempotencyKey: `reverse-${payment.id}`, reason });
    if (order.paymentId !== payment.id) {
      // Superseded attempt that was paid anyway: give the money back.
      if (status.state === 'authorized' || status.state === 'captured') await giveBack(`Erstattet betaling for ${order.ref}`);
      await tx.update('payments', payment.id, { status: 'cancelled', updatedAt: nowS });
      return order;
    }
    if (status.state === 'authorized' || status.state === 'captured') {
      const p: Payment = {
        ...payment,
        status: status.state === 'captured' ? 'captured' : 'authorized',
        capturedOre: status.capturedOre,
      };
      if (isPaidStatus(order.status)) {
        if (p.status === 'authorized' && payment.status === 'authorized') captureNeeded = true;
        return order;
      }
      if (!['reserved', 'pending_payment', 'expired'].includes(order.status)) {
        await giveBack(`Betaling for ${order.ref} (${order.status})`);
        return order;
      }
      await tx.update('payments', payment.id, { status: p.status, capturedOre: status.capturedOre, updatedAt: nowS });
      const fulfilled = await fulfillOrderTx(tx, deps, order, p);
      if (!fulfilled.ok) {
        const reason = fulfilled.reason;
        if (order.status !== 'expired') await releaseOrderTx(tx, deps, order, 'cancelled', reason);
        else await tx.update('orders', order.id, { status: 'cancelled', failureReason: reason, cancelledAt: nowS, updatedAt: nowS });
        await giveBack(`Kunne ikke fullføre ${order.ref}: ${reason}`);
        await notify(tx, deps, order.userId, {
          kind: 'refund_issued',
          title: 'Kjøpet kunne ikke fullføres',
          body: 'Billettene ble utsolgt før betalingen var ferdig. Du blir ikke belastet.',
          link: `/ordre/${order.id}`,
          email: null,
        });
        return tx.get('orders', order.id);
      }
      captureNeeded = p.status === 'authorized' && deps.payments[payment.method]?.needsCapture === true;
      return fulfilled.order;
    }
    if (status.state === 'failed' || status.state === 'cancelled' || status.state === 'expired') {
      await tx.update('payments', payment.id, { status: status.state === 'expired' ? 'expired' : status.state === 'cancelled' ? 'cancelled' : 'failed', updatedAt: nowS });
      if (order.status === 'pending_payment') {
        if (order.expiresAt <= nowS) return releaseOrderTx(tx, deps, order, 'expired');
        return tx.update('orders', order.id, { status: 'reserved', updatedAt: nowS });
      }
      return order;
    }
    return order;
  });

  const payment = await deps.store.read((tx) => tx.get('payments', paymentId));
  if (payment) {
    const adapter = deps.payments[payment.method];
    if (adapter && captureNeeded) {
      try {
        await adapter.capture(payment.providerRef, payment.amountOre, `capture-${payment.id}`);
        await deps.store.tx(async (tx) => {
          await tx.update('payments', payment.id, { status: 'captured', capturedOre: payment.amountOre, updatedAt: nowIso(deps) });
        });
      } catch (err) {
        deps.log.error('Capture feilet – prøves igjen senere', { paymentId, error: String(err) });
        await deps.store.tx(async (tx) => {
          await tx.update('payments', payment.id, { lastError: `capture: ${String(err)}`.slice(0, 300), updatedAt: nowIso(deps) });
        });
      }
    }
  }
  return result;
}

/** Asks the provider for the latest status of the order's payment and applies it. */
export async function syncOrderPayment(deps: Deps, orderId: string): Promise<void> {
  const payment = await deps.store.read(async (tx) => {
    const order = await tx.get('orders', orderId);
    if (!order?.paymentId) return null;
    return tx.get('payments', order.paymentId);
  });
  if (!payment) return;
  if (!['pending', 'creating', 'authorized'].includes(payment.status)) return;
  const adapter = deps.payments[payment.method];
  if (!adapter) return;
  let status: ProviderPaymentStatus;
  try {
    status = await adapter.getStatus(payment.providerRef);
  } catch (err) {
    deps.log.warn('Kunne ikke hente betalingsstatus', { paymentId: payment.id, error: String(err) });
    return;
  }
  if (status.state === 'pending') return;
  await applyProviderStatus(deps, payment.id, status);
}

/** Webhook entry point: providerRef → sync. */
export async function handlePaymentWebhook(deps: Deps, provider: 'vipps' | 'stripe', providerRef: string): Promise<void> {
  const payment = await deps.store.read((tx) => tx.findOne('payments', { provider, providerRef }));
  if (!payment) return;
  const adapter = deps.payments[payment.method];
  if (!adapter) return;
  const status = await adapter.getStatus(payment.providerRef);
  if (status.state === 'pending') return;
  await applyProviderStatus(deps, payment.id, status);
}

/** Retries captures that failed earlier (cron). */
export async function retryPendingCaptures(deps: Deps): Promise<number> {
  const pending = await deps.store.read(async (tx) => {
    const payments = await tx.find('payments', { status: 'authorized' });
    const out: Payment[] = [];
    for (const p of payments) {
      const order = await tx.get('orders', p.orderId);
      if (order && isPaidStatus(order.status) && order.paymentId === p.id) out.push(p);
    }
    return out;
  });
  let n = 0;
  for (const p of pending) {
    const adapter = deps.payments[p.method];
    if (!adapter || !adapter.needsCapture) continue;
    try {
      await adapter.capture(p.providerRef, p.amountOre, `capture-${p.id}`);
      await deps.store.tx(async (tx) => {
        await tx.update('payments', p.id, { status: 'captured', capturedOre: p.amountOre, updatedAt: nowIso(deps) });
      });
      n++;
    } catch (err) {
      deps.log.warn('Capture feilet igjen', { paymentId: p.id, error: String(err) });
    }
  }
  return n;
}

/**
 * Open payments older than a minute are polled (covers missed webhooks). That includes payments stuck in
 * 'creating' – the provider may have created them even though we never stored the answer (a deploy or a
 * timeout in between) – and attempts that were superseded, which are handed back if they got paid anyway.
 */
export async function pollPendingPayments(deps: Deps): Promise<number> {
  const now = deps.clock().getTime();
  const cutoff = new Date(now - 60_000).toISOString();
  const creatingCutoff = new Date(now - 3 * 60_000).toISOString();
  const giveUpAt = new Date(now - 24 * 3600_000).toISOString();
  const open = await deps.store.read(async (tx) =>
    (await tx.find('payments', { status: { in: ['pending', 'creating'] } })).filter(
      (p) => p.createdAt >= giveUpAt && (p.status === 'pending' ? p.createdAt <= cutoff : p.createdAt <= creatingCutoff),
    ),
  );
  let n = 0;
  for (const p of open) {
    const adapter = deps.payments[p.method];
    if (!adapter || adapter.provider !== p.provider) continue;
    let status: ProviderPaymentStatus;
    try {
      status = await adapter.getStatus(p.providerRef);
    } catch (err) {
      if (p.status === 'pending') deps.log.warn('Kunne ikke hente betalingsstatus', { paymentId: p.id, error: String(err) });
      continue; // 'creating' that never reached the provider: nothing there to follow up
    }
    if (status.state === 'pending') continue;
    await applyProviderStatus(deps, p.id, status);
    n++;
  }
  return n;
}

// ── DTO ──────────────────────────────────────────────────────────────────────

export async function getOrderDTO(deps: Deps, user: User | null, orderId: string, asOrganizer = false): Promise<OrderDTO> {
  const now = deps.clock();
  const nowS = now.toISOString();
  // Lazy expiry keeps what the buyer sees accurate even without cron.
  await deps.store.tx(async (tx) => {
    const o = await tx.get('orders', orderId, { forUpdate: true });
    if (o && OPEN_STATUSES.includes(o.status) && o.expiresAt <= nowS && o.status === 'reserved') await releaseOrderTx(tx, deps, o, 'expired');
  });
  return deps.store.read(async (tx) => {
    const order = await tx.get('orders', orderId);
    if (!order) throw new AppError('not_found');
    if (!asOrganizer && (!user || order.userId !== user.id)) throw new AppError('not_found');
    const event = await tx.get('events', order.eventId);
    const org = await tx.get('organizers', order.organizerId);
    if (!event || !org) throw new AppError('not_found');
    const types = await loadTicketTypes(tx, event.id);
    const held = await activeHeld(tx, event.id, nowS);
    const card = toEventCard(
      event,
      org,
      types.map((tt) => ({ tt, available: availableOf(tt, held) })),
      now,
    );
    const payment = order.paymentId ? await tx.get('payments', order.paymentId) : null;
    const tickets = await tx.find('tickets', { orderId: order.id });
    const seatMap = event.seated ? await tx.get('seatMaps', event.id) : null;
    const seatIndex = seatMap ? indexSeats(seatMap) : new Map();
    const settings = await getSettings(tx, deps);
    const totals = computeTotals(order.items, settings.feeVatRate);
    return {
      id: order.id,
      ref: order.ref,
      kind: order.kind,
      status: order.status,
      event: { ...card, venue: event.venue, settings: { personalizedTickets: event.settings.personalizedTickets, refundPolicy: event.settings.refundPolicy } },
      items: order.items,
      attendeeNames: order.attendeeNames,
      discount: order.discount,
      subtotalOre: order.subtotalOre,
      discountOre: order.discountOre,
      feeOre: order.feeOre,
      totalOre: order.totalOre,
      refundedOre: order.refundedOre,
      expiresAt: order.expiresAt,
      createdAt: order.createdAt,
      paidAt: order.paidAt,
      paymentMethod: order.paymentMethod,
      payment: payment ? { status: payment.status, method: payment.method, redirectUrl: payment.status === 'pending' ? payment.redirectUrl : null } : null,
      ticketIds: tickets.map((t) => t.id),
      seats: order.items.flatMap((i) => i.seatIds.map((id) => seatIndex.get(id)?.ref).filter((r): r is SeatRef => !!r)),
      organizer: { name: org.name, orgNumber: org.orgNumber, email: org.email },
      vat: { ticketsVatOre: totals.ticketsVatOre, feeVatOre: totals.feeVatOre },
      buyer: order.buyer,
      failureReason: order.failureReason,
    };
  });
}

export async function listMyOrders(deps: Deps, user: User): Promise<OrderDTO[]> {
  const ids = await deps.store.read(async (tx) => {
    const orders = await tx.find('orders', { userId: user.id }, { orderBy: { field: 'createdAt', dir: 'desc' }, limit: 100 });
    return orders
      .filter((o) => o.kind !== 'comp' && ((o.status !== 'expired' && o.status !== 'cancelled') || o.paidAt))
      .map((o) => o.id);
  });
  const out: OrderDTO[] = [];
  for (const id of ids) out.push(await getOrderDTO(deps, user, id));
  return out;
}
