import { describe, expect, it, vi } from 'vitest';
import { makeHarness, type Harness } from './harness';
import type { AppleNativeAdapter, ExternalProfile, OAuthAdapter } from '../../src/server/adapters/types';
import { challengeFor } from '../../src/server/services/nativeAuth';
import { sha256Hex } from '../../src/shared/encoding';

/**
 * What the iOS app and App Review need from the API: login hand-off to the app, native Sign in with Apple
 * (and revoking it on account deletion), App Review access, and content moderation (Guideline 1.2).
 */

const VERIFIER = 'v'.repeat(20) + 'Abc_123-xyz' + 'w'.repeat(20);

function fakeGoogle(profile: Partial<ExternalProfile> = {}): OAuthAdapter {
  return {
    provider: 'google',
    responseMode: 'query',
    usesPkce: true,
    async createAuthorizationUrl({ state }) {
      return `https://accounts.example/auth?state=${state}`;
    },
    async finishAuthorization() {
      return {
        provider: 'google',
        subject: 'g-123',
        email: 'kari@example.no',
        emailVerified: true,
        name: 'Kari Nordmann',
        phone: null,
        phoneVerified: false,
        birthdate: null,
        birthdateVerified: false,
        demo: false,
        ...profile,
      };
    },
  };
}

/** Runs a browser login the way ASWebAuthenticationSession does and returns the code handed to the app. */
async function nativeBrowserLogin(h: Harness, query: string): Promise<URL> {
  const start = await h.call('GET', `/auth/login/google?${query}`);
  expect(start.status).toBe(302);
  const cookie = start.headers.get('set-cookie')!.split(';')[0]!;
  const cb = await h.call('GET', '/auth/callback/google?code=abc&state=x', undefined, null, { cookie });
  expect(cb.status).toBe(303);
  const location = new URL(cb.headers.get('location')!);
  expect(location.protocol).toBe('tikit:');
  expect(location.host + location.pathname).toBe('auth/callback');
  return location;
}

describe('iOS app login hand-off', () => {
  it('hands the app a one-time code that only the holder of the verifier can exchange', async () => {
    const h = await makeHarness({ config: { native: { urlScheme: 'tikit', trustedOrigins: ['capacitor://localhost'] } } });
    h.deps.oauth.google = fakeGoogle();
    const challenge = await challengeFor(VERIFIER);

    // Wrong verifier: refused, and the code is gone afterwards (single use).
    const first = await nativeBrowserLogin(h, `native=${challenge}&returnTo=/billetter`);
    const code = first.searchParams.get('code')!;
    expect((await h.call('POST', '/auth/native/exchange', { code, verifier: 'x'.repeat(43) })).status).toBe(400);
    expect((await h.call('POST', '/auth/native/exchange', { code, verifier: VERIFIER })).status).toBe(400);

    const second = await nativeBrowserLogin(h, `native=${challenge}&returnTo=/billetter`);
    const ok = await h.call('POST', '/auth/native/exchange', { code: second.searchParams.get('code'), verifier: VERIFIER });
    expect(ok.status).toBe(200);
    expect(ok.json.returnTo).toBe('/billetter');
    const me = await h.call('GET', '/me', undefined, ok.json.token);
    expect(me.json.me.name).toBe('Kari Nordmann');
  });

  it('expires codes after two minutes', async () => {
    const h = await makeHarness();
    h.deps.oauth.google = fakeGoogle();
    const loc = await nativeBrowserLogin(h, `native=${await challengeFor(VERIFIER)}`);
    h.advance(3 * 60_000);
    expect((await h.call('POST', '/auth/native/exchange', { code: loc.searchParams.get('code'), verifier: VERIFIER })).status).toBe(400);
  });

  it('links a login method from the app only for the signed-in account that asked', async () => {
    const h = await makeHarness();
    h.deps.oauth.google = fakeGoogle({ subject: 'g-emma', email: 'emma.google@example.no' });
    const emma = await h.login('buyer');
    const jonas = await h.login('organizer');
    const challenge = await challengeFor(VERIFIER);
    const ticket = (await h.call('POST', '/auth/native/link-ticket', { challenge }, emma)).json.ticket as string;

    // Someone else's session can't complete Emma's link.
    const stolen = await nativeBrowserLogin(h, `mode=link&native=${challenge}&linkTicket=${encodeURIComponent(ticket)}`);
    expect((await h.call('POST', '/auth/native/exchange', { code: stolen.searchParams.get('code'), verifier: VERIFIER }, jonas)).status).toBe(401);

    const loc = await nativeBrowserLogin(h, `mode=link&native=${challenge}&linkTicket=${encodeURIComponent(ticket)}`);
    const res = await h.call('POST', '/auth/native/exchange', { code: loc.searchParams.get('code'), verifier: VERIFIER }, emma);
    expect(res.status).toBe(200);
    expect(res.json.linked).toBe(true);
    expect(res.json.me.providers).toContain('google');
  });

  it('refuses a link ticket bound to another challenge', async () => {
    const h = await makeHarness();
    h.deps.oauth.google = fakeGoogle();
    const emma = await h.login('buyer');
    const ticket = (await h.call('POST', '/auth/native/link-ticket', { challenge: await challengeFor(VERIFIER) }, emma)).json.ticket as string;
    const other = await challengeFor('o'.repeat(43));
    const start = await h.call('GET', `/auth/login/google?mode=link&native=${other}&linkTicket=${encodeURIComponent(ticket)}`);
    expect(start.status).toBe(302);
    expect(start.headers.get('location')).toContain('/logg-inn?feil=unauthorized');
  });
});

describe('native Sign in with Apple', () => {
  function fakeApple(): AppleNativeAdapter & { verify: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> } {
    return {
      nativeSignIn: true,
      verify: vi.fn(async () => ({
        provider: 'apple' as const,
        subject: 'apple-001',
        email: 'x1@privaterelay.appleid.com',
        emailVerified: true,
        name: 'Ola Apple',
        phone: null,
        phoneVerified: false,
        birthdate: null,
        birthdateVerified: false,
        demo: false,
        revocation: { clientId: 'no.tikit.app', token: 'refresh-1' },
      })),
      revoke: vi.fn(async () => {}),
    };
  }

  it('signs in with a server-issued nonce and revokes the grant when the account is deleted', async () => {
    const h = await makeHarness();
    const apple = fakeApple();
    h.deps.appleNative = apple;
    expect((await h.call('GET', '/config')).json.appleNative).toBe(true);

    const { nonce } = (await h.call('POST', '/auth/native/apple/nonce', {})).json;
    const res = await h.call('POST', '/auth/native/apple', { nonce, identityToken: 'header.payload.signature-000000', authorizationCode: 'c-1', givenName: 'Ola', familyName: 'Apple' });
    expect(res.status).toBe(200);
    expect(apple.verify).toHaveBeenCalledWith(expect.objectContaining({ expectedNonceHash: await sha256Hex(nonce), authorizationCode: 'c-1' }));

    // The refresh token is stored encrypted, never in the clear.
    const identity = await h.deps.store.read((tx) => tx.findOne('identities', { provider: 'apple', subject: 'apple-001' }));
    expect(identity?.revocation).toMatch(/^v1\./);
    expect(JSON.stringify(identity)).not.toContain('refresh-1');

    expect((await h.call('DELETE', '/me', undefined, res.json.token)).status).toBe(200);
    await vi.waitFor(() => expect(apple.revoke).toHaveBeenCalledWith('no.tikit.app', 'refresh-1'));
  });

  it('rejects a nonce the server did not issue', async () => {
    const h = await makeHarness();
    h.deps.appleNative = fakeApple();
    const res = await h.call('POST', '/auth/native/apple', { nonce: 'made-up-nonce-123', identityToken: 'header.payload.signature-000000' });
    expect(res.status).toBe(400);
  });
});

describe('App Review access', () => {
  const review = { email: 'appreview@tikit.no', code: 'review-code-0123456789' };

  it('is off unless configured', async () => {
    const h = await makeHarness();
    expect((await h.call('GET', '/config')).json.reviewLogin).toBe(false);
    expect((await h.call('POST', '/auth/review', { code: review.code })).status).toBe(404);
  });

  it('signs in to the review account with the right code only', async () => {
    const h = await makeHarness({ config: { review } });
    expect((await h.call('GET', '/config')).json.reviewLogin).toBe(true);
    expect((await h.call('POST', '/auth/review', { code: 'wrong' })).status).toBe(400);
    const ok = await h.call('POST', '/auth/review', { code: review.code });
    expect(ok.status).toBe(200);
    expect(ok.json.me.email).toBe(review.email);
    expect(ok.json.me.role).toBe('user');
  });

  it('never signs in to an admin account', async () => {
    const h = await makeHarness({ config: { review: { ...review, email: 'admin@tikit.example' } } });
    expect((await h.call('POST', '/auth/review', { code: review.code })).status).toBe(403);
  });
});

describe('content moderation (Guideline 1.2)', () => {
  async function jonasEvent(h: Harness, jonas: string) {
    const me = (await h.call('GET', '/me', undefined, jonas)).json.me;
    const org = me.organizations.find((o: any) => o.status === 'approved');
    const page = (await h.call('GET', `/organizers/${org.slug}`)).json;
    const card = page.events[0];
    const detail = (await h.call('GET', `/events/${card.slug}`)).json;
    return { orgId: org.id as string, orgSlug: org.slug as string, eventId: detail.event.id as string, slug: card.slug as string };
  }

  it('lets anyone report, e-mails support and lets an admin take the event down and restore it', async () => {
    const h = await makeHarness({ config: { supportEmail: 'support@tikit.no' } });
    const jonas = await h.login('organizer');
    const admin = await h.login('admin');
    const ev = await jonasEvent(h, jonas);

    const report = await h.call('POST', '/reports', { kind: 'event', targetId: ev.eventId, reason: 'offensive', message: 'Stygt språk i beskrivelsen' });
    expect(report.status).toBe(201);
    const mail = await h.deps.store.read((tx) => tx.find('outbox'));
    expect(mail.some((m) => m.to === 'support@tikit.no' && m.subject.startsWith('Ny rapport'))).toBe(true);

    const queue = (await h.call('GET', '/admin/reports?status=open', undefined, admin)).json.reports;
    const row = queue.find((r: any) => r.targetId === ev.eventId);
    expect(row.reasonLabel).toBe('Støtende eller hatefullt innhold');
    expect(row.targetState).toBe('visible');

    // Only admins see the queue.
    expect((await h.call('GET', '/admin/reports', undefined, jonas)).status).toBe(403);

    expect((await h.call('POST', `/admin/reports/${row.id}/resolve`, { action: 'takedown', note: 'Brudd på vilkårene' }, admin)).status).toBe(200);
    expect((await h.call('GET', `/events/${ev.slug}`)).status).toBe(404);
    expect((await h.call('GET', '/events')).json.events.some((e: any) => e.slug === ev.slug)).toBe(false);
    const publish = await h.call('POST', `/org/${ev.orgId}/events/${ev.eventId}/publish`, {}, jonas);
    expect(publish.status).toBe(403);
    expect((await h.call('GET', '/admin/reports?status=open', undefined, admin)).json.reports.some((r: any) => r.targetId === ev.eventId)).toBe(false);

    expect((await h.call('POST', `/admin/events/${ev.eventId}/restore`, {}, admin)).status).toBe(200);
    expect((await h.call('POST', `/org/${ev.orgId}/events/${ev.eventId}/publish`, {}, jonas)).status).toBe(200);
    expect((await h.call('GET', `/events/${ev.slug}`)).status).toBe(200);
  });

  it('lets a person hide an organizer from their feeds and search, and undo it', async () => {
    const h = await makeHarness();
    const jonas = await h.login('organizer');
    const emma = await h.login('buyer');
    const ev = await jonasEvent(h, jonas);
    const has = async () => {
      const home = (await h.call('GET', '/home', undefined, emma)).json.sections.flatMap((s: any) => s.events);
      const all = (await h.call('GET', '/events', undefined, emma)).json.events;
      return [...home, ...all].some((e: any) => e.organizerSlug === ev.orgSlug);
    };
    expect(await has()).toBe(true);

    expect((await h.call('POST', `/organizers/${ev.orgId}/block`, {}, emma)).status).toBe(200);
    expect(await has()).toBe(false);
    const page = (await h.call('GET', `/organizers/${ev.orgSlug}`, undefined, emma)).json;
    expect(page.blocked).toBe(true);
    expect(page.events.length).toBeGreaterThan(0);
    expect((await h.call('GET', '/me/blocked', undefined, emma)).json.organizers.map((o: any) => o.slug)).toContain(ev.orgSlug);
    // Others are not affected.
    expect((await h.call('GET', '/events')).json.events.some((e: any) => e.organizerSlug === ev.orgSlug)).toBe(true);

    expect((await h.call('DELETE', `/organizers/${ev.orgId}/block`, undefined, emma)).status).toBe(200);
    expect(await has()).toBe(true);
  });
});

describe('the iOS app as an API client', () => {
  it('accepts requests from the app web view origin in production, and nothing else', async () => {
    const h = await makeHarness({ config: { production: true, native: { urlScheme: 'tikit', trustedOrigins: ['capacitor://localhost'] } } });
    const ev = (await h.call('GET', '/events')).json.events[0];
    const eventId = (await h.call('GET', `/events/${ev.slug}`)).json.event.id;
    const body = { kind: 'event', targetId: eventId, reason: 'other' };
    expect((await h.call('POST', '/reports', body, null, { origin: 'capacitor://localhost' })).status).toBe(201);
    expect((await h.call('POST', '/reports', body, null, { origin: 'https://evil.example' })).status).toBe(403);
  });

  it('sends buyers paying in the app back through the /app universal link', async () => {
    const h = await makeHarness();
    const emma = await h.login('buyer');
    const ev = (await h.call('GET', '/events/russetreff-vest')).json;
    const type = ev.ticketTypes.find((t: any) => t.state === 'on_sale');
    const order = await h.call('POST', '/orders', { eventId: ev.event.id, items: [{ ticketTypeId: type.id, qty: 1 }] }, emma);
    expect(order.status).toBe(201);
    const pay = await h.call('POST', `/orders/${order.json.id}/pay`, { method: 'vipps', acceptTerms: true, client: 'ios' }, emma);
    expect(pay.status).toBe(200);
    const docs = await h.deps.store.read((tx) => tx.find('kv'));
    const demo = docs.filter((d) => d.id.startsWith('demopay:')).map((d) => d.value as { returnUrl: string; cancelUrl: string });
    const mine = demo.find((v) => v.returnUrl.includes(order.json.id));
    expect(mine?.returnUrl).toBe(`http://localhost:5173/app/ordre/${order.json.id}?retur=1`);
    expect(mine?.cancelUrl).toBe(`http://localhost:5173/app/kasse/${order.json.id}?avbrutt=1`);
  });
});
