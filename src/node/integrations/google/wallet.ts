import { importPKCS8, SignJWT } from 'jose';
import type { WalletPassInput } from '../../../server/adapters/types';

/**
 * Google Wallet: a "save to Google Wallet" link carrying a JWT signed with a service account. The JWT holds
 * the event's ticket class and the ticket object, so no API calls are needed – Google creates them when the
 * person saves the pass. Once saved, the ticket opens from Google Wallet (double press of the power button
 * on Android phones that have it switched on).
 *
 * The barcode is the static TK2 code. Setup: docs/oppsett.md §9.
 */

export interface GoogleWalletConfig {
  /** Issuer ID from the Google Pay & Wallet Console. */
  issuerId: string;
  /** The service account's JSON key file, as text. */
  serviceAccount: string;
  publicUrl: string;
  /** Shown as the issuer on the pass (OPERATOR_NAME or TIKIT). */
  issuerName: string;
}

export interface GoogleServiceAccount {
  clientEmail: string;
  privateKey: string;
  keyId: string | null;
}

export function parseGoogleServiceAccount(json: string): GoogleServiceAccount {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error('GOOGLE_WALLET_SERVICE_ACCOUNT er ikke gyldig JSON. Lim inn hele JSON-nøkkelfilen til tjenestekontoen.');
  }
  const clientEmail = typeof data.client_email === 'string' ? data.client_email : '';
  const privateKey = typeof data.private_key === 'string' ? data.private_key.replace(/\\n/g, '\n') : '';
  if (!clientEmail || !privateKey.includes('PRIVATE KEY')) throw new Error('GOOGLE_WALLET_SERVICE_ACCOUNT mangler client_email eller private_key.');
  return { clientEmail, privateKey, keyId: typeof data.private_key_id === 'string' ? data.private_key_id : null };
}

const loc = (value: string) => ({ defaultValue: { language: 'nb', value } });

/** Google's IDs allow letters, digits, '.', '_' and '-'. */
const safeId = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, '_');

export function googleWalletPayload(input: WalletPassInput, cfg: Pick<GoogleWalletConfig, 'issuerId' | 'publicUrl' | 'issuerName'>) {
  const classId = `${cfg.issuerId}.tikit-event-${safeId(input.eventId)}`;
  const https = cfg.publicUrl.startsWith('https://');
  const eventClass = {
    id: classId,
    issuerName: cfg.issuerName,
    reviewStatus: 'UNDER_REVIEW',
    eventName: loc(input.eventTitle),
    venue: { name: loc(input.venue.name), address: loc(input.venue.address || input.venue.name) },
    dateTime: { start: input.startsAt, end: input.endsAt, ...(input.doorsAt ? { doorsOpen: input.doorsAt } : {}) },
    hexBackgroundColor: input.colors.background,
    // Google fetches the logo itself, so it must be a public https address.
    ...(https ? { logo: { sourceUri: { uri: `${cfg.publicUrl}/icons/icon-192.png` }, contentDescription: loc('TIKIT') } } : {}),
  };
  const ticket = {
    id: `${cfg.issuerId}.${safeId(input.serial)}`,
    classId,
    state: 'ACTIVE',
    ticketHolderName: input.holderName,
    ticketNumber: input.number,
    ticketType: loc(input.typeName),
    barcode: { type: 'QR_CODE', value: input.barcode, alternateText: input.number },
    validTimeInterval: { end: { date: new Date(new Date(input.endsAt).getTime() + 6 * 3_600_000).toISOString() } },
    ...(input.seat ? { textModulesData: [{ id: 'seat', header: 'Plass', body: input.seat }] } : {}),
    linksModuleData: { uris: [{ id: 'tikit', uri: input.ticketUrl, description: 'Åpne billetten i TIKIT' }] },
  };
  return { eventTicketClasses: [eventClass], eventTicketObjects: [ticket] };
}

export interface GoogleWallet {
  issuerId: string;
  clientEmail: string;
  build(input: WalletPassInput): Promise<string>;
}

export function createGoogleWallet(cfg: GoogleWalletConfig, clock: () => Date = () => new Date()): GoogleWallet {
  const account = parseGoogleServiceAccount(cfg.serviceAccount);
  let key: ReturnType<typeof importPKCS8> | null = null;
  return {
    issuerId: cfg.issuerId,
    clientEmail: account.clientEmail,
    async build(input) {
      key ??= importPKCS8(account.privateKey, 'RS256');
      const jwt = await new SignJWT({ typ: 'savetowallet', origins: [cfg.publicUrl], payload: googleWalletPayload(input, cfg) })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT', ...(account.keyId ? { kid: account.keyId } : {}) })
        .setIssuer(account.clientEmail)
        .setAudience('google')
        .setIssuedAt(Math.floor(clock().getTime() / 1000))
        .sign(await key);
      return `https://pay.google.com/gp/v/save/${jwt}`;
    },
  };
}
