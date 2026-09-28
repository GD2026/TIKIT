/** Norwegian-specific validators. */

function mod11(digits: number[], weights: number[]): number | null {
  const sum = weights.reduce((acc, w, i) => acc + w * (digits[i] ?? 0), 0);
  const r = 11 - (sum % 11);
  if (r === 11) return 0;
  if (r === 10) return null;
  return r;
}

/** Organisasjonsnummer: 9 digits with MOD11 check digit. */
export function isValidOrgNumber(input: string): boolean {
  const value = input.replace(/\s/g, '');
  if (!/^\d{9}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const check = mod11(digits.slice(0, 8), [3, 2, 7, 6, 5, 4, 3, 2]);
  return check !== null && check === digits[8];
}

/** Kontonummer: 11 digits with MOD11 check digit. */
export function isValidAccountNumber(input: string): boolean {
  const value = input.replace(/[\s.]/g, '');
  if (!/^\d{11}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const check = mod11(digits.slice(0, 10), [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]);
  return check !== null && check === digits[10];
}

export function formatAccountNumber(value: string): string {
  const v = value.replace(/\D/g, '');
  return v.length === 11 ? `${v.slice(0, 4)}.${v.slice(4, 6)}.${v.slice(6)}` : value;
}

export function formatOrgNumber(value: string): string {
  const v = value.replace(/\D/g, '');
  return v.length === 9 ? `${v.slice(0, 3)} ${v.slice(3, 6)} ${v.slice(6)}` : value;
}

/**
 * Normalises phone numbers to E.164. Accepts "912 34 567", "+47 91234567", "004791234567"
 * and Vipps' "4791234567" format. Returns null for anything that doesn't look like a phone number.
 */
export function normalizePhone(input: string): string | null {
  let v = input.replace(/[\s\-().]/g, '');
  if (v.startsWith('00')) v = `+${v.slice(2)}`;
  if (/^\d{8}$/.test(v)) v = `+47${v}`;
  else if (/^47\d{8}$/.test(v)) v = `+${v}`;
  else if (/^\d{9,15}$/.test(v)) v = `+${v}`;
  if (!/^\+\d{8,15}$/.test(v)) return null;
  return v;
}

export function formatPhone(e164: string | null): string {
  if (!e164) return '';
  const m = /^\+47(\d{3})(\d{2})(\d{3})$/.exec(e164);
  if (m) return `${m[1]} ${m[2]} ${m[3]}`;
  return e164;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(input: string): boolean {
  return input.length <= 254 && EMAIL_RE.test(input);
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** Masks an email for display to others: "e***@gmail.com". */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!domain) return email;
  return `${local.slice(0, 1)}***@${domain}`;
}

export function maskPhone(e164: string): string {
  return e164.length > 4 ? `${'•'.repeat(Math.max(0, e164.length - 5))} ${e164.slice(-3)}` : e164;
}

export function isValidPostalCode(input: string): boolean {
  return /^\d{4}$/.test(input.trim());
}
