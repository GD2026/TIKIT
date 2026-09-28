import { describe, expect, it } from 'vitest';
import { completeDemoPayment, makeHarness, type Harness } from './harness';
import { createTicketCode } from '../../src/shared/qr';
import { DEMO_SCANNER_CODE } from '../../src/server/seed';

async function eventBySlug(h: Harness, slug: string, token?: string | null, unlock?: string) {
  const r = await h.call('GET', `/events/${slug}`, undefined, token, unlock ? { 'x-tikit-unlock': unlock } : {});
  expect(r.status).toBe(200);
  return r.json;
}

async function buy(h: Harness, token: string, eventId: string, items: { ticketTypeId: string; qty: number }[], method: 'vipps' | 'card' = 'vipps', extra: Record<string, unknown> = {}) {
  const created = await h.call('POST', '/orders', { eventId, items, ...extra }, token);
  if (created.status !== 201) return { created, paid: null as any };
  const pay = await h.call('POST', `/orders/${created.json.id}/pay`, { method, acceptTerms: true }, token);
  if (pay.status !== 200) return { created, paid: pay };
  if (!pay.json.redirectUrl) return { created, paid: pay };
  const synced = await completeDemoPayment(h, token, created.json.id, pay.json.redirectUrl);
  return { created, paid: synced };
}

describe('catalogue', () => {
  it('serves config, home and event lists from seeded data', async () => {
    const h = await makeHarness();
    const cfg = await h.call('GET', '/config');
    expect(cfg.status).toBe(200);
    expect(cfg.json.demoMode).toBe(true);
    expect(cfg.json.providers.map((p: any) => p.id)).toEqual(['vipps', 'google', 'apple']);
    expect(cfg.json.paymentMethods.map((p: any) => p.id)).toEqual(['vipps', 'card']);

    const home = await h.call('GET', '/home');
    expect(home.status).toBe(200);
    expect(home.json.sections.find((s: any) => s.id === 'featured').events.length).toBeGreaterThan(0);

    const list = await h.call('GET', '/events');
    const titles = list.json.events.map((e: any) => e.title);
    expect(titles).toContain('Russetreff Vest');
    expect(titles).not.toContain('Julebord for russen'); // draft
    expect(titles).not.toContain('Høstslipp'); // past

    const search = await h.call('GET', '/events?q=russetreff%20vest');
    expect(search.json.events).toHaveLength(1);
    const byCity = await h.call('GET', '/events?city=Sola');
    expect(byCity.json.events.map((e: any) => e.title)).toEqual(['Midnattsfest på stranden']);

    const detail = await eventBySlug(h, 'russetreff-vest');
    expect(detail.event.saleState).toBe('on_sale');
    expect(detail.ticketTypes.map((t: any) => t.name)).toEqual(['Early Bird', 'Ordinær', 'VIP + garderobe']);
    expect(detail.ticketTypes[0].state).toBe('sold_out');
    expect(detail.hasHiddenTypes).toBe(true);

    const strand = await eventBySlug(h, 'midnattsfest-pa-stranden');
    expect(strand.event.saleState).toBe('sold_out');
    expect(strand.resale.count).toBe(3);
  });

  it('unlocks hidden ticket types with an access code', async () => {
    const h = await makeHarness();
    const d = await eventBySlug(h, 'russetreff-vest');
    const wrong = await h.call('POST', `/events/${d.event.id}/unlock`, { code: 'feil' });
    expect(wrong.status).toBe(400);
    expect(wrong.json.error.code).toBe('invalid_access_code');
    const ok = await h.call('POST', `/events/${d.event.id}/unlock`, { code: 'styret27' });
    expect(ok.status).toBe(200);
    const d2 = await eventBySlug(h, 'russetreff-vest', null, ok.json.token);
    expect(d2.ticketTypes.map((t: any) => t.name)).toContain('Russestyret');
    expect(d2.hasHiddenTypes).toBe(false);
  });
});

describe('buying', () => {
  it('reserves, pays with Vipps (demo), issues tickets and captures', async () => {
    const h = await makeHarness();
    const token = await h.login('buyer');
    const d = await eventBySlug(h, 'russetreff-vest', token);
    const ord = d.ticketTypes.find((t: any) => t.name === 'Ordinær');
    const before = (await h.call('GET', '/tickets', undefined, token)).json.tickets.length;
    const { created, paid } = await buy(h, token, d.event.id, [{ ticketTypeId: ord.id, qty: 2 }]);
    expect(created.status).toBe(201);
    expect(created.json.status).toBe('reserved');
    expect(created.json.totalOre).toBe(2 * 44900 + 2 * created.json.items[0].feeOre);
    expect(paid.status).toBe(200);
    expect(paid.json.status).toBe('paid');
    expect(paid.json.ticketIds).toHaveLength(2);
    const tickets = (await h.call('GET', '/tickets', undefined, token)).json.tickets;
    expect(tickets.length).toBe(before + 2);
    const payment = await h.deps.store.read((tx) => tx.findOne('payments', { orderId: created.json.id }));
    expect(payment?.status).toBe('captured');
    const mails = await h.deps.store.read((tx) => tx.find('outbox'));
    expect(mails.some((m) => m.subject.includes(created.json.ref))).toBe(true);
  });

  it('prevents overselling and releases holds when they expire', async () => {
    const h = await makeHarness();
    const org = await h.login('organizer');
    const me = (await h.call('GET', '/me', undefined, org)).json.me;
    const orgId = me.organizations.find((o: any) => o.name === 'Nordlys Events').id;
    const start = new Date(h.now().getTime() + 10 * 86400000);
    const ev = await h.call(
      'POST',
      `/org/${orgId}/events`,
      {
        event: {
          title: 'Lite testarrangement',
          category: 'fest',
          startsAt: start.toISOString(),
          endsAt: new Date(start.getTime() + 4 * 3600000).toISOString(),
          venue: { name: 'Testsalen', city: 'Stavanger' },
          poster: { style: 'aurora', palette: 'blatime', seed: 1 },
          settings: { maxPerOrder: 4, personalizedTickets: false, transfersAllowed: true, resaleAllowed: true, refundPolicy: 'none', queueEnabled: false, queueRatePerMinute: 100, waitlistEnabled: true, showRemaining: true, requireVerifiedAge: false },
        },
        ticketTypes: [{ name: 'Inngang', priceOre: 10000, capacity: 3 }],
      },
      org,
    );
    expect(ev.status).toBe(201);
    const pub = await h.call('POST', `/org/${orgId}/events/${ev.json.id}/publish`, {}, org);
    expect(pub.status).toBe(200);
    const detail = await eventBySlug(h, ev.json.slug);
    const typeId = detail.ticketTypes[0].id;

    const a = await h.login('buyer');
    const b = await h.login('new', 'google', 'Ola Test');
    const r1 = await h.call('POST', '/orders', { eventId: ev.json.id, items: [{ ticketTypeId: typeId, qty: 2 }] }, a);
    expect(r1.status).toBe(201);
    const r2 = await h.call('POST', '/orders', { eventId: ev.json.id, items: [{ ticketTypeId: typeId, qty: 2 }] }, b);
    expect(r2.status).toBe(400);
    expect(r2.json.error.code).toBe('not_enough_tickets');
    expect(r2.json.error.details.available).toBe(1);

    // Concurrent attempts for the last ticket: exactly one wins.
    const results = await Promise.all([1, 2, 3].map(() => h.call('POST', '/orders', { eventId: ev.json.id, items: [{ ticketTypeId: typeId, qty: 1 }] }, b)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);

    h.advance(11 * 60_000);
    const r3 = await h.call('POST', '/orders', { eventId: ev.json.id, items: [{ ticketTypeId: typeId, qty: 3 }] }, b);
    expect(r3.status).toBe(201);
    const expired = await h.call('GET', `/orders/${r1.json.id}`, undefined, a);
    expect(expired.json.status).toBe('expired');
    const pay = await h.call('POST', `/orders/${r1.json.id}/pay`, { method: 'vipps', acceptTerms: true }, a);
    expect(pay.status).toBe(400);
    expect(pay.json.error.code).toBe('order_expired');
  });

  it('applies discount codes only to eligible ticket types', async () => {
    const h = await makeHarness();
    const token = await h.login('buyer');
    const d = await eventBySlug(h, 'russetreff-vest', token);
    const ord = d.ticketTypes.find((t: any) => t.name === 'Ordinær');
    const vip = d.ticketTypes.find((t: any) => t.name === 'VIP + garderobe');
    const res = await h.call('POST', '/orders', { eventId: d.event.id, items: [{ ticketTypeId: ord.id, qty: 1 }, { ticketTypeId: vip.id, qty: 1 }], discountCode: 'russ27' }, token);
    expect(res.status).toBe(201);
    const ordItem = res.json.items.find((i: any) => i.ticketTypeId === ord.id);
    const vipItem = res.json.items.find((i: any) => i.ticketTypeId === vip.id);
    expect(ordItem.unitPriceOre).toBe(44900 - Math.round(44900 * 0.15));
    expect(vipItem.unitPriceOre).toBe(69900);
    expect(res.json.discountOre).toBe(Math.round(44900 * 0.15));
    const removed = await h.call('PATCH', `/orders/${res.json.id}`, { discountCode: null }, token);
    expect(removed.json.discountOre).toBe(0);
    const bad = await h.call('PATCH', `/orders/${res.json.id}`, { discountCode: 'FINNESIKKE' }, token);
    expect(bad.json.error.code).toBe('invalid_discount_code');
  });

  it('enforces age limits and Vipps-verified age', async () => {
    const h = await makeHarness();
    const google = await h.login('new', 'google', 'Uten Alder');
    const d = await eventBySlug(h, 'russetreff-vest', google);
    const ord = d.ticketTypes.find((t: any) => t.name === 'Ordinær');
    const noAge = await h.call('POST', '/orders', { eventId: d.event.id, items: [{ ticketTypeId: ord.id, qty: 1 }] }, google);
    expect(noAge.json.error.code).toBe('age_required');
    await h.call('PATCH', '/me', { birthdate: '2010-01-01' }, google);
    const young = await h.call('POST', '/orders', { eventId: d.event.id, items: [{ ticketTypeId: ord.id, qty: 1 }] }, google);
    expect(young.json.error.code).toBe('age_too_young');
    await h.call('PATCH', '/me', { birthdate: '2004-01-01' }, google);
    const ok = await h.call('POST', '/orders', { eventId: d.event.id, items: [{ ticketTypeId: ord.id, qty: 1 }] }, google);
    expect(ok.status).toBe(201);

    const buss = await eventBySlug(h, 'blatimen-busslansering', google);
    const verifiedOnly = await h.call('POST', '/orders', { eventId: buss.event.id, items: [{ ticketTypeId: buss.ticketTypes[0].id, qty: 1 }] }, google);
    expect(verifiedOnly.json.error.code).toBe('age_verification_required');
    const vipps = await h.login('buyer', 'vipps');
    const fine = await h.call('POST', '/orders', { eventId: buss.event.id, items: [{ ticketTypeId: buss.ticketTypes[0].id, qty: 1 }] }, vipps);
    expect(fine.status).toBe(201);
  });

  it('handles free tickets and personalised tickets', async () => {
    const h = await makeHarness();
    const token = await h.login('buyer');
    const cup = await eventBySlug(h, 'russecupen-i-fotball', token);
    const free = cup.ticketTypes.find((t: any) => t.priceOre === 0);
    const created = await h.call('POST', '/orders', { eventId: cup.event.id, items: [{ ticketTypeId: free.id, qty: 2 }] }, token);
    expect(created.json.totalOre).toBe(0);
    const paid = await h.call('POST', `/orders/${created.json.id}/pay`, { method: 'free', acceptTerms: true }, token);
    expect(paid.status).toBe(200);
    expect(paid.json.order.status).toBe('paid');

    const galla = await eventBySlug(h, 'avgangsgalla-vg3', token);
    const g = await h.call('POST', '/orders', { eventId: galla.event.id, items: [{ ticketTypeId: galla.ticketTypes[0].id, qty: 2 }] }, token);
    const missing = await h.call('POST', `/orders/${g.json.id}/pay`, { method: 'card', acceptTerms: true }, token);
    expect(missing.json.error.code).toBe('attendee_names_required');
    await h.call('PATCH', `/orders/${g.json.id}`, { attendeeNames: ['Emma Hansen', 'Nora Olsen'] }, token);
    const pay = await h.call('POST', `/orders/${g.json.id}/pay`, { method: 'card', acceptTerms: true }, token);
    expect(pay.status).toBe(200);
    const done = await completeDemoPayment(h, token, g.json.id, pay.json.redirectUrl);
    expect(done.json.status).toBe('paid');
    const tickets = (await h.call('GET', '/tickets', undefined, token)).json.tickets.filter((t: any) => t.event.id === galla.event.id);
    expect(tickets.map((t: any) => t.holderName).sort()).toEqual(['Emma Hansen', 'Nora Olsen']);
  });

  it('declined payments return the order to reserved so another method can be used', async () => {
    const h = await makeHarness();
    const token = await h.login('buyer');
    const d = await eventBySlug(h, 'nordfall-live', token);
    const c = await h.call('POST', '/orders', { eventId: d.event.id, items: [{ ticketTypeId: d.ticketTypes[0].id, qty: 1 }] }, token);
    const pay = await h.call('POST', `/orders/${c.json.id}/pay`, { method: 'vipps', acceptTerms: true }, token);
    const declined = await completeDemoPayment(h, token, c.json.id, pay.json.redirectUrl, 'decline');
    expect(declined.json.status).toBe('reserved');
    const pay2 = await h.call('POST', `/orders/${c.json.id}/pay`, { method: 'card', acceptTerms: true }, token);
    const ok = await completeDemoPayment(h, token, c.json.id, pay2.json.redirectUrl);
    expect(ok.json.status).toBe('paid');
  });
});

describe('seats', () => {
  it('reserves chosen seats and refuses taken ones', async () => {
    const h = await makeHarness();
    const token = await h.login('new', 'google', 'Setekjøper');
    const d = await eventBySlug(h, 'russerevyen-siste-skoledag', token);
    expect(d.event.seated).toBe(true);
    const map = (await h.call('GET', `/events/${d.event.id}/seatmap`)).json;
    const free = map.sections[0].rows.flatMap((r: any) => r.seats).filter((s: any) => s.state === 'free').slice(0, 2);
    const taken = map.sections[0].rows.flatMap((r: any) => r.seats).find((s: any) => s.state === 'taken');
    const order = await h.call('POST', '/orders', { eventId: d.event.id, seatIds: free.map((s: any) => s.id) }, token);
    expect(order.status).toBe(201);
    expect(order.json.seats).toHaveLength(2);
    const other = await h.login('buyer');
    const clash = await h.call('POST', '/orders', { eventId: d.event.id, seatIds: [free[0].id] }, other);
    expect(clash.json.error.code).toBe('seat_unavailable');
    const clash2 = await h.call('POST', '/orders', { eventId: d.event.id, seatIds: [taken.id] }, other);
    expect(clash2.json.error.code).toBe('seat_unavailable');
    const noSeats = await h.call('POST', '/orders', { eventId: d.event.id, items: [{ ticketTypeId: d.ticketTypes[0].id, qty: 1 }] }, other);
    expect(noSeats.json.error.code).toBe('seats_required');
    const pay = await h.call('POST', `/orders/${order.json.id}/pay`, { method: 'vipps', acceptTerms: true }, token);
    const done = await completeDemoPayment(h, token, order.json.id, pay.json.redirectUrl);
    expect(done.json.status).toBe('paid');
    const map2 = (await h.call('GET', `/events/${d.event.id}/seatmap`)).json;
    const states = map2.sections[0].rows.flatMap((r: any) => r.seats).filter((s: any) => free.some((f: any) => f.id === s.id)).map((s: any) => s.state);
    expect(states).toEqual(['taken', 'taken']);
  });
});

describe('tickets after purchase', () => {
  it('transfers a ticket with a claim link and rotates the secret', async () => {
    const h = await makeHarness();
    const emma = await h.login('buyer');
    const tickets = (await h.call('GET', '/tickets', undefined, emma)).json.tickets;
    const t = tickets.find((x: any) => x.event.title === 'Russetreff Vest');
    expect(t.canTransfer).toBe(true);
    const tr = await h.call('POST', `/tickets/${t.id}/transfer`, { contact: null, message: 'Kos deg!' }, emma);
    expect(tr.status).toBe(200);
    const token = tr.json.link.split('/overfor/')[1];
    const frozen = (await h.call('GET', `/tickets/${t.id}`, undefined, emma)).json.ticket;
    expect(frozen.secret).toBeNull();
    const preview = await h.call('GET', `/transfers/${token}`);
    expect(preview.json.fromName).toBe('Emma Hansen');
    const self = await h.call('POST', `/transfers/${token}/accept`, {}, emma);
    expect(self.json.error.code).toBe('transfer_self');
    const friend = await h.login('new', 'vipps', 'Venn Venninne');
    const accepted = await h.call('POST', `/transfers/${token}/accept`, {}, friend);
    expect(accepted.status).toBe(200);
    const friendTickets = (await h.call('GET', '/tickets', undefined, friend)).json.tickets;
    expect(friendTickets).toHaveLength(1);
    expect(friendTickets[0].secret).not.toBe(t.secret);
    expect(friendTickets[0].receivedFrom).toBe('Emma Hansen');
    expect(friendTickets[0].canResell).toBe(false);
    const again = await h.call('POST', `/transfers/${token}/accept`, {}, friend);
    expect(again.json.error.code).toBe('transfer_invalid');
  });

  it('sells a ticket through capped resale and pays the seller back', async () => {
    const h = await makeHarness();
    const emma = await h.login('buyer');
    const t = (await h.call('GET', '/tickets', undefined, emma)).json.tickets.find((x: any) => x.event.title === 'Russetreff Vest');
    const tooHigh = await h.call('POST', `/tickets/${t.id}/resale`, { priceOre: t.pricePaidOre + 100 }, emma);
    expect(tooHigh.json.error.code).toBe('resale_price_too_high');
    const listing = await h.call('POST', `/tickets/${t.id}/resale`, { priceOre: 40000 }, emma);
    expect(listing.status).toBe(200);
    const buyer = await h.login('new', 'vipps', 'Kjøper Videresalg');
    const offers = (await h.call('GET', `/events/${t.event.id}/resale`, undefined, buyer)).json.offers;
    const offer = offers.find((o: any) => o.id === listing.json.id);
    expect(offer.priceOre).toBe(40000);
    const order = await h.call('POST', '/orders', { eventId: t.event.id, resaleListingId: offer.id }, buyer);
    expect(order.status).toBe(201);
    expect(order.json.kind).toBe('resale');
    const pay = await h.call('POST', `/orders/${order.json.id}/pay`, { method: 'vipps', acceptTerms: true }, buyer);
    const done = await completeDemoPayment(h, buyer, order.json.id, pay.json.redirectUrl);
    expect(done.json.status).toBe('paid');
    const buyerTickets = (await h.call('GET', '/tickets', undefined, buyer)).json.tickets;
    expect(buyerTickets).toHaveLength(1);
    expect(buyerTickets[0].id).toBe(t.id);
    const emmaTickets = (await h.call('GET', '/tickets', undefined, emma)).json.tickets;
    expect(emmaTickets.find((x: any) => x.id === t.id)).toBeUndefined();
    const sellerOrder = await h.deps.store.read((tx) => tx.get('orders', t.orderId));
    expect(sellerOrder?.refunds.some((r) => r.kind === 'resale_payout' && r.amountOre === 40000)).toBe(true);
  });

  it('lets the buyer refund within the organiser policy', async () => {
    const h = await makeHarness();
    const emma = await h.login('buyer');
    const t = (await h.call('GET', '/tickets', undefined, emma)).json.tickets.find((x: any) => x.event.title === 'Russetreff Vest');
    expect(t.canRefund).toBe(true);
    const typeBefore = await h.deps.store.read((tx) => tx.get('ticketTypes', (t as any).event ? '' : ''));
    void typeBefore;
    const res = await h.call('POST', `/tickets/${t.id}/refund`, {}, emma);
    expect(res.status).toBe(200);
    expect(res.json.refundedOre).toBe(t.pricePaidOre);
    const after = (await h.call('GET', `/tickets/${t.id}`, undefined, emma)).json.ticket;
    expect(after.status).toBe('refunded');
  });
});

describe('check-in', () => {
  it('scans rotating codes, blocks reuse and stale screenshots', async () => {
    const h = await makeHarness();
    const emma = await h.login('buyer');
    const org = await h.login('organizer');
    const t = (await h.call('GET', '/tickets', undefined, emma)).json.tickets.find((x: any) => x.event.title === 'Russetreff Vest');
    const code = await createTicketCode(t.id, t.secret, h.now().getTime());
    const ok = await h.call('POST', '/checkin', { eventId: t.event.id, code, gate: 'Inngang A' }, org);
    expect(ok.status).toBe(200);
    expect(ok.json.result).toBe('ok');
    expect(ok.json.ticket.holderName).toBe('Emma Hansen');
    const again = await h.call('POST', '/checkin', { eventId: t.event.id, code }, org);
    expect(again.json.result).toBe('already_used');

    const t2 = (await h.call('GET', '/tickets', undefined, emma)).json.tickets.find((x: any) => x.event.title === 'Russetreff Vest' && x.id !== t.id);
    const oldCode = await createTicketCode(t2.id, t2.secret, h.now().getTime());
    h.advance(5 * 60_000);
    const stale = await h.call('POST', '/checkin', { eventId: t2.event.id, code: oldCode }, org);
    expect(stale.json.result).toBe('expired_code');

    const revyTicket = (await h.call('GET', '/tickets', undefined, emma)).json.tickets.find((x: any) => x.event.title.startsWith('Russerevyen'));
    const wrong = await h.call('POST', '/checkin', { eventId: t.event.id, code: await createTicketCode(revyTicket.id, revyTicket.secret, h.now().getTime()) }, org);
    expect(wrong.json.result).toBe('wrong_event');

    // Door staff with a scanner code, no account
    const login = await h.call('POST', '/scanner/login', { code: DEMO_SCANNER_CODE });
    expect(login.status).toBe(200);
    const fresh = await createTicketCode(t2.id, t2.secret, h.now().getTime());
    const scan = await h.call('POST', '/checkin', { eventId: t2.event.id, code: fresh }, login.json.token);
    expect(scan.json.result).toBe('ok');
    const forbidden = await h.call('POST', '/checkin', { eventId: revyTicket.event.id, code: 'x.y' }, login.json.token);
    expect(forbidden.status).toBe(403);

    const undo = await h.call('POST', '/checkin/manual', { eventId: t.event.id, ticketId: t.id, undo: true }, org);
    expect(undo.json.result).toBe('undo');
    const stats = await h.call('GET', `/checkin/${t.event.id}/stats`, undefined, org);
    expect(stats.json.checkedIn).toBeGreaterThanOrEqual(1);
  });

  it('refuses buyers without organiser access', async () => {
    const h = await makeHarness();
    const emma = await h.login('buyer');
    const d = await eventBySlug(h, 'russetreff-vest', emma);
    const res = await h.call('POST', '/checkin', { eventId: d.event.id, code: 'TK1.abc' }, emma);
    expect(res.status).toBe(403);
  });
});

describe('organiser tools', () => {
  it('refunds, cancels events with full refunds, issues guest tickets and reports stats', async () => {
    const h = await makeHarness();
    const org = await h.login('organizer');
    const me = (await h.call('GET', '/me', undefined, org)).json.me;
    const orgId = me.organizations.find((o: any) => o.name === 'Nordlys Events').id;
    const events = (await h.call('GET', `/org/${orgId}/events`, undefined, org)).json.events;
    const treff = events.find((e: any) => e.card.title === 'Russetreff Vest');
    expect(treff.sold).toBeGreaterThan(800);

    const dash = await h.call('GET', `/org/${orgId}/dashboard`, undefined, org);
    expect(dash.status).toBe(200);
    expect(dash.json.kpis.revenueOre).toBeGreaterThan(0);

    const guests = await h.call('POST', `/org/${orgId}/events/${treff.card.id}/guests`, { name: 'Gjest Gjestesen', contact: null, ticketTypeId: (await eventBySlug(h, 'russetreff-vest')).ticketTypes[1].id, qty: 2 }, org);
    expect(guests.status).toBe(201);
    expect(guests.json.links).toHaveLength(2);

    const orders = (await h.call('GET', `/org/${orgId}/events/${treff.card.id}/orders`, undefined, org)).json.orders;
    const target = orders.find((o: any) => o.kind === 'standard' && o.tickets >= 2 && o.totalOre > 0);
    const detail = (await h.call('GET', `/org/${orgId}/orders/${target.id}`, undefined, org)).json;
    const one = detail.tickets[0];
    const refund = await h.call('POST', `/org/${orgId}/orders/${target.id}/refund`, { ticketIds: [one.id], includeFees: true, reason: 'Syk' }, org);
    expect(refund.status).toBe(200);
    expect(refund.json.refundedOre).toBe(one.pricePaidOre + detail.order.items[0].feeOre);
    const afterOrder = await h.deps.store.read((tx) => tx.get('orders', target.id));
    expect(afterOrder?.status).toBe('partially_refunded');

    const strand = events.find((e: any) => e.card.title === 'Midnattsfest på stranden');
    const cancel = await h.call('POST', `/org/${orgId}/events/${strand.card.id}/cancel`, { reason: 'Uvær og storm meldt' }, org);
    expect(cancel.status).toBe(200);
    expect(cancel.json.failed).toBe(0);
    const strandOrders = await h.deps.store.read((tx) => tx.find('orders', { eventId: strand.card.id }));
    const paid = strandOrders.filter((o) => o.paidAt);
    expect(paid.every((o) => o.status === 'refunded' && o.refundedOre === o.totalOre)).toBe(true);
    const listings = await h.deps.store.read((tx) => tx.find('resaleListings', { eventId: strand.card.id }));
    expect(listings.every((l) => l.status === 'cancelled')).toBe(true);

    const settlement = await h.call('GET', `/org/${orgId}/settlement`, undefined, org);
    expect(settlement.status).toBe(200);
    const strandRow = settlement.json.events.find((e: any) => e.id === strand.card.id);
    expect(strandRow.netOre).toBe(0);
  });

  it('manages discount codes and scanner codes', async () => {
    const h = await makeHarness();
    const org = await h.login('organizer');
    const orgId = (await h.call('GET', '/me', undefined, org)).json.me.organizations[0].id;
    const events = (await h.call('GET', `/org/${orgId}/events`, undefined, org)).json.events;
    const ev = events.find((e: any) => e.card.status === 'published' && e.card.saleState === 'on_sale');
    const created = await h.call('POST', `/org/${orgId}/events/${ev.card.id}/discounts`, { code: 'venn10', kind: 'percent', value: 10 }, org);
    expect(created.status).toBe(201);
    expect(created.json.code).toBe('VENN10');
    const dup = await h.call('POST', `/org/${orgId}/events/${ev.card.id}/discounts`, { code: 'VENN10', kind: 'fixed', value: 5000 }, org);
    expect(dup.json.error.code).toBe('discount_code_exists');
    const sc = await h.call('POST', `/org/${orgId}/events/${ev.card.id}/scanner-codes`, { label: 'Inngang B' }, org);
    expect(sc.status).toBe(201);
    expect(sc.json.code).toMatch(/^\d{4}-\d{4}-\d{4}$/);
    const login = await h.call('POST', '/scanner/login', { code: sc.json.code });
    expect(login.status).toBe(200);
    await h.call('DELETE', `/org/${orgId}/scanner-codes/${sc.json.scannerCode.id}`, undefined, org);
    const me = await h.call('GET', '/me', undefined, login.json.token);
    expect(me.json.scanner).toBeNull();
  });

  it('lets a new organiser apply and an admin approve', async () => {
    const h = await makeHarness({ config: { demoMode: true } });
    const admin = await h.login('admin');
    const overview = await h.call('GET', '/admin/overview', undefined, admin);
    expect(overview.status).toBe(200);
    const pending = overview.json.pendingOrganizers;
    expect(pending.length).toBe(1);
    const review = await h.call('POST', `/admin/organizers/${pending[0].id}/review`, { status: 'approved', note: null, verified: true }, admin);
    expect(review.json.status).toBe('approved');
    const buyer = await h.login('buyer');
    const forbidden = await h.call('GET', '/admin/overview', undefined, buyer);
    expect(forbidden.status).toBe(403);
  });
});

describe('queue', () => {
  it('gates purchases behind a fair queue', async () => {
    const h = await makeHarness();
    const token = await h.login('new', 'vipps', 'Kø Person');
    const d = await eventBySlug(h, 'rodruss-rave-oslo', token);
    expect(d.event.saleState).toBe('upcoming');
    const joined = await h.call('POST', `/events/${d.event.id}/queue`, {}, token);
    expect(joined.json.status).toBe('before_open');
    h.advance(3 * 60_000 + 1000);
    const noToken = await h.call('POST', '/orders', { eventId: d.event.id, items: [{ ticketTypeId: d.ticketTypes[0].id, qty: 1 }] }, token);
    expect(noToken.json.error.code).toBe('queue_required');
    let status = (await h.call('GET', `/events/${d.event.id}/queue`, undefined, token)).json.status;
    expect(['waiting', 'admitted']).toContain(status.status);
    for (let i = 0; i < 10 && status.status !== 'admitted'; i++) {
      h.advance(30_000);
      status = (await h.call('GET', `/events/${d.event.id}/queue`, undefined, token)).json.status;
    }
    expect(status.status).toBe('admitted');
    const ok = await h.call('POST', '/orders', { eventId: d.event.id, items: [{ ticketTypeId: d.ticketTypes[0].id, qty: 2 }], queueToken: status.token }, token);
    expect(ok.status).toBe(201);
  });
});

describe('security', () => {
  it('requires the CSRF header for cookie-authenticated writes', async () => {
    const h = await makeHarness();
    const login = await h.call('POST', '/auth/demo', { provider: 'vipps', persona: 'buyer' });
    const cookie = `tikit_sid=${login.json.token}`;
    const noHeader = await h.call('POST', '/me/notifications/read', {}, null, { cookie, 'x-tikit': '' });
    expect(noHeader.status).toBe(403);
    expect(noHeader.json.error.code).toBe('csrf');
    const withHeader = await h.call('POST', '/me/notifications/read', {}, null, { cookie, 'x-tikit': '1' });
    expect(withHeader.status).toBe(200);
  });

  it('hides demo endpoints outside demo mode and validates input', async () => {
    const h = await makeHarness({ config: { demoMode: false } });
    const r = await h.call('POST', '/auth/demo', { provider: 'vipps', persona: 'buyer' });
    expect(r.status).toBe(404);
    const bad = await h.call('GET', '/events?category=ukjent');
    expect(bad.status).toBe(422);
    const unauth = await h.call('GET', '/tickets');
    expect(unauth.status).toBe(401);
  });
});
