import { AppError } from '../../shared/errors';
import { newId, newToken } from '../../shared/ids';
import { sha256Hex } from '../../shared/encoding';
import { LIMITS, refundDeadline } from '../../shared/constants';
import { isValidEmail, normalizeEmail, normalizePhone } from '../../shared/validation';
import { feeForPrice, resalePayout } from '../../shared/pricing';
import type { EventDoc, Organizer, ResaleListing, Ticket, TicketDTO, Transfer, User } from '../../shared/types';
import type { Deps } from '../context';
import { appLink } from '../context';
import type { Tx } from '../store/types';
import { audit, getSettings, notify, nowIso, sendMailSafe } from './common';
import { toEventCard } from './dto';
import { activeHeld, availableOf, loadTicketTypes } from './inventory';
import { checkAge, freshTicketNumber } from './orders';
import { notifyWaitlist } from './waitlist';
import { renderEmail } from './emails';
import { formatEventWhen } from '../../shared/time';

interface TicketContext {
  event: EventDoc;
  org: Organizer;
  now: Date;
}

async function toTicketDTO(tx: Tx, deps: Deps, ticket: Ticket, viewer: User, ctx: TicketContext): Promise<TicketDTO> {
  const { event, org, now } = ctx;
  const nowS = now.toISOString();
  const types = await loadTicketTypes(tx, event.id);
  const held = await activeHeld(tx, event.id, nowS);
  const card = toEventCard(
    event,
    org,
    types.map((tt) => ({ tt, available: availableOf(tt, held) })),
    now,
  );
  const order = await tx.get('orders', ticket.orderId);
  const transfer = ticket.transferId ? await tx.get('transfers', ticket.transferId) : null;
  const listing = ticket.resaleListingId ? await tx.get('resaleListings', ticket.resaleListingId) : null;
  const owner = ticket.ownerId === viewer.id ? viewer : await tx.get('users', ticket.ownerId);
  const purchaser = ticket.purchaserId !== ticket.ownerId ? await tx.get('users', ticket.purchaserId) : null;

  const live = event.status !== 'cancelled' && event.endsAt > nowS;
  const pendingTransfer = transfer?.status === 'pending' ? transfer : null;
  const activeListing = listing && (listing.status === 'active' || listing.status === 'reserved') ? listing : null;
  const frozen = !!pendingTransfer || !!activeListing;
  const isOwner = ticket.ownerId === viewer.id;
  const boughtByOwner = ticket.purchaserId === ticket.ownerId;
  const deadline = refundDeadline(event.settings.refundPolicy, event.startsAt);

  const canTransfer = isOwner && live && ticket.status === 'valid' && !frozen && event.settings.transfersAllowed;
  const canResell =
    isOwner &&
    live &&
    ticket.status === 'valid' &&
    !frozen &&
    event.settings.resaleAllowed &&
    boughtByOwner &&
    ticket.pricePaidOre > 0 &&
    event.startsAt > nowS;
  const canRefund =
    isOwner && live && ticket.status === 'valid' && !frozen && boughtByOwner && ticket.kind !== 'comp' && !!deadline && deadline.toISOString() > nowS;

  return {
    id: ticket.id,
    number: ticket.number,
    status: ticket.status,
    kind: ticket.kind,
    typeName: ticket.typeName,
    holderName: ticket.holderName,
    seat: ticket.seat,
    pricePaidOre: ticket.pricePaidOre,
    secret: isOwner && ticket.status === 'valid' && !frozen && live ? ticket.secret : null,
    checkedInAt: ticket.checkedInAt,
    event: {
      ...card,
      venue: event.venue,
      doorsAt: event.doorsAt,
      settings: { transfersAllowed: event.settings.transfersAllowed, resaleAllowed: event.settings.resaleAllowed, refundPolicy: event.settings.refundPolicy },
    },
    orderId: ticket.orderId,
    orderRef: order?.ref ?? ticket.number.slice(0, 9),
    canTransfer,
    canResell,
    canRefund,
    refundDeadline: deadline ? deadline.toISOString() : null,
    resaleMaxOre: ticket.pricePaidOre,
    transfer: pendingTransfer
      ? { id: pendingTransfer.id, status: pendingTransfer.status, toContact: pendingTransfer.toContact, link: null, createdAt: pendingTransfer.createdAt }
      : null,
    resale: activeListing ? { id: activeListing.id, priceOre: activeListing.priceOre, status: activeListing.status, payoutOre: activeListing.payoutOre } : null,
    ageVerified: !!owner?.birthdateVerified,
    receivedFrom: purchaser ? purchaser.name : null,
  };
}

export async function listMyTickets(deps: Deps, user: User): Promise<TicketDTO[]> {
  const now = deps.clock();
  return deps.store.read(async (tx) => {
    const owned = await tx.find('tickets', { ownerId: user.id });
    const out: TicketDTO[] = [];
    const cache = new Map<string, TicketContext | null>();
    for (const t of owned) {
      if (t.status === 'cancelled') continue;
      if (t.transferId) {
        const tr = await tx.get('transfers', t.transferId);
        if (tr?.status === 'pending' && tr.kind === 'guest') continue; // organiser comp awaiting claim
      }
      let ctx = cache.get(t.eventId);
      if (ctx === undefined) {
        const event = await tx.get('events', t.eventId);
        const org = event ? await tx.get('organizers', event.organizerId) : null;
        ctx = event && org ? { event, org, now } : null;
        cache.set(t.eventId, ctx);
      }
      if (!ctx) continue;
      out.push(await toTicketDTO(tx, deps, t, user, ctx));
    }
    return out.sort((a, b) => a.event.startsAt.localeCompare(b.event.startsAt) || a.number.localeCompare(b.number));
  });
}

export async function getTicket(deps: Deps, user: User, ticketId: string): Promise<TicketDTO> {
  const now = deps.clock();
  return deps.store.read(async (tx) => {
    const t = await tx.get('tickets', ticketId);
    if (!t || t.ownerId !== user.id) throw new AppError('not_found');
    const event = await tx.get('events', t.eventId);
    const org = event ? await tx.get('organizers', event.organizerId) : null;
    if (!event || !org) throw new AppError('not_found');
    return toTicketDTO(tx, deps, t, user, { event, org, now });
  });
}

// ── Transfers ────────────────────────────────────────────────────────────────

async function findUserByContact(tx: Tx, contact: string): Promise<User | null> {
  if (isValidEmail(normalizeEmail(contact))) {
    const users = await tx.find('users', { email: normalizeEmail(contact), emailVerified: true });
    return users.find((u) => !u.deletedAt && !u.banned) ?? null;
  }
  const phone = normalizePhone(contact);
  if (phone) {
    const users = await tx.find('users', { phone, phoneVerified: true });
    return users.find((u) => !u.deletedAt && !u.banned) ?? null;
  }
  return null;
}

export async function createTransferTx(
  tx: Tx,
  deps: Deps,
  args: { ticket: Ticket; event: EventDoc; from: User; contact: string | null; message: string | null; kind: Transfer['kind'] },
): Promise<{ transfer: Transfer; link: string; recipient: User | null }> {
  const nowS = nowIso(deps);
  const token = newToken(24);
  let recipient: User | null = null;
  let toContact: string | null = null;
  if (args.contact) {
    const c = args.contact.trim();
    const email = normalizeEmail(c);
    const phone = normalizePhone(c);
    if (!isValidEmail(email) && !phone) throw new AppError('validation', { fields: { contact: 'Skriv en e-postadresse eller et mobilnummer.' } });
    toContact = isValidEmail(email) ? email : phone;
    recipient = await findUserByContact(tx, c);
    if (recipient && recipient.id === args.from.id && args.kind === 'transfer') throw new AppError('transfer_self');
  }
  const expires = Math.min(Date.parse(nowS) + LIMITS.transferExpiryDays * 86400000, Date.parse(args.event.endsAt));
  const transfer: Transfer = {
    id: newId(),
    ticketId: args.ticket.id,
    eventId: args.event.id,
    fromUserId: args.from.id,
    toUserId: recipient?.id ?? null,
    toContact,
    tokenHash: await sha256Hex(`transfer:${token}`),
    message: args.message,
    status: 'pending',
    kind: args.kind,
    createdAt: nowS,
    expiresAt: new Date(expires).toISOString(),
    acceptedAt: null,
  };
  await tx.insert('transfers', transfer);
  await tx.update('tickets', args.ticket.id, { transferId: transfer.id, updatedAt: nowS });
  const link = appLink(deps.config, `/overfor/${token}`);
  const title = args.kind === 'guest' ? `Du har fått en billett til ${args.event.title}` : `${args.from.name} sender deg en billett`;
  const body = args.kind === 'guest' ? `${args.event.title} – trykk for å legge billetten i appen.` : `${args.event.title}. Trykk for å ta imot billetten.`;
  if (recipient) {
    await notify(tx, deps, recipient.id, {
      kind: args.kind === 'guest' ? 'guest_ticket' : 'transfer_received',
      title,
      body,
      link: `/overfor/${token}`,
      email: {
        subject: title,
        heading: title,
        paragraphs: [
          `${args.event.title} – ${formatEventWhen(args.event.startsAt)}, ${args.event.venue.name}.`,
          ...(args.message ? [`Melding: «${args.message}»`] : []),
          'Trykk på knappen for å legge billetten til i TIKIT.',
        ],
        cta: { label: 'Ta imot billetten', url: link },
      },
      transactional: true,
    });
  } else if (toContact && isValidEmail(toContact)) {
    // Mail to an address without an account goes out from TIKIT's own domain, so it must not work as a
    // relay for someone else's text: a fixed subject, only the sender's first name, no links in the note,
    // and a daily cap per sender (cancelled transfers count too).
    const since = new Date(Date.parse(nowS) - 86_400_000).toISOString();
    const sentToday = (await tx.find('transfers', { fromUserId: args.from.id })).filter(
      (t) => t.id !== transfer.id && !t.toUserId && t.toContact?.includes('@') && t.createdAt >= since,
    ).length;
    if (sentToday >= LIMITS.externalTransferMailsPerDay) {
      throw new AppError('rate_limited', { message: 'Du har sendt billetter til mange e-postadresser i dag. Del lenken direkte, eller prøv igjen i morgen.' });
    }
    const subject = args.kind === 'guest' ? title : `Du har fått en billett til ${args.event.title}`;
    const firstName = args.from.name.trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{M}'-]/gu, '').slice(0, 30) ?? '';
    const note = args.message ? stripLinks(args.message) : '';
    const mail = renderEmail({
      appName: 'TIKIT',
      heading: subject,
      paragraphs: [
        `${args.event.title} – ${formatEventWhen(args.event.startsAt)}, ${args.event.venue.name}.`,
        ...(args.kind !== 'guest' && firstName ? [`Fra ${firstName}.`] : []),
        ...(note ? [`Melding: «${note}»`] : []),
        'Logg inn i TIKIT med Vipps, Google eller Apple for å ta imot billetten.',
      ],
      cta: { label: 'Ta imot billetten', url: link },
    });
    const to = toContact;
    tx.afterCommit(() => sendMailSafe(deps, { to, subject, html: mail.html, text: mail.text }));
  }
  return { transfer, link, recipient };
}

/** Personal notes in e-mails stay plain text: anything that looks like a link or web address is dropped. */
function stripLinks(text: string): string {
  return text
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, '')
    .replace(/\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:no|com|net|org|io|app|link|ly|me|info|xyz|site|online|shop|co|uk|se|dk|de|eu)\b\S*/giu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export async function createTransfer(deps: Deps, user: User, ticketId: string, contact: string | null, message: string | null): Promise<{ transferId: string; link: string; recipientName: string | null }> {
  const nowS = nowIso(deps);
  return deps.store.tx(async (tx) => {
    const ticket = await tx.get('tickets', ticketId, { forUpdate: true });
    if (!ticket || ticket.ownerId !== user.id) throw new AppError('not_found');
    const event = await tx.get('events', ticket.eventId);
    if (!event) throw new AppError('not_found');
    if (!event.settings.transfersAllowed || ticket.status !== 'valid' || event.status === 'cancelled' || event.endsAt <= nowS) {
      throw new AppError('ticket_not_transferable');
    }
    if (ticket.transferId || ticket.resaleListingId) {
      if (ticket.transferId) {
        const tr = await tx.get('transfers', ticket.transferId);
        if (tr && tr.status === 'pending') throw new AppError('ticket_busy');
      } else throw new AppError('ticket_busy');
    }
    const { transfer, link, recipient } = await createTransferTx(tx, deps, { ticket, event, from: user, contact, message, kind: 'transfer' });
    await audit(tx, deps, user.id, 'transfer.created', 'tickets', ticket.id, { transferId: transfer.id });
    return { transferId: transfer.id, link, recipientName: recipient?.name ?? null };
  });
}

export async function cancelTransfer(deps: Deps, user: User, transferId: string): Promise<void> {
  await deps.store.tx(async (tx) => {
    const tr = await tx.get('transfers', transferId, { forUpdate: true });
    if (!tr || tr.fromUserId !== user.id) throw new AppError('not_found');
    if (tr.status !== 'pending') return;
    await tx.update('transfers', tr.id, { status: 'cancelled' });
    const ticket = await tx.get('tickets', tr.ticketId, { forUpdate: true });
    if (ticket && ticket.transferId === tr.id) await tx.update('tickets', ticket.id, { transferId: null, updatedAt: nowIso(deps) });
  });
}

export interface TransferPreview {
  status: Transfer['status'] | 'expired';
  kind: Transfer['kind'];
  fromName: string;
  message: string | null;
  typeName: string;
  seat: Ticket['seat'];
  event: { title: string; startsAt: string; venueName: string; city: string; slug: string; poster: EventDoc['poster']; coverUrl: string | null; ageLimit: number | null };
  expiresAt: string;
  isOwnTransfer: boolean;
}

async function loadTransferByToken(tx: Tx, token: string, forUpdate = false): Promise<Transfer | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const hash = await sha256Hex(`transfer:${token}`);
  return tx.findOne('transfers', { tokenHash: hash }, { forUpdate });
}

export async function previewTransfer(deps: Deps, token: string, viewer: User | null): Promise<TransferPreview> {
  const nowS = nowIso(deps);
  return deps.store.read(async (tx) => {
    const tr = await loadTransferByToken(tx, token);
    if (!tr) throw new AppError('transfer_invalid');
    const ticket = await tx.get('tickets', tr.ticketId);
    const event = await tx.get('events', tr.eventId);
    const from = await tx.get('users', tr.fromUserId);
    const org = event ? await tx.get('organizers', event.organizerId) : null;
    if (!ticket || !event || !org) throw new AppError('transfer_invalid');
    const status = tr.status === 'pending' && tr.expiresAt <= nowS ? 'expired' : tr.status;
    return {
      status,
      kind: tr.kind,
      fromName: tr.kind === 'guest' ? org.name : (from?.name ?? 'Ukjent'),
      message: tr.message,
      typeName: ticket.typeName,
      seat: ticket.seat,
      event: {
        title: event.title,
        startsAt: event.startsAt,
        venueName: event.venue.name,
        city: event.city,
        slug: event.slug,
        poster: event.poster,
        coverUrl: event.coverImageId ? `/api/images/${event.coverImageId}` : null,
        ageLimit: event.ageLimit,
      },
      expiresAt: tr.expiresAt,
      isOwnTransfer: !!viewer && viewer.id === tr.fromUserId && tr.kind === 'transfer',
    };
  });
}

export async function acceptTransfer(deps: Deps, user: User, token: string): Promise<{ ticketId: string }> {
  const nowS = nowIso(deps);
  return deps.store.tx(async (tx) => {
    const tr = await loadTransferByToken(tx, token, true);
    if (!tr || tr.status !== 'pending' || tr.expiresAt <= nowS) throw new AppError('transfer_invalid');
    if (tr.fromUserId === user.id && tr.kind === 'transfer') throw new AppError('transfer_self');
    const ticket = await tx.get('tickets', tr.ticketId, { forUpdate: true });
    const event = await tx.get('events', tr.eventId);
    if (!ticket || !event || ticket.transferId !== tr.id || ticket.status !== 'valid') throw new AppError('transfer_invalid');
    if (event.status === 'cancelled') throw new AppError('event_cancelled');
    checkAge(event, user);
    await tx.update('tickets', ticket.id, {
      ownerId: user.id,
      holderName: user.name,
      secret: newToken(16),
      // The sender's old number (receipt, screenshots) stops working at the door.
      number: await freshTicketNumber(tx),
      transferId: null,
      updatedAt: nowS,
    });
    await tx.update('transfers', tr.id, { status: 'accepted', acceptedAt: nowS, toUserId: user.id });
    if (tr.kind === 'transfer') {
      await notify(tx, deps, tr.fromUserId, {
        kind: 'transfer_accepted',
        title: 'Billetten er overført',
        body: `${user.name} har tatt imot billetten til ${event.title}.`,
        link: '/billetter',
        email: null,
      });
    }
    await audit(tx, deps, user.id, 'transfer.accepted', 'tickets', ticket.id, { transferId: tr.id });
    return { ticketId: ticket.id };
  });
}

/** Cron: expires pending transfers. */
export async function expireTransfers(deps: Deps): Promise<number> {
  const nowS = nowIso(deps);
  return deps.store.tx(async (tx) => {
    const pending = await tx.find('transfers', { status: 'pending' });
    let n = 0;
    for (const tr of pending) {
      if (tr.expiresAt > nowS) continue;
      await tx.update('transfers', tr.id, { status: 'expired' });
      const ticket = await tx.get('tickets', tr.ticketId);
      if (ticket && ticket.transferId === tr.id) await tx.update('tickets', ticket.id, { transferId: null, updatedAt: nowS });
      n++;
    }
    return n;
  });
}

// ── Resale ───────────────────────────────────────────────────────────────────

export async function createResaleListing(deps: Deps, user: User, ticketId: string, priceOre: number): Promise<ResaleListing> {
  const nowS = nowIso(deps);
  return deps.store.tx(async (tx) => {
    const ticket = await tx.get('tickets', ticketId, { forUpdate: true });
    if (!ticket || ticket.ownerId !== user.id) throw new AppError('not_found');
    const event = await tx.get('events', ticket.eventId);
    if (!event) throw new AppError('not_found');
    if (!event.settings.resaleAllowed || ticket.status !== 'valid' || event.status !== 'published' || event.startsAt <= nowS) {
      throw new AppError('ticket_not_resellable');
    }
    if (ticket.purchaserId !== user.id) throw new AppError('received_ticket_resale');
    if (ticket.pricePaidOre <= 0) throw new AppError('ticket_not_resellable');
    if (priceOre > ticket.pricePaidOre) throw new AppError('resale_price_too_high');
    if (ticket.resaleListingId || ticket.transferId) {
      const busyTransfer = ticket.transferId ? await tx.get('transfers', ticket.transferId) : null;
      if (ticket.resaleListingId || busyTransfer?.status === 'pending') throw new AppError('ticket_busy');
    }
    const settings = await getSettings(tx, deps);
    const listing: ResaleListing = {
      id: newId(),
      ticketId: ticket.id,
      eventId: event.id,
      ticketTypeId: ticket.ticketTypeId,
      sellerId: user.id,
      priceOre,
      status: 'active',
      reservedByOrderId: null,
      reservedUntil: null,
      buyerOrderId: null,
      payoutOre: Math.min(resalePayout(priceOre, settings.resaleFeePercentBp), ticket.pricePaidOre),
      createdAt: nowS,
      soldAt: null,
    };
    await tx.insert('resaleListings', listing);
    await tx.update('tickets', ticket.id, { resaleListingId: listing.id, transferId: null, updatedAt: nowS });
    await notifyWaitlist(tx, deps, event);
    await audit(tx, deps, user.id, 'resale.listed', 'tickets', ticket.id, { priceOre });
    return listing;
  });
}

export async function cancelResaleListing(deps: Deps, user: User, listingId: string): Promise<void> {
  const nowS = nowIso(deps);
  await deps.store.tx(async (tx) => {
    const listing = await tx.get('resaleListings', listingId, { forUpdate: true });
    if (!listing || listing.sellerId !== user.id) throw new AppError('not_found');
    if (listing.status === 'sold' || listing.status === 'cancelled') return;
    if (listing.status === 'reserved' && listing.reservedUntil && listing.reservedUntil > nowS) {
      throw new AppError('conflict', { message: 'Noen holder på å kjøpe billetten akkurat nå. Prøv igjen om noen minutter.' });
    }
    await tx.update('resaleListings', listing.id, { status: 'cancelled', reservedByOrderId: null, reservedUntil: null });
    const ticket = await tx.get('tickets', listing.ticketId, { forUpdate: true });
    if (ticket && ticket.resaleListingId === listing.id) await tx.update('tickets', ticket.id, { resaleListingId: null, updatedAt: nowS });
  });
}

export interface ResaleOffer {
  id: string;
  priceOre: number;
  feeOre: number;
  typeName: string;
  seat: Ticket['seat'];
}

export async function listResaleOffers(deps: Deps, eventId: string, viewer: User | null): Promise<ResaleOffer[]> {
  const nowS = nowIso(deps);
  return deps.store.read(async (tx) => {
    const settings = await getSettings(tx, deps);
    const listings = await tx.find('resaleListings', { eventId });
    const available = listings.filter(
      (l) => (l.status === 'active' || (l.status === 'reserved' && !!l.reservedUntil && l.reservedUntil <= nowS)) && l.sellerId !== viewer?.id,
    );
    const tickets = await tx.getMany(
      'tickets',
      available.map((l) => l.ticketId),
    );
    return available
      .map((l) => {
        const t = tickets.find((x) => x.id === l.ticketId);
        return { id: l.id, priceOre: l.priceOre, feeOre: feeForPrice(l.priceOre, settings), typeName: t?.typeName ?? 'Billett', seat: t?.seat ?? null };
      })
      .sort((a, b) => a.priceOre - b.priceOre);
  });
}
