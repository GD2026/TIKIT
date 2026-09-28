import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import Stripe from 'stripe';
import type { CreatePaymentArgs, Logger, PaymentAdapter, ProviderPaymentStatus } from '../server/adapters/types';
import { VIPPS_SYSTEM_HEADERS, createVippsTokenSource, type VippsApiConfig } from './vippsCommon';

/** Vipps and Stripe accept idempotency keys of limited length and alphabet. */
function idemKey(key: string): string {
  if (/^[A-Za-z0-9-]{1,50}$/.test(key)) return key;
  return `k-${createHash('sha256').update(key).digest('hex').slice(0, 40)}`;
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ── Vipps MobilePay ePayment API ─────────────────────────────────────────────

export interface VippsPaymentConfig extends VippsApiConfig {
  /** Secret returned when the webhook was registered (scripts/register-vipps-webhook.ts). */
  webhookSecret: string | null;
  /** Public origin; its host is what Vipps signs webhook requests with. */
  publicUrl: string;
}

interface VippsAmount {
  currency: string;
  value: number;
}

interface VippsPayment {
  reference: string;
  state: 'CREATED' | 'AUTHORIZED' | 'ABORTED' | 'EXPIRED' | 'TERMINATED';
  aggregate?: {
    authorizedAmount?: VippsAmount;
    cancelledAmount?: VippsAmount;
    capturedAmount?: VippsAmount;
    refundedAmount?: VippsAmount;
  };
}

/** "+4791234567" → "4791234567" (the format ePayment expects), or null when it doesn't look like a phone number. */
function vippsPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, '');
  return /^\d{10,15}$/.test(digits) ? digits : null;
}

export function mapVippsState(p: VippsPayment): ProviderPaymentStatus {
  const a = p.aggregate ?? {};
  const authorized = a.authorizedAmount?.value ?? 0;
  const captured = a.capturedAmount?.value ?? 0;
  const refunded = a.refundedAmount?.value ?? 0;
  const cancelled = a.cancelledAmount?.value ?? 0;
  const base = { authorizedOre: authorized, capturedOre: captured, refundedOre: refunded };
  switch (p.state) {
    case 'CREATED':
      return { state: 'pending', ...base };
    case 'ABORTED':
    case 'TERMINATED':
      return { state: 'cancelled', ...base };
    case 'EXPIRED':
      return { state: 'expired', ...base };
    case 'AUTHORIZED':
      if (captured > 0 && refunded >= captured) return { state: 'refunded', ...base };
      if (captured > 0) return { state: 'captured', ...base };
      // Authorized and then cancelled by us before capture.
      if (cancelled > 0 && cancelled >= authorized) return { state: 'cancelled', ...base };
      return { state: 'authorized', ...base };
    default:
      return { state: 'failed', ...base };
  }
}

export function createVippsPayments(cfg: VippsPaymentConfig, log: Logger, fetchImpl: typeof fetch = fetch): PaymentAdapter {
  const token = createVippsTokenSource(cfg, fetchImpl);

  const call = async <T>(method: 'GET' | 'POST', path: string, body?: unknown, idempotency?: string): Promise<T> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await token()}`,
      'Ocp-Apim-Subscription-Key': cfg.subscriptionKey,
      'Merchant-Serial-Number': cfg.merchantSerialNumber,
      ...VIPPS_SYSTEM_HEADERS,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotency) headers['Idempotency-Key'] = idemKey(idempotency);
    const res = await fetchImpl(`${cfg.baseUrl}/epayment/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 400);
      try {
        const p = JSON.parse(text) as { title?: string; detail?: string };
        detail = [p.title, p.detail].filter(Boolean).join(': ') || detail;
      } catch {
        /* not JSON */
      }
      throw new Error(`Vipps ${method} ${path} → ${res.status}: ${detail}`);
    }
    return (text ? JSON.parse(text) : {}) as T;
  };

  const amount = (value: number): VippsAmount => ({ currency: 'NOK', value });

  return {
    provider: 'vipps',
    method: 'vipps',
    // Tickets are delivered at once, so the reserved amount is captured right after fulfilment.
    needsCapture: true,
    async createPayment(args: CreatePaymentArgs) {
      const phone = vippsPhone(args.customerPhone);
      const res = await call<{ redirectUrl: string; reference: string }>(
        'POST',
        '/payments',
        {
          amount: amount(args.amountOre),
          paymentMethod: { type: 'WALLET' },
          ...(phone ? { customer: { phoneNumber: phone } } : {}),
          reference: args.reference,
          returnUrl: args.returnUrl,
          userFlow: 'WEB_REDIRECT',
          paymentDescription: args.description.slice(0, 100),
        },
        `create-${args.reference}`,
      );
      return { providerRef: res.reference ?? args.reference, redirectUrl: res.redirectUrl };
    },
    async getStatus(ref) {
      return mapVippsState(await call<VippsPayment>('GET', `/payments/${encodeURIComponent(ref)}`));
    },
    async capture(ref, amountOre, key) {
      await call('POST', `/payments/${encodeURIComponent(ref)}/capture`, { modificationAmount: amount(amountOre) }, key);
    },
    async refund(ref, amountOre, key) {
      await call('POST', `/payments/${encodeURIComponent(ref)}/refund`, { modificationAmount: amount(amountOre) }, key);
    },
    async cancel(ref) {
      try {
        await call('POST', `/payments/${encodeURIComponent(ref)}/cancel`, {}, `cancel-${ref}`);
      } catch (err) {
        // Already final (expired, aborted, captured) – nothing to cancel.
        log.info('Vipps-kansellering avvist', { ref, error: String(err) });
      }
    },
    async handleWebhook(request, rawBody) {
      if (!cfg.webhookSecret) return null;
      const date = request.headers.get('x-ms-date');
      const contentHash = request.headers.get('x-ms-content-sha256');
      const authorization = request.headers.get('authorization');
      if (!date || !contentHash || !authorization) return null;
      const expectedHash = createHash('sha256').update(rawBody, 'utf8').digest('base64');
      if (!safeEqual(contentHash, expectedHash)) return null;
      const url = new URL(request.url);
      const pathAndQuery = `${url.pathname}${url.search}`;
      // Vipps signs with the host of the registered URL; a proxy may rewrite the Host header.
      const hosts = [...new Set([new URL(cfg.publicUrl).host, request.headers.get('host') ?? ''])].filter(Boolean);
      const valid = hosts.some((host) => {
        const signed = `${request.method.toUpperCase()}\n${pathAndQuery}\n${date};${host};${contentHash}`;
        const signature = createHmac('sha256', cfg.webhookSecret!).update(signed, 'utf8').digest('base64');
        return safeEqual(authorization, `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${signature}`);
      });
      if (!valid) return null;
      try {
        const event = JSON.parse(rawBody) as { reference?: unknown };
        return { providerRef: typeof event.reference === 'string' ? event.reference : null };
      } catch {
        return { providerRef: null };
      }
    },
  };
}

// ── Stripe (cards) ───────────────────────────────────────────────────────────

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string | null;
}

export function createStripePayments(cfg: StripeConfig, log: Logger): PaymentAdapter {
  const stripe = new Stripe(cfg.secretKey, { maxNetworkRetries: 2, appInfo: { name: 'TIKIT', version: '1.0.0' } });

  const paymentIntentId = async (sessionId: string): Promise<string | null> => {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const pi = session.payment_intent;
    return typeof pi === 'string' ? pi : (pi?.id ?? null);
  };

  return {
    provider: 'stripe',
    method: 'card',
    // Checkout captures automatically.
    needsCapture: false,
    async createPayment(args) {
      const linesTotal = args.lines.reduce((s, l) => s + l.unitAmountOre * l.qty, 0);
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
        linesTotal === args.amountOre && args.lines.every((l) => l.unitAmountOre >= 0 && Number.isInteger(l.unitAmountOre))
          ? args.lines
              .filter((l) => l.qty > 0 && l.unitAmountOre > 0)
              .map((l) => ({ quantity: l.qty, price_data: { currency: 'nok', unit_amount: l.unitAmountOre, product_data: { name: l.name.slice(0, 250) } } }))
          : [{ quantity: 1, price_data: { currency: 'nok', unit_amount: args.amountOre, product_data: { name: args.description.slice(0, 250) } } }];
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          payment_method_types: ['card'],
          line_items: lineItems,
          success_url: args.returnUrl,
          cancel_url: args.cancelUrl,
          client_reference_id: args.reference,
          customer_email: args.customerEmail ?? undefined,
          locale: 'nb',
          // Stripe's minimum lifetime is 30 minutes.
          expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
          metadata: { reference: args.reference, paymentId: args.paymentId },
          payment_intent_data: { description: args.description.slice(0, 1000), metadata: { reference: args.reference, paymentId: args.paymentId } },
        },
        { idempotencyKey: idemKey(`create-${args.reference}`) },
      );
      if (!session.url) throw new Error('Stripe returnerte ingen betalingslenke');
      return { providerRef: session.id, redirectUrl: session.url };
    },
    async getStatus(sessionId) {
      const s = await stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent.latest_charge'] });
      const total = s.amount_total ?? 0;
      if (s.status === 'expired') return { state: 'expired', authorizedOre: 0, capturedOre: 0, refundedOre: 0 };
      if (s.status === 'complete' && s.payment_status === 'paid') {
        const pi = typeof s.payment_intent === 'object' ? s.payment_intent : null;
        const charge = pi && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
        const refunded = charge?.amount_refunded ?? 0;
        return { state: refunded > 0 && refunded >= total ? 'refunded' : 'captured', authorizedOre: total, capturedOre: total, refundedOre: refunded };
      }
      return { state: 'pending', authorizedOre: 0, capturedOre: 0, refundedOre: 0 };
    },
    async capture() {
      /* automatic capture */
    },
    async refund(sessionId, amountOre, key) {
      const pi = await paymentIntentId(sessionId);
      if (!pi) throw new Error('Fant ingen kortbetaling å refundere');
      await stripe.refunds.create({ payment_intent: pi, amount: amountOre, reason: 'requested_by_customer' }, { idempotencyKey: idemKey(key) });
    },
    async cancel(sessionId) {
      try {
        const s = await stripe.checkout.sessions.retrieve(sessionId);
        if (s.status === 'open') await stripe.checkout.sessions.expire(sessionId);
      } catch (err) {
        log.info('Stripe-økt kunne ikke avsluttes', { sessionId, error: String(err) });
      }
    },
    async handleWebhook(request, rawBody) {
      if (!cfg.webhookSecret) return null;
      const signature = request.headers.get('stripe-signature');
      if (!signature) return null;
      let event: Stripe.Event;
      try {
        event = await stripe.webhooks.constructEventAsync(rawBody, signature, cfg.webhookSecret);
      } catch {
        return null;
      }
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded':
        case 'checkout.session.async_payment_failed':
        case 'checkout.session.expired':
          return { providerRef: event.data.object.id };
        default:
          // Verified, but nothing we act on (refunds are recorded when we issue them).
          return { providerRef: null };
      }
    },
  };
}
