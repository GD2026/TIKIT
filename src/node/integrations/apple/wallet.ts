import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import forge from 'node-forge';
import type { WalletPassInput } from '../../../server/adapters/types';
import { createZip } from '../zip';
import { APPLE_WWDR_G4_PEM } from './wwdr';

/**
 * Apple Wallet passes (.pkpass): a ZIP with pass.json, images, a manifest of SHA-1 hashes and a detached
 * PKCS#7 signature of the manifest made with the Pass Type ID certificate (plus Apple's WWDR intermediate).
 * Once added, the ticket opens from the lock screen or with a double-click on the side button.
 *
 * The barcode is the static TK2 code: Wallet passes can't rotate like the live ticket in the app.
 * Setup: docs/oppsett.md §9.
 */

export interface AppleWalletConfig {
  /** PEM of the Pass Type ID certificate (pass.cer converted with openssl). `\n` escapes are allowed. */
  certificate: string;
  /** PEM of the certificate's private key. */
  privateKey: string;
  passphrase: string | null;
  /** Overrides the built-in WWDR G4 intermediate. */
  wwdr: string | null;
  /** APPLE_TEAM_ID, if set: must match the certificate. */
  teamId: string | null;
}

export interface AppleWalletCredentials {
  passTypeId: string;
  teamId: string;
  validTo: Date;
  cert: forge.pki.Certificate;
  wwdr: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
}

export const APPLE_WALLET_IMAGES = ['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png', 'logo@3x.png'] as const;

const pem = (value: string) => value.replace(/\\n/g, '\n').trim();

/** Reads and checks the certificate and key. Throws with a message meant for `npm run doctor` and the log. */
export function loadAppleWalletCredentials(cfg: AppleWalletConfig): AppleWalletCredentials {
  let x509: X509Certificate;
  try {
    x509 = new X509Certificate(pem(cfg.certificate));
  } catch {
    throw new Error('APPLE_WALLET_CERT er ikke et gyldig PEM-sertifikat (konverter pass.cer med openssl x509 -inform der).');
  }
  let wwdrX509: X509Certificate;
  try {
    wwdrX509 = new X509Certificate(cfg.wwdr ? pem(cfg.wwdr) : APPLE_WWDR_G4_PEM);
  } catch {
    throw new Error('APPLE_WALLET_WWDR_CERT er ikke et gyldig PEM-sertifikat.');
  }
  let keyPem: string;
  try {
    const key = createPrivateKey({ key: pem(cfg.privateKey), ...(cfg.passphrase ? { passphrase: cfg.passphrase } : {}) });
    if (!x509.checkPrivateKey(key)) throw new Error('mismatch');
    keyPem = key.export({ type: 'pkcs8', format: 'pem' }).toString();
  } catch (err) {
    throw new Error(
      err instanceof Error && err.message === 'mismatch'
        ? 'APPLE_WALLET_KEY hører ikke til sertifikatet i APPLE_WALLET_CERT.'
        : 'APPLE_WALLET_KEY er ikke en gyldig privat nøkkel (eller APPLE_WALLET_KEY_PASSPHRASE er feil).',
      { cause: err },
    );
  }

  const subject = new Map(
    x509.subject.split('\n').map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1)] as const;
    }),
  );
  const passTypeId = subject.get('UID') ?? '';
  const teamId = subject.get('OU') ?? '';
  if (!/^pass\.[A-Za-z0-9.-]+$/.test(passTypeId)) throw new Error('Sertifikatet i APPLE_WALLET_CERT er ikke et Pass Type ID-sertifikat (mangler pass.… i UID).');
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error('Fant ikke Team ID (OU) i Wallet-sertifikatet.');
  if (cfg.teamId && cfg.teamId !== teamId) throw new Error(`Wallet-sertifikatet tilhører team ${teamId}, men APPLE_TEAM_ID er ${cfg.teamId}.`);
  if (!x509.checkIssued(wwdrX509)) throw new Error('Wallet-sertifikatet er ikke utstedt av Apple WWDR G4. Last ned riktig mellomsertifikat og legg det i APPLE_WALLET_WWDR_CERT.');

  return {
    passTypeId,
    teamId,
    validTo: new Date(x509.validTo),
    cert: forge.pki.certificateFromPem(x509.toString()),
    wwdr: forge.pki.certificateFromPem(wwdrX509.toString()),
    key: forge.pki.privateKeyFromPem(keyPem),
  };
}

/** The pass images, from the first folder that has them (dist/web/wallet in production, public/wallet in development). */
export function loadAppleWalletImages(dirs: string[]): Map<string, Buffer> {
  for (const dir of dirs) {
    if (!existsSync(path.join(dir, 'icon.png'))) continue;
    const images = new Map<string, Buffer>();
    for (const name of APPLE_WALLET_IMAGES) {
      const file = path.join(dir, name);
      if (existsSync(file)) images.set(name, readFileSync(file));
    }
    return images;
  }
  throw new Error(`Fant ikke Wallet-bildene (icon.png) i ${dirs.join(' eller ')}. Kjør npm run icons og npm run build.`);
}

/** Wallet wants W3C dates without milliseconds. */
function w3c(iso: string | Date): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function rgb(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const HOUR = 3_600_000;

export function applePassJson(input: WalletPassInput, ids: { passTypeId: string; teamId: string }): Record<string, unknown> {
  const opensAt = input.doorsAt ?? input.startsAt;
  const auxiliary: Record<string, unknown>[] = [{ key: 'type', label: 'BILLETT', value: input.typeName }];
  if (input.seat) auxiliary.push({ key: 'seat', label: 'PLASS', value: input.seat });
  if (input.doorsAt) auxiliary.push({ key: 'doors', label: 'DØRENE ÅPNER', value: w3c(input.doorsAt), timeStyle: 'PKDateStyleShort', dateStyle: 'PKDateStyleNone' });

  return {
    formatVersion: 1,
    passTypeIdentifier: ids.passTypeId,
    teamIdentifier: ids.teamId,
    serialNumber: input.serial,
    organizationName: input.organizer || 'TIKIT',
    description: `Billett til ${input.eventTitle}`,
    // logo.png is the wordmark itself, so no logoText next to it.
    foregroundColor: rgb(input.colors.foreground),
    backgroundColor: rgb(input.colors.background),
    labelColor: rgb(input.colors.label),
    // On the lock screen from a few hours before the doors open until the event ends; greyed out afterwards.
    relevantDate: w3c(opensAt),
    relevantDates: [{ startDate: w3c(new Date(new Date(opensAt).getTime() - 3 * HOUR)), endDate: w3c(input.endsAt) }],
    expirationDate: w3c(new Date(new Date(input.endsAt).getTime() + 6 * HOUR)),
    sharingProhibited: true,
    barcodes: [{ format: 'PKBarcodeFormatQR', message: input.barcode, messageEncoding: 'iso-8859-1', altText: input.number }],
    semantics: {
      eventType: 'PKEventTypeGeneric',
      eventName: input.eventTitle,
      eventStartDate: w3c(input.startsAt),
      eventEndDate: w3c(input.endsAt),
      venueName: input.venue.name,
    },
    eventTicket: {
      headerFields: [{ key: 'date', label: 'DATO', value: w3c(input.startsAt), dateStyle: 'PKDateStyleShort', timeStyle: 'PKDateStyleShort' }],
      primaryFields: [{ key: 'event', label: 'ARRANGEMENT', value: input.eventTitle }],
      secondaryFields: [
        { key: 'venue', label: 'STED', value: input.venue.name },
        { key: 'holder', label: 'NAVN', value: input.holderName },
      ],
      auxiliaryFields: auxiliary,
      backFields: [
        { key: 'number', label: 'Billettnummer', value: input.number },
        ...(input.venue.address ? [{ key: 'address', label: 'Adresse', value: input.venue.address }] : []),
        { key: 'organizer', label: 'Arrangør', value: input.organizer },
        { key: 'live', label: 'Levende billett', value: input.ticketUrl, attributedValue: `<a href="${input.ticketUrl}">Åpne billetten i TIKIT</a>` },
        {
          key: 'note',
          label: 'Viktig',
          value: 'Kortet har en fast kode. Ikke del det eller skjermbilder av det: den som kommer først, kommer inn. Overfører, selger eller refunderer du billetten, slutter kortet å virke.',
        },
      ],
    },
  };
}

function signManifest(manifest: Buffer, creds: AppleWalletCredentials, now: Date): Buffer {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifest.toString('binary'));
  p7.addCertificate(creds.wwdr);
  p7.addCertificate(creds.cert);
  p7.addSigner({
    key: creds.key,
    certificate: creds.cert,
    digestAlgorithm: forge.pki.oids.sha256!,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType!, value: forge.pki.oids.data! },
      { type: forge.pki.oids.messageDigest! },
      { type: forge.pki.oids.signingTime!, value: now.toISOString() },
    ],
  });
  p7.sign({ detached: true });
  return Buffer.from(forge.asn1.toDer(p7.toAsn1()).getBytes(), 'binary');
}

export interface AppleWallet {
  passTypeId: string;
  teamId: string;
  validTo: Date;
  build(input: WalletPassInput): Promise<Uint8Array>;
}

export function createAppleWallet(creds: AppleWalletCredentials, images: Map<string, Buffer>, clock: () => Date = () => new Date()): AppleWallet {
  return {
    passTypeId: creds.passTypeId,
    teamId: creds.teamId,
    validTo: creds.validTo,
    async build(input) {
      const files = new Map<string, Buffer>(images);
      files.set('pass.json', Buffer.from(JSON.stringify(applePassJson(input, creds)), 'utf8'));
      const manifest = Buffer.from(
        JSON.stringify(Object.fromEntries([...files].map(([name, data]) => [name, createHash('sha1').update(data).digest('hex')]))),
        'utf8',
      );
      return createZip([
        ...[...files].map(([name, data]) => ({ name, data })),
        { name: 'manifest.json', data: manifest },
        { name: 'signature', data: signManifest(manifest, creds, clock()) },
      ]);
    },
  };
}
