import { AppError } from '../../shared/errors';
import { newId } from '../../shared/ids';
import type { DiscountCode, User } from '../../shared/types';
import type { DiscountInput } from '../../shared/schemas';
import type { Deps } from '../context';
import { UniqueViolation } from '../store/types';
import { audit, nowIso } from './common';
import { requireOrgAccess } from './organizers';
import { isPaidStatus } from './orders';

export interface DiscountWithStats extends DiscountCode {
  paidUses: number;
  discountGivenOre: number;
}

async function eventOf(deps: Deps, user: User, organizerId: string, eventId: string, min: 'staff' | 'admin') {
  return deps.store.read(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, min);
    const event = await tx.get('events', eventId);
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    return event;
  });
}

export async function listDiscounts(deps: Deps, user: User, organizerId: string, eventId: string): Promise<DiscountWithStats[]> {
  // Codes are as good as money off – only organizer admins see them (door staff never need them).
  await eventOf(deps, user, organizerId, eventId, 'admin');
  return deps.store.read(async (tx) => {
    const codes = await tx.find('discountCodes', { eventId });
    const orders = (await tx.find('orders', { eventId })).filter((o) => o.discount && isPaidStatus(o.status));
    return codes
      .map((c) => {
        const using = orders.filter((o) => o.discount?.codeId === c.id);
        return { ...c, paidUses: using.length, discountGivenOre: using.reduce((s, o) => s + o.discountOre, 0) };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
}

export async function createDiscount(deps: Deps, user: User, organizerId: string, eventId: string, input: DiscountInput): Promise<DiscountCode> {
  return deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const event = await tx.get('events', eventId);
    if (!event || event.organizerId !== organizerId) throw new AppError('not_found');
    const types = await tx.find('ticketTypes', { eventId });
    if (input.ticketTypeIds.some((id) => !types.some((t) => t.id === id))) throw new AppError('invalid_ticket_type');
    const dc: DiscountCode = {
      id: newId(),
      eventId,
      organizerId,
      code: input.code,
      kind: input.kind,
      value: input.value,
      maxUses: input.maxUses,
      used: 0,
      ticketTypeIds: input.ticketTypeIds,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      active: input.active,
      createdAt: nowIso(deps),
    };
    try {
      await tx.insert('discountCodes', dc);
    } catch (err) {
      if (err instanceof UniqueViolation) throw new AppError('discount_code_exists');
      throw err;
    }
    await audit(tx, deps, user.id, 'discount.created', 'events', eventId, { code: dc.code });
    return dc;
  });
}

export async function updateDiscount(deps: Deps, user: User, organizerId: string, codeId: string, input: DiscountInput): Promise<DiscountCode> {
  return deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const dc = await tx.get('discountCodes', codeId, { forUpdate: true });
    if (!dc || dc.organizerId !== organizerId) throw new AppError('not_found');
    if (dc.used > 0 && (input.code !== dc.code || input.kind !== dc.kind || input.value !== dc.value)) {
      throw new AppError('validation', { message: 'Koden er allerede brukt. Du kan bare endre gyldighet, antall og om den er aktiv.' });
    }
    try {
      return await tx.update('discountCodes', codeId, {
        code: input.code,
        kind: input.kind,
        value: input.value,
        maxUses: input.maxUses,
        ticketTypeIds: input.ticketTypeIds,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        active: input.active,
      });
    } catch (err) {
      if (err instanceof UniqueViolation) throw new AppError('discount_code_exists');
      throw err;
    }
  });
}

export async function deleteDiscount(deps: Deps, user: User, organizerId: string, codeId: string): Promise<'deleted' | 'deactivated'> {
  return deps.store.tx(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'admin');
    const dc = await tx.get('discountCodes', codeId, { forUpdate: true });
    if (!dc || dc.organizerId !== organizerId) throw new AppError('not_found');
    if (dc.used > 0) {
      await tx.update('discountCodes', codeId, { active: false });
      return 'deactivated';
    }
    await tx.delete('discountCodes', codeId);
    return 'deleted';
  });
}
