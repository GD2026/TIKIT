import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createVippsPayments, mapVippsState } from '../../src/node/payments';
import { loadConfig } from '../../src/node/config';
import type { Logger } from '../../src/server/adapters/types';

const quiet: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const NOK = (value: number) => ({ currency: 'NOK', value });

describe('Vipps ePayment state mapping', () => {
  it('maps states and aggregates', () => {
    expect(mapVippsState({ reference: 'r', state: 'CREATED' }).state).toBe('pending');
    expect(mapVippsState({ reference: 'r', state: 'ABORTED' }).state).toBe('cancelled');
    expect(mapVippsState({ reference: 'r', state: 'TERMINATED' }).state).toBe('cancelled');
    expect(mapVippsState({ reference: 'r', state: 'EXPIRED' }).state).toBe('expired');
    const authorized = mapVippsState({ reference: 'r', state: 'AUTHORIZED', aggregate: { authorizedAmount: NOK(94000), capturedAmount: NOK(0), refundedAmount: NOK(0), cancelledAmount: NOK(0) } });
    expect(authorized).toEqual({ state: 'authorized', authorizedOre: 94000, capturedOre: 0, refundedOre: 0 });
    expect(mapVippsState({ reference: 'r', state: 'AUTHORIZED', aggregate: { authorizedAmount: NOK(94000), capturedAmount: NOK(94000) } }).state).toBe('captured');
    expect(mapVippsState({ reference: 'r', state: 'AUTHORIZED', aggregate: { authorizedAmount: NOK(94000), capturedAmount: NOK(94000), refundedAmount: NOK(94000) } }).state).toBe('refunded');
    expect(mapVippsState({ reference: 'r', state: 'AUTHORIZED', aggregate: { authorizedAmount: NOK(94000), cancelledAmount: NOK(94000) } }).state).toBe('cancelled');
  });
});

describe('Vipps webhook signature', () => {
  const secret = '090a478d-37ff-4e77-970e-d457aeb26a3a';
  const adapter = createVippsPayments(
    { baseUrl: 'https://apitest.vipps.no', clientId: 'c', clientSecret: 's', subscriptionKey: 'k', merchantSerialNumber: '123456', webhookSecret: secret, publicUrl: 'https://tikit.example' },
    quiet,
    async () => new Response('{}'),
  );

  function signedRequest(body: string, opts: { host?: string; tamperBody?: boolean; path?: string } = {}) {
    const host = opts.host ?? 'tikit.example';
    const path = opts.path ?? '/api/webhooks/vipps';
    const date = 'Thu, 01 Oct 2026 18:00:00 GMT';
    const hash = createHash('sha256').update(body).digest('base64');
    const signature = createHmac('sha256', secret).update(`POST\n${path}\n${date};${host};${hash}`).digest('base64');
    const request = new Request(`http://internal:8787${path}`, {
      method: 'POST',
      headers: {
        host: 'internal:8787', // a proxy may rewrite Host – the public host is what Vipps signed
        'x-ms-date': date,
        'x-ms-content-sha256': hash,
        authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`,
        'content-type': 'application/json',
      },
      body,
    });
    return { request, raw: opts.tamperBody ? body.replace('tikit-', 'evil-') : body };
  }

  it('accepts a correctly signed event and returns its reference', async () => {
    const body = JSON.stringify({ msn: '123456', reference: 'tikit-AbCdEfGhIjKlMnOp', name: 'AUTHORIZED', amount: NOK(94000), success: true });
    const { request, raw } = signedRequest(body);
    expect(await adapter.handleWebhook!(request, raw)).toEqual({ providerRef: 'tikit-AbCdEfGhIjKlMnOp' });
  });

  it('rejects a changed body, a wrong host and a missing signature', async () => {
    const body = JSON.stringify({ reference: 'tikit-AbCdEfGhIjKlMnOp', name: 'CAPTURED' });
    const tampered = signedRequest(body, { tamperBody: true });
    expect(await adapter.handleWebhook!(tampered.request, tampered.raw)).toBeNull();
    const wrongHost = signedRequest(body, { host: 'attacker.example' });
    expect(await adapter.handleWebhook!(wrongHost.request, wrongHost.raw)).toBeNull();
    const bare = new Request('https://tikit.example/api/webhooks/vipps', { method: 'POST', body });
    expect(await adapter.handleWebhook!(bare, body)).toBeNull();
  });
});

describe('server configuration', () => {
  const prod = {
    NODE_ENV: 'production',
    PUBLIC_URL: 'https://tikit.example',
    SESSION_SECRET: 'x'.repeat(48),
    DATABASE_URL: 'postgres://tikit@db.internal/tikit',
    GOOGLE_CLIENT_ID: 'g',
    GOOGLE_CLIENT_SECRET: 'gs',
    RESEND_API_KEY: 're_x',
    MAIL_FROM: 'TIKIT <billetter@tikit.example>',
  };

  it('accepts a minimal production setup and keeps demo mode off', () => {
    const cfg = loadConfig(prod);
    expect(cfg.production).toBe(true);
    expect(cfg.demoMode).toBe(false);
    expect(cfg.publicUrl).toBe('https://tikit.example');
  });

  it('refuses unsafe production settings', () => {
    expect(() => loadConfig({ ...prod, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...prod, PUBLIC_URL: 'http://tikit.example' })).toThrow(/https/);
    expect(() => loadConfig({ ...prod, PUBLIC_URL: 'https://tikit.example/app' })).toThrow(/uten sti/);
    expect(() => loadConfig({ ...prod, GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' })).toThrow(/innloggingsmetode/);
    expect(() => loadConfig({ ...prod, MAIL_FROM: '' })).toThrow(/MAIL_FROM/);
    expect(() => loadConfig({ ...prod, RESEND_API_KEY: '' })).toThrow(/RESEND_API_KEY/);
    expect(() => loadConfig({ ...prod, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
    expect(loadConfig({ ...prod, DATABASE_URL: '', ALLOW_EMBEDDED_DB: 'true' }).production).toBe(true);
  });

  it('only uses the public development session key when NODE_ENV says development or test', () => {
    expect(loadConfig({ NODE_ENV: 'development' }).sessionSecret).toMatch(/^dev-only/);
    expect(loadConfig({}).sessionSecret).toMatch(/^dev-only/);
    expect(() => loadConfig({ NODE_ENV: 'staging', PUBLIC_URL: 'https://tikit.example' })).toThrow(/SESSION_SECRET/);
  });

  it('never mixes demo mode with real providers in production', () => {
    const pureDemo = { NODE_ENV: 'production', PUBLIC_URL: 'https://demo.tikit.example', SESSION_SECRET: 'x'.repeat(48), DEMO_MODE: 'true', ALLOW_EMBEDDED_DB: 'true' };
    expect(loadConfig(pureDemo).demoMode).toBe(true);
    expect(() => loadConfig({ ...pureDemo, GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 'gs' })).toThrow(/DEMO_MODE/);
    expect(() => loadConfig({ ...pureDemo, STRIPE_SECRET_KEY: 'sk_live_x' })).toThrow(/DEMO_MODE/);
  });

  it('requires payment webhooks in production and falls back to the Render URL', () => {
    const keys = { VIPPS_CLIENT_ID: 'a', VIPPS_CLIENT_SECRET: 'b', VIPPS_SUBSCRIPTION_KEY: 'c', VIPPS_MSN: '123456', VIPPS_ENV: 'production' };
    expect(() => loadConfig({ ...prod, ...keys })).toThrow(/VIPPS_WEBHOOK_SECRET/);
    expect(loadConfig({ ...prod, ...keys, VIPPS_WEBHOOK_SECRET: 'w' }).vipps).not.toBeNull();
    expect(() => loadConfig({ ...prod, STRIPE_SECRET_KEY: 'sk_live_x' })).toThrow(/STRIPE_WEBHOOK_SECRET/);
    expect(loadConfig({ ...prod, PUBLIC_URL: '', RENDER_EXTERNAL_URL: 'https://tikit.onrender.com' }).publicUrl).toBe('https://tikit.onrender.com');
  });

  it('builds the Vipps endpoints for the chosen environment', () => {
    const keys = { VIPPS_CLIENT_ID: 'a', VIPPS_CLIENT_SECRET: 'b', VIPPS_SUBSCRIPTION_KEY: 'c', VIPPS_MSN: '123456' };
    expect(loadConfig({ ...prod, ...keys, VIPPS_ENV: 'production', VIPPS_WEBHOOK_SECRET: 'w' }).vipps?.issuer).toBe('https://api.vipps.no/access-management-1.0/access/');
    expect(loadConfig({ ...keys }).vipps?.baseUrl).toBe('https://apitest.vipps.no');
    expect(loadConfig({ VIPPS_CLIENT_ID: 'a' }).vipps).toBeNull();
  });
});
