/**
 * Isomorphic encoding + crypto helpers (Web Crypto only – runs in Node 22+ and browsers).
 */

const textEncoder = new TextEncoder();

export function utf8(input: string): Uint8Array {
  return textEncoder.encode(input);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return base64ToBytes(padded);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

/** Copies into a fresh ArrayBuffer-backed view (keeps TypeScript's BufferSource typing happy). */
export function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function sha256(input: string | Uint8Array): Promise<Uint8Array> {
  const data = typeof input === 'string' ? utf8(input) : input;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', toBuffer(data));
  return new Uint8Array(digest);
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  return bytesToHex(await sha256(input));
}

export async function sha256Base64(input: string | Uint8Array): Promise<string> {
  return bytesToBase64(await sha256(input));
}

type HmacKey = Awaited<ReturnType<typeof globalThis.crypto.subtle.importKey>>;
const hmacKeyCache = new Map<string, Promise<HmacKey>>();

function importHmacKey(secret: string | Uint8Array): Promise<HmacKey> {
  const cacheKey = typeof secret === 'string' ? `s:${secret}` : `b:${bytesToBase64(secret)}`;
  let key = hmacKeyCache.get(cacheKey);
  if (!key) {
    const raw = typeof secret === 'string' ? utf8(secret) : secret;
    key = globalThis.crypto.subtle.importKey('raw', toBuffer(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    if (hmacKeyCache.size > 2000) hmacKeyCache.clear();
    hmacKeyCache.set(cacheKey, key);
  }
  return key;
}

export async function hmacSha256(secret: string | Uint8Array, message: string | Uint8Array): Promise<Uint8Array> {
  const key = await importHmacKey(secret);
  const data = typeof message === 'string' ? utf8(message) : message;
  const sig = await globalThis.crypto.subtle.sign('HMAC', key, toBuffer(data));
  return new Uint8Array(sig);
}

/** Constant-time string comparison (length leak only). */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
