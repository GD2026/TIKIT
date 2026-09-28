import { AppError } from '../../shared/errors';
import { newId } from '../../shared/ids';
import { isValidEmail, normalizeEmail, normalizePhone } from '../../shared/validation';
import type { Order, User } from '../../shared/types';
import type { Deps } from '../context';
import { audit, notify, nowIso } from './common';
import { activeHeld, availableOf } from './inventory';
import { createTickets } from './orders';
import { requireOrgAccess } from './organizers';
import { createTransferTx } from './tickets';
import { humanRef } from '../../shared/ids';

export interface GuestResult {
  orderId: string;
  ref: string;
  tickets: number;
  delivered: 'account' | 'link';
  links: string[];
  recipientName: string | null;
}

/** Complimentary tickets (gjesteliste / manuell utdeling). Counts toward capacity. */
export async function issueGuestTickets(
  deps: Deps,
  user: User,
  organizerId: string,
  eventId: string,
  input: { name: string; contact?: string | null | undefined; ticketTypeId: string; qty: number; message?: string | null | undefined },
): Promise<GuestResult> {
  const nowS = nowIso(deps);
  return deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const event = await tx.get('events', eventId);
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    if (event.status === 'cancelled') throw new AppError('event_cancelled');
    if (event.endsAt <= nowS) throw new AppError('event_ended');
    const tt = await tx.get('ticketTypes', input.ticketTypeId, { forUpdate: true });
    if (!tt || tt.eventId !== eventId) throw new AppError('invalid_ticket_type');
    const seatMap = event.seated ? await tx.get('seatMaps', eventId) : null;
    if (seatMap?.sections.some((s) => s.ticketTypeId === tt.id)) {
      throw new AppError('validation', { message: 'Gjestebilletter kan ikke ha sitteplass. Velg en billettype uten setekart.' });
    }
    const held = await activeHeld(tx, eventId, nowS);
    const available = availableOf(tt, held);
    if (available < input.qty) throw new AppError('not_enough_tickets', { details: { available } });

    let recipient: User | null = null;
    const contact = input.contact?.trim() || null;
    if (contact) {
      const email = normalizeEmail(contact);
      const phone = normalizePhone(contact);
      if (!isValidEmail(email) && !phone) throw new AppError('validation', { fields: { contact: 'Skriv en e-postadresse eller et mobilnummer.' } });
      const users = isValidEmail(email)
        ? await tx.find('users', { email, emailVerified: true })
        : await tx.find('users', { phone: phone!, phoneVerified: true });
      recipient = users.find((u) => !u.deletedAt && !u.banned) ?? null;
    }

    let ref = humanRef('TK', 6);
    while (await tx.findOne('orders', { ref })) ref = humanRef('TK', 6);
    const ownerId = recipient?.id ?? user.id;
    const order: Order = {
      id: newId(),
      ref,
      userId: ownerId,
      eventId,
      organizerId,
      kind: 'comp',
      status: 'paid',
      items: [{ ticketTypeId: tt.id, name: tt.name, qty: input.qty, listPriceOre: 0, unitPriceOre: 0, feeOre: 0, vatRate: tt.vatRate, seatIds: [] }],
      attendeeNames: Array.from({ length: input.qty }, (_, i) => (i === 0 ? input.name : `${input.name} (+${i})`)),
      discount: null,
      subtotalOre: 0,
      discountOre: 0,
      feeOre: 0,
      totalOre: 0,
      refundedOre: 0,
      refunds: [],
      resaleListingId: null,
      paymentId: null,
      paymentMethod: 'comp',
      idemKey: null,
      buyer: {
        name: input.name,
        email: contact && isValidEmail(normalizeEmail(contact)) ? normalizeEmail(contact) : null,
        phone: contact ? normalizePhone(contact) : null,
      },
      expiresAt: nowS,
      createdAt: nowS,
      updatedAt: nowS,
      paidAt: nowS,
      cancelledAt: null,
      failureReason: null,
    };
    await tx.insert('orders', order);
    await tx.update('ticketTypes', tt.id, { sold: tt.sold + input.qty, updatedAt: nowS });
    const tickets = await createTickets(tx, deps, order, { ownerId, purchaserId: ownerId, kind: 'comp', holderFallback: input.name, seatRefs: new Map() });

    const links: string[] = [];
    if (recipient) {
      await notify(tx, deps, recipient.id, {
        kind: 'guest_ticket',
        title: `Du står på gjestelisten til ${event.title}`,
        body: `${tickets.length} ${tickets.length === 1 ? 'billett' : 'billetter'} ligger klare i appen.`,
        link: '/billetter',
        email: {
          subject: `Gjestebillett til ${event.title}`,
          heading: 'Du står på gjestelisten',
          paragraphs: [`${event.title}: ${tickets.length} ${tickets.length === 1 ? 'billett' : 'billetter'} ligger klare under Billetter i TIKIT.`, ...(input.message ? [`«${input.message}»`] : [])],
        },
        transactional: true,
      });
    } else {
      for (const t of tickets) {
        const { link } = await createTransferTx(tx, deps, {
          ticket: t,
          event,
          from: user,
          contact: t === tickets[0] ? contact : null,
          message: input.message ?? null,
          kind: 'guest',
        });
        links.push(link);
      }
    }
    await audit(tx, deps, user.id, 'guest.issued', 'events', eventId, { qty: input.qty, name: input.name });
    return { orderId: order.id, ref, tickets: tickets.length, delivered: recipient ? 'account' : 'link', links, recipientName: recipient?.name ?? null };
  });
}
