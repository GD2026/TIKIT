import { AppError } from '../../shared/errors';
import { newId } from '../../shared/ids';
import { LIMITS } from '../../shared/constants';
import type { EventDoc } from '../../shared/types';
import type { Deps } from '../context';
import { appLink } from '../context';
import type { Tx } from '../store/types';
import { notify, nowIso } from './common';

export async function joinWaitlist(deps: Deps, userId: string, eventId: string): Promise<void> {
  await deps.store.tx(async (tx) => {
    const event = await tx.get('events', eventId);
    if (!event || event.status !== 'published') throw new AppError('not_found');
    if (!event.settings.waitlistEnabled) throw new AppError('bad_request', { message: 'Arrangøren har ikke venteliste for dette arrangementet.' });
    const existing = await tx.findOne('waitlist', { eventId, userId }, { forUpdate: true });
    if (existing) {
      if (existing.status !== 'waiting') await tx.update('waitlist', existing.id, { status: 'waiting', notifiedAt: null, createdAt: nowIso(deps) });
      return;
    }
    await tx.insert('waitlist', { id: newId(), eventId, userId, status: 'waiting', createdAt: nowIso(deps), notifiedAt: null });
  });
}

export async function leaveWaitlist(deps: Deps, userId: string, eventId: string): Promise<void> {
  await deps.store.tx(async (tx) => {
    const existing = await tx.findOne('waitlist', { eventId, userId });
    if (existing) await tx.delete('waitlist', existing.id);
  });
}

/** Tells the next people on the waitlist that tickets are available (capacity freed or resale listing). */
export async function notifyWaitlist(tx: Tx, deps: Deps, event: EventDoc): Promise<number> {
  if (!event.settings.waitlistEnabled || event.status !== 'published') return 0;
  const waiting = (await tx.find('waitlist', { eventId: event.id, status: 'waiting' }, { orderBy: { field: 'createdAt', dir: 'asc' } })).slice(
    0,
    LIMITS.waitlistBatch,
  );
  const now = nowIso(deps);
  for (const w of waiting) {
    await tx.update('waitlist', w.id, { status: 'notified', notifiedAt: now });
    const user = await tx.get('users', w.userId);
    const wantsEmail = !!user?.prefs.waitlist;
    await notify(tx, deps, w.userId, {
      kind: 'waitlist_available',
      title: `Billetter tilgjengelig: ${event.title}`,
      body: 'Det har åpnet seg billetter. Først til mølla!',
      link: `/e/${event.slug}`,
      email: wantsEmail
        ? {
            subject: `Billetter tilgjengelig: ${event.title}`,
            heading: 'Det har åpnet seg billetter',
            paragraphs: [`Du står på ventelisten til ${event.title}. Nå er det billetter tilgjengelig – først til mølla.`],
            cta: { label: 'Kjøp billetter', url: appLink(deps.config, `/e/${event.slug}`) },
          }
        : null,
      transactional: true,
    });
  }
  return waiting.length;
}
