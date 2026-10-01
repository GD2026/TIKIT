import Stripe from 'stripe';
import type { Logger, PaymentAdapter } from '../../../server/adapters/types';
import { idemKey } from '../shared';

/** Card payments through Stripe Checkout (TIKIT never sees card numbers). Keys: docs/oppsett.md §5. */

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
