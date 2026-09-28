import { base64UrlToBytes, bytesToBase64Url, randomBytes, sha256, toBuffer, utf8 } from '../../shared/encoding';

/**
 * Small secrets stored in the database (Apple refresh tokens for revocation) are encrypted with AES-256-GCM
 * under a key derived from SESSION_SECRET. Format: `v1.<iv>.<ciphertext>` (base64url).
 * If SESSION_SECRET changes, old values simply can't be opened any more – callers treat that as "no secret".
 */

type AesKey = Awaited<ReturnType<typeof globalThis.crypto.subtle.importKey>>;

async function keyFor(secret: string): Promise<AesKey> {
  const raw = await sha256(`tikit:sealed:v1:${secret}`);
  return globalThis.crypto.subtle.importKey('raw', toBuffer(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function sealSecret(secret: string, plaintext: string): Promise<string> {
  const iv = randomBytes(12);
  const data = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: toBuffer(iv) }, await keyFor(secret), toBuffer(utf8(plaintext)));
  return `v1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(data))}`;
}

export async function openSecret(secret: string, sealed: string | null | undefined): Promise<string | null> {
  if (!sealed) return null;
  const [version, iv, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !data) return null;
  try {
    const plain = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBuffer(base64UrlToBytes(iv)) }, await keyFor(secret), toBuffer(base64UrlToBytes(data)));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
