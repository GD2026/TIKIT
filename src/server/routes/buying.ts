import { Hono } from 'hono';
import { AppError } from '../../shared/errors';
import { orderCreateSchema, orderPaySchema, orderUpdateSchema, resaleCreateSchema, transferCreateSchema } from '../../shared/schemas';
import { toIcsUtc } from '../../shared/time';
import { body, limit, requireUser, type AppEnv } from '../middleware/core';
import { cancelOrder, createOrder, getOrderDTO, payOrder, syncOrderPayment, updateOrder } from '../services/orders';
import {
  acceptTransfer,
  cancelResaleListing,
  cancelTransfer,
  createResaleListing,
  createTransfer,
  getTicket,
  listMyTickets,
  previewTransfer,
} from '../services/tickets';
import { refundTickets } from '../services/refunds';
import { createStaticTicketCode } from '../../shared/qr';
import { bytesToBase64Url, hmacSha256 } from '../../shared/encoding';
import type { WalletPassInput } from '../adapters/types';
import type { Deps } from '../context';
import { appLink } from '../context';

function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function buyingRoutes(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // ── Orders ────────────────────────────────────────────────────────────────
  app.post('/orders', limit('order-create', 20, 60_000, 'user'), async (c) => {
    const user = requireUser(c);
    const input = await body(c, orderCreateSchema);
    const order = await createOrder(deps, user, input);
    return c.json(await getOrderDTO(deps, user, order.id), 201);
  });

  app.get('/orders/:id', async (c) => c.json(await getOrderDTO(deps, requireUser(c), c.req.param('id'))));

  app.patch('/orders/:id', async (c) => {
    const user = requireUser(c);
    const input = await body(c, orderUpdateSchema);
    await updateOrder(deps, user, c.req.param('id'), input);
    return c.json(await getOrderDTO(deps, user, c.req.param('id')));
  });

  app.post('/orders/:id/pay', limit('order-pay', 20, 60_000, 'user'), async (c) => {
    const user = requireUser(c);
    const input = await body(c, orderPaySchema);
    const { redirectUrl } = await payOrder(deps, user, c.req.param('id'), input);
    return c.json({ order: await getOrderDTO(deps, user, c.req.param('id')), redirectUrl });
  });

  app.post('/orders/:id/sync', limit('order-sync', 60, 60_000, 'user'), async (c) => {
    const user = requireUser(c);
    const id = c.req.param('id');
    await getOrderDTO(deps, user, id); // ownership check
    await syncOrderPayment(deps, id);
    return c.json(await getOrderDTO(deps, user, id));
  });

  app.post('/orders/:id/cancel', async (c) => {
    const user = requireUser(c);
    await cancelOrder(deps, user, c.req.param('id'));
    return c.json(await getOrderDTO(deps, user, c.req.param('id')));
  });

  // ── Tickets ───────────────────────────────────────────────────────────────
  app.get('/tickets', async (c) => {
    const user = requireUser(c);
    return c.json({ tickets: await listMyTickets(deps, user), serverTime: deps.clock().toISOString() });
  });

  app.get('/tickets/:id', async (c) => {
    const ticket = await getTicket(deps, requireUser(c), c.req.param('id'));
    return c.json({ ticket, serverTime: deps.clock().toISOString() });
  });

  app.post('/tickets/:id/transfer', limit('transfer', 30, 60 * 60_000, 'user'), async (c) => {
    const user = requireUser(c);
    const input = await body(c, transferCreateSchema);
    return c.json(await createTransfer(deps, user, c.req.param('id'), input.contact ?? null, input.message ?? null));
  });

  app.delete('/transfers/:id', async (c) => {
    await cancelTransfer(deps, requireUser(c), c.req.param('id'));
    return c.json({ ok: true });
  });

  app.get('/transfers/:token', limit('transfer-view', 60, 60_000), async (c) => c.json(await previewTransfer(deps, c.req.param('token'), c.get('user'))));

  app.post('/transfers/:token/accept', limit('transfer-accept', 20, 60_000, 'user'), async (c) =>
    c.json(await acceptTransfer(deps, requireUser(c), c.req.param('token'))),
  );

  app.post('/tickets/:id/resale', async (c) => {
    const user = requireUser(c);
    const { priceOre } = await body(c, resaleCreateSchema);
    return c.json(await createResaleListing(deps, user, c.req.param('id'), priceOre));
  });

  app.delete('/resale/:id', async (c) => {
    await cancelResaleListing(deps, requireUser(c), c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/tickets/:id/refund', limit('self-refund', 10, 60 * 60_000, 'user'), async (c) => {
    const user = requireUser(c);
    const ticket = await getTicket(deps, user, c.req.param('id'));
    if (!ticket.canRefund) throw new AppError('ticket_not_refundable');
    return c.json(await refundTickets(deps, user, { orderId: ticket.orderId, ticketIds: [ticket.id], includeFees: false, reason: 'Refundert av kjøper', mode: 'self' }));
  });

  app.get('/tickets/:id/calendar.ics', async (c) => {
    const user = requireUser(c);
    const t = await getTicket(deps, user, c.req.param('id'));
    const e = t.event;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//TIKIT//Billetter//NO',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${t.id}@tikit`,
      `DTSTAMP:${toIcsUtc(deps.clock().toISOString())}`,
      `DTSTART:${toIcsUtc(e.startsAt)}`,
      `DTEND:${toIcsUtc(e.endsAt)}`,
      `SUMMARY:${icsEscape(e.title)}`,
      `LOCATION:${icsEscape([e.venue.name, e.venue.address, e.venue.city].filter(Boolean).join(', '))}`,
      `DESCRIPTION:${icsEscape(`Billett ${t.number} – ${t.typeName}. Vis billetten i TIKIT: ${appLink(deps.config, `/billetter/${t.id}`)}`)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ];
    return new Response(lines.join('\r\n'), {
      headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${e.slug}.ics"` },
    });
  });

  app.get('/tickets/:id/wallet/:kind', limit('wallet', 30, 60 * 60_000, 'user'), async (c) => {
    const user = requireUser(c);
    const kind = c.req.param('kind');
    const t = await getTicket(deps, user, c.req.param('id'));
    if (!t.secret) throw new AppError('ticket_busy', { message: 'Billetten kan ikke legges i lommeboken nå.' });
    const wallet = deps.wallet;
    const input: WalletPassInput = {
      ticketId: t.id,
      serial: `${t.id}-${bytesToBase64Url(await hmacSha256(t.secret, 'wallet-serial')).slice(0, 10)}`,
      number: t.number,
      eventId: t.event.id,
      eventTitle: t.event.title,
      venue: { name: t.event.venue.name, address: [t.event.venue.address, [t.event.venue.postalCode, t.event.venue.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') },
      startsAt: t.event.startsAt,
      endsAt: t.event.endsAt,
      doorsAt: t.event.doorsAt,
      holderName: t.holderName,
      typeName: t.typeName,
      seat: t.seat ? `${t.seat.section}, rad ${t.seat.row}, sete ${t.seat.number}` : null,
      barcode: await createStaticTicketCode(t.id, t.secret),
      colors: { background: '#0B0A24', foreground: '#FFFFFF', label: '#B8C0FF' },
      organizer: t.event.organizerName,
      ticketUrl: appLink(deps.config, `/billetter/${t.id}`),
    };
    if (kind === 'apple' && wallet?.apple) {
      const pass = await wallet.apple(input);
      return new Response(pass as unknown as ConstructorParameters<typeof Response>[0], {
        headers: {
          'Content-Type': 'application/vnd.apple.pkpass',
          'Content-Disposition': `attachment; filename="${t.number}.pkpass"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    if (kind === 'google' && wallet?.google) {
      return c.json({ url: await wallet.google(input) });
    }
    throw new AppError('not_found', { message: 'Lommebok er ikke satt opp for denne installasjonen.' });
  });

  return app;
}
