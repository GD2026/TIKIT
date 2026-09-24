import type { EventDoc, SeatMap, SeatRef, SeatState, SeatStateEntry, TicketType } from '../../shared/types';
import type { Tx } from '../store/types';

export async function loadTicketTypes(tx: Tx, eventId: string, forUpdate = false): Promise<TicketType[]> {
  const types = await tx.find('ticketTypes', { eventId }, { forUpdate });
  return types.sort((a, b) => a.sortOrder - b.sortOrder || a.priceOre - b.priceOre || a.createdAt.localeCompare(b.createdAt));
}

/** Active (unexpired) holds per ticket type for an event. */
export async function activeHeld(tx: Tx, eventId: string, nowIso: string, excludeOrderId: string | null = null): Promise<Map<string, number>> {
  const holds = await tx.find('holds', { eventId });
  const out = new Map<string, number>();
  for (const h of holds) {
    if (h.expiresAt <= nowIso) continue;
    if (excludeOrderId && h.orderId === excludeOrderId) continue;
    out.set(h.ticketTypeId, (out.get(h.ticketTypeId) ?? 0) + h.qty);
  }
  return out;
}

export function availableOf(tt: TicketType, held: Map<string, number>): number {
  return Math.max(0, tt.capacity - tt.sold - (held.get(tt.id) ?? 0));
}

export async function typesWithAvailability(tx: Tx, event: EventDoc, nowIso: string): Promise<{ tt: TicketType; available: number }[]> {
  const types = await loadTicketTypes(tx, event.id);
  const held = await activeHeld(tx, event.id, nowIso);
  return types.map((tt) => ({ tt, available: availableOf(tt, held) }));
}

// ── Seats ────────────────────────────────────────────────────────────────────

export function seatIdFor(sectionId: string, rowLabel: string, number: number): string {
  return `${sectionId}-${rowLabel}-${number}`;
}

export interface SeatInfo {
  ref: SeatRef;
  ticketTypeId: string;
  accessible: boolean;
}

export function indexSeats(map: SeatMap): Map<string, SeatInfo> {
  const out = new Map<string, SeatInfo>();
  for (const section of map.sections) {
    for (const row of section.rows) {
      for (const seat of row.seats) {
        out.set(seat.id, {
          ref: { id: seat.id, section: section.name, row: row.label, number: seat.number },
          ticketTypeId: section.ticketTypeId,
          accessible: seat.accessible,
        });
      }
    }
  }
  return out;
}

export async function loadSeatState(tx: Tx, eventId: string, nowIso: string, forUpdate = false): Promise<SeatState> {
  const existing = await tx.get('seatStates', eventId, { forUpdate });
  return existing ?? { id: eventId, eventId, seats: {}, updatedAt: nowIso };
}

/** A seat is free when it has no entry, or its hold has expired (and isn't held by `orderId`). */
export function seatIsFree(entry: SeatStateEntry | undefined, nowIso: string, orderId: string | null = null): boolean {
  if (!entry) return true;
  if (entry.status === 'held') {
    if (orderId && entry.orderId === orderId) return true;
    return !!entry.until && entry.until <= nowIso;
  }
  return false;
}

export function seatLabel(seat: SeatRef | null): string | null {
  if (!seat) return null;
  return `${seat.section}, rad ${seat.row}, sete ${seat.number}`;
}
