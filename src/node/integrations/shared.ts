import { createHash, timingSafeEqual } from 'node:crypto';

/** Vipps and Stripe accept idempotency keys of limited length and alphabet. */
export function idemKey(key: string): string {
  if (/^[A-Za-z0-9-]{1,50}$/.test(key)) return key;
  return `k-${createHash('sha256').update(key).digest('hex').slice(0, 40)}`;
}

/** Constant-time string comparison for signatures. */
export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
