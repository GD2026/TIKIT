/** All money is handled as integer øre (1 kr = 100 øre). Never floats. */

export const MAX_PRICE_ORE = 10_000_000; // 100 000 kr per ticket – sanity cap

export function isValidOre(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000;
}

function groupThousands(n: number): string {
  // Norwegian uses a (narrow) no-break space as thousands separator.
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
}

/**
 * 34900 -> "349 kr", 34950 -> "349,50 kr", 0 -> "Gratis" (when freeLabel given).
 */
export function formatNok(ore: number, options: { freeLabel?: string; showSign?: boolean } = {}): string {
  if (ore === 0 && options.freeLabel) return options.freeLabel;
  const negative = ore < 0;
  const abs = Math.abs(Math.round(ore));
  const kr = Math.floor(abs / 100);
  const rest = abs % 100;
  const body = rest === 0 ? `${groupThousands(kr)}\u00a0kr` : `${groupThousands(kr)},${String(rest).padStart(2, '0')}\u00a0kr`;
  if (negative) return `−${body}`;
  if (options.showSign && ore > 0) return `+${body}`;
  return body;
}

/** Compact variant for charts/axes: 1 250 000 øre -> "12,5k kr". */
export function formatNokCompact(ore: number): string {
  const kr = ore / 100;
  if (Math.abs(kr) >= 1_000_000) return `${(kr / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')} mill. kr`;
  if (Math.abs(kr) >= 10_000) return `${Math.round(kr / 1000)}k kr`;
  if (Math.abs(kr) >= 1000) return `${(kr / 1000).toFixed(1).replace('.', ',').replace(',0', '')}k kr`;
  return `${Math.round(kr)} kr`;
}

/**
 * Parses user input in kroner ("349", "349,50", "349.5", "1 250") to øre.
 * Returns null when the input is not a valid non-negative amount.
 */
export function parseKroner(input: string): number | null {
  const cleaned = input.replace(/[\s\u00a0]/g, '').replace(/kr$/i, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const ore = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(ore) ? ore : null;
}

/** Øre -> kroner string for form inputs ("349" or "349,50"). */
export function oreToInput(ore: number): string {
  const kr = Math.floor(ore / 100);
  const rest = ore % 100;
  return rest === 0 ? String(kr) : `${kr},${String(rest).padStart(2, '0')}`;
}

/** VAT amount included in a gross amount: gross * rate / (100 + rate), rounded to nearest øre. */
export function includedVat(grossOre: number, ratePercent: number): number {
  if (ratePercent <= 0) return 0;
  return Math.round((grossOre * ratePercent) / (100 + ratePercent));
}

/** Rounded to whole kroner – for headline figures where øre are noise ("421 304 kr"). */
export function formatNokWhole(ore: number): string {
  return formatNok(Math.round(ore / 100) * 100);
}
