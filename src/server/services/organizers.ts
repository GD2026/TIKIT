import { AppError } from '../../shared/errors';
import { newId, slugify } from '../../shared/ids';
import type { OrgMember, OrgRole, Organizer, OrganizerPublic, User } from '../../shared/types';
import type { OrganizerInput } from '../../shared/schemas';
import type { Deps } from '../context';
import type { Tx } from '../store/types';
import { audit, notify, nowIso } from './common';
import { toOrganizerPublic } from './dto';
import { appLink } from '../context';

const ROLE_RANK: Record<OrgRole, number> = { staff: 1, admin: 2, owner: 3 };

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export interface OrgAccess {
  org: Organizer;
  role: OrgRole;
  userId: string;
  platformAdmin: boolean;
}

/** Loads an organizer and verifies the user's role. Platform admins get owner-level access. */
export async function requireOrgAccess(tx: Tx, user: User, organizerId: string, min: OrgRole): Promise<OrgAccess> {
  const org = await tx.get('organizers', organizerId);
  if (!org) throw new AppError('not_found');
  if (user.role === 'admin') return { org, role: 'owner', userId: user.id, platformAdmin: true };
  const member = await tx.findOne('orgMembers', { organizerId, userId: user.id });
  if (!member) throw new AppError('forbidden');
  if (!roleAtLeast(member.role, min)) throw new AppError('forbidden');
  return { org, role: member.role, userId: user.id, platformAdmin: false };
}

async function uniqueSlug(tx: Tx, base: string, collection: 'organizers' | 'events', excludeId: string | null = null): Promise<string> {
  const root = slugify(base);
  for (let i = 0; i < 200; i++) {
    const candidate = i === 0 ? root : `${root}-${i + 1}`;
    const existing = await tx.findOne(collection, { slug: candidate });
    if (!existing || existing.id === excludeId) return candidate;
  }
  return `${root}-${newId(6).toLowerCase()}`;
}
export { uniqueSlug };

export async function applyOrganizer(deps: Deps, user: User, input: OrganizerInput): Promise<Organizer> {
  const now = nowIso(deps);
  return deps.store.tx(async (tx) => {
    const memberships = await tx.find('orgMembers', { userId: user.id });
    if (memberships.length >= 10) throw new AppError('forbidden', { message: 'Du kan være med i maks 10 arrangørkontoer.' });
    const autoApprove = deps.config.demoMode;
    const org: Organizer = {
      id: newId(),
      slug: await uniqueSlug(tx, input.name, 'organizers'),
      name: input.name,
      type: input.type,
      orgNumber: input.orgNumber ?? null,
      description: input.description ?? '',
      city: input.city ?? null,
      email: input.email,
      phone: input.phone ?? null,
      website: input.website ?? null,
      logoImageId: input.logoImageId ?? null,
      palette: input.palette ?? 'blatime',
      payoutAccount: input.payoutAccount ?? null,
      status: autoApprove ? 'approved' : 'pending',
      verified: false,
      statusNote: null,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
      approvedAt: autoApprove ? now : null,
    };
    await tx.insert('organizers', org);
    await tx.insert('orgMembers', { id: newId(), organizerId: org.id, userId: user.id, role: 'owner', createdAt: now });
    await audit(tx, deps, user.id, 'organizer.created', 'organizers', org.id, { name: org.name });
    return org;
  });
}

export async function updateOrganizer(deps: Deps, user: User, organizerId: string, input: OrganizerInput): Promise<Organizer> {
  return deps.store.tx(async (tx) => {
    const access = await requireOrgAccess(tx, user, organizerId, 'admin');
    const patch: Partial<Organizer> = {
      name: input.name,
      type: input.type,
      description: input.description ?? '',
      city: input.city ?? null,
      email: input.email,
      phone: input.phone ?? null,
      website: input.website ?? null,
      updatedAt: nowIso(deps),
    };
    if (input.orgNumber !== undefined) patch.orgNumber = input.orgNumber ?? null;
    if (input.palette) patch.palette = input.palette;
    if (input.logoImageId !== undefined) patch.logoImageId = input.logoImageId ?? null;
    if (input.payoutAccount !== undefined) {
      if (!roleAtLeast(access.role, 'owner')) throw new AppError('forbidden', { message: 'Bare eiere kan endre kontonummer for utbetaling.' });
      patch.payoutAccount = input.payoutAccount ?? null;
    }
    if (input.name !== access.org.name) patch.slug = await uniqueSlug(tx, input.name, 'organizers', organizerId);
    const updated = await tx.update('organizers', organizerId, patch);
    await audit(tx, deps, user.id, 'organizer.updated', 'organizers', organizerId);
    return updated;
  });
}

export interface OrgDetail extends Organizer {
  role: OrgRole;
}

export async function getOrganizerForMember(deps: Deps, user: User, organizerId: string): Promise<OrgDetail> {
  return deps.store.read(async (tx) => {
    const access = await requireOrgAccess(tx, user, organizerId, 'staff');
    const org = { ...access.org };
    // Only owners see the payout account.
    if (!roleAtLeast(access.role, 'owner')) org.payoutAccount = null;
    return { ...org, role: access.role };
  });
}

export async function getOrganizerPublic(deps: Deps, slug: string): Promise<OrganizerPublic> {
  return deps.store.read(async (tx) => {
    const org = await tx.findOne('organizers', { slug });
    if (!org || org.status !== 'approved') throw new AppError('not_found');
    const followers = await tx.count('follows', { organizerId: org.id });
    return toOrganizerPublic(org, followers);
  });
}

export interface TeamMember {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  role: OrgRole;
  createdAt: string;
}

export async function listTeam(deps: Deps, user: User, organizerId: string): Promise<{ members: TeamMember[]; invites: { id: string; email: string; role: OrgRole; createdAt: string }[] }> {
  return deps.store.read(async (tx) => {
    await requireOrgAccess(tx, user, organizerId, 'staff');
    const members = await tx.find('orgMembers', { organizerId });
    const users = await tx.getMany(
      'users',
      members.map((m) => m.userId),
    );
    const invites = await tx.find('orgInvites', { organizerId, status: 'pending' });
    return {
      members: members
        .map((m) => {
          const u = users.find((x) => x.id === m.userId);
          return { id: m.id, userId: m.userId, name: u?.name ?? 'Ukjent', email: u?.email ?? null, role: m.role, createdAt: m.createdAt };
        })
        .sort((a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || a.name.localeCompare(b.name, 'nb')),
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt })),
    };
  });
}

export async function inviteMember(deps: Deps, user: User, organizerId: string, email: string, role: OrgRole): Promise<'added' | 'invited'> {
  return deps.store.tx(async (tx) => {
    const access = await requireOrgAccess(tx, user, organizerId, 'admin');
    if (role === 'owner' && !roleAtLeast(access.role, 'owner')) throw new AppError('forbidden');
    const existingUsers = await tx.find('users', { email, emailVerified: true });
    const target = existingUsers.find((u) => !u.deletedAt);
    if (target) {
      const member = await tx.findOne('orgMembers', { organizerId, userId: target.id });
      if (member) throw new AppError('member_exists');
      const m: OrgMember = { id: newId(), organizerId, userId: target.id, role, createdAt: nowIso(deps) };
      await tx.insert('orgMembers', m);
      await notify(tx, deps, target.id, {
        kind: 'team_invite',
        title: `Du er lagt til i ${access.org.name}`,
        body: `Du har fått tilgang som ${role === 'staff' ? 'dørvakt/crew' : 'administrator'}.`,
        link: `/arrangor/${organizerId}`,
        email: {
          subject: `Du er lagt til i ${access.org.name} på TIKIT`,
          heading: `Velkommen til teamet i ${access.org.name}`,
          paragraphs: [`${user.name} har gitt deg tilgang til arrangørpanelet.`],
          cta: { label: 'Åpne arrangørpanelet', url: appLink(deps.config, `/arrangor/${organizerId}`) },
        },
        transactional: true,
      });
      await audit(tx, deps, user.id, 'team.added', 'organizers', organizerId, { userId: target.id, role });
      return 'added';
    }
    const pending = await tx.find('orgInvites', { organizerId, email, status: 'pending' });
    if (pending.length === 0) {
      await tx.insert('orgInvites', { id: newId(), organizerId, email, role, invitedBy: user.id, status: 'pending', createdAt: nowIso(deps) });
    }
    await audit(tx, deps, user.id, 'team.invited', 'organizers', organizerId, { email, role });
    return 'invited';
  });
}

export async function removeMember(deps: Deps, user: User, organizerId: string, memberId: string): Promise<void> {
  await deps.store.tx(async (tx) => {
    const access = await requireOrgAccess(tx, user, organizerId, 'admin');
    const member = await tx.get('orgMembers', memberId);
    if (!member || member.organizerId !== organizerId) {
      const invite = await tx.get('orgInvites', memberId);
      if (invite && invite.organizerId === organizerId) {
        await tx.update('orgInvites', memberId, { status: 'revoked' });
        return;
      }
      throw new AppError('not_found');
    }
    if (member.role === 'owner') {
      if (!roleAtLeast(access.role, 'owner')) throw new AppError('forbidden');
      const owners = await tx.find('orgMembers', { organizerId, role: 'owner' });
      if (owners.length <= 1) throw new AppError('last_owner');
    }
    await tx.delete('orgMembers', memberId);
    await audit(tx, deps, user.id, 'team.removed', 'organizers', organizerId, { userId: member.userId });
  });
}

export async function changeMemberRole(deps: Deps, user: User, organizerId: string, memberId: string, role: OrgRole): Promise<void> {
  await deps.store.tx(async (tx) => {
    const access = await requireOrgAccess(tx, user, organizerId, 'owner');
    void access;
    const member = await tx.get('orgMembers', memberId, { forUpdate: true });
    if (!member || member.organizerId !== organizerId) throw new AppError('not_found');
    if (member.role === 'owner' && role !== 'owner') {
      const owners = await tx.find('orgMembers', { organizerId, role: 'owner' });
      if (owners.length <= 1) throw new AppError('last_owner');
    }
    await tx.update('orgMembers', memberId, { role });
  });
}

export async function setFollow(deps: Deps, userId: string, organizerId: string, follow: boolean): Promise<void> {
  const id = `${userId}:${organizerId}`;
  await deps.store.tx(async (tx) => {
    const org = await tx.get('organizers', organizerId);
    if (!org) throw new AppError('not_found');
    const existing = await tx.get('follows', id);
    if (follow && !existing) await tx.insert('follows', { id, userId, organizerId, createdAt: nowIso(deps) });
    if (!follow && existing) await tx.delete('follows', id);
  });
}
