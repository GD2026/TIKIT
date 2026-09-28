import { AppError } from '../../shared/errors';
import { base64ToBytes } from '../../shared/encoding';
import { newId } from '../../shared/ids';
import { LIMITS } from '../../shared/constants';
import type { AppNotification, ImageDoc, User } from '../../shared/types';
import type { Deps } from '../context';
import { appLink } from '../context';
import { nowIso, notify } from './common';
import { expireStaleOrders, pollPendingPayments, retryPendingCaptures } from './orders';
import { expireTransfers } from './tickets';
import { retryCancelledEventRefunds } from './refunds';
import { runDuePaymentJobs } from './paymentJobs';
import { applyRetention } from './retention';
import { loadTicketTypes, activeHeld, availableOf } from './inventory';
import { ticketTypeState } from './dto';
import { purgeExpiredHandoffs } from './nativeAuth';
import { formatEventWhen } from '../../shared/time';

// ── Notifications ────────────────────────────────────────────────────────────

export async function listNotifications(deps: Deps, user: User): Promise<AppNotification[]> {
  return deps.store.read((tx) => tx.find('notifications', { userId: user.id }, { orderBy: { field: 'createdAt', dir: 'desc' }, limit: 100 }));
}

export async function markNotificationsRead(deps: Deps, user: User, ids: string[] | null): Promise<void> {
  const nowS = nowIso(deps);
  await deps.store.tx(async (tx) => {
    const unread = await tx.find('notifications', { userId: user.id, readAt: null });
    for (const n of unread) if (!ids || ids.includes(n.id)) await tx.update('notifications', n.id, { readAt: nowS });
  });
}

// ── Images ───────────────────────────────────────────────────────────────────

const MAGIC: Record<ImageDoc['mime'], (b: Uint8Array) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  'image/webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
};

export async function uploadImage(deps: Deps, user: User, input: { mime: ImageDoc['mime']; data: string; width: number; height: number }): Promise<{ id: string; url: string }> {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(input.data);
  } catch {
    throw new AppError('validation', { message: 'Bildet kunne ikke leses.' });
  }
  if (bytes.length > LIMITS.imageMaxBytes) throw new AppError('validation', { message: 'Bildet er for stort (maks 1,5 MB).' });
  if (bytes.length < 64 || !MAGIC[input.mime](bytes)) throw new AppError('validation', { message: 'Filen er ikke et gyldig bilde.' });
  const doc: ImageDoc = { id: newId(), ownerId: user.id, mime: input.mime, data: input.data, width: input.width, height: input.height, bytes: bytes.length, createdAt: nowIso(deps) };
  await deps.store.tx(async (tx) => {
    await tx.insert('images', doc);
  });
  return { id: doc.id, url: `/api/images/${doc.id}` };
}

export async function getImage(deps: Deps, id: string): Promise<{ mime: string; bytes: Uint8Array } | null> {
  const doc = await deps.store.read((tx) => tx.get('images', id));
  if (!doc) return null;
  return { mime: doc.mime, bytes: base64ToBytes(doc.data) };
}

// ── Scheduled work ───────────────────────────────────────────────────────────

async function sendSaleStartAlerts(deps: Deps): Promise<number> {
  const now = deps.clock();
  const nowS = now.toISOString();
  const pending = await deps.store.read((tx) => tx.find('saleAlerts', { notifiedAt: null }));
  const byEvent = new Map<string, typeof pending>();
  for (const a of pending) byEvent.set(a.eventId, [...(byEvent.get(a.eventId) ?? []), a]);
  let sent = 0;
  for (const [eventId, alerts] of byEvent) {
    await deps.store.tx(async (tx) => {
      const event = await tx.get('events', eventId);
      if (!event || event.status !== 'published' || event.endsAt <= nowS) return;
      const types = await loadTicketTypes(tx, eventId);
      const held = await activeHeld(tx, eventId, nowS);
      const onSale = types.some((t) => !t.hidden && ticketTypeState(t, event, availableOf(t, held), now) === 'on_sale');
      if (!onSale) return;
      for (const a of alerts) {
        const fresh = await tx.get('saleAlerts', a.id);
        if (!fresh || fresh.notifiedAt) continue;
        await tx.update('saleAlerts', a.id, { notifiedAt: nowS });
        await notify(tx, deps, a.userId, {
          kind: 'sale_started',
          title: `Salget har startet: ${event.title}`,
          body: event.settings.queueEnabled ? 'Still deg i kø nå for å sikre billetter.' : 'Billettene er ute nå.',
          link: `/e/${event.slug}`,
          email: {
            subject: `Billettsalget har startet: ${event.title}`,
            heading: 'Billettsalget har startet',
            paragraphs: [`${event.title} – ${formatEventWhen(event.startsAt)}, ${event.venue.name}.`],
            cta: { label: 'Kjøp billetter', url: appLink(deps.config, `/e/${event.slug}`) },
          },
          transactional: true,
        });
        sent++;
      }
    });
  }
  return sent;
}

async function sendEventReminders(deps: Deps): Promise<number> {
  const now = deps.clock();
  const nowS = now.toISOString();
  const soon = new Date(now.getTime() + 26 * 3600000).toISOString();
  const events = await deps.store.read(async (tx) => {
    const published = await tx.find('events', { status: 'published' });
    return published.filter((e) => e.startsAt > nowS && e.startsAt <= soon);
  });
  let sent = 0;
  for (const event of events) {
    await deps.store.tx(async (tx) => {
      const key = `reminder:${event.id}`;
      if (await tx.get('kv', key)) return;
      await tx.put('kv', { id: key, value: true, updatedAt: nowS });
      const tickets = await tx.find('tickets', { eventId: event.id, status: 'valid' });
      const owners = [...new Set(tickets.map((t) => t.ownerId))];
      for (const ownerId of owners) {
        const user = await tx.get('users', ownerId);
        if (!user || !user.prefs.reminders) continue;
        await notify(tx, deps, ownerId, {
          kind: 'event_reminder',
          title: `Snart: ${event.title}`,
          body: `${formatEventWhen(event.startsAt)} på ${event.venue.name}. Billetten ligger klar i appen.`,
          link: '/billetter',
          email: {
            subject: `Påminnelse: ${event.title}`,
            heading: `${event.title} nærmer seg`,
            paragraphs: [
              `${formatEventWhen(event.startsAt)} – ${event.venue.name}, ${event.venue.address ? `${event.venue.address}, ` : ''}${event.venue.city}.`,
              'Åpne billetten i TIKIT ved inngangen. Skru opp lysstyrken for rask skanning.',
            ],
            cta: { label: 'Vis billetten', url: appLink(deps.config, '/billetter') },
          },
          transactional: true,
        });
        sent++;
      }
    });
  }
  return sent;
}

async function cleanup(deps: Deps): Promise<void> {
  const nowS = nowIso(deps);
  const dayAgo = new Date(deps.clock().getTime() - 86400000).toISOString();
  await deps.store.tx(async (tx) => {
    const sessions = await tx.find('sessions');
    for (const s of sessions) if (s.expiresAt <= nowS) await tx.delete('sessions', s.id);
    const holds = await tx.find('holds');
    for (const h of holds) {
      if (h.expiresAt > dayAgo) continue;
      const order = await tx.get('orders', h.orderId);
      if (!order || (order.status !== 'reserved' && order.status !== 'pending_payment')) await tx.delete('holds', h.id);
    }
  });
}

export interface CronResult {
  expiredOrders: number;
  expiredTransfers: number;
  captures: number;
  polledPayments: number;
  saleAlerts: number;
  reminders: number;
  refundRetries: number;
  paymentJobs: number;
  retention: number;
}

let cronRunning = false;

export async function runCron(deps: Deps): Promise<CronResult | null> {
  if (cronRunning) return null;
  cronRunning = true;
  try {
    const result: CronResult = {
      expiredOrders: await expireStaleOrders(deps),
      expiredTransfers: await expireTransfers(deps),
      captures: await retryPendingCaptures(deps),
      polledPayments: await pollPendingPayments(deps),
      saleAlerts: await sendSaleStartAlerts(deps),
      reminders: await sendEventReminders(deps),
      refundRetries: await retryCancelledEventRefunds(deps),
      paymentJobs: await runDuePaymentJobs(deps),
      retention: await applyRetention(deps),
    };
    await cleanup(deps);
    await purgeExpiredHandoffs(deps);
    return result;
  } catch (err) {
    deps.log.error('Cron feilet', { error: String(err) });
    return null;
  } finally {
    cronRunning = false;
  }
}
