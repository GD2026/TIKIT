import { AppError } from '../../shared/errors';
import { sha256Hex } from '../../shared/encoding';
import { newId, newToken } from '../../shared/ids';
import { LIMITS } from '../../shared/constants';
import type { Identity, Me, ProviderId, Session, User } from '../../shared/types';
import type { ProfileUpdateInput } from '../../shared/schemas';
import type { ExternalProfile } from '../adapters/types';
import type { Deps } from '../context';
import type { Tx } from '../store/types';
import { audit, nowIso } from './common';
import { openSecret, sealSecret } from './sealed';

export const DEFAULT_PREFS = { email: true, reminders: true, waitlist: true, marketing: false } as const;

// ── Sessions ─────────────────────────────────────────────────────────────────

export async function createSession(
  deps: Deps,
  tx: Tx,
  args: { userId: string | null; kind: Session['kind']; scanner?: Session['scanner']; userAgent: string | null; ttlMs?: number },
): Promise<{ token: string; session: Session }> {
  const token = newToken(32);
  const now = deps.clock();
  const ttl = args.ttlMs ?? LIMITS.sessionDays * 86400000;
  const session: Session = {
    id: await sha256Hex(`session:${token}`),
    userId: args.userId,
    kind: args.kind,
    scanner: args.scanner ?? null,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl).toISOString(),
    lastSeenAt: now.toISOString(),
    userAgent: args.userAgent ? args.userAgent.slice(0, 200) : null,
  };
  await tx.insert('sessions', session);
  return { token, session };
}

export interface ResolvedSession {
  session: Session;
  user: User | null;
}

export async function resolveSession(deps: Deps, token: string | null): Promise<ResolvedSession | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const id = await sha256Hex(`session:${token}`);
  const now = deps.clock();
  const found = await deps.store.read(async (tx) => {
    const session = await tx.get('sessions', id);
    if (!session) return null;
    if (session.expiresAt <= now.toISOString()) return null;
    const user = session.userId ? await tx.get('users', session.userId) : null;
    if (session.kind === 'user' && (!user || user.deletedAt || user.banned)) return null;
    return { session, user };
  });
  if (!found) return null;
  // Rolling expiry, written at most every 15 minutes.
  if (now.getTime() - new Date(found.session.lastSeenAt).getTime() > 15 * 60000) {
    const ttl = found.session.kind === 'scanner' ? LIMITS.scannerSessionHours * 3600000 : LIMITS.sessionDays * 86400000;
    const patch = {
      lastSeenAt: now.toISOString(),
      expiresAt:
        found.session.kind === 'user' ? new Date(now.getTime() + ttl).toISOString() : found.session.expiresAt,
    };
    await deps.store.tx(async (tx) => {
      if (await tx.get('sessions', id)) await tx.update('sessions', id, patch);
    });
    found.session = { ...found.session, ...patch };
  }
  return found;
}

export async function destroySession(deps: Deps, token: string | null): Promise<void> {
  if (!token) return;
  const id = await sha256Hex(`session:${token}`);
  await deps.store.tx(async (tx) => {
    await tx.delete('sessions', id);
  });
}

// ── Login / account linking ─────────────────────────────────────────────────

function mergeProfile(user: User, profile: ExternalProfile, now: string): User {
  const next: User = { ...user, updatedAt: now, lastLoginAt: now };
  if (profile.name && (!user.name || user.name === 'Ny bruker')) next.name = profile.name.slice(0, 80);
  // An identity-verified provider (Vipps) owns name and birthdate together: the door trusts the account's
  // age only for tickets carrying the account's name, so that name must be the verified one.
  if (profile.name && profile.birthdateVerified) next.name = profile.name.slice(0, 80);
  if (profile.email && (!user.email || (!user.emailVerified && profile.emailVerified))) {
    next.email = profile.email.toLowerCase();
    next.emailVerified = profile.emailVerified;
  } else if (profile.email && user.email === profile.email.toLowerCase() && profile.emailVerified) {
    next.emailVerified = true;
  }
  if (profile.phone && profile.phoneVerified) {
    next.phone = profile.phone;
    next.phoneVerified = true;
  } else if (profile.phone && !user.phone) {
    next.phone = profile.phone;
  }
  if (profile.birthdate && profile.birthdateVerified) {
    next.birthdate = profile.birthdate;
    next.birthdateVerified = true;
  } else if (profile.birthdate && !user.birthdate) {
    next.birthdate = profile.birthdate;
  }
  return next;
}

async function acceptInvites(tx: Tx, deps: Deps, user: User): Promise<void> {
  if (!user.email || !user.emailVerified) return;
  const invites = await tx.find('orgInvites', { email: user.email, status: 'pending' });
  for (const inv of invites) {
    const existing = await tx.findOne('orgMembers', { organizerId: inv.organizerId, userId: user.id });
    if (!existing) {
      await tx.insert('orgMembers', { id: newId(), organizerId: inv.organizerId, userId: user.id, role: inv.role, createdAt: nowIso(deps) });
    }
    await tx.update('orgInvites', inv.id, { status: 'accepted' });
  }
}

export async function loginWithProfile(
  deps: Deps,
  profile: ExternalProfile,
  opts: { linkToUserId?: string | null } = {},
): Promise<{ user: User; created: boolean }> {
  const now = nowIso(deps);
  // Sealed outside the transaction (Web Crypto is async and the transaction may be retried).
  const revocation = profile.revocation ? await sealSecret(deps.config.sessionSecret, JSON.stringify(profile.revocation)) : null;
  const result = await deps.store.tx(async (tx) => {
    let identity = await tx.findOne('identities', { provider: profile.provider, subject: profile.subject });
    let user: User | null = null;
    let created = false;

    if (opts.linkToUserId) {
      if (identity && identity.userId !== opts.linkToUserId) throw new AppError('identity_in_use');
      user = await tx.get('users', opts.linkToUserId);
      if (!user) throw new AppError('unauthorized');
      // An account verified as one person can't be re-verified as someone else.
      if (profile.birthdateVerified && user.birthdateVerified && profile.birthdate && user.birthdate !== profile.birthdate) {
        throw new AppError('identity_in_use', { message: 'Kontoen er allerede bekreftet med en annen person.' });
      }
    } else if (identity) {
      user = await tx.get('users', identity.userId);
    }

    if (!user && profile.email && profile.emailVerified) {
      const email = profile.email.toLowerCase();
      const candidates = await tx.find('users', { email, emailVerified: true });
      user = candidates.find((u) => !u.deletedAt) ?? null;
    }

    if (!user) {
      created = true;
      user = {
        id: newId(),
        name: (profile.name ?? 'Ny bruker').slice(0, 80),
        email: profile.email ? profile.email.toLowerCase() : null,
        emailVerified: !!profile.email && profile.emailVerified,
        phone: profile.phone,
        phoneVerified: !!profile.phone && profile.phoneVerified,
        birthdate: profile.birthdate,
        birthdateVerified: !!profile.birthdate && profile.birthdateVerified,
        city: null,
        role: 'user',
        prefs: { ...DEFAULT_PREFS },
        banned: false,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
        deletedAt: null,
      };
      await tx.insert('users', user);
    } else {
      if (user.banned) throw new AppError('account_banned');
      if (user.deletedAt) throw new AppError('login_failed');
      user = mergeProfile(user, profile, now);
      await tx.put('users', user);
    }

    if (user.email && user.emailVerified && deps.config.adminEmails.includes(user.email) && user.role !== 'admin') {
      user = await tx.update('users', user.id, { role: 'admin' });
    }

    if (!identity) {
      identity = {
        id: newId(),
        userId: user.id,
        provider: profile.provider,
        subject: profile.subject,
        email: profile.email,
        emailVerified: profile.emailVerified,
        demo: profile.demo,
        revocation,
        createdAt: now,
        lastUsedAt: now,
      } satisfies Identity;
      await tx.insert('identities', identity);
    } else {
      await tx.update('identities', identity.id, {
        lastUsedAt: now,
        email: profile.email ?? identity.email,
        emailVerified: profile.emailVerified,
        ...(revocation ? { revocation } : {}),
      });
    }

    await acceptInvites(tx, deps, user);
    if (created) await audit(tx, deps, user.id, 'user.created', 'users', user.id, { provider: profile.provider });
    return { user, created };
  });
  return result;
}

/**
 * The account App Review signs in to (routes/nativeAuth.ts). Created on first use with no login method of
 * its own; it can never be a platform admin, so a leaked review code can't reach the admin pages.
 */
export async function findOrCreateReviewUser(deps: Deps, email: string): Promise<User> {
  const now = nowIso(deps);
  return deps.store.tx(async (tx) => {
    const existing = (await tx.find('users', { email })).find((u) => !u.deletedAt) ?? null;
    if (existing) {
      if (existing.role === 'admin') throw new AppError('forbidden', { message: 'App Review-kontoen kan ikke være administrator.' });
      if (existing.banned) throw new AppError('account_banned');
      await audit(tx, deps, existing.id, 'review.login', 'users', existing.id);
      return tx.update('users', existing.id, { lastLoginAt: now, updatedAt: now });
    }
    const user: User = {
      id: newId(),
      name: 'App Review',
      email,
      emailVerified: true,
      phone: null,
      phoneVerified: false,
      birthdate: null,
      birthdateVerified: false,
      city: null,
      role: 'user',
      prefs: { ...DEFAULT_PREFS },
      banned: false,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
      deletedAt: null,
    };
    await tx.insert('users', user);
    await audit(tx, deps, user.id, 'review.login', 'users', user.id, { created: true });
    return user;
  });
}

export async function getMe(deps: Deps, userId: string): Promise<Me> {
  return deps.store.read(async (tx) => {
    const user = await tx.get('users', userId);
    if (!user) throw new AppError('unauthorized');
    const identities = await tx.find('identities', { userId });
    const memberships = await tx.find('orgMembers', { userId });
    const orgs = await tx.getMany(
      'organizers',
      memberships.map((m) => m.organizerId),
    );
    const unread = await tx.count('notifications', { userId, readAt: null });
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      phone: user.phone,
      birthdate: user.birthdate,
      birthdateVerified: user.birthdateVerified,
      city: user.city,
      role: user.role,
      prefs: user.prefs,
      providers: [...new Set(identities.map((i) => i.provider))] as ProviderId[],
      organizations: memberships
        .map((m) => {
          const org = orgs.find((o) => o.id === m.organizerId);
          return org ? { id: org.id, name: org.name, slug: org.slug, role: m.role, status: org.status } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
      unreadNotifications: unread,
      createdAt: user.createdAt,
    };
  });
}

export async function updateProfile(deps: Deps, userId: string, input: ProfileUpdateInput): Promise<void> {
  await deps.store.tx(async (tx) => {
    const user = await tx.get('users', userId, { forUpdate: true });
    if (!user) throw new AppError('unauthorized');
    const patch: Partial<User> = { updatedAt: nowIso(deps) };
    if (input.name !== undefined && input.name !== user.name) {
      if (user.birthdateVerified) {
        throw new AppError('forbidden', { message: 'Navnet er bekreftet med Vipps og kan ikke endres.' });
      }
      patch.name = input.name;
    }
    if (input.email !== undefined && input.email !== user.email) {
      patch.email = input.email;
      patch.emailVerified = false;
    }
    if (input.phone !== undefined && input.phone !== user.phone) {
      patch.phone = input.phone;
      patch.phoneVerified = false;
    }
    if (input.birthdate !== undefined && input.birthdate !== user.birthdate) {
      if (user.birthdateVerified) {
        throw new AppError('forbidden', { message: 'Fødselsdatoen er bekreftet med Vipps og kan ikke endres.' });
      }
      patch.birthdate = input.birthdate;
    }
    if (input.city !== undefined) patch.city = input.city || null;
    if (input.prefs) patch.prefs = { ...user.prefs, ...input.prefs };
    await tx.update('users', userId, patch);
  });
}

/**
 * Apple asks apps to revoke Sign in with Apple grants when an account is deleted (and we do the same when
 * Apple is unlinked). Runs after commit; a failure is logged and never blocks the deletion.
 */
function revokeAfterCommit(tx: Tx, deps: Deps, identities: Identity[]): void {
  const apple = deps.appleNative;
  const sealed = identities.filter((i) => i.provider === 'apple' && i.revocation).map((i) => i.revocation!);
  if (!apple || sealed.length === 0) return;
  tx.afterCommit(async () => {
    for (const s of sealed) {
      const raw = await openSecret(deps.config.sessionSecret, s);
      if (!raw) continue;
      try {
        const grant = JSON.parse(raw) as { clientId: string; token: string };
        await apple.revoke(grant.clientId, grant.token);
      } catch (err) {
        deps.log.warn('Kunne ikke trekke tilbake Apple-innlogging', { error: String(err) });
      }
    }
  });
}

export async function unlinkIdentity(deps: Deps, userId: string, provider: ProviderId): Promise<void> {
  await deps.store.tx(async (tx) => {
    const identities = await tx.find('identities', { userId });
    const target = identities.filter((i) => i.provider === provider);
    if (target.length === 0) throw new AppError('not_found');
    if (identities.length - target.length < 1) throw new AppError('last_login_method');
    for (const i of target) await tx.delete('identities', i.id);
    revokeAfterCommit(tx, deps, target);
    // What Vipps verified (age, phone) stops being verified once Vipps is no longer attached to the account.
    if (provider === 'vipps') await tx.update('users', userId, { birthdateVerified: false, phoneVerified: false, updatedAt: nowIso(deps) });
    await audit(tx, deps, userId, 'identity.unlinked', 'users', userId, { provider });
  });
}

export async function exportUserData(deps: Deps, userId: string): Promise<Record<string, unknown>> {
  return deps.store.read(async (tx) => {
    const user = await tx.get('users', userId);
    if (!user) throw new AppError('unauthorized');
    const identities = await tx.find('identities', { userId });
    const orders = await tx.find('orders', { userId });
    const tickets = await tx.find('tickets', { ownerId: userId });
    const notifications = await tx.find('notifications', { userId });
    const favorites = await tx.find('favorites', { userId });
    const follows = await tx.find('follows', { userId });
    const blocks = await tx.find('blocks', { userId });
    const reports = (await tx.find('reports')).filter((r) => r.reporterId === userId);
    return {
      exportedAt: nowIso(deps),
      user,
      identities: identities.map((i) => ({ provider: i.provider, email: i.email, createdAt: i.createdAt, lastUsedAt: i.lastUsedAt })),
      orders: orders.map((o) => ({ ref: o.ref, status: o.status, totalOre: o.totalOre, createdAt: o.createdAt, eventId: o.eventId, items: o.items })),
      tickets: tickets.map((t) => ({ number: t.number, eventId: t.eventId, typeName: t.typeName, status: t.status, holderName: t.holderName })),
      notifications: notifications.map((n) => ({ title: n.title, body: n.body, createdAt: n.createdAt })),
      favorites: favorites.map((f) => f.eventId),
      follows: follows.map((f) => f.organizerId),
      blockedOrganizers: blocks.map((b) => b.organizerId),
      reports: reports.map((r) => ({ kind: r.kind, targetTitle: r.targetTitle, reason: r.reason, message: r.message, status: r.status, createdAt: r.createdAt })),
    };
  });
}

export async function deleteAccount(deps: Deps, userId: string): Promise<void> {
  const now = nowIso(deps);
  await deps.store.tx(async (tx) => {
    const user = await tx.get('users', userId, { forUpdate: true });
    if (!user) throw new AppError('unauthorized');
    const tickets = await tx.find('tickets', { ownerId: userId, status: 'valid' });
    for (const t of tickets) {
      const event = await tx.get('events', t.eventId);
      if (event && event.status !== 'cancelled' && event.endsAt > now) throw new AppError('has_upcoming_tickets');
    }
    const memberships = await tx.find('orgMembers', { userId });
    for (const m of memberships) {
      if (m.role === 'owner') {
        const owners = await tx.find('orgMembers', { organizerId: m.organizerId, role: 'owner' });
        if (owners.length <= 1) throw new AppError('last_owner', { message: 'Du er eneste eier av en arrangørkonto. Legg til en annen eier før du sletter kontoen.' });
      }
      await tx.delete('orgMembers', m.id);
    }
    revokeAfterCommit(tx, deps, await tx.find('identities', { userId }));
    for (const c of ['identities', 'sessions', 'notifications', 'favorites', 'follows', 'waitlist', 'saleAlerts', 'queueEntries', 'blocks'] as const) {
      await tx.deleteWhere(c, { userId } as never);
    }
    const orders = await tx.find('orders', { userId });
    for (const o of orders) {
      await tx.update('orders', o.id, { buyer: { name: 'Slettet bruker', email: null, phone: null } });
    }
    await tx.update('users', userId, {
      name: 'Slettet bruker',
      email: null,
      emailVerified: false,
      phone: null,
      phoneVerified: false,
      birthdate: null,
      birthdateVerified: false,
      city: null,
      deletedAt: now,
      updatedAt: now,
    });
    await audit(tx, deps, userId, 'user.deleted', 'users', userId);
  });
}
