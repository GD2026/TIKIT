import type { PaymentMethodId } from '../../shared/types';
import { newId } from '../../shared/ids';
import type { ServerConfig } from '../context';
import { appLink } from '../context';
import type { Store } from '../store/types';
import type { CreatePaymentArgs, MailMessage, Mailer, PaymentAdapter, ProviderPaymentStatus } from './types';

export interface DemoPaymentState {
  reference: string;
  method: PaymentMethodId;
  amountOre: number;
  description: string;
  state: 'pending' | 'authorized' | 'captured' | 'cancelled' | 'refunded';
  capturedOre: number;
  refundedOre: number;
  returnUrl: string;
  cancelUrl: string;
  lines: CreatePaymentArgs['lines'];
  phone: string | null;
  createdAt: string;
}

const key = (ref: string) => `demopay:${ref}`;

export async function readDemoPayment(store: Store, reference: string): Promise<DemoPaymentState | null> {
  const doc = await store.read((tx) => tx.get('kv', key(reference)));
  return (doc?.value as DemoPaymentState | undefined) ?? null;
}

export async function writeDemoPayment(store: Store, state: DemoPaymentState): Promise<void> {
  await store.tx(async (tx) => {
    await tx.put('kv', { id: key(state.reference), value: state, updatedAt: new Date().toISOString() });
  });
}

/**
 * Simulated Vipps / card payments. The "redirect" goes to an in-app page that looks like the
 * provider's confirmation step, where the person approves or declines.
 */
export function createDemoPaymentAdapter(method: PaymentMethodId, store: Store, config: ServerConfig): PaymentAdapter {
  return {
    provider: 'demo',
    method,
    needsCapture: method === 'vipps',
    async createPayment(args) {
      const state: DemoPaymentState = {
        reference: args.reference,
        method,
        amountOre: args.amountOre,
        description: args.description,
        state: 'pending',
        capturedOre: 0,
        refundedOre: 0,
        returnUrl: args.returnUrl,
        cancelUrl: args.cancelUrl,
        lines: args.lines,
        phone: args.customerPhone,
        createdAt: new Date().toISOString(),
      };
      await writeDemoPayment(store, state);
      return { providerRef: args.reference, redirectUrl: appLink(config, `/demo/betal/${encodeURIComponent(args.reference)}`) };
    },
    async getStatus(ref): Promise<ProviderPaymentStatus> {
      const s = await readDemoPayment(store, ref);
      if (!s) return { state: 'failed', authorizedOre: 0, capturedOre: 0, refundedOre: 0 };
      const state = s.state === 'refunded' ? 'refunded' : s.state;
      return {
        state: state === 'pending' ? 'pending' : state,
        authorizedOre: s.state === 'pending' || s.state === 'cancelled' ? 0 : s.amountOre,
        capturedOre: s.capturedOre,
        refundedOre: s.refundedOre,
      };
    },
    async capture(ref, amountOre) {
      const s = await readDemoPayment(store, ref);
      if (!s || (s.state !== 'authorized' && s.state !== 'captured')) throw new Error('Kan ikke trekke beløpet');
      await writeDemoPayment(store, { ...s, state: 'captured', capturedOre: Math.min(s.amountOre, amountOre) });
    },
    async refund(ref, amountOre, idempotencyKey) {
      const s = await readDemoPayment(store, ref);
      if (!s) throw new Error('Ukjent betaling');
      const done = await store.read((tx) => tx.get('kv', `demorefund:${idempotencyKey}`));
      if (done) return;
      const refunded = Math.min(s.capturedOre || s.amountOre, s.refundedOre + amountOre);
      await writeDemoPayment(store, { ...s, refundedOre: refunded, state: refunded >= (s.capturedOre || s.amountOre) ? 'refunded' : s.state });
      await store.tx(async (tx) => {
        await tx.put('kv', { id: `demorefund:${idempotencyKey}`, value: amountOre, updatedAt: new Date().toISOString() });
      });
    },
    async cancel(ref) {
      const s = await readDemoPayment(store, ref);
      if (!s) return;
      if (s.state === 'pending' || s.state === 'authorized') await writeDemoPayment(store, { ...s, state: 'cancelled' });
    },
  };
}

/** Stores mail in the `outbox` collection (shown in the demo inbox) instead of sending it. */
export function createOutboxMailer(store: Store, log: (msg: string) => void = () => {}): Mailer {
  return {
    kind: 'outbox',
    async send(msg: MailMessage) {
      await store.tx(async (tx) => {
        await tx.insert('outbox', { id: newId(), to: msg.to, subject: msg.subject, text: msg.text, html: msg.html, createdAt: new Date().toISOString(), status: 'logged' });
      });
      log(`E-post (ikke sendt, demo): ${msg.to} – ${msg.subject}`);
    },
  };
}
