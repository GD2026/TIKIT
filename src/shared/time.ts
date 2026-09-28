/**
 * Time helpers. All instants are stored as UTC ISO strings; everything shown to people
 * is rendered in Europe/Oslo (events happen in Norway), independent of the device time zone.
 * Formatting is done with our own name tables so output is identical in every JS engine.
 */

export const OSLO = 'Europe/Oslo';

const WEEKDAYS_LONG = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
const WEEKDAYS_SHORT = ['søn.', 'man.', 'tir.', 'ons.', 'tor.', 'fre.', 'lør.'];
const MONTHS_LONG = ['januar', 'februar', 'mars', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'desember'];
const MONTHS_SHORT = ['jan.', 'feb.', 'mar.', 'apr.', 'mai', 'jun.', 'jul.', 'aug.', 'sep.', 'okt.', 'nov.', 'des.'];

export interface OsloParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: OSLO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function toDate(input: Date | string | number): Date {
  return input instanceof Date ? input : new Date(input);
}

export function osloParts(input: Date | string | number): OsloParts {
  const date = toDate(input);
  const parts = partsFormatter.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0;
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
  };
}

/** Oslo's UTC offset in minutes at the given instant (60 in winter, 120 in summer). */
export function osloOffsetMinutes(input: Date | string | number): number {
  const date = toDate(input);
  const p = osloParts(date);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const actual = Math.floor(date.getTime() / 1000) * 1000;
  return Math.round((asUtc - actual) / 60000);
}

/**
 * Converts an Oslo wall-clock time ("2027-05-01T20:00" or with seconds) to a UTC Date.
 * Non-existent times in the spring DST gap resolve forward; ambiguous autumn times pick the first occurrence.
 */
export function osloLocalToUtc(local: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(local.trim());
  if (!m) throw new Error(`Ugyldig dato/tid: ${local}`);
  const [, y, mo, d, h, mi, s] = m;
  const naive = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? '0'));
  let guess = naive - osloOffsetMinutes(naive) * 60000;
  const correction = osloOffsetMinutes(guess);
  guess = naive - correction * 60000;
  // Ambiguous (autumn) times: prefer the earlier instant if it maps to the same wall time.
  const earlier = guess - 60 * 60000;
  const ep = osloParts(earlier);
  if (ep.hour === Number(h) && ep.minute === Number(mi) && ep.day === Number(d)) return new Date(earlier);
  return new Date(guess);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** UTC instant -> "YYYY-MM-DDTHH:mm" in Oslo time (for <input type="datetime-local">). */
export function toOsloInput(input: Date | string | number): string {
  const p = osloParts(input);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** "YYYY-MM-DD" of the Oslo calendar day. */
export function osloDateKey(input: Date | string | number): string {
  const p = osloParts(input);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function formatTime(input: Date | string | number): string {
  const p = osloParts(input);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** "lørdag 1. mai 2027" */
export function formatDateLong(input: Date | string | number, withYear = true): string {
  const p = osloParts(input);
  return `${WEEKDAYS_LONG[p.weekday]} ${p.day}. ${MONTHS_LONG[p.month - 1]}${withYear ? ` ${p.year}` : ''}`;
}

/** "lør. 1. mai" (+ year when not the current year) */
export function formatDateShort(input: Date | string | number, now: Date = new Date()): string {
  const p = osloParts(input);
  const n = osloParts(now);
  const year = p.year !== n.year ? ` ${p.year}` : '';
  return `${WEEKDAYS_SHORT[p.weekday]} ${p.day}. ${MONTHS_SHORT[p.month - 1]}${year}`;
}

/** "1. mai" */
export function formatDayMonth(input: Date | string | number): string {
  const p = osloParts(input);
  return `${p.day}. ${MONTHS_LONG[p.month - 1]}`;
}

export function monthShort(input: Date | string | number): string {
  return MONTHS_SHORT[osloParts(input).month - 1]!.replace('.', '').toUpperCase();
}

export function weekdayShort(input: Date | string | number): string {
  return WEEKDAYS_SHORT[osloParts(input).weekday]!;
}

/** "lør. 1. mai · 20:00" */
export function formatEventWhen(startsAt: string, now: Date = new Date()): string {
  return `${formatDateShort(startsAt, now)} · ${formatTime(startsAt)}`;
}

/** "20:00–03:00" or "lør. 1. mai 20:00 – søn. 2. mai 18:00" for multi-day */
export function formatTimeRange(startsAt: string, endsAt: string, now: Date = new Date()): string {
  const sameDay = osloDateKey(startsAt) === osloDateKey(endsAt);
  const hoursApart = (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 3600000;
  if (sameDay || hoursApart <= 12) return `${formatTime(startsAt)}–${formatTime(endsAt)}`;
  return `${formatDateShort(startsAt, now)} ${formatTime(startsAt)} – ${formatDateShort(endsAt, now)} ${formatTime(endsAt)}`;
}

/** "I dag", "I morgen", "lørdag" (within a week) or "lør. 1. mai" */
export function formatRelativeDay(input: string, now: Date = new Date()): string {
  const target = osloDateKey(input);
  const today = osloDateKey(now);
  if (target === today) return 'I dag';
  const tomorrow = osloDateKey(new Date(now.getTime() + 86400000));
  if (target === tomorrow) return 'I morgen';
  const diffDays = (new Date(input).getTime() - now.getTime()) / 86400000;
  if (diffDays > 0 && diffDays < 6) {
    const name = WEEKDAYS_LONG[osloParts(input).weekday]!;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  return formatDateShort(input, now);
}

/** Countdown text: "2 d 04:12:09", "04:12:09", "12:09" */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days} d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** "for 5 min siden", "for 2 t siden", "i går", or a date */
export function formatAgo(input: string, now: Date = new Date()): string {
  const diff = now.getTime() - new Date(input).getTime();
  if (diff < 60_000) return 'nå nettopp';
  if (diff < 3_600_000) return `for ${Math.floor(diff / 60_000)} min siden`;
  if (diff < 86_400_000 && osloDateKey(input) === osloDateKey(now)) return `for ${Math.floor(diff / 3_600_000)} t siden`;
  if (osloDateKey(input) === osloDateKey(new Date(now.getTime() - 86400000))) return `i går ${formatTime(input)}`;
  return `${formatDateShort(input, now)} ${formatTime(input)}`;
}

/** Whole years between a birthdate (YYYY-MM-DD) and an instant (Oslo calendar). */
export function ageOn(birthdate: string, at: Date | string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthdate);
  if (!m) return 0;
  const p = osloParts(at);
  const by = Number(m[1]);
  const bm = Number(m[2]);
  const bd = Number(m[3]);
  let age = p.year - by;
  if (p.month < bm || (p.month === bm && p.day < bd)) age -= 1;
  return age;
}

export function isValidBirthdate(value: string, now: Date = new Date()): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return false;
  const age = ageOn(value, now);
  return age >= 10 && age <= 120;
}

/** Start (00:00 Oslo) of the Oslo day containing the instant, as UTC Date. */
export function startOfOsloDay(input: Date | string | number): Date {
  const p = osloParts(input);
  return osloLocalToUtc(`${p.year}-${pad(p.month)}-${pad(p.day)}T00:00`);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

/** Upcoming weekend window in Oslo time: Friday 15:00 – Monday 06:00 (or the current one). */
export function weekendWindow(now: Date = new Date()): { from: Date; to: Date } {
  const p = osloParts(now);
  // days until Friday (5); if Sat/Sun we're inside the weekend already
  const dow = p.weekday;
  let fridayOffset: number;
  if (dow === 6) fridayOffset = -1;
  else if (dow === 0) fridayOffset = -2;
  else fridayOffset = 5 - dow;
  const friday = startOfOsloDay(addDays(now, fridayOffset));
  const from = new Date(friday.getTime() + 15 * 3600000);
  const to = new Date(startOfOsloDay(addDays(friday, 3)).getTime() + 6 * 3600000);
  return { from: from < now ? now : from, to };
}

export function isoNow(clock: () => Date = () => new Date()): string {
  return clock().toISOString();
}

export function addMinutesIso(iso: string | Date, minutes: number): string {
  return new Date(toDate(iso).getTime() + minutes * 60000).toISOString();
}

/** Formats a UTC instant as an iCalendar UTC timestamp (YYYYMMDDTHHMMSSZ). */
export function toIcsUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}
