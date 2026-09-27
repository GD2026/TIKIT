import { describe, expect, it } from 'vitest';
import { completeDemoPayment, makeHarness, type Harness } from './harness';
import { createTicketCode } from '../../src/shared/qr';
import { readDemoPayment } from '../../src/server/adapters/demo';
import { runDuePaymentJobs } from '../../src/server/services/paymentJobs';

/** Regression tests for the problems found in the pre-launch review (money, access, door). */

async function emmaTicket(h: Harness, token: string, title = 'Russetreff Vest') {
  const tickets = (await h.call('GET', '/tickets', undefined, token)).json.tickets;
  return tickets.find((x: any) => x.event.title === title && x.status === 'valid');
}

async function nordlys(h: Harness, token: string) {
  const me = (await h.call('GET', '/me', undefined, token)).json.me;
  return me.organizations.find((o: any) => o.name === 'Nordlys Events');
}

async function createEvent(h: Harness, token: string, orgId: string, maxPerOrder = 4) {
  const start = new Date(h.now().getTime() + 10 * 86_400_000);
  const ev = await h.call(
    'POST',
    `/org/${orgId}/events`,
    {
      event: {
        title: 'Grensetest',
        category: 'fest',
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + 4 * 3_600_000).toISOString(),
        venue: { name: 'Testsalen', city: 'Stavanger' },
        poster: { style: 'aurora', palette: 'blatime', seed: 1 },
        settings: {
          maxPerOrder,
          personalizedTickets: false,
          transfersAllowed: true,
          resaleAllowed: true,
          refundPolicy: 'none',
          queueEnabled: false,
          queueRatePerMinute: 100,
          waitlistEnabled: false,
          showRemaining: true,
          requireVerifiedAge: false,
        },
      },
      ticketTypes: [{ name: 'Inngang', priceOre: 30000, capacity: 100 }],
    },
    token,
  );
  expect(ev.status).toBe(201);
  await h.call('POST', `/org/${orgId}/events/${ev.json.id}/publish`, {}, token);
  const typeId = (await h.call('GET', `/events/${ev.json.slug}`)).json.ticketTypes[0].id as string;
  return { eventId: ev.json.id as string, typeId };
}

describe('door', () => {
  it('only accepts a bare ticket number when staff type it in, and then asks for ID', async () => {
    const h = await makeHarness();
    const emma = await h.login('buyer');
    const org = await h.login('organizer');
    const t = await emmaTicket(h, emma);
    const qrWithNumber = await h.call('POST', '/checkin', { eventId: t.event.id, code: t.number }, org);
    expect(qrWithNumber.json.result).toBe('invalid');
    const typed = await h.call('POST', '/checkin', { eventId: t.event.id, code: t.number, manual: true }, org);
    expect(typed.json.result).toBe('ok');
    expect(typed.json.warning).toMatch(/legitimasjon/);
  });

  it('gives a transferred ticket a new number, so the old one stops working', async () => {
    const h = await makeHarness();
    const emma = await h.login('buyer');
    const org = await h.login('organizer');
    const t = await emmaTicket(h, emma);
    const tr = await h.call('POST', `/tickets/${t.id}/transfer`, { contact: null, message: null }, emma);
    const friend = await h.login('new', 'vipps', 'Venn Venninne');
    await h.call('POST', `/transfers/${tr.json.link.split('/overfor/')[1]}/accept`, {}, friend);
    const received = (await h.call('GET', '/tickets', undefined, friend)).json.tickets[0];
    expect(received.number).not.toBe(t.number);
    const old = await h.call('POST', '/checkin', { eventId: t.event.id, code: t.number, manual: true }, org);
    expect(old.json.result).toBe('invalid');
    const code = await createTicketCode(received.id, received.secret, h.now().getTime());
    expect((await h.call('POST', '/checkin', { eventId: t.event.id, code }, org)).json.result).toBe('ok');
  });
});

describe('money', () => {
  it('pays out once when the buyer and the organizer refund the same ticket at the same time', async () => {
    const h = await makeHarness();
    const emma = await h.login('buyer');
    const org = await h.login('organizer');
    const orgId = (await nordlys(h, org)).id;
    const t = (await h.call('GET', '/tickets', undefined, emma)).json.tickets.find((x: any) => x.event.title === 'Russetreff Vest' && x.canRefund);
    const order = await h.deps.store.read((tx) => tx.get('orders', t.orderId));
    const payment = await h.deps.store.read((tx) => tx.get('payments', order!.paymentId!));
    const [a, b] = await Promise.all([
      h.call('POST', `/tickets/${t.id}/refund`, {}, emma),
      h.call('POST', `/org/${orgId}/orders/${t.orderId}/refund`, { ticketIds: [t.id], includeFees: true, reason: 'Syk' }, org),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
    const provider = await readDemoPayment(h.deps.store, payment!.providerRef);
    const after = await h.deps.store.read((tx) => tx.get('orders', t.orderId));
    expect(provider!.refundedOre).toBe(after!.refundedOre - order!.refundedOre);
    expect(after!.refunds.filter((r) => r.kind === 'ticket')).toHaveLength(1);
  });

  it('keeps retrying a refund the provider rejected until it goes through', async () => {
    const h = await makeHarness();
    const emma = await h.login('buyer');
    const t = (await h.call('GET', '/tickets', undefined, emma)).json.tickets.find((x: any) => x.event.title === 'Russetreff Vest' && x.canRefund);
    const vipps = h.deps.payments.vipps!;
    const realRefund = vipps.refund.bind(vipps);
    let failures = 1;
    vipps.refund = async (...args) => {
      if (failures-- > 0) throw new Error('Vipps 503');
      return realRefund(...args);
    };
    const res = await h.call('POST', `/tickets/${t.id}/refund`, {}, emma);
    expect(res.status).toBe(200);
    let jobs = await h.deps.store.read((tx) => tx.find('paymentJobs', {}));
    expect(jobs.map((j) => [j.status, j.attempts])).toEqual([['pending', 1]]);
    h.advance(2 * 60_000);
    expect(await runDuePaymentJobs(h.deps)).toBe(1);
    jobs = await h.deps.store.read((tx) => tx.find('paymentJobs', {}));
    expect(jobs[0]!.status).toBe('done');
    const payment = await h.deps.store.read((tx) => tx.get('payments', jobs[0]!.paymentId));
    expect(payment!.refundedOre).toBe(res.json.refundedOre);
  });

  it('closes a superseded payment at the provider so it cannot be paid as well', async () => {
    const h = await makeHarness();
    const org = await h.login('organizer');
    const { eventId, typeId } = await createEvent(h, org, (await nordlys(h, org)).id);
    const buyer = await h.login('new', 'vipps', 'Betal Toganger');
    const o = await h.call('POST', '/orders', { eventId, items: [{ ticketTypeId: typeId, qty: 1 }] }, buyer);
    const first = await h.call('POST', `/orders/${o.json.id}/pay`, { method: 'card', acceptTerms: true }, buyer);
    const firstRef = decodeURIComponent(first.json.redirectUrl.split('/demo/betal/')[1]);
    const second = await h.call('POST', `/orders/${o.json.id}/pay`, { method: 'vipps', acceptTerms: true }, buyer);
    expect((await readDemoPayment(h.deps.store, firstRef))!.state).toBe('cancelled');
    const done = await completeDemoPayment(h, buyer, o.json.id, second.json.redirectUrl);
    expect(done.json.status).toBe('paid');
  });

  it('limits tickets per person across orders, not just per order', async () => {
    const h = await makeHarness();
    const org = await h.login('organizer');
    const { eventId, typeId } = await createEvent(h, org, (await nordlys(h, org)).id, 4);
    const buyer = await h.login('new', 'vipps', 'Hamstre Hansen');
    expect((await h.call('POST', '/orders', { eventId, items: [{ ticketTypeId: typeId, qty: 3 }] }, buyer)).status).toBe(201);
    const more = await h.call('POST', '/orders', { eventId, items: [{ ticketTypeId: typeId, qty: 2 }] }, buyer);
    expect(more.json.error.code).toBe('too_many_tickets');
    expect((await h.call('POST', '/orders', { eventId, items: [{ ticketTypeId: typeId, qty: 1 }] }, buyer)).status).toBe(201);
  });

  it('never holds tickets past the ceiling by paying again and again', async () => {
    const h = await makeHarness();
    const org = await h.login('organizer');
    const { eventId, typeId } = await createEvent(h, org, (await nordlys(h, org)).id);
    const buyer = await h.login('new', 'vipps', 'Holde Holm');
    const o = await h.call('POST', '/orders', { eventId, items: [{ ticketTypeId: typeId, qty: 1 }] }, buyer);
    h.advance(9 * 60_000);
    expect((await h.call('POST', `/orders/${o.json.id}/pay`, { method: 'vipps', acceptTerms: true }, buyer)).status).toBe(200);
    h.advance(19 * 60_000);
    const again = await h.call('POST', `/orders/${o.json.id}/pay`, { method: 'vipps', acceptTerms: true }, buyer);
    expect(again.status).toBe(200);
    expect(Date.parse(again.json.order.expiresAt)).toBeLessThanOrEqual(Date.parse(o.json.createdAt) + 30 * 60_000);
    h.advance(3 * 60_000);
    const late = await h.call('POST', `/orders/${o.json.id}/pay`, { method: 'vipps', acceptTerms: true }, buyer);
    expect(late.json.error.code).toBe('order_expired');
  });
});

describe('access', () => {
  it('does not export another organizer’s attendees through an organizer the caller owns', async () => {
    const h = await makeHarness();
    const owner = await h.login('organizer');
    const n = await nordlys(h, owner);
    const ev = (await h.call('GET', `/org/${n.id}/events`, undefined, owner)).json.events.find((e: any) => e.card.title === 'Russetreff Vest');
    const staff = await h.login('new', 'apple', 'Dora Dørvakt');
    const staffMe = (await h.call('GET', '/me', undefined, staff)).json.me;
    await h.call('POST', `/org/${n.id}/team`, { email: staffMe.email, role: 'staff' }, owner);
    const own = await h.call('POST', '/org', { name: 'Doras Org', type: 'russ', email: 'dora@example.no', description: '' }, staff);
    expect(own.status).toBe(201);
    for (const path of ['attendees', 'attendees.csv']) {
      const leak = await h.call('GET', `/org/${own.json.id}/events/${ev.card.id}/${path}`, undefined, staff);
      expect(leak.status).toBe(404);
    }
    const staffView = await h.call('GET', `/org/${n.id}/events/${ev.card.id}/attendees`, undefined, staff);
    expect(staffView.status).toBe(200);
    expect(staffView.json.attendees.every((a: any) => a.buyerEmail === null && a.buyerPhone === null)).toBe(true);
    const events = (await h.call('GET', `/org/${n.id}/events`, undefined, staff)).json.events;
    expect(events.every((e: any) => e.revenueOre === 0)).toBe(true);
  });

  it('ties Vipps age verification to the verified name and drops it when Vipps is unlinked', async () => {
    const h = await makeHarness();
    const emma = await h.login('buyer');
    const me = (await h.call('GET', '/me', undefined, emma)).json.me;
    expect(me.birthdateVerified).toBe(true);
    const rename = await h.call('PATCH', '/me', { name: 'Lille Søster' }, emma);
    expect(rename.status).toBe(403);
    const link = await h.call('POST', '/auth/demo?mode=link', { provider: 'google' }, emma);
    expect(link.status).toBe(200);
    const unlinked = await h.call('DELETE', '/me/identities/vipps', undefined, emma);
    expect(unlinked.status).toBe(200);
    expect(unlinked.json.me.birthdateVerified).toBe(false);
    expect((await h.call('PATCH', '/me', { name: 'Emma Hansen-Berg' }, emma)).status).toBe(200);
  });
});

describe('personvern', () => {
  it('deletes and anonymizes personal data once its retention period has passed', async () => {
    const { applyRetention, ANONYMIZED } = await import('../../src/server/services/retention');
    const h = await makeHarness();
    const emma = await h.login('buyer');
    const t = await emmaTicket(h, emma);
    // Recent data is left alone.
    await applyRetention(h.deps, { force: true });
    expect((await h.deps.store.read((tx) => tx.get('orders', t.orderId)))!.buyer.name).toBe('Emma Hansen');
    // Seven years later nothing personal about the purchase is left – but the order itself (accounting) is.
    h.advance(7 * 365 * 86_400_000);
    await applyRetention(h.deps, { force: true });
    const order = await h.deps.store.read((tx) => tx.get('orders', t.orderId));
    expect(order!.buyer).toEqual({ name: ANONYMIZED, email: null, phone: null });
    expect(order!.totalOre).toBeGreaterThan(0);
    expect((await h.deps.store.read((tx) => tx.get('tickets', t.id)))!.holderName).toBe(ANONYMIZED);
    expect(await h.deps.store.read((tx) => tx.count('notifications'))).toBe(0);
    expect(await h.deps.store.read((tx) => tx.count('checkins'))).toBe(0);
  });
});
