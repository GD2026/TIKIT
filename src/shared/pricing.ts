import { includedVat } from './money';

export interface FeeSettings {
  feeFixedOre: number;
  feePercentBp: number; // basis points: 350 = 3.5 %
  feeMaxOre: number;
}

/**
 * Service fee per ticket, paid by the buyer. Free tickets carry no fee.
 * Fee = fixed + percent of price, rounded to whole kroner, capped.
 */
export function feeForPrice(unitPriceOre: number, s: FeeSettings): number {
  if (!Number.isFinite(unitPriceOre) || unitPriceOre <= 0) return 0;
  const raw = s.feeFixedOre + Math.round((unitPriceOre * s.feePercentBp) / 10000);
  const rounded = Math.round(raw / 100) * 100;
  return Math.max(0, Math.min(rounded, s.feeMaxOre));
}

export interface DiscountRule {
  kind: 'percent' | 'fixed';
  value: number;
}

/** Unit price after a per-ticket discount. Never negative. */
export function discountedPrice(listPriceOre: number, rule: DiscountRule | null): number {
  if (!rule) return listPriceOre;
  if (rule.kind === 'percent') {
    const pct = Math.min(100, Math.max(0, rule.value));
    return Math.max(0, listPriceOre - Math.round((listPriceOre * pct) / 100));
  }
  return Math.max(0, listPriceOre - Math.max(0, rule.value));
}

export interface PricedLine {
  qty: number;
  listPriceOre: number;
  unitPriceOre: number;
  feeOre: number;
  vatRate: number;
}

export interface Totals {
  subtotalOre: number;
  discountOre: number;
  feeOre: number;
  totalOre: number;
  ticketsVatOre: number;
  feeVatOre: number;
}

export function computeTotals(lines: PricedLine[], feeVatRate: number): Totals {
  let subtotalOre = 0;
  let discountOre = 0;
  let feeOre = 0;
  let ticketsVatOre = 0;
  for (const l of lines) {
    subtotalOre += l.qty * l.listPriceOre;
    discountOre += l.qty * (l.listPriceOre - l.unitPriceOre);
    feeOre += l.qty * l.feeOre;
    ticketsVatOre += includedVat(l.qty * l.unitPriceOre, l.vatRate);
  }
  const totalOre = subtotalOre - discountOre + feeOre;
  return { subtotalOre, discountOre, feeOre, totalOre, ticketsVatOre, feeVatOre: includedVat(feeOre, feeVatRate) };
}

/** Amount a reseller receives when a resale listing sells. */
export function resalePayout(priceOre: number, resaleFeePercentBp: number): number {
  const fee = Math.round((priceOre * resaleFeePercentBp) / 10000);
  return Math.max(0, priceOre - fee);
}
