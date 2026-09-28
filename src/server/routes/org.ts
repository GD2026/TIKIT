import { Hono } from 'hono';
import { z } from 'zod';
import { AppError } from '../../shared/errors';
import { formatNok } from '../../shared/money';
import {
  cancelEventSchema,
  discountInputSchema,
  eventInputSchema,
  guestTicketSchema,
  organizerSchema,
  refundSchema,
  scannerCodeCreateSchema,
  seatMapInputSchema,
  teamInviteSchema,
  ticketTypeInputSchema,
} from '../../shared/schemas';
import { formatDateShort, formatTime } from '../../shared/time';
import { body, limit, requireUser, type AppEnv } from '../middleware/core';
import {
  applyOrganizer,
  changeMemberRole,
  getOrganizerForMember,
  inviteMember,
  listTeam,
  removeMember,
  requireOrgAccess,
  updateOrganizer,
} from '../services/organizers';
import {
  createEvent,
  deleteSeatMap,
  duplicateEvent,
  getOrgEvent,
  listOrgEvents,
  publishEvent,
  saveSeatMap,
  saveTicketTypes,
  setSeatsBlocked,
  unpublishEvent,
  updateEvent,
} from '../services/events';
import { cancelEvent, refundTickets } from '../services/refunds';
import { createDiscount, deleteDiscount, listDiscounts, updateDiscount } from '../services/discounts';
import { eventStats, orgDashboard, settlement } from '../services/stats';
import { issueGuestTickets } from '../services/guests';
import { createScannerCode, listAttendees, listScannerCodes, revokeScannerCode } from '../services/checkin';
import { getOrderDTO, isPaidStatus } from '../services/orders';
import type { Deps } from '../context';
import type { User } from '../../shared/types';

const createEventSchema = z.object({ event: eventInputSchema, ticketTypes: z.array(ticketTypeInputSchema).max(20).default([]) }).strict();
const ticketTypesSchema = z.object({ ticketTypes: z.array(ticketTypeInputSchema).max(20) }).strict();
const blockSchema = z.object({ seatIds: z.array(z.string().max(80)).max(500), blocked: z.boolean() }).strict();
const roleSchema = z.object({ role: z.enum(['owner', 'admin', 'staff']) }).strict();

function csvCell(value: string | number | null): string {
  const s = value === null ? '' : String(value);
  // Neutralise spreadsheet formula injection and quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function orgRoutes(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post('/', limit('org-apply', 5, 60 * 60_000, 'user'), async (c) => {
    const user = requireUser(c);
    const org = await applyOrganizer(deps, user, await body(c, organizerSchema));
    return c.json(org, 201);
  });

  app.get('/:orgId', async (c) => c.json(await getOrganizerForMember(deps, requireUser(c), c.req.param('orgId'))));
  app.put('/:orgId', async (c) => c.json(await updateOrganizer(deps, requireUser(c), c.req.param('orgId'), await body(c, organizerSchema))));
  app.get('/:orgId/dashboard', async (c) => c.json(await orgDashboard(deps, requireUser(c), c.req.param('orgId'))));
  app.get('/:orgId/settlement', async (c) => c.json(await settlement(deps, requireUser(c), c.req.param('orgId'))));

  // ── Team ──────────────────────────────────────────────────────────────────
  app.get('/:orgId/team', async (c) => c.json(await listTeam(deps, requireUser(c), c.req.param('orgId'))));
  app.post('/:orgId/team', limit('team-invite', 30, 60 * 60_000, 'user'), async (c) => {
    const input = await body(c, teamInviteSchema);
    const result = await inviteMember(deps, requireUser(c), c.req.param('orgId'), input.email, input.role);
    return c.json({ result });
  });
  app.delete('/:orgId/team/:memberId', async (c) => {
    await removeMember(deps, requireUser(c), c.req.param('orgId'), c.req.param('memberId'));
    return c.json({ ok: true });
  });
  app.patch('/:orgId/team/:memberId', async (c) => {
    const { role } = await body(c, roleSchema);
    await changeMemberRole(deps, requireUser(c), c.req.param('orgId'), c.req.param('memberId'), role);
    return c.json({ ok: true });
  });

  // ── Events ────────────────────────────────────────────────────────────────
  app.get('/:orgId/events', async (c) => c.json({ events: await listOrgEvents(deps, requireUser(c), c.req.param('orgId')) }));
  app.post('/:orgId/events', async (c) => {
    const input = await body(c, createEventSchema);
    const event = await createEvent(deps, requireUser(c), c.req.param('orgId'), input.event, input.ticketTypes);
    return c.json(event, 201);
  });
  app.get('/:orgId/events/:eventId', async (c) => c.json(await getOrgEvent(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId'))));
  app.put('/:orgId/events/:eventId', async (c) => {
    const input = await body(c, z.object({ event: eventInputSchema }).strict());
    return c.json(await updateEvent(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId'), input.event));
  });
  app.put('/:orgId/events/:eventId/ticket-types', async (c) => {
    const input = await body(c, ticketTypesSchema);
    await saveTicketTypes(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId'), input.ticketTypes);
    return c.json(await getOrgEvent(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId')));
  });
  app.post('/:orgId/events/:eventId/publish', async (c) => c.json(await publishEvent(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId'))));
  app.post('/:orgId/events/:eventId/unpublish', async (c) => c.json(await unpublishEvent(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId'))));
  app.post('/:orgId/events/:eventId/cancel', async (c) => {
    const { reason } = await body(c, cancelEventSchema);
    return c.json(await cancelEvent(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId'), reason));
  });
  app.post('/:orgId/events/:eventId/duplicate', async (c) => c.json(await duplicateEvent(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId')), 201));
  app.put('/:orgId/events/:eventId/seatmap', async (c) => c.json(await saveSeatMap(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId'), await body(c, seatMapInputSchema))));
  app.delete('/:orgId/events/:eventId/seatmap', async (c) => {
    await deleteSeatMap(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId'));
    return c.json({ ok: true });
  });
  app.post('/:orgId/events/:eventId/seats/block', async (c) => {
    const input = await body(c, blockSchema);
    await setSeatsBlocked(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId'), input.seatIds, input.blocked);
    return c.json({ ok: true });
  });
  app.get('/:orgId/events/:eventId/stats', async (c) => c.json(await eventStats(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId'))));

  // ── Orders & refunds ──────────────────────────────────────────────────────
  app.get('/:orgId/events/:eventId/orders', async (c) => {
    const user = requireUser(c);
    const orgId = c.req.param('orgId');
    const eventId = c.req.param('eventId');
    const rows = await deps.store.read(async (tx) => {
      await requireOrgAccess(tx, user, orgId, 'admin');
      const event = await tx.get('events', eventId);
      if (!event || event.organizerId !== orgId) throw new AppError('not_found');
      const orders = await tx.find('orders', { eventId });
      return orders
        .filter((o) => isPaidStatus(o.status) || o.status === 'pending_payment')
        .sort((a, b) => (b.paidAt ?? b.createdAt).localeCompare(a.paidAt ?? a.createdAt))
        .map((o) => ({
          id: o.id,
          ref: o.ref,
          kind: o.kind,
          status: o.status,
          buyerName: o.buyer.name,
          buyerEmail: o.buyer.email,
          tickets: o.items.reduce((s, i) => s + i.qty, 0),
          totalOre: o.totalOre,
          ticketOre: o.subtotalOre - o.discountOre,
          feeOre: o.feeOre,
          refundedOre: o.refundedOre,
          discountCode: o.discount?.code ?? null,
          paymentMethod: o.paymentMethod,
          paidAt: o.paidAt,
          createdAt: o.createdAt,
        }));
    });
    return c.json({ orders: rows });
  });

  app.get('/:orgId/orders/:orderId', async (c) => {
    const user = requireUser(c);
    const orgId = c.req.param('orgId');
    const orderId = c.req.param('orderId');
    const tickets = await deps.store.read(async (tx) => {
      await requireOrgAccess(tx, user, orgId, 'admin');
      const order = await tx.get('orders', orderId);
      if (!order || order.organizerId !== orgId) throw new AppError('not_found');
      const ts = await tx.find('tickets', { originalOrderId: orderId });
      return { refunds: order.refunds, tickets: ts.map((t) => ({ id: t.id, number: t.number, typeName: t.typeName, holderName: t.holderName, status: t.status, kind: t.kind, pricePaidOre: t.pricePaidOre, seat: t.seat, checkedInAt: t.checkedInAt, currentOrder: t.orderId === orderId })) };
    });
    const order = await getOrderDTO(deps, user, orderId, true);
    return c.json({ order, ...tickets });
  });

  app.post('/:orgId/orders/:orderId/refund', limit('org-refund', 60, 60 * 60_000, 'user'), async (c) => {
    const user = requireUser(c);
    const input = await body(c, refundSchema);
    const orderId = c.req.param('orderId');
    await deps.store.read(async (tx) => {
      const o = await tx.get('orders', orderId);
      if (!o || o.organizerId !== c.req.param('orgId')) throw new AppError('not_found');
    });
    return c.json(await refundTickets(deps, user, { orderId, ticketIds: input.ticketIds, includeFees: input.includeFees, reason: input.reason, mode: 'organizer' }));
  });

  // ── Attendees & guests ────────────────────────────────────────────────────
  /** Role in the organizer from the URL – and the event must belong to that same organizer. */
  const eventAccess = (user: User, orgId: string, eventId: string, min: 'staff' | 'admin') =>
    deps.store.read(async (tx) => {
      const access = await requireOrgAccess(tx, user, orgId, min);
      const event = await tx.get('events', eventId);
      if (!event || event.organizerId !== orgId) throw new AppError('not_found');
      return access;
    });

  app.get('/:orgId/events/:eventId/attendees', async (c) => {
    const user = requireUser(c);
    const access = await eventAccess(user, c.req.param('orgId'), c.req.param('eventId'), 'staff');
    const includePii = access.role !== 'staff';
    return c.json({ attendees: await listAttendees(deps, { kind: 'user', user }, c.req.param('eventId'), includePii) });
  });

  app.get('/:orgId/events/:eventId/attendees.csv', async (c) => {
    const user = requireUser(c);
    await eventAccess(user, c.req.param('orgId'), c.req.param('eventId'), 'admin');
    const rows = await listAttendees(deps, { kind: 'user', user }, c.req.param('eventId'), true);
    const header = ['Billettnr', 'Navn på billett', 'Billettype', 'Sete', 'Status', 'Sjekket inn', 'Ordre', 'Kjøper', 'E-post', 'Telefon', 'Pris'];
    const lines = [header.map(csvCell).join(';')];
    for (const r of rows) {
      lines.push(
        [
          r.number,
          r.holderName,
          r.typeName,
          r.seat,
          { valid: 'Gyldig', used: 'Brukt', refunded: 'Refundert', cancelled: 'Kansellert' }[r.status],
          r.checkedInAt ? `${formatDateShort(r.checkedInAt)} ${formatTime(r.checkedInAt)}` : '',
          r.orderRef,
          r.buyerName,
          r.buyerEmail,
          r.buyerPhone,
          formatNok(r.pricePaidOre).replace(/\u00a0/g, ' '),
        ]
          .map(csvCell)
          .join(';'),
      );
    }
    return new Response(`\uFEFF${lines.join('\r\n')}`, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="deltakerliste.csv"', 'Cache-Control': 'no-store' },
    });
  });

  app.post('/:orgId/events/:eventId/guests', limit('guests', 200, 60 * 60_000, 'user'), async (c) => {
    const input = await body(c, guestTicketSchema);
    return c.json(await issueGuestTickets(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId'), input), 201);
  });

  // ── Discount codes ────────────────────────────────────────────────────────
  app.get('/:orgId/events/:eventId/discounts', async (c) => c.json({ discounts: await listDiscounts(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId')) }));
  app.post('/:orgId/events/:eventId/discounts', async (c) =>
    c.json(await createDiscount(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId'), await body(c, discountInputSchema)), 201),
  );
  app.put('/:orgId/discounts/:codeId', async (c) => c.json(await updateDiscount(deps, requireUser(c), c.req.param('orgId'), c.req.param('codeId'), await body(c, discountInputSchema))));
  app.delete('/:orgId/discounts/:codeId', async (c) => c.json({ result: await deleteDiscount(deps, requireUser(c), c.req.param('orgId'), c.req.param('codeId')) }));

  // ── Scanner codes ─────────────────────────────────────────────────────────
  app.get('/:orgId/events/:eventId/scanner-codes', async (c) => c.json({ codes: await listScannerCodes(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId')) }));
  app.post('/:orgId/events/:eventId/scanner-codes', async (c) => {
    const { label } = await body(c, scannerCodeCreateSchema);
    return c.json(await createScannerCode(deps, requireUser(c), c.req.param('orgId'), c.req.param('eventId'), label), 201);
  });
  app.delete('/:orgId/scanner-codes/:codeId', async (c) => {
    await revokeScannerCode(deps, requireUser(c), c.req.param('orgId'), c.req.param('codeId'));
    return c.json({ ok: true });
  });

  return app;
}
