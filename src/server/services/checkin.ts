import { AppError } from '../../shared/errors';
import { newId, numericCode } from '../../shared/ids';
import { sha256Hex } from '../../shared/encoding';
import { LIMITS } from '../../shared/constants';
import { ageOn, formatTime } from '../../shared/time';
import { looksLikeTicketNumber, parseTicketCode, verifyTicketCode } from '../../shared/qr';
import type { CheckinLog, CheckinResult, EventDoc, ScannerCode, Session, Ticket, User } from '../../shared/types';
import type { Deps } from '../context';
import type { Tx } from '../store/types';
import { audit, nowIso } from './common';
import { requireOrgAccess } from './organizers';
import { seatLabel } from './inventory';
import { createSession } from './users';

export type ScanActor =
  | { kind: 'user'; user: User }
  | { kind: 'scanner'; session: Session };

export type ScanOutcome = CheckinResult | 'underage';

export interface ScanResult {
  result: ScanOutcome;
  title: string;
  detail: string | null;
  warning: string | null;
  ticket: {
    id: string;
    number: string;
    typeName: string;
    holderName: string;
    seat: string | null;
    checkedInAt: string | null;
    age: number | null;
    ageVerified: boolean;
  } | null;
  otherEvent: string | null;
  stats: { checkedIn: number; total: number };
  at: string;
}

function actorLabel(actor: ScanActor): string {
  return actor.kind === 'user' ? actor.user.name : (actor.session.scanner?.label ?? 'Skanner');
}

export async function requireScanAccess(tx: Tx, actor: ScanActor, eventId: string): Promise<EventDoc> {
  const event = await tx.get('events', eventId);
  if (!event) throw new AppError('not_found');
  if (actor.kind === 'scanner') {
    if (actor.session.scanner?.eventId !== eventId) throw new AppError('forbidden');
    const code = await tx.get('scannerCodes', actor.session.scanner.codeId);
    if (!code || code.revoked) throw new AppError('invalid_scanner_code');
    return event;
  }
  await requireOrgAccess(tx, actor.user, event.organizerId, 'staff');
  return event;
}

async function eventStats(tx: Tx, eventId: string): Promise<{ checkedIn: number; total: number }> {
  const [valid, used] = await Promise.all([tx.count('tickets', { eventId, status: 'valid' }), tx.count('tickets', { eventId, status: 'used' })]);
  return { checkedIn: used, total: valid + used };
}

function normName(n: string): string[] {
  return n
    .toLocaleLowerCase('nb-NO')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[\s-]+/)
    .filter(Boolean);
}

/** Same person if first and last name match (middle names may be left out on either side). */
export function sameHolder(accountName: string, holderName: string): boolean {
  const a = normName(accountName);
  const b = normName(holderName);
  if (a.length === 0 || b.length === 0) return false;
  return a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
}

/**
 * The only age we know is the account owner's (verified through Vipps when possible). It applies to the
 * ticket only when the ticket carries the owner's own name – a friend's ticket that still sits in the
 * buyer's account says nothing about the friend's age, so the door checks ID instead.
 */
async function holderAge(tx: Tx, ticket: Ticket, event: EventDoc): Promise<{ age: number | null; verified: boolean; otherPerson: boolean }> {
  const owner = await tx.get('users', ticket.ownerId);
  if (!owner) return { age: null, verified: false, otherPerson: false };
  if (!sameHolder(owner.name, ticket.holderName)) return { age: null, verified: false, otherPerson: true };
  if (!owner.birthdate) return { age: null, verified: false, otherPerson: false };
  return { age: ageOn(owner.birthdate, event.startsAt), verified: owner.birthdateVerified, otherPerson: false };
}

const TITLES: Record<ScanOutcome, string> = {
  ok: 'Gyldig billett',
  already_used: 'Allerede sjekket inn',
  invalid: 'Ugyldig billett',
  wrong_event: 'Feil arrangement',
  cancelled: 'Billetten er ikke gyldig',
  expired_code: 'Utløpt kode',
  undo: 'Innsjekk angret',
  underage: 'Under aldersgrensen',
};

export async function scanTicket(
  deps: Deps,
  actor: ScanActor,
  input: { eventId: string; code: string; gate?: string | null | undefined; manual?: boolean | undefined },
): Promise<ScanResult> {
  const now = deps.clock();
  const nowS = now.toISOString();
  const gate = input.gate?.trim() || (actor.kind === 'scanner' ? (actor.session.scanner?.label ?? null) : null);
  const raw = input.code.trim();

  return deps.store.tx(async (tx) => {
    const event = await requireScanAccess(tx, actor, input.eventId);
    let ticket: Ticket | null = null;
    let manual = false;
    // The number is printed on the ticket and survives screenshots, so it proves nothing on its own: it is
    // only accepted when staff type it in by hand (and then always with an ID check).
    let bareNumber = false;
    const parsed = parseTicketCode(raw);
    if (parsed) {
      ticket = await tx.get('tickets', parsed.ticketId, { forUpdate: true });
    } else if (looksLikeTicketNumber(raw)) {
      if (input.manual) {
        manual = true;
        ticket = await tx.findOne('tickets', { number: raw.toUpperCase() }, { forUpdate: true });
      } else bareNumber = true;
    }

    const finish = async (result: ScanOutcome, detail: string | null, warning: string | null = null, t: Ticket | null = ticket, otherEvent: string | null = null): Promise<ScanResult> => {
      const log: CheckinLog = {
        id: newId(),
        eventId: event.id,
        ticketId: t?.id ?? null,
        result: result === 'underage' ? 'invalid' : result,
        actor: actorLabel(actor),
        gate,
        manual,
        at: nowS,
      };
      await tx.insert('checkins', log);
      let ticketInfo: ScanResult['ticket'] = null;
      if (t && t.eventId === event.id) {
        const age = await holderAge(tx, t, event);
        ticketInfo = {
          id: t.id,
          number: t.number,
          typeName: t.typeName,
          holderName: t.holderName,
          seat: seatLabel(t.seat),
          checkedInAt: t.checkedInAt,
          age: age.age,
          ageVerified: age.verified,
        };
      }
      return { result, title: TITLES[result], detail, warning, ticket: ticketInfo, otherEvent, stats: await eventStats(tx, event.id), at: nowS };
    };

    if (bareNumber) {
      return finish('invalid', 'Koden inneholder bare billettnummeret – det er ikke en gyldig billett. Be gjesten åpne billetten i TIKIT.', null, null);
    }
    if (!ticket) return finish('invalid', parsed ? 'Fant ingen billett med denne koden.' : 'Koden er ikke en TIKIT-billett.', null, null);
    if (ticket.eventId !== event.id) {
      const other = await tx.get('events', ticket.eventId);
      return finish('wrong_event', other ? `Billetten gjelder ${other.title}.` : 'Billetten gjelder et annet arrangement.', null, ticket, other?.title ?? null);
    }
    if (ticket.status === 'cancelled' || ticket.status === 'refunded') {
      return finish('cancelled', ticket.status === 'refunded' ? 'Billetten er refundert.' : 'Billetten er kansellert.');
    }
    if (parsed) {
      const check = await verifyTicketCode(parsed, ticket.secret, now.getTime());
      if (check === 'bad_signature') return finish('invalid', 'Koden hører til en eldre versjon av billetten (overført eller solgt videre).');
      if (check === 'expired') return finish('expired_code', 'Koden er for gammel – kanskje et skjermbilde. Be gjesten åpne billetten i TIKIT.');
      if (check === 'future') return finish('expired_code', 'Klokken på gjestens telefon går feil. Be gjesten slå på automatisk tid.');
    }
    if (ticket.resaleListingId) {
      const l = await tx.get('resaleListings', ticket.resaleListingId);
      if (l && (l.status === 'active' || l.status === 'reserved')) return finish('invalid', 'Billetten er lagt ut for videresalg.');
    }
    if (ticket.transferId) {
      const tr = await tx.get('transfers', ticket.transferId);
      if (tr?.status === 'pending' && tr.kind === 'transfer') return finish('invalid', 'Billetten er under overføring til en annen person.');
    }
    if (ticket.status === 'used') {
      const when = ticket.checkedInAt ? `kl. ${formatTime(ticket.checkedInAt)}` : '';
      return finish('already_used', `Sjekket inn ${when}${ticket.checkedInBy ? ` av ${ticket.checkedInBy}` : ''}.`.replace('  ', ' '));
    }
    let warning: string | null = null;
    if (event.ageLimit && event.ageLimit > 0) {
      const age = await holderAge(tx, ticket, event);
      if (age.age !== null && age.age < event.ageLimit) {
        return finish('underage', `Innehaver er ${age.age} år. Aldersgrensen er ${event.ageLimit} år.`);
      }
      if (age.otherPerson) warning = `Billetten ligger i en annen persons konto. Sjekk legitimasjonen til ${ticket.holderName}.`;
      else if (age.age === null) warning = 'Alderen er ikke registrert – sjekk legitimasjon.';
      else if (!age.verified) warning = 'Alderen er ikke bekreftet med Vipps – sjekk legitimasjon.';
    }
    if (manual) {
      const idCheck = `Manuell innsjekk: sjekk at legitimasjonen stemmer med ${ticket.holderName}.`;
      warning = warning ? `${idCheck} ${warning}` : idCheck;
    }
    const updated = await tx.update('tickets', ticket.id, { status: 'used', checkedInAt: nowS, checkedInBy: gate ?? actorLabel(actor), updatedAt: nowS });
    return finish('ok', updated.seat ? seatLabel(updated.seat) : null, warning, updated);
  });
}

export async function manualCheckin(deps: Deps, actor: ScanActor, input: { eventId: string; ticketId: string; undo: boolean }): Promise<ScanResult> {
  const nowS = nowIso(deps);
  if (!input.undo) {
    const number = await deps.store.read(async (tx) => {
      await requireScanAccess(tx, actor, input.eventId);
      const t = await tx.get('tickets', input.ticketId);
      if (!t || t.eventId !== input.eventId) throw new AppError('not_found');
      return t.number;
    });
    return scanTicket(deps, actor, { eventId: input.eventId, code: number, manual: true });
  }
  return deps.store.tx(async (tx) => {
    const event = await requireScanAccess(tx, actor, input.eventId);
    if (actor.kind === 'user') await requireOrgAccess(tx, actor.user, event.organizerId, 'staff');
    const ticket = await tx.get('tickets', input.ticketId, { forUpdate: true });
    if (!ticket || ticket.eventId !== event.id) throw new AppError('not_found');
    if (ticket.status !== 'used') throw new AppError('bad_request', { message: 'Billetten er ikke sjekket inn.' });
    const updated = await tx.update('tickets', ticket.id, { status: 'valid', checkedInAt: null, checkedInBy: null, updatedAt: nowS });
    await tx.insert('checkins', { id: newId(), eventId: event.id, ticketId: ticket.id, result: 'undo', actor: actorLabel(actor), gate: null, manual: true, at: nowS });
    return {
      result: 'undo',
      title: TITLES.undo,
      detail: `${updated.holderName} kan sjekkes inn på nytt.`,
      warning: null,
      ticket: { id: updated.id, number: updated.number, typeName: updated.typeName, holderName: updated.holderName, seat: seatLabel(updated.seat), checkedInAt: null, age: null, ageVerified: false },
      otherEvent: null,
      stats: await eventStats(tx, event.id),
      at: nowS,
    };
  });
}

export interface CheckinStats {
  eventId: string;
  title: string;
  startsAt: string;
  checkedIn: number;
  total: number;
  byType: { ticketTypeId: string; name: string; checkedIn: number; total: number }[];
  byGate: { gate: string; count: number }[];
  recent: { id: string; result: CheckinLog['result']; at: string; holderName: string | null; typeName: string | null; gate: string | null; actor: string }[];
  timeline: { at: string; count: number }[];
}

export async function getCheckinStats(deps: Deps, actor: ScanActor, eventId: string): Promise<CheckinStats> {
  return deps.store.read(async (tx) => {
    const event = await requireScanAccess(tx, actor, eventId);
    const tickets = (await tx.find('tickets', { eventId })).filter((t) => t.status === 'valid' || t.status === 'used');
    const types = await tx.find('ticketTypes', { eventId });
    const logs = await tx.find('checkins', { eventId }, { orderBy: { field: 'at', dir: 'desc' } });
    const byGate = new Map<string, number>();
    for (const t of tickets) if (t.status === 'used') byGate.set(t.checkedInBy ?? 'Ukjent', (byGate.get(t.checkedInBy ?? 'Ukjent') ?? 0) + 1);
    const slots = new Map<string, number>();
    for (const t of tickets) {
      if (!t.checkedInAt) continue;
      const d = new Date(t.checkedInAt);
      d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15, 0, 0);
      const key = d.toISOString();
      slots.set(key, (slots.get(key) ?? 0) + 1);
    }
    const ticketById = new Map(tickets.map((t) => [t.id, t]));
    return {
      eventId,
      title: event.title,
      startsAt: event.startsAt,
      checkedIn: tickets.filter((t) => t.status === 'used').length,
      total: tickets.length,
      byType: types
        .map((tt) => {
          const of = tickets.filter((t) => t.ticketTypeId === tt.id);
          return { ticketTypeId: tt.id, name: tt.name, checkedIn: of.filter((t) => t.status === 'used').length, total: of.length };
        })
        .filter((x) => x.total > 0),
      byGate: [...byGate.entries()].map(([gate, count]) => ({ gate, count })).sort((a, b) => b.count - a.count),
      recent: logs.slice(0, 25).map((l) => {
        const t = l.ticketId ? ticketById.get(l.ticketId) : undefined;
        return { id: l.id, result: l.result, at: l.at, holderName: t?.holderName ?? null, typeName: t?.typeName ?? null, gate: l.gate, actor: l.actor };
      }),
      timeline: [...slots.entries()].map(([at, count]) => ({ at, count })).sort((a, b) => a.at.localeCompare(b.at)),
    };
  });
}

export interface Attendee {
  ticketId: string;
  number: string;
  holderName: string;
  typeName: string;
  seat: string | null;
  status: Ticket['status'];
  kind: Ticket['kind'];
  checkedInAt: string | null;
  orderId: string;
  orderRef: string;
  buyerName: string;
  buyerEmail: string | null;
  buyerPhone: string | null;
  pricePaidOre: number;
}

export async function listAttendees(deps: Deps, actor: ScanActor, eventId: string, includePii: boolean): Promise<Attendee[]> {
  return deps.store.read(async (tx) => {
    await requireScanAccess(tx, actor, eventId);
    const tickets = await tx.find('tickets', { eventId });
    const orderIds = [...new Set(tickets.map((t) => t.orderId))];
    const orders = await tx.getMany('orders', orderIds);
    const orderById = new Map(orders.map((o) => [o.id, o]));
    return tickets
      .filter((t) => t.status !== 'cancelled')
      .map((t) => {
        const o = orderById.get(t.orderId);
        return {
          ticketId: t.id,
          number: t.number,
          holderName: t.holderName,
          typeName: t.typeName,
          seat: seatLabel(t.seat),
          status: t.status,
          kind: t.kind,
          checkedInAt: t.checkedInAt,
          orderId: t.orderId,
          orderRef: o?.ref ?? '',
          buyerName: o?.buyer.name ?? '',
          buyerEmail: includePii ? (o?.buyer.email ?? null) : null,
          buyerPhone: includePii ? (o?.buyer.phone ?? null) : null,
          pricePaidOre: t.pricePaidOre,
        };
      })
      .sort((a, b) => a.holderName.localeCompare(b.holderName, 'nb'));
  });
}

// ── Scanner codes (door staff without accounts) ─────────────────────────────

async function scannerCodeHash(code: string): Promise<string> {
  return sha256Hex(`scanner:${code.replace(/\D/g, '')}`);
}

export async function createScannerCode(deps: Deps, user: User, organizerId: string, eventId: string, label: string): Promise<{ code: string; scannerCode: Omit<ScannerCode, 'codeHash'> }> {
  const nowS = nowIso(deps);
  return deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const event = await tx.get('events', eventId);
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    const existing = await tx.find('scannerCodes', { eventId, revoked: false });
    if (existing.length >= 30) throw new AppError('validation', { message: 'Maks 30 aktive skannerkoder per arrangement.' });
    const code = numericCode(3, 4);
    const sc: ScannerCode = { id: newId(), eventId, organizerId, label, codeHash: await scannerCodeHash(code), createdBy: user.id, createdAt: nowS, revoked: false, lastUsedAt: null };
    await tx.insert('scannerCodes', sc);
    await audit(tx, deps, user.id, 'scanner_code.created', 'events', eventId, { label });
    const { codeHash: _omit, ...rest } = sc;
    void _omit;
    return { code, scannerCode: rest };
  });
}

export async function listScannerCodes(deps: Deps, user: User, organizerId: string, eventId: string): Promise<Omit<ScannerCode, 'codeHash'>[]> {
  return deps.store.read(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const codes = await tx.find('scannerCodes', { eventId });
    return codes
      .filter((c) => c.organizerId === organizerId)
      .map(({ codeHash: _h, ...rest }) => {
        void _h;
        return rest;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

export async function revokeScannerCode(deps: Deps, user: User, organizerId: string, codeId: string): Promise<void> {
  await deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const code = await tx.get('scannerCodes', codeId);
    if (!code || code.organizerId !== organizerId) throw new AppError('not_found');
    await tx.update('scannerCodes', codeId, { revoked: true });
    const sessions = await tx.find('sessions', { kind: 'scanner' });
    for (const s of sessions) if (s.scanner?.codeId === codeId) await tx.delete('sessions', s.id);
  });
}

export async function scannerLogin(deps: Deps, code: string, userAgent: string | null): Promise<{ token: string; eventId: string; label: string; eventTitle: string }> {
  const now = deps.clock();
  const hash = await scannerCodeHash(code);
  return deps.store.tx(async (tx) => {
    const sc = await tx.findOne('scannerCodes', { codeHash: hash });
    if (!sc || sc.revoked) throw new AppError('invalid_scanner_code');
    const event = await tx.get('events', sc.eventId);
    if (!event || event.status === 'cancelled') throw new AppError('invalid_scanner_code');
    if (new Date(event.endsAt).getTime() + 12 * 3600000 < now.getTime()) throw new AppError('invalid_scanner_code', { message: 'Arrangementet er over, og koden er ikke lenger gyldig.' });
    await tx.update('scannerCodes', sc.id, { lastUsedAt: now.toISOString() });
    const { token } = await createSession(deps, tx, {
      userId: null,
      kind: 'scanner',
      scanner: { eventId: sc.eventId, organizerId: sc.organizerId, codeId: sc.id, label: sc.label },
      userAgent,
      ttlMs: LIMITS.scannerSessionHours * 3600000,
    });
    return { token, eventId: sc.eventId, label: sc.label, eventTitle: event.title };
  });
}

/** Everything a scanner device needs to validate tickets offline (secrets included – staff only). */
export async function offlineManifest(deps: Deps, actor: ScanActor, eventId: string): Promise<{ eventId: string; generatedAt: string; tickets: { id: string; number: string; secret: string; status: Ticket['status']; holderName: string; typeName: string; seat: string | null; frozen: boolean }[] }> {
  return deps.store.read(async (tx) => {
    await requireScanAccess(tx, actor, eventId);
    const tickets = await tx.find('tickets', { eventId });
    return {
      eventId,
      generatedAt: nowIso(deps),
      tickets: tickets
        .filter((t) => t.status === 'valid' || t.status === 'used')
        .map((t) => ({ id: t.id, number: t.number, secret: t.secret, status: t.status, holderName: t.holderName, typeName: t.typeName, seat: seatLabel(t.seat), frozen: !!t.resaleListingId })),
    };
  });
}
