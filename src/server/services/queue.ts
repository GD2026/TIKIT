import { AppError } from '../../shared/errors';
import { newId } from '../../shared/ids';
import { LIMITS } from '../../shared/constants';
import type { EventDoc, QueueEntry, QueueState, QueueStatus } from '../../shared/types';
import type { Deps } from '../context';
import type { Tx } from '../store/types';
import { nowIso, signToken, verifyToken } from './common';
import { typeSalesWindow, ticketTypeState } from './dto';
import { loadTicketTypes, activeHeld, availableOf } from './inventory';

/**
 * Virtual queue for high-demand ticket drops.
 * Everyone who joins before the sale opens gets a random place among the early joiners (fair lottery);
 * later arrivals queue behind them in arrival order. Admission is a steady flow of `ratePerMinute`,
 * with a quarter of a minute's worth admitted instantly at opening. An admitted person has
 * `queueTokenMinutes` to start an order. All times are derived deterministically from the queue settings.
 */

export function queueOpensAt(event: EventDoc, types: { salesStartAt: string | null; hidden: boolean }[]): string {
  const starts = types
    .filter((t) => !t.hidden)
    .map((t) => t.salesStartAt ?? event.salesStartAt)
    .filter((d): d is string => !!d)
    .sort();
  return starts[0] ?? event.salesStartAt ?? event.publishedAt ?? event.createdAt;
}

function initialBatch(rate: number): number {
  return Math.max(1, Math.ceil(rate / 4));
}

export function admittedCount(queue: QueueState, nowMs: number): number {
  const opens = Date.parse(queue.opensAt);
  if (nowMs < opens) return 0;
  return Math.floor((queue.ratePerMinute * (nowMs - opens)) / 60000) + initialBatch(queue.ratePerMinute);
}

export function admitTimeMs(queue: QueueState, position: number, joinedAtMs: number): number {
  const opens = Date.parse(queue.opensAt);
  const batch = initialBatch(queue.ratePerMinute);
  const base = position <= batch ? opens : opens + Math.ceil(((position - batch) * 60000) / queue.ratePerMinute);
  return Math.max(base, joinedAtMs);
}

async function currentOpensAt(tx: Tx, event: EventDoc): Promise<string> {
  const types = await loadTicketTypes(tx, event.id);
  return queueOpensAt(
    event,
    types.map((t) => ({ salesStartAt: typeSalesWindow(t, event).start, hidden: t.hidden })),
  );
}

/** What has to change for the queue to follow the event's current settings (null: nothing). */
function queueDrift(queue: QueueState, event: EventDoc, opensAt: string): Partial<QueueState> | null {
  const patch: Partial<QueueState> = {};
  if (!queue.frozen && queue.ratePerMinute !== event.settings.queueRatePerMinute) patch.ratePerMinute = event.settings.queueRatePerMinute;
  // A moved sale start moves the opening. Before the lottery has run, in either direction; after it, only
  // later (a postponed sale) – positions stay, admission simply starts at the new time.
  if (opensAt !== queue.opensAt && (!queue.frozen || opensAt > queue.opensAt)) patch.opensAt = opensAt;
  return Object.keys(patch).length > 0 ? patch : null;
}

async function syncQueue(tx: Tx, event: EventDoc, queue: QueueState): Promise<QueueState> {
  const patch = queueDrift(queue, event, await currentOpensAt(tx, event));
  return patch ? tx.update('queues', queue.id, patch) : queue;
}

async function ensureQueue(tx: Tx, deps: Deps, event: EventDoc): Promise<QueueState> {
  const existing = await tx.get('queues', event.id, { forUpdate: true });
  if (existing) return syncQueue(tx, event, existing);
  const queue: QueueState = {
    id: event.id,
    eventId: event.id,
    opensAt: await currentOpensAt(tx, event),
    ratePerMinute: event.settings.queueRatePerMinute,
    frozen: false,
    earlyCount: 0,
    nextPosition: 1,
    createdAt: nowIso(deps),
  };
  await tx.insert('queues', queue);
  return queue;
}

/** Assigns lottery positions to everyone who joined before opening. Runs once, after opening. */
async function freeze(tx: Tx, queue: QueueState): Promise<QueueState> {
  if (queue.frozen) return queue;
  const entries = await tx.find('queueEntries', { eventId: queue.eventId });
  const early = entries.filter((e) => e.joinedAt < queue.opensAt).sort((a, b) => a.rand - b.rand || a.id.localeCompare(b.id));
  let pos = 1;
  for (const e of early) {
    await tx.update('queueEntries', e.id, { position: pos++ });
  }
  const late = entries
    .filter((e) => e.joinedAt >= queue.opensAt && e.position === null)
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.id.localeCompare(b.id));
  for (const e of late) {
    await tx.update('queueEntries', e.id, { position: pos++ });
  }
  return tx.update('queues', queue.id, { frozen: true, earlyCount: early.length, nextPosition: pos });
}

async function soldOut(tx: Tx, event: EventDoc, now: Date): Promise<boolean> {
  const types = await loadTicketTypes(tx, event.id);
  const held = await activeHeld(tx, event.id, now.toISOString());
  const visible = types.filter((t) => !t.hidden && !t.paused);
  if (visible.length === 0) return false;
  return visible.every((t) => {
    const s = ticketTypeState(t, event, availableOf(t, held), now);
    return s === 'sold_out' || s === 'ended';
  });
}

async function buildStatus(tx: Tx, deps: Deps, event: EventDoc, queue: QueueState, entry: QueueEntry): Promise<QueueStatus> {
  const now = deps.clock();
  const nowMs = now.getTime();
  const total = await tx.count('queueEntries', { eventId: event.id });
  const base = { entryId: entry.id, eventId: event.id, total, opensAt: queue.opensAt };
  if (nowMs < Date.parse(queue.opensAt)) {
    return { ...base, status: 'before_open', position: null, ahead: null, etaSeconds: null, token: null, admittedUntil: null };
  }
  let position = entry.position;
  if (position === null) {
    // Not frozen yet (read-only path): derive the lottery rank.
    const entries = await tx.find('queueEntries', { eventId: event.id });
    const early = entries.filter((e) => e.joinedAt < queue.opensAt).sort((a, b) => a.rand - b.rand || a.id.localeCompare(b.id));
    position = early.findIndex((e) => e.id === entry.id) + 1 || early.length + 1;
  }
  if (await soldOut(tx, event, now)) {
    return { ...base, status: 'sold_out', position, ahead: null, etaSeconds: null, token: null, admittedUntil: null };
  }
  const admitted = admittedCount(queue, nowMs);
  if (position <= admitted) {
    const admitAt = admitTimeMs(queue, position, Date.parse(entry.joinedAt));
    const until = admitAt + LIMITS.queueTokenMinutes * 60000;
    if (nowMs > until) {
      return { ...base, status: 'expired', position, ahead: 0, etaSeconds: null, token: null, admittedUntil: new Date(until).toISOString() };
    }
    const token = await signToken(deps.config.sessionSecret, 'queue', { e: event.id, u: entry.userId }, until);
    return { ...base, status: 'admitted', position, ahead: 0, etaSeconds: 0, token, admittedUntil: new Date(until).toISOString() };
  }
  const ahead = position - admitted;
  return {
    ...base,
    status: 'waiting',
    position,
    ahead,
    etaSeconds: Math.ceil((ahead * 60) / queue.ratePerMinute),
    token: null,
    admittedUntil: null,
  };
}

/** Read-only status for the event page. */
export async function queueStatusFor(tx: Tx, deps: Deps, event: EventDoc, userId: string): Promise<QueueStatus | null> {
  const queue = await tx.get('queues', event.id);
  if (!queue) return null;
  const entry = await tx.findOne('queueEntries', { eventId: event.id, userId });
  if (!entry || entry.status === 'left') return null;
  return buildStatus(tx, deps, event, queue, entry);
}

export async function joinQueue(deps: Deps, eventId: string, userId: string): Promise<QueueStatus> {
  const now = deps.clock();
  return deps.store.tx(async (tx) => {
    const event = await tx.get('events', eventId);
    if (!event || event.status !== 'published') throw new AppError('not_found');
    if (!event.settings.queueEnabled) throw new AppError('bad_request', { message: 'Dette arrangementet har ikke kø.' });
    let queue = await ensureQueue(tx, deps, event);
    const afterOpen = now.toISOString() >= queue.opensAt;
    if (afterOpen) queue = await freeze(tx, queue);
    let entry = await tx.findOne('queueEntries', { eventId, userId }, { forUpdate: true });
    if (entry && entry.status === 'left') {
      await tx.delete('queueEntries', entry.id);
      entry = null;
    }
    if (!entry) {
      entry = {
        id: newId(),
        eventId,
        userId,
        joinedAt: now.toISOString(),
        rand: Math.random(),
        position: afterOpen ? queue.nextPosition : null,
        status: 'waiting',
        admittedAt: null,
      };
      await tx.insert('queueEntries', entry);
      if (afterOpen) queue = await tx.update('queues', queue.id, { nextPosition: queue.nextPosition + 1 });
    }
    return buildStatus(tx, deps, event, queue, entry);
  });
}

/**
 * Status poll (every few seconds from everyone waiting). Most polls only read; the queue row is locked only
 * when the queue has to change – the sale start moved, or the lottery is due on the first poll after opening.
 */
export async function getQueueStatus(deps: Deps, eventId: string, userId: string): Promise<QueueStatus | null> {
  const nowS = nowIso(deps);
  const fast = await deps.store.read(async (tx) => {
    const event = await tx.get('events', eventId);
    if (!event) throw new AppError('not_found');
    const queue = await tx.get('queues', eventId);
    if (!queue) return { status: null };
    const opensAt = await currentOpensAt(tx, event);
    if (queueDrift(queue, event, opensAt) || (!queue.frozen && nowS >= queue.opensAt)) return null;
    const entry = await tx.findOne('queueEntries', { eventId, userId });
    if (!entry || entry.status === 'left') return { status: null };
    return { status: await buildStatus(tx, deps, event, queue, entry) };
  });
  if (fast) return fast.status;
  return deps.store.tx(async (tx) => {
    const event = await tx.get('events', eventId);
    if (!event) throw new AppError('not_found');
    let queue = await tx.get('queues', eventId, { forUpdate: true });
    if (!queue) return null;
    queue = await syncQueue(tx, event, queue);
    if (!queue.frozen && nowS >= queue.opensAt) queue = await freeze(tx, queue);
    const entry = await tx.findOne('queueEntries', { eventId, userId });
    if (!entry || entry.status === 'left') return null;
    return buildStatus(tx, deps, event, queue, entry);
  });
}

/** Leave the queue (or rejoin at the back after an expired admission). */
export async function leaveQueue(deps: Deps, eventId: string, userId: string): Promise<void> {
  await deps.store.tx(async (tx) => {
    const entry = await tx.findOne('queueEntries', { eventId, userId }, { forUpdate: true });
    if (entry) await tx.update('queueEntries', entry.id, { status: 'left' });
  });
}

export async function verifyQueueToken(deps: Deps, token: string | null | undefined, eventId: string, userId: string): Promise<boolean> {
  const payload = await verifyToken<{ e: string; u: string }>(deps.config.sessionSecret, 'queue', token, deps.clock().getTime());
  return !!payload && payload.e === eventId && payload.u === userId;
}
