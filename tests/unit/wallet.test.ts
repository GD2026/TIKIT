import { createHash, generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import forge from 'node-forge';
import { importSPKI, jwtVerify } from 'jose';
import type { WalletPassInput } from '../../src/server/adapters/types';
import { createAppleWallet, loadAppleWalletCredentials, loadAppleWalletImages } from '../../src/node/integrations/apple/wallet';
import { createGoogleWallet, parseGoogleServiceAccount } from '../../src/node/integrations/google/wallet';
import { createZip } from '../../src/node/integrations/zip';
import { createWalletAdapter } from '../../src/node/wallet';
import { loadConfig } from '../../src/node/config';

function rsaPem() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), pub: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
}

function makeCert(subject: forge.pki.CertificateField[], issuer: forge.pki.CertificateField[], pubPem: string, signKeyPem: string, serial: string, ca: boolean) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(pubPem);
  cert.serialNumber = serial;
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  cert.setSubject(subject);
  cert.setIssuer(issuer);
  cert.setExtensions(ca ? [{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }] : [{ name: 'basicConstraints', cA: false }]);
  cert.sign(forge.pki.privateKeyFromPem(signKeyPem) as forge.pki.rsa.PrivateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

/** A stand-in for Apple's chain: a test "WWDR" CA that issued a Pass Type ID certificate. */
function fakeAppleChain(passTypeId = 'pass.no.tikit.test', teamId = 'ABCDE12345') {
  const ca = rsaPem();
  const caName = [{ shortName: 'CN', value: 'Test WWDR' }, { shortName: 'O', value: 'Test' }];
  const wwdr = makeCert(caName, caName, ca.pub, ca.key, '01', true);
  const pass = rsaPem();
  const subject = [
    { type: '0.9.2342.19200300.100.1.1', value: passTypeId },
    { shortName: 'CN', value: `Pass Type ID: ${passTypeId}` },
    { shortName: 'OU', value: teamId },
    { shortName: 'O', value: 'Din Russetid AS' },
    { shortName: 'C', value: 'NO' },
  ];
  const certificate = makeCert(subject, caName, pass.pub, ca.key, '02', false);
  return { wwdr, certificate, key: pass.key };
}

/** Reads a ZIP through its central directory. */
function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const body = buf.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(body) : Buffer.from(body));
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return files;
}

const input: WalletPassInput = {
  ticketId: 'AbCdEfGh12345678',
  serial: 'AbCdEfGh12345678-x_Y-z0a1b2',
  number: 'TK-7F3K9Q-01',
  eventId: 'Ev3ntId000000001',
  eventTitle: 'Russetreff Vest',
  venue: { name: 'Sola Strand', address: 'Axel Lunds veg 27, 4055 Sola' },
  startsAt: '2027-05-01T18:00:00.000Z',
  endsAt: '2027-05-02T00:00:00.000Z',
  doorsAt: '2027-05-01T17:30:00.000Z',
  holderName: 'Emma Hansen',
  typeName: 'Ordinær',
  seat: null,
  barcode: 'TK2.AbCdEfGh12345678.abcdefABCDEF',
  colors: { background: '#0B0A24', foreground: '#FFFFFF', label: '#B8C0FF' },
  organizer: 'Nordlys Events',
  ticketUrl: 'https://tikit.no/billetter/AbCdEfGh12345678',
};

describe('zip', () => {
  it('round-trips stored and deflated entries', () => {
    const big = Buffer.alloc(5000, 'a');
    const files = unzip(createZip([{ name: 'a.txt', data: big }, { name: 'b.bin', data: new Uint8Array([1, 2, 3]) }]));
    expect(files.get('a.txt')).toEqual(big);
    expect([...files.get('b.bin')!]).toEqual([1, 2, 3]);
  });
});

describe('Apple Wallet', () => {
  const chain = fakeAppleChain();
  const cfg = { certificate: chain.certificate.replace(/\n/g, '\\n'), privateKey: chain.key, passphrase: null, wwdr: chain.wwdr, teamId: null };

  it('reads the pass type and team from the certificate', () => {
    const creds = loadAppleWalletCredentials(cfg);
    expect(creds.passTypeId).toBe('pass.no.tikit.test');
    expect(creds.teamId).toBe('ABCDE12345');
    expect(creds.validTo.getTime()).toBeGreaterThan(Date.now());
  });

  it('refuses a key that does not belong to the certificate, the wrong team and a foreign issuer', () => {
    expect(() => loadAppleWalletCredentials({ ...cfg, privateKey: rsaPem().key })).toThrow(/hører ikke til/);
    expect(() => loadAppleWalletCredentials({ ...cfg, teamId: 'ZZZZZ99999' })).toThrow(/APPLE_TEAM_ID/);
    expect(() => loadAppleWalletCredentials({ ...cfg, wwdr: null })).toThrow(/WWDR G4/);
    expect(() => loadAppleWalletCredentials({ ...cfg, certificate: 'nope' })).toThrow(/APPLE_WALLET_CERT/);
  });

  it('builds a signed .pkpass with the static code', async () => {
    const wallet = createAppleWallet(loadAppleWalletCredentials(cfg), loadAppleWalletImages(['public/wallet']));
    const files = unzip(Buffer.from(await wallet.build(input)));
    expect([...files.keys()].sort()).toEqual(['icon.png', 'icon@2x.png', 'icon@3x.png', 'logo.png', 'logo@2x.png', 'logo@3x.png', 'manifest.json', 'pass.json', 'signature']);

    const manifest = JSON.parse(files.get('manifest.json')!.toString('utf8')) as Record<string, string>;
    for (const [name, hash] of Object.entries(manifest)) expect(createHash('sha1').update(files.get(name)!).digest('hex')).toBe(hash);
    expect(Object.keys(manifest).sort()).toEqual([...files.keys()].filter((n) => n !== 'manifest.json' && n !== 'signature').sort());

    const pass = JSON.parse(files.get('pass.json')!.toString('utf8'));
    expect(pass).toMatchObject({
      formatVersion: 1,
      passTypeIdentifier: 'pass.no.tikit.test',
      teamIdentifier: 'ABCDE12345',
      serialNumber: input.serial,
      sharingProhibited: true,
      backgroundColor: 'rgb(11, 10, 36)',
      relevantDate: '2027-05-01T17:30:00Z',
      expirationDate: '2027-05-02T06:00:00Z',
      barcodes: [{ format: 'PKBarcodeFormatQR', message: input.barcode, altText: input.number }],
    });
    expect(pass.eventTicket.primaryFields[0].value).toBe('Russetreff Vest');

    // The signature: detached PKCS#7 with the pass certificate and the WWDR intermediate.
    const p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(files.get('signature')!.toString('binary'))) as forge.pkcs7.PkcsSignedData;
    expect(p7.certificates).toHaveLength(2);
    const openssl = spawnSync('openssl', ['version']);
    if (openssl.status === 0) {
      const dir = mkdtempSync(path.join(tmpdir(), 'pkpass-'));
      writeFileSync(path.join(dir, 'signature'), files.get('signature')!);
      writeFileSync(path.join(dir, 'manifest.json'), files.get('manifest.json')!);
      writeFileSync(path.join(dir, 'ca.pem'), chain.wwdr);
      const verify = spawnSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', 'signature', '-content', 'manifest.json', '-CAfile', 'ca.pem', '-purpose', 'any', '-out', '/dev/null'], { cwd: dir });
      expect(verify.stderr.toString()).toMatch(/Verification successful/);
      writeFileSync(path.join(dir, 'manifest.json'), Buffer.concat([files.get('manifest.json')!, Buffer.from(' ')]));
      const tampered = spawnSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', 'signature', '-content', 'manifest.json', '-CAfile', 'ca.pem', '-purpose', 'any', '-out', '/dev/null'], { cwd: dir });
      expect(tampered.status).not.toBe(0);
    }
  });

  it('turns only the wallet off when the certificate is broken', () => {
    const errors: string[] = [];
    const log = { info: () => {}, warn: () => {}, error: (m: string, d?: Record<string, unknown>) => errors.push(`${m} ${String(d?.error)}`) };
    const config = loadConfig({ NODE_ENV: 'test', APPLE_WALLET_CERT: 'broken', APPLE_WALLET_KEY: chain.key });
    expect(createWalletAdapter(config, 'dist/web', log)).toBeNull();
    expect(errors[0]).toMatch(/Apple Wallet er slått av.*APPLE_WALLET_CERT/);
  });
});

describe('Google Wallet', () => {
  const keys = rsaPem();
  const serviceAccount = JSON.stringify({ type: 'service_account', client_email: 'wallet@tikit-test.iam.gserviceaccount.com', private_key: keys.key, private_key_id: 'kid-1' });
  const issuerId = '3388000000012345678';

  it('makes a save link with a signed JWT holding the event class and the ticket', async () => {
    const wallet = createGoogleWallet({ issuerId, serviceAccount, publicUrl: 'https://tikit.no', issuerName: 'TIKIT' });
    const url = await wallet.build(input);
    expect(url.startsWith('https://pay.google.com/gp/v/save/')).toBe(true);
    // The app opens the link directly (never in a mail or SMS), so ~2.3 kB is fine; this guards against bloat.
    expect(url.length).toBeLessThan(2600);
    const longest = await wallet.build({ ...input, eventTitle: 'x'.repeat(120), venue: { name: 'y'.repeat(120), address: 'z'.repeat(160) } });
    expect(longest.length).toBeLessThan(4000);

    const { payload, protectedHeader } = await jwtVerify(url.split('/save/')[1]!, await importSPKI(keys.pub, 'RS256'), { issuer: 'wallet@tikit-test.iam.gserviceaccount.com', audience: 'google' });
    expect(protectedHeader.kid).toBe('kid-1');
    expect(payload.typ).toBe('savetowallet');
    expect(payload.origins).toEqual(['https://tikit.no']);
    const body = payload.payload as { eventTicketClasses: any[]; eventTicketObjects: any[] };
    expect(body.eventTicketClasses[0]).toMatchObject({ id: `${issuerId}.tikit-event-Ev3ntId000000001`, eventName: { defaultValue: { value: 'Russetreff Vest' } } });
    expect(body.eventTicketObjects[0]).toMatchObject({
      id: `${issuerId}.${input.serial}`,
      classId: `${issuerId}.tikit-event-Ev3ntId000000001`,
      state: 'ACTIVE',
      ticketHolderName: 'Emma Hansen',
      barcode: { type: 'QR_CODE', value: input.barcode },
    });
  });

  it('explains a bad service account key', () => {
    expect(() => parseGoogleServiceAccount('{')).toThrow(/ikke gyldig JSON/);
    expect(() => parseGoogleServiceAccount('{"client_email":"x"}')).toThrow(/private_key/);
  });

  it('checks the wallet settings at start-up', () => {
    expect(loadConfig({ NODE_ENV: 'test', GOOGLE_WALLET_ISSUER_ID: '3388000000012345678' }).warnings.join(' ')).toMatch(/Google Wallet er delvis/);
    expect(loadConfig({ NODE_ENV: 'test', APPLE_WALLET_CERT: 'x' }).warnings.join(' ')).toMatch(/Apple Wallet er delvis/);
    expect(() => loadConfig({ NODE_ENV: 'test', GOOGLE_WALLET_ISSUER_ID: 'abc', GOOGLE_WALLET_SERVICE_ACCOUNT: serviceAccount })).toThrow(/bare være tall/);
    expect(loadConfig({ NODE_ENV: 'test', GOOGLE_WALLET_ISSUER_ID: issuerId, GOOGLE_WALLET_SERVICE_ACCOUNT: serviceAccount }).wallet.google?.issuerId).toBe(issuerId);
  });
});
