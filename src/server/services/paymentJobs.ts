import { newId } from '../../shared/ids';
import type { Payment, PaymentJob } from '../../shared/types';
import type { Deps } from '../context';
import type { Tx } from '../store/types';
import { audit, nowIso } from './common';

/**
 * Money that has to move at a payment provider is queued here, in the same transaction as the change in
 * TIKIT (ticket refunded, resale sold, payment superseded …), then tried right after commit and retried by
 * cron with backoff until the provider confirms. Refunds use a stable idempotency key, so a retry after an
 * unclear failure never pays out twice.
 */

const MAX_ATTEMPTS = 10;
/** Minutes to wait after the n-th failed attempt. */
const BACKOFF_MINUTES = [1, 5, 15, 30, 60, 120, 240, 480, 720];
const LOCK_MS = 2 * 60_000;

export interface EnqueueArgs {
  payment: Payment;
  kind: PaymentJob['kind'];
  /** Refunds only; `reverse` works out the amount from the provider's status. */
  amountOre: number;
  idempotencyKey: string;
  reason: string;
  /** Try right after commit (default). Bulk operations leave it to cron so the request stays fast. */
  runNow?: boolean;
}

/** Queues a provider operation inside the caller's transaction; it is attempted right after commit. */
export async function enqueuePaymentJob(tx: Tx, deps: Deps, args: EnqueueArgs): Promise<PaymentJob | null> {
  if (args.kind === 'refund' && args.amountOre <= 0) return null;
  // The same key is the same operation – never queue it twice.
  const existing = (await tx.find('paymentJobs', { paymentId: args.payment.id })).find((j) => j.idempotencyKey === args.idempotencyKey);
  if (existing) return existing;
  const nowS = nowIso(deps);
  const job: PaymentJob = {
    id: newId(),
    paymentId: args.payment.id,
    orderId: args.payment.orderId,
    kind: args.kind,
    amountOre: args.kind === 'refund' ? args.amountOre : 0,
    idempotencyKey: args.idempotencyKey,
    reason: args.reason.slice(0, 200),
    status: 'pending',
    attempts: 0,
    nextAttemptAt: nowS,
    lockedUntil: null,
    lastError: null,
    createdAt: nowS,
    updatedAt: nowS,
  };
  await tx.insert('paymentJobs', job);
  if (args.runNow !== false) {
    tx.afterCommit(async () => {
      await runPaymentJob(deps, job.id);
    });
  }
  return job;
}

/** Runs one job if it is due and nobody else is running it. Returns true when the job is done. */
export async function runPaymentJob(deps: Deps, jobId: string): Promise<boolean> {
  const now = deps.clock();
  const nowS = now.toISOString();
  const claimed = await deps.store.tx(async (tx) => {
    const job = await tx.get('paymentJobs', jobId, { forUpdate: true });
    if (!job || job.status !== 'pending' || job.nextAttemptAt > nowS) return null;
    if (job.lockedUntil && job.lockedUntil > nowS) return null;
    const payment = await tx.get('payments', job.paymentId);
    const updated = await tx.update('paymentJobs', job.id, { lockedUntil: new Date(now.getTime() + LOCK_MS).toISOString(), attempts: job.attempts + 1, updatedAt: nowS });
    return { job: updated, payment };
  });
  if (!claimed) return false;
  const { job, payment } = claimed;

  try {
    if (!payment) throw new Error('Betalingen finnes ikke');
    const adapter = deps.payments[payment.method];
    if (!adapter || adapter.provider !== payment.provider) throw new Error(`Mangler betalingsadapter for ${payment.provider}`);
    let refundedOre = 0;
    if (job.kind === 'refund') {
      await adapter.refund(payment.providerRef, job.amountOre, job.idempotencyKey);
      refundedOre = job.amountOre;
    } else {
      // Whatever the payment turned into, the customer must not be charged for it.
      const status = await adapter.getStatus(payment.providerRef);
      if (status.state === 'pending' || status.state === 'authorized') {
        await adapter.cancel(payment.providerRef);
      } else if (status.state === 'captured') {
        const left = status.capturedOre - status.refundedOre;
        if (left > 0) {
          await adapter.refund(payment.providerRef, left, job.idempotencyKey);
          refundedOre = left;
        }
      }
    }
    await deps.store.tx(async (tx) => {
      await tx.update('paymentJobs', job.id, { status: 'done', lockedUntil: null, lastError: null, updatedAt: nowIso(deps) });
      if (refundedOre > 0) {
        const p = await tx.get('payments', payment.id, { forUpdate: true });
        if (p) {
          const refunded = p.refundedOre + refundedOre;
          await tx.update('payments', p.id, {
            refundedOre: refunded,
            status: refunded >= p.capturedOre && p.capturedOre > 0 ? 'refunded' : 'partially_refunded',
            updatedAt: nowIso(deps),
          });
        }
      }
    });
    return true;
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    const giveUp = job.attempts >= MAX_ATTEMPTS;
    const waitMin = BACKOFF_MINUTES[Math.min(job.attempts - 1, BACKOFF_MINUTES.length - 1)] ?? 720;
    await deps.store.tx(async (tx) => {
      await tx.update('paymentJobs', job.id, {
        status: giveUp ? 'failed' : 'pending',
        nextAttemptAt: new Date(deps.clock().getTime() + waitMin * 60_000).toISOString(),
        lockedUntil: null,
        lastError: message,
        updatedAt: nowIso(deps),
      });
      if (payment) await tx.update('payments', payment.id, { lastError: `${job.kind}: ${message}`, updatedAt: nowIso(deps) });
      if (giveUp) await audit(tx, deps, null, 'payment_job.failed', 'payments', job.paymentId, { jobId: job.id, kind: job.kind, amountOre: job.amountOre, error: message });
    });
    const data = { jobId: job.id, kind: job.kind, paymentId: job.paymentId, amountOre: job.amountOre, attempt: job.attempts, error: message };
    if (giveUp) deps.log.error('Betalingsjobb ga opp – må følges opp manuelt hos betalingsleverandøren', data);
    else deps.log.warn('Betalingsjobb feilet – prøves igjen', data);
    return false;
  }
}

/** Cron: runs every job that is due, a few at a time (an event cancellation can queue hundreds). */
export async function runDuePaymentJobs(deps: Deps, concurrency = 4): Promise<number> {
  const nowS = nowIso(deps);
  const due = await deps.store.read(async (tx) =>
    (await tx.find('paymentJobs', { status: 'pending' }))
      .filter((j) => j.nextAttemptAt <= nowS && (!j.lockedUntil || j.lockedUntil <= nowS))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((j) => j.id),
  );
  let done = 0;
  let next = 0;
  const worker = async () => {
    while (next < due.length) {
      const id = due[next++]!;
      if (await runPaymentJob(deps, id)) done++;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, due.length) }, worker));
  return done;
}
