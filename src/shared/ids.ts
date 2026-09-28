import { bytesToBase64Url, randomBytes } from './encoding';

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** No 0/O, 1/I/L – easy to read aloud at the door or over the phone. */
const HUMAN = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

function randomFromAlphabet(alphabet: string, length: number): string {
  // Rejection sampling avoids modulo bias.
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  let out = '';
  while (out.length < length) {
    const bytes = randomBytes(length * 2);
    for (const b of bytes) {
      if (b < max) {
        out += alphabet[b % alphabet.length];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

/** 16 chars base62 ≈ 95 bits – unguessable ids for URLs. */
export function newId(length = 16): string {
  return randomFromAlphabet(BASE62, length);
}

/** Opaque secret token (base64url). */
export function newToken(bytes = 32): string {
  return bytesToBase64Url(randomBytes(bytes));
}

/** Human-friendly reference, e.g. "TK-7F3K9Q". */
export function humanRef(prefix = 'TK', length = 6): string {
  return `${prefix}-${randomFromAlphabet(HUMAN, length)}`;
}

/** Numeric code grouped for readability, e.g. "4829-1736". */
export function numericCode(groups = 2, groupLength = 4): string {
  const parts: string[] = [];
  for (let i = 0; i < groups; i++) parts.push(randomFromAlphabet('0123456789', groupLength));
  return parts.join('-');
}

const NORDIC: Record<string, string> = { æ: 'ae', ø: 'o', å: 'a', ä: 'a', ö: 'o', ü: 'u', é: 'e', è: 'e', ß: 'ss' };

export function slugify(input: string, maxLength = 60): string {
  const lowered = input.toLowerCase().replace(/[æøåäöüéèß]/g, (ch) => NORDIC[ch] ?? ch);
  const ascii = lowered.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const slug = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'arrangement';
}

/** Normalizes text for search: lower-case, Nordic letters folded, accents removed. */
export function searchNormalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[æøåäöüéèß]/g, (ch) => NORDIC[ch] ?? ch)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
