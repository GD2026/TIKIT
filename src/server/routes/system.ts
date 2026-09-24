import { Hono } from 'hono';
import { AppError } from '../../shared/errors';
import { timingSafeEqual } from '../../shared/encoding';
import { limit, requireUser, type AppEnv } from '../middleware/core';
import { handlePaymentWebhook } from '../services/orders';
import { runCron } from '../services/misc';
import { readDemoPayment, writeDemoPayment } from '../adapters/demo';
import { requireScanAccess, sameHolder, type ScanActor } from '../services/checkin';
import { ageOn } from '../../shared/time';
import { createTicketCode } from '../../shared/qr';
import { LIMITS } from '../../shared/constants';
import type { Deps } from '../context';

export function systemRoutes(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // ── Webhooks (signature verified by the adapter) ─────────────────────────
  for (const provider of ['vipps', 'stripe'] as const) {
    app.post(`/webhooks/${provider}`, limit(`webhook-${provider}`, 600, 60_000), async (c) => {
      const adapter = Object.values(deps.payments).find((p) => p?.provider === provider);
      if (!adapter?.handleWebhook) throw new AppError('not_found');
      const raw = await c.req.text();
      const verified = await adapter.handleWebhook(c.req.raw, raw);
      if (!verified) return c.json({ ok: false }, 401);
      if (!verified.providerRef) return c.json({ ok: true, ignored: true });
      try {
        await handlePaymentWebhook(deps, provider, verified.providerRef);
      } catch (err) {
        deps.log.error('Webhook-behandling feilet', { provider, error: String(err) });
        return c.json({ ok: false }, 500); // provider retries
      }
      return c.json({ ok: true });
    });
  }

  // ── Cron (protected by CRON_SECRET) ───────────────────────────────────────
  app.post('/cron', async (c) => {
    const secret = deps.config.cronSecret;
    const given = c.req.header('x-cron-secret') ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!secret || !timingSafeEqual(secret, given)) throw new AppError('forbidden');
    return c.json({ result: await runCron(deps) });
  });

  // ── Demo-only endpoints ──────────────────────────────────────────────────
  app.get('/demo/payments/:ref', async (c) => {
    if (!deps.config.demoMode) throw new AppError('not_found');
    requireUser(c);
    const p = await readDemoPayment(deps.store, c.req.param('ref'));
    if (!p) throw new AppError('not_found');
    return c.json(p);
  });

  app.post('/demo/payments/:ref/:action', async (c) => {
    if (!deps.config.demoMode) throw new AppError('not_found');
    requireUser(c);
    const p = await readDemoPayment(deps.store, c.req.param('ref'));
    if (!p) throw new AppError('not_found');
    const action = c.req.param('action');
    if (p.state === 'pending') {
      if (action === 'approve') await writeDemoPayment(deps.store, { ...p, state: p.method === 'card' ? 'captured' : 'authorized', capturedOre: p.method === 'card' ? p.amountOre : 0 });
      else if (action === 'decline') await writeDemoPayment(deps.store, { ...p, state: 'cancelled' });
      else throw new AppError('not_found');
    }
    return c.json({ returnUrl: p.returnUrl });
  });

  /**
   * Demo only: a code the door scanner can "scan" without a second phone. `kind` picks a valid ticket,
   * an already used one, or a stale code (as from a screenshot).
   */
  app.get('/demo/sample-ticket/:eventId', limit('demo-sample', 120, 60_000), async (c) => {
    if (!deps.config.demoMode) throw new AppError('not_found');
    const session = c.get('session');
    const user = c.get('user');
    const actor: ScanActor | null = session?.kind === 'scanner' ? { kind: 'scanner', session } : user ? { kind: 'user', user } : null;
    if (!actor) throw new AppError('unauthorized');
    const eventId = c.req.param('eventId');
    const kind = c.req.query('kind') === 'used' ? 'used' : c.req.query('kind') === 'stale' ? 'stale' : 'valid';
    const ticket = await deps.store.read(async (tx) => {
      const event = await requireScanAccess(tx, actor, eventId);
      const tickets = await tx.find('tickets', { eventId, status: kind === 'used' ? 'used' : 'valid' });
      let usable = tickets.filter((t) => !t.transferId && !t.resaleListingId);
      if (kind === 'valid' && event.ageLimit) {
        // "Scan a valid ticket" should show the green screen: prefer tickets held by their own,
        // Vipps-verified, old-enough account owner.
        const clean: typeof usable = [];
        for (const t of usable.slice(0, 400)) {
          const owner = await tx.get('users', t.ownerId);
          if (owner?.birthdate && owner.birthdateVerified && sameHolder(owner.name, t.holderName) && ageOn(owner.birthdate, event.startsAt) >= event.ageLimit) clean.push(t);
        }
        if (clean.length > 0) usable = clean;
      }
      return usable[Math.floor(Math.random() * usable.length)] ?? null;
    });
    if (!ticket) throw new AppError('not_found', { message: kind === 'used' ? 'Ingen billetter er sjekket inn ennå.' : 'Ingen gyldige billetter igjen å skanne.' });
    const at = kind === 'stale' ? deps.clock().getTime() - (LIMITS.qrPastSteps + 4) * LIMITS.qrStepSeconds * 1000 : deps.clock().getTime();
    return c.json({ code: await createTicketCode(ticket.id, ticket.secret, at), holderName: ticket.holderName });
  });

  app.get('/demo/outbox', async (c) => {
    if (!deps.config.demoMode) throw new AppError('not_found');
    const user = requireUser(c);
    const mails = await deps.store.read((tx) => tx.find('outbox', {}, { orderBy: { field: 'createdAt', dir: 'desc' }, limit: 50 }));
    const visible = user.role === 'admin' ? mails : mails.filter((m) => m.to === user.email);
    return c.json({ emails: visible });
  });

  return app;
}
