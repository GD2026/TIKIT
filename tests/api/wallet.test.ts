import { describe, expect, it } from 'vitest';
import { makeHarness, type Harness } from './harness';
import type { WalletPassInput } from '../../src/server/adapters/types';

/** The ticket as an Apple/Google Wallet pass: who may fetch it, and that the door accepts its static code. */

async function withWallet() {
  const h = await makeHarness();
  const passes: WalletPassInput[] = [];
  h.deps.wallet = {
    apple: async (input) => {
      passes.push(input);
      return new Uint8Array([0x50, 0x4b, 0x05, 0x06]);
    },
    google: async (input) => {
      passes.push(input);
      return `https://pay.google.com/gp/v/save/${input.serial}`;
    },
  };
  return { h, passes };
}

async function emmaTicket(h: Harness, token: string) {
  const tickets = (await h.call('GET', '/tickets', undefined, token)).json.tickets;
  return tickets.find((x: any) => x.event.title === 'Russetreff Vest' && x.status === 'valid');
}

describe('wallet passes', () => {
  it('is off until the server has wallet keys', async () => {
    const h = await makeHarness();
    const emma = await h.login('buyer');
    expect((await h.call('GET', '/config')).json.wallet).toEqual({ apple: false, google: false });
    const t = await emmaTicket(h, emma);
    expect((await h.call('GET', `/tickets/${t.id}/wallet/apple`, undefined, emma)).status).toBe(404);
  });

  it('gives the owner a pass whose code gets in once, and nobody else a pass', async () => {
    const { h, passes } = await withWallet();
    const emma = await h.login('buyer');
    const org = await h.login('organizer');
    expect((await h.call('GET', '/config')).json.wallet).toEqual({ apple: true, google: true });
    const t = await emmaTicket(h, emma);

    const res = await h.call('GET', `/tickets/${t.id}/wallet/apple`, undefined, emma);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.apple.pkpass');
    const pass = passes[0]!;
    expect(pass).toMatchObject({ ticketId: t.id, number: t.number, eventId: t.event.id, eventTitle: 'Russetreff Vest', holderName: t.holderName, ticketUrl: `http://localhost:5173/billetter/${t.id}` });
    expect(pass.barcode).toMatch(/^TK2\./);
    expect(pass.serial.startsWith(`${t.id}-`)).toBe(true);
    expect(pass.serial).not.toContain(t.secret);

    const google = await h.call('GET', `/tickets/${t.id}/wallet/google`, undefined, emma);
    expect(google.json.url).toBe(`https://pay.google.com/gp/v/save/${pass.serial}`);

    expect((await h.call('GET', `/tickets/${t.id}/wallet/apple`)).status).toBe(401);
    const stranger = await h.login('new', 'vipps', 'Ola Fremmed');
    expect((await h.call('GET', `/tickets/${t.id}/wallet/apple`, undefined, stranger)).status).toBe(404);

    const first = await h.call('POST', '/checkin', { eventId: t.event.id, code: pass.barcode }, org);
    expect(first.json.result).toBe('ok');
    const again = await h.call('POST', '/checkin', { eventId: t.event.id, code: pass.barcode }, org);
    expect(again.json.result).toBe('already_used');
  });

  it('stops the old pass when the ticket is transferred, and gives the new holder a new one', async () => {
    const { h, passes } = await withWallet();
    const emma = await h.login('buyer');
    const org = await h.login('organizer');
    const t = await emmaTicket(h, emma);
    await h.call('GET', `/tickets/${t.id}/wallet/apple`, undefined, emma);
    const old = passes[0]!;

    const tr = await h.call('POST', `/tickets/${t.id}/transfer`, { contact: null, message: null }, emma);
    // While the transfer is pending the ticket has no live code, so no pass either.
    const pending = await h.call('GET', `/tickets/${t.id}/wallet/apple`, undefined, emma);
    expect(pending.status).toBe(400);
    expect(pending.json.error.code).toBe('ticket_busy');
    const friend = await h.login('new', 'vipps', 'Venn Venninne');
    await h.call('POST', `/transfers/${tr.json.link.split('/overfor/')[1]}/accept`, {}, friend);

    const stale = await h.call('POST', '/checkin', { eventId: t.event.id, code: old.barcode }, org);
    expect(stale.json.result).toBe('invalid');

    const received = (await h.call('GET', '/tickets', undefined, friend)).json.tickets[0];
    await h.call('GET', `/tickets/${received.id}/wallet/apple`, undefined, friend);
    const fresh = passes[1]!;
    expect(fresh.serial).not.toBe(old.serial);
    expect(fresh.holderName).toBe('Venn Venninne');
    expect((await h.call('POST', '/checkin', { eventId: t.event.id, code: fresh.barcode }, org)).json.result).toBe('ok');
  });
});
