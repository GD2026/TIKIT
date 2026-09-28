import { createHash, createHmac } from 'node:crypto';
import type { CreatePaymentArgs, Logger, PaymentAdapter, ProviderPaymentStatus } from '../../../server/adapters/types';
import { idemKey, safeEqual } from '../shared';
import { VIPPS_SYSTEM_HEADERS, createVippsTokenSource, type VippsApiConfig } from './common';

/** Vipps MobilePay ePayment API: reserve, capture after the tickets are issued, refund. Keys: docs/oppsett.md §1. */

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
