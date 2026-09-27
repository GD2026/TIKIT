import { AppError } from '../../shared/errors';
import { base64UrlToBytes, bytesToBase64Url, hmacSha256, timingSafeEqual, utf8 } from '../../shared/encoding';
import { newId } from '../../shared/ids';
import { DEFAULT_PLATFORM_SETTINGS } from '../../shared/constants';
import type { AppNotification, NotificationKind, PlatformSettings, User } from '../../shared/types';
import type { Deps } from '../context';
import type { Tx } from '../store/types';
import { renderEmail } from './emails';

export function nowIso(deps: Pick<Deps, 'clock'>): string {
  return deps.clock().toISOString();
}

export async function getSettings(tx: Tx, deps: Pick<Deps, 'clock'>): Promise<PlatformSettings> {
  const existing = await tx.get('settings', 'platform');
  if (existing) return existing;
  return {
    id: 'platform',
    ...DEFAULT_PLATFORM_SETTINGS,
    updatedAt: nowIso(deps),
  };
}

export async function audit(
  tx: Tx,
  deps: Pick<Deps, 'clock'>,
  actorId: string | null,
  action: string,
  entity: string,
  entityId: string,
  data: Record<string, unknown> | null = null,
): Promise<void> {
  await tx.insert('audit', { id: newId(), actorId, action, entity, entityId, data, at: nowIso(deps) });
}

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
  /** When set, an email with this subject/body is sent (if the user allows email). */
  email?: { subject: string; heading: string; paragraphs: string[]; cta?: { label: string; url: string } } | null;
  /** Transactional mails (receipts, transfers) ignore the marketing/email preference. */
  transactional?: boolean;
}

/** Creates an in-app notification and queues an email after commit. */
export async function notify(tx: Tx, deps: Deps, userId: string, input: NotifyInput): Promise<AppNotification> {
  const notification: AppNotification = {
    id: newId(),
    userId,
    kind: input.kind,
    title: input.title,
    body: input.body,
    link: input.link,
    readAt: null,
    createdAt: nowIso(deps),
  };
  await tx.insert('notifications', notification);
  if (input.email) {
    const user = await tx.get('users', userId);
    if (user && canEmail(user, input.transactional ?? false)) {
      const mail = renderEmail({ appName: 'TIKIT', ...input.email });
      const to = user.email!;
      tx.afterCommit(async () => {
        await sendMailSafe(deps, { to, subject: input.email!.subject, html: mail.html, text: mail.text });
      });
    }
  }
  return notification;
}

export function canEmail(user: User, transactional: boolean): boolean {
  if (!user.email || user.deletedAt || user.banned) return false;
  return transactional || user.prefs.email;
}

export async function sendMailSafe(deps: Deps, msg: { to: string; subject: string; html: string; text: string }): Promise<void> {
  // A real mail provider never holds up the request that triggered the mail, and transient failures
  // (rate limits during a ticket drop, timeouts) are retried a few times in the background.
  if (deps.mailer.kind === 'resend') {
    void deliverWithRetry(deps, msg, 1);
    return;
  }
  try {
    await deps.mailer.send(msg);
  } catch (err) {
    deps.log.error('E-post kunne ikke sendes', { subject: msg.subject, error: String(err) });
  }
}

const MAIL_ATTEMPTS = 4;

async function deliverWithRetry(deps: Deps, msg: { to: string; subject: string; html: string; text: string }, attempt: number): Promise<void> {
  try {
    await deps.mailer.send(msg);
  } catch (err) {
    if (attempt < MAIL_ATTEMPTS) {
      const timer = setTimeout(() => void deliverWithRetry(deps, msg, attempt + 1), attempt * attempt * 5_000);
      (timer as { unref?: () => void }).unref?.();
      return;
    }
    deps.log.error('E-post kunne ikke sendes etter flere forsøk', { subject: msg.subject, error: String(err) });
  }
}

// ── Signed tokens (unlock codes, queue admission, OAuth state) ───────────────
export async function signToken(secret: string, purpose: string, payload: Record<string, unknown>, expiresAtMs: number): Promise<string> {
  const body = bytesToBase64Url(utf8(JSON.stringify({ ...payload, p: purpose, x: expiresAtMs })));
  const sig = bytesToBase64Url(await hmacSha256(secret, `${purpose}.${body}`));
  return `${body}.${sig}`;
}

export async function verifyToken<T extends Record<string, unknown>>(
  secret: string,
  purpose: string,
  token: string | null | undefined,
  nowMs: number,
): Promise<T | null> {
  if (!token || typeof token !== 'string' || token.length > 4000) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = bytesToBase64Url(await hmacSha256(secret, `${purpose}.${body}`));
  if (!timingSafeEqual(expected, sig)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as T & { p: string; x: number };
    if (parsed.p !== purpose || typeof parsed.x !== 'number' || parsed.x < nowMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ── Guards ───────────────────────────────────────────────────────────────────
export function assertFound<T>(value: T | null | undefined, code: 'not_found' = 'not_found'): T {
  if (value === null || value === undefined) throw new AppError(code);
  return value;
}

export function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Seeded PRNG for deterministic demo data and poster seeds. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
