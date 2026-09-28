import { bytesToBase64Url, hmacSha256, timingSafeEqual } from './encoding';
import { LIMITS } from './constants';

/**
 * Ticket codes.
 *
 * Rotating ("levende billett", shown in the app): the holder's device and the server share a per-ticket
 * secret. The payload changes every `qrStepSeconds`, so a screenshot stops working within about a minute.
 *   TK1.<ticketId>.<step base36>.<mac>
 *
 * Static (Apple/Google Wallet passes, which cannot rotate): signed with the same secret, so a transfer or
 * resale – which rotates the secret – invalidates it. Double entry is still prevented by check-in state.
 *   TK2.<ticketId>.<mac>
 */

export const QR_PREFIX = 'TK1';
export const QR_STATIC_PREFIX = 'TK2';
const TICKET_ID_RE = /^[0-9A-Za-z]{16}$/;

export function qrStep(unixMs: number, stepSeconds: number = LIMITS.qrStepSeconds): number {
  return Math.floor(unixMs / 1000 / stepSeconds);
}

async function mac(secret: string, message: string): Promise<string> {
  const sig = await hmacSha256(secret, message);
  return bytesToBase64Url(sig).slice(0, 12);
}

export async function createTicketCode(ticketId: string, secret: string, unixMs: number): Promise<string> {
  const step = qrStep(unixMs);
  return `${QR_PREFIX}.${ticketId}.${step.toString(36)}.${await mac(secret, `${QR_PREFIX}.${ticketId}.${step}`)}`;
}

export async function createStaticTicketCode(ticketId: string, secret: string): Promise<string> {
  return `${QR_STATIC_PREFIX}.${ticketId}.${await mac(secret, `${QR_STATIC_PREFIX}.${ticketId}`)}`;
}

export interface ParsedTicketCode {
  kind: 'rotating' | 'static';
  ticketId: string;
  step: number | null;
  mac: string;
}

export function parseTicketCode(raw: string): ParsedTicketCode | null {
  const parts = raw.trim().split('.');
  const macOk = (m: string | undefined): m is string => !!m && /^[A-Za-z0-9_-]{12}$/.test(m);
  if (parts.length === 4 && parts[0] === QR_PREFIX) {
    const [, ticketId, stepPart, macPart] = parts as [string, string, string, string];
    if (!TICKET_ID_RE.test(ticketId) || !/^[0-9a-z]{1,12}$/.test(stepPart) || !macOk(macPart)) return null;
    const step = parseInt(stepPart, 36);
    if (!Number.isSafeInteger(step)) return null;
    return { kind: 'rotating', ticketId, step, mac: macPart };
  }
  if (parts.length === 3 && parts[0] === QR_STATIC_PREFIX) {
    const [, ticketId, macPart] = parts as [string, string, string];
    if (!TICKET_ID_RE.test(ticketId) || !macOk(macPart)) return null;
    return { kind: 'static', ticketId, step: null, mac: macPart };
  }
  return null;
}

export type CodeCheck = 'ok' | 'bad_signature' | 'expired' | 'future';

export async function verifyTicketCode(parsed: ParsedTicketCode, secret: string, unixMs: number): Promise<CodeCheck> {
  if (parsed.kind === 'static') {
    const expected = await mac(secret, `${QR_STATIC_PREFIX}.${parsed.ticketId}`);
    return timingSafeEqual(expected, parsed.mac) ? 'ok' : 'bad_signature';
  }
  const step = parsed.step!;
  const expected = await mac(secret, `${QR_PREFIX}.${parsed.ticketId}.${step}`);
  if (!timingSafeEqual(expected, parsed.mac)) return 'bad_signature';
  const now = qrStep(unixMs);
  if (step < now - LIMITS.qrPastSteps) return 'expired';
  if (step > now + LIMITS.qrFutureSteps) return 'future';
  return 'ok';
}

/** Allows door staff to type the ticket number when a phone screen is broken: "TK-7F3K9Q-01". */
export function looksLikeTicketNumber(raw: string): boolean {
  return /^TK-[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{6,8}-\d{2,3}$/i.test(raw.trim());
}
