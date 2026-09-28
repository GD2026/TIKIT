export const APP_NAME = 'TIKIT';

/** What russ actually go to. "Annet" is only a fallback for organizers – it's never shown as a filter. */
export const CATEGORIES = [
  { id: 'russetreff', label: 'Russetreff' },
  { id: 'fest', label: 'Fest' },
  { id: 'buss', label: 'Busslansering' },
  { id: 'revy', label: 'Revy' },
  { id: 'annet', label: 'Annet' },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]['id'];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];

export function categoryLabel(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.label ?? 'Annet';
}

export const CITIES = [
  'Stavanger',
  'Sandnes',
  'Sola',
  'Randaberg',
  'Bryne',
  'Haugesund',
  'Egersund',
  'Oslo',
  'Bergen',
  'Trondheim',
  'Kristiansand',
  'Drammen',
  'Fredrikstad',
  'Sarpsborg',
  'Tønsberg',
  'Sandefjord',
  'Larvik',
  'Skien',
  'Porsgrunn',
  'Arendal',
  'Ålesund',
  'Molde',
  'Hamar',
  'Lillehammer',
  'Gjøvik',
  'Moss',
  'Halden',
  'Bodø',
  'Tromsø',
] as const;

export const ORGANIZER_TYPES = [
  { id: 'russ', label: 'Russegruppe / russebuss' },
  { id: 'school', label: 'Skole / elevråd' },
  { id: 'venue', label: 'Utested / scene' },
  { id: 'company', label: 'Arrangørselskap' },
  { id: 'association', label: 'Lag eller forening' },
  { id: 'other', label: 'Annet' },
] as const;
export type OrganizerTypeId = (typeof ORGANIZER_TYPES)[number]['id'];
export const ORGANIZER_TYPE_IDS = ORGANIZER_TYPES.map((t) => t.id) as [OrganizerTypeId, ...OrganizerTypeId[]];

export const REFUND_POLICIES = [
  { id: 'none', label: 'Ingen refusjon', description: 'Billetter refunderes bare hvis arrangementet avlyses.' },
  { id: 'until-7d', label: 'Frem til 7 dager før', description: 'Kjøpere kan refundere selv frem til 7 dager før start.' },
  { id: 'until-48h', label: 'Frem til 48 timer før', description: 'Kjøpere kan refundere selv frem til 48 timer før start.' },
  { id: 'until-start', label: 'Frem til start', description: 'Kjøpere kan refundere selv helt frem til arrangementet starter.' },
] as const;
export type RefundPolicyId = (typeof REFUND_POLICIES)[number]['id'];
export const REFUND_POLICY_IDS = REFUND_POLICIES.map((p) => p.id) as [RefundPolicyId, ...RefundPolicyId[]];

export function refundDeadline(policy: RefundPolicyId, startsAt: string): Date | null {
  const start = new Date(startsAt).getTime();
  switch (policy) {
    case 'until-7d':
      return new Date(start - 7 * 86400000);
    case 'until-48h':
      return new Date(start - 48 * 3600000);
    case 'until-start':
      return new Date(start);
    default:
      return null;
  }
}

export const LIMITS = {
  holdMinutes: 10,
  paymentHoldMinutes: 20,
  maxTicketsPerOrder: 20,
  defaultMaxPerOrder: 8,
  transferExpiryDays: 14,
  /** Transfer e-mails to addresses without an account, per sender per 24 hours. */
  externalTransferMailsPerDay: 15,
  qrStepSeconds: 15,
  qrPastSteps: 6,
  qrFutureSteps: 2,
  sessionDays: 30,
  scannerSessionHours: 24,
  queueTokenMinutes: 15,
  waitlistBatch: 50,
  imageMaxBytes: 1_500_000,
  titleMax: 80,
  descriptionMax: 5000,
  ticketTypesMax: 20,
  maxSeatsPerMap: 2500,
} as const;

export const DEFAULT_PLATFORM_SETTINGS = {
  feeFixedOre: 500, // 5 kr
  feePercentBp: 350, // 3,5 %
  feeMaxOre: 4900, // 49 kr
  feeVatRate: 25,
  resaleFeePercentBp: 0,
} as const;

export const TICKET_VAT_RATES = [0, 12, 25] as const;
export type VatRate = (typeof TICKET_VAT_RATES)[number];

/** Poster art styles available for generated event covers. */
export const POSTER_STYLES = ['aurora', 'rays', 'grid', 'waves', 'orbit', 'stripes'] as const;
export type PosterStyle = (typeof POSTER_STYLES)[number];

/** Curated colour pairs for generated posters (content layer – never used for UI controls). */
export const POSTER_PALETTES = [
  { id: 'blatime', label: 'Blåtime', colors: ['#1B1464', '#3B4CF2', '#FF6FB5'] },
  { id: 'midnattsol', label: 'Midnattsol', colors: ['#2B0A3D', '#FF5E3A', '#FFC93C'] },
  { id: 'rodruss', label: 'Rødruss', colors: ['#3A0610', '#E3163A', '#FF9F68'] },
  { id: 'fjord', label: 'Fjord', colors: ['#03256C', '#1768AC', '#6FFFE9'] },
  { id: 'nordlys', label: 'Nordlys', colors: ['#050A30', '#12B886', '#B197FC'] },
  { id: 'syrin', label: 'Syrin', colors: ['#2D1B69', '#9D4EDD', '#FFD6FF'] },
  { id: 'sitron', label: 'Sitron', colors: ['#1E1E24', '#F7D002', '#FF5D8F'] },
  { id: 'kobber', label: 'Kobber', colors: ['#1A120B', '#C0692A', '#F3D9B1'] },
] as const;
export type PosterPaletteId = (typeof POSTER_PALETTES)[number]['id'];
export const POSTER_PALETTE_IDS = POSTER_PALETTES.map((p) => p.id) as [PosterPaletteId, ...PosterPaletteId[]];

export function posterPalette(id: string): readonly [string, string, string] {
  const p = POSTER_PALETTES.find((x) => x.id === id) ?? POSTER_PALETTES[0];
  return p.colors;
}
