import type { Deps } from '../context';
import { nowIso } from './common';

/**
 * How long personal data is kept. The privacy policy states these periods, so change both together.
 * Accounting records (orders) follow bokføringsloven § 13: five years after the end of the financial year.
 */
export const RETENTION = {
  /** In-app notifications. */
  notificationsDays: 365,
  /** Door logs (who was let in, when, at which gate), counted from the end of the event. */
  checkinLogsDaysAfterEvent: 365,
  /** Names on tickets, counted from the end of the event (the order keeps the buyer for accounting). */
  ticketNamesDaysAfterEvent: 365,
  /** Queue places, waitlist entries and sale alerts, counted from the end of the event. */
  queueDaysAfterEvent: 30,
  /** Recipient e-mail/phone and the personal note on transfers, counted from when the transfer was made. */
  transferContactDays: 90,
  /** Copies of e-mails in the demo/development outbox. */
  outboxDays: 30,
  /** Orders: buyer name and contact details are removed after this many full financial years. */
  orderYears: 5,
  /** Audit log entries. */
  auditYears: 5,
  /** Reports about content (moderation), counted from when they were handled. Open reports are kept. */
  reportsDaysAfterHandled: 365,
} as const;

export const ANONYMIZED = 'Anonymisert';

const DAY = 86_400_000;
const RUN_EVERY_MS = 23 * 3600_000;

/**
 * Cron: deletes or anonymizes personal data that has passed its retention period. Runs at most about once a
 * day (the time of the last run is kept in the database). Returns the number of documents changed.
 */
export async function applyRetention(deps: Deps, opts: { force?: boolean } = {}): Promise<number> {
  const now = deps.clock();
  const nowMs = now.getTime();
  if (!opts.force) {
    const due = await deps.store.tx(async (tx) => {
      const last = await tx.get('kv', 'retention-last-run', { forUpdate: true });
      if (last && nowMs - Date.parse(String(last.value)) < RUN_EVERY_MS) return false;
      await tx.put('kv', { id: 'retention-last-run', value: now.toISOString(), updatedAt: now.toISOString() });
      return true;
    });
    if (!due) return 0;
  }
  const before = (days: number) => new Date(nowMs - days * DAY).toISOString();
  let changed = 0;

  // Events that ended long enough ago for each rule.
  const ended = await deps.store.read(async (tx) => (await tx.find('events')).map((e) => ({ id: e.id, endsAt: e.endsAt })));
  const endedBefore = (days: number) => ended.filter((e) => e.endsAt < before(days)).map((e) => e.id);

  changed += await deps.store.tx(async (tx) => {
    let n = 0;
    const queueEvents = endedBefore(RETENTION.queueDaysAfterEvent);
    if (queueEvents.length > 0) {
      n += await tx.deleteWhere('queueEntries', { eventId: { in: queueEvents } });
      n += await tx.deleteWhere('waitlist', { eventId: { in: queueEvents } });
      n += await tx.deleteWhere('saleAlerts', { eventId: { in: queueEvents } });
    }
    const doorEvents = endedBefore(RETENTION.checkinLogsDaysAfterEvent);
    if (doorEvents.length > 0) n += await tx.deleteWhere('checkins', { eventId: { in: doorEvents } });
    return n;
  });

  changed += await deps.store.tx(async (tx) => {
    let n = 0;
    const nameEvents = endedBefore(RETENTION.ticketNamesDaysAfterEvent);
    if (nameEvents.length > 0) {
      for (const t of await tx.find('tickets', { eventId: { in: nameEvents } })) {
        if (t.holderName === ANONYMIZED) continue;
        await tx.update('tickets', t.id, { holderName: ANONYMIZED, updatedAt: nowIso(deps) });
        n++;
      }
    }
    for (const tr of await tx.find('transfers')) {
      if (tr.status === 'pending' || tr.createdAt >= before(RETENTION.transferContactDays)) continue;
      if (tr.toContact === null && tr.message === null) continue;
      await tx.update('transfers', tr.id, { toContact: null, message: null });
      n++;
    }
    return n;
  });

  changed += await deps.store.tx(async (tx) => {
    let n = 0;
    for (const x of await tx.find('notifications')) if (x.createdAt < before(RETENTION.notificationsDays) && (await tx.delete('notifications', x.id))) n++;
    for (const x of await tx.find('outbox')) if (x.createdAt < before(RETENTION.outboxDays) && (await tx.delete('outbox', x.id))) n++;
    const auditCutoff = new Date(Date.UTC(now.getUTCFullYear() - RETENTION.auditYears, now.getUTCMonth(), now.getUTCDate())).toISOString();
    for (const x of await tx.find('audit')) if (x.at < auditCutoff && (await tx.delete('audit', x.id))) n++;
    for (const r of await tx.find('reports')) {
      if (r.status !== 'open' && r.resolvedAt && r.resolvedAt < before(RETENTION.reportsDaysAfterHandled) && (await tx.delete('reports', r.id))) n++;
    }
    return n;
  });

  // Orders: kept in full until the end of the financial year plus five years, then the buyer is anonymized.
  changed += await deps.store.tx(async (tx) => {
    let n = 0;
    const lastYearToAnonymize = now.getUTCFullYear() - RETENTION.orderYears - 1;
    for (const o of await tx.find('orders')) {
      const year = new Date(o.paidAt ?? o.createdAt).getUTCFullYear();
      if (year > lastYearToAnonymize) continue;
      if (o.buyer.name === ANONYMIZED && o.buyer.email === null && o.buyer.phone === null && o.attendeeNames.length === 0) continue;
      await tx.update('orders', o.id, { buyer: { name: ANONYMIZED, email: null, phone: null }, attendeeNames: [], updatedAt: nowIso(deps) });
      n++;
    }
    return n;
  });

  if (changed > 0) deps.log.info('Personopplysninger slettet eller anonymisert etter lagringstiden', { changed });
  return changed;
}
