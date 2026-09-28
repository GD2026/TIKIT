import { describe, expect, it } from 'vitest';
import { ageOn, formatDateLong, formatTime, isValidBirthdate, osloLocalToUtc, osloOffsetMinutes, toOsloInput } from '../../src/shared/time';
import { computeTotals, discountedPrice, feeForPrice, resalePayout } from '../../src/shared/pricing';
import { formatNok, formatNokWhole, includedVat, parseKroner } from '../../src/shared/money';
import { createStaticTicketCode, createTicketCode, looksLikeTicketNumber, parseTicketCode, verifyTicketCode } from '../../src/shared/qr';
import { slugify, humanRef, newId, searchNormalize } from '../../src/shared/ids';
import { sameHolder } from '../../src/server/services/checkin';

const FEES = { feeFixedOre: 500, feePercentBp: 350, feeMaxOre: 4900 };

describe('Oslo time', () => {
  it('knows summer and winter time', () => {
    expect(osloOffsetMinutes('2026-07-01T12:00:00Z')).toBe(120);
    expect(osloOffsetMinutes('2026-12-01T12:00:00Z')).toBe(60);
  });

  it('converts wall-clock times across the DST switches', () => {
    // Spring forward: 29 March 2026 02:00 → 03:00.
    expect(osloLocalToUtc('2026-03-29T01:30').toISOString()).toBe('2026-03-29T00:30:00.000Z');
    expect(osloLocalToUtc('2026-03-29T03:30').toISOString()).toBe('2026-03-29T01:30:00.000Z');
    // A time inside the gap resolves forward instead of failing.
    const gap = osloLocalToUtc('2026-03-29T02:30');
    expect(toOsloInput(gap)).toBe('2026-03-29T03:30');
    // Fall back: 25 October 2026 03:00 → 02:00; 02:30 happens twice – the first one is chosen.
    expect(osloLocalToUtc('2026-10-25T02:30').toISOString()).toBe('2026-10-25T00:30:00.000Z');
    expect(osloLocalToUtc('2026-10-25T20:00').toISOString()).toBe('2026-10-25T19:00:00.000Z');
  });

  it('round-trips datetime-local values', () => {
    for (const local of ['2026-05-17T00:00', '2026-10-03T20:00', '2027-01-01T23:59']) {
      expect(toOsloInput(osloLocalToUtc(local))).toBe(local);
    }
  });

  it('formats in Norwegian', () => {
    expect(formatTime('2026-10-03T18:00:00Z')).toBe('20:00');
    expect(formatDateLong('2026-10-03T18:00:00Z')).toBe('lørdag 3. oktober 2026');
  });

  it('computes age on the Oslo calendar day, leap-day births turn older on 1 March', () => {
    expect(ageOn('2008-10-03', '2026-10-02T21:59:00Z')).toBe(17); // 23:59 in Oslo on 2 Oct
    expect(ageOn('2008-10-03', '2026-10-02T22:00:00Z')).toBe(18); // 00:00 in Oslo on 3 Oct
    expect(ageOn('2008-02-29', '2026-02-28T12:00:00Z')).toBe(17);
    expect(ageOn('2008-02-29', '2026-03-01T12:00:00Z')).toBe(18);
  });

  it('validates birth dates', () => {
    const now = new Date('2026-09-23T10:00:00Z');
    expect(isValidBirthdate('2007-03-14', now)).toBe(true);
    expect(isValidBirthdate('2007-02-30', now)).toBe(false);
    expect(isValidBirthdate('2024-01-01', now)).toBe(false);
    expect(isValidBirthdate('14.03.2007', now)).toBe(false);
  });
});

describe('pricing', () => {
  it('charges 5 kr + 3.5 % per ticket, rounded to whole kroner, capped at 49 kr', () => {
    expect(feeForPrice(0, FEES)).toBe(0);
    expect(feeForPrice(34900, FEES)).toBe(1700); // 5 + 12.215 = 17.2 → 17
    expect(feeForPrice(44900, FEES)).toBe(2100); // 5 + 15.715 = 20.7 → 21
    expect(feeForPrice(69900, FEES)).toBe(2900); // 5 + 24.465 = 29.5 → 29 (29.47)
    expect(feeForPrice(500000, FEES)).toBe(4900); // capped
    expect(feeForPrice(-100, FEES)).toBe(0);
    expect(feeForPrice(Number.NaN, FEES)).toBe(0);
  });

  it('applies discounts without going negative', () => {
    expect(discountedPrice(44900, { kind: 'percent', value: 15 })).toBe(38165);
    expect(discountedPrice(44900, { kind: 'fixed', value: 50000 })).toBe(0);
    expect(discountedPrice(44900, { kind: 'percent', value: 150 })).toBe(0);
    expect(discountedPrice(44900, null)).toBe(44900);
  });

  it('adds up totals and included VAT', () => {
    const t = computeTotals(
      [
        { qty: 2, listPriceOre: 44900, unitPriceOre: 44900, feeOre: 2100, vatRate: 0 },
        { qty: 1, listPriceOre: 20000, unitPriceOre: 17000, feeOre: 1100, vatRate: 12 },
      ],
      25,
    );
    expect(t.subtotalOre).toBe(109800);
    expect(t.discountOre).toBe(3000);
    expect(t.feeOre).toBe(5300);
    expect(t.totalOre).toBe(112100);
    expect(t.ticketsVatOre).toBe(includedVat(17000, 12));
    expect(t.feeVatOre).toBe(1060); // 25 % of 53 kr incl. VAT = 10.60 kr
  });

  it('pays the reseller the price minus the resale fee', () => {
    expect(resalePayout(44900, 500)).toBe(42655);
    expect(resalePayout(44900, 0)).toBe(44900);
  });
});

describe('money', () => {
  it('formats kroner the Norwegian way', () => {
    expect(formatNok(44900)).toBe('449 kr');
    expect(formatNok(123456789)).toBe('1 234 567,89 kr');
    expect(formatNokWhole(71635140)).toBe('716 351 kr');
  });

  it('parses typed amounts', () => {
    expect(parseKroner('449')).toBe(44900);
    expect(parseKroner('449,50 kr')).toBe(44950);
    expect(parseKroner('1 234')).toBe(123400);
    expect(parseKroner('-5')).toBeNull();
    expect(parseKroner('abc')).toBeNull();
  });
});

describe('ticket codes', () => {
  const id = 'AbCdEfGhIjKlMnOp';
  const secret = 'per-ticket-secret';
  const t0 = Date.parse('2026-10-03T19:00:00Z');

  it('accepts a fresh rotating code and rejects old, future and forged ones', async () => {
    const code = await createTicketCode(id, secret, t0);
    const parsed = parseTicketCode(code)!;
    expect(parsed.kind).toBe('rotating');
    expect(await verifyTicketCode(parsed, secret, t0)).toBe('ok');
    expect(await verifyTicketCode(parsed, secret, t0 + 6 * 15_000)).toBe('ok'); // within the grace window
    expect(await verifyTicketCode(parsed, secret, t0 + 8 * 15_000)).toBe('expired'); // screenshot
    expect(await verifyTicketCode(parsed, secret, t0 - 4 * 15_000)).toBe('future'); // phone clock ahead
    expect(await verifyTicketCode(parsed, 'rotated-after-transfer', t0)).toBe('bad_signature');
    const tampered = code.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect(await verifyTicketCode(parseTicketCode(tampered)!, secret, t0)).toBe('bad_signature');
  });

  it('verifies static wallet codes', async () => {
    const code = await createStaticTicketCode(id, secret);
    expect(await verifyTicketCode(parseTicketCode(code)!, secret, t0)).toBe('ok');
    expect(await verifyTicketCode(parseTicketCode(code)!, 'other', t0)).toBe('bad_signature');
  });

  it('rejects junk', () => {
    expect(parseTicketCode('')).toBeNull();
    expect(parseTicketCode('https://example.com')).toBeNull();
    expect(parseTicketCode('TK1.short.1.abcdefghijkl')).toBeNull();
    expect(parseTicketCode('TK1.AbCdEfGhIjKlMnOp.zz.<script>')).toBeNull();
  });

  it('recognises typed ticket numbers', () => {
    expect(looksLikeTicketNumber('TK-7F3K9Q-01')).toBe(true);
    expect(looksLikeTicketNumber('tk-7f3k9q-01')).toBe(true);
    expect(looksLikeTicketNumber('TK-7F3K9O-01')).toBe(false); // O is never used
    expect(looksLikeTicketNumber('7F3K9Q')).toBe(false);
  });
});

describe('ids and text', () => {
  it('makes readable slugs with Norwegian letters', () => {
    expect(slugify('Russetreff Vest – Ålesund 2027!')).toBe('russetreff-vest-alesund-2027');
    expect(slugify('Blåtime på Bryggen')).toBe('blatime-pa-bryggen');
    expect(slugify('!!!')).toBe('arrangement');
  });

  it('normalises search text', () => {
    expect(searchNormalize('  RØDRUSS   Rave ')).toBe('rodruss rave');
  });

  it('creates unguessable ids and readable references', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newId()));
    expect(ids.size).toBe(2000);
    expect(humanRef()).toMatch(/^TK-[2-9A-HJKMNP-Z]{6}$/);
  });
});

describe('door check: who the verified age belongs to', () => {
  it('matches the account owner on first and last name', () => {
    expect(sameHolder('Emma Hansen', 'Emma Hansen')).toBe(true);
    expect(sameHolder('Emma Sofie Hansen', 'emma hansen')).toBe(true);
    expect(sameHolder('Sindre Sæther', 'Sindre Saether')).toBe(false);
    expect(sameHolder('Ola Nordmann', 'Kari Nordmann')).toBe(false);
    expect(sameHolder('Ola Nordmann', '')).toBe(false);
    expect(sameHolder('Anne-Marie Holm', 'Anne Marie Holm')).toBe(true);
  });
});

describe('safe return path', () => {
  it('keeps same-site paths and rejects anything a browser could read as another site', async () => {
    const { safeReturnPath } = await import('../../src/shared/redirect');
    expect(safeReturnPath('/e/russetreff-vest?x=1#billetter')).toBe('/e/russetreff-vest?x=1#billetter');
    for (const bad of ['//evil.example', '/\\evil.example', '/\t/evil.example/x', '/\n/evil.example', 'https://evil.example', 'evil', '', null, undefined, `/${'a'.repeat(600)}`]) {
      expect(safeReturnPath(bad as string | null | undefined)).toBe('/');
    }
    expect(safeReturnPath('//evil.example', '/profil')).toBe('/profil');
  });
});
