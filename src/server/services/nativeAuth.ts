import { AppError } from '../../shared/errors';
import { bytesToBase64Url, sha256, sha256Hex } from '../../shared/encoding';
import { newToken } from '../../shared/ids';
import type { ExternalProfile } from '../adapters/types';
import type { Deps } from '../context';
import { openSecret, sealSecret } from './sealed';

/**
 * Login hand-off for the iOS app.
 *
 * The app can't read cookies set in the system browser (ASWebAuthenticationSession), so a finished login
 * ends with a redirect to `tikit://auth/callback?code=…` instead of a session cookie. The code is single use,
 * lives two minutes and is bound to a PKCE-style challenge: only the app that started the login (and holds
 * the verifier) can exchange it for a session token. The token is then kept in the iOS Keychain.
 */

export const HANDOFF_TTL_MS = 2 * 60_000;
const KV_PREFIX = 'handoff:';

export type Handoff =
  | { kind: 'login'; userId: string; challenge: string; returnTo: string; expiresAt: number }
  | { kind: 'link'; linkUserId: string; profile: string /* sealed ExternalProfile */; challenge: string; returnTo: string; expiresAt: number };

/** base64url(sha256(verifier)) – the S256 method from PKCE (RFC 7636). */
export async function challengeFor(verifier: string): Promise<string> {
  return bytesToBase64Url(await sha256(verifier));
}

export function isChallenge(value: string | null | undefined): value is string {
  return !!value && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export async function createLoginHandoff(deps: Deps, input: { userId: string; challenge: string; returnTo: string }): Promise<string> {
  return store(deps, { kind: 'login', ...input, expiresAt: deps.clock().getTime() + HANDOFF_TTL_MS });
}

export async function createLinkHandoff(deps: Deps, input: { linkUserId: string; profile: ExternalProfile; challenge: string; returnTo: string }): Promise<string> {
  // The profile carries personal data (name, phone, birth date) – sealed while it waits for the app.
  const profile = await sealSecret(deps.config.sessionSecret, JSON.stringify(input.profile));
  return store(deps, { kind: 'link', linkUserId: input.linkUserId, profile, challenge: input.challenge, returnTo: input.returnTo, expiresAt: deps.clock().getTime() + HANDOFF_TTL_MS });
}

async function store(deps: Deps, handoff: Handoff): Promise<string> {
  const code = newToken(32);
  const id = `${KV_PREFIX}${await sha256Hex(code)}`;
  await deps.store.tx((tx) => tx.insert('kv', { id, value: handoff, updatedAt: new Date(deps.clock().getTime()).toISOString() }));
  return code;
}

/** Single use: the hand-off is deleted whether or not the verifier matches. */
export async function redeemHandoff(deps: Deps, code: string, verifier: string): Promise<Handoff & { openedProfile?: ExternalProfile }> {
  const id = `${KV_PREFIX}${await sha256Hex(code)}`;
  const challenge = await challengeFor(verifier);
  const handoff = await deps.store.tx(async (tx) => {
    const doc = await tx.get('kv', id, { forUpdate: true });
    if (!doc) return null;
    await tx.delete('kv', id);
    return doc.value as Handoff;
  });
  if (!handoff || handoff.expiresAt < deps.clock().getTime() || handoff.challenge !== challenge) throw new AppError('login_failed');
  if (handoff.kind === 'link') {
    const raw = await openSecret(deps.config.sessionSecret, handoff.profile);
    if (!raw) throw new AppError('login_failed');
    return { ...handoff, openedProfile: JSON.parse(raw) as ExternalProfile };
  }
  return handoff;
}

/** Removes hand-offs that were never exchanged (the app was closed mid-login). Called from the cron job. */
export async function purgeExpiredHandoffs(deps: Deps): Promise<number> {
  const now = deps.clock().getTime();
  return deps.store.tx(async (tx) => {
    const docs = await tx.find('kv');
    let removed = 0;
    for (const d of docs) {
      if (!d.id.startsWith(KV_PREFIX)) continue;
      const h = d.value as Partial<Handoff> | null;
      if (!h || typeof h.expiresAt !== 'number' || h.expiresAt < now) {
        await tx.delete('kv', d.id);
        removed++;
      }
    }
    return removed;
  });
}
