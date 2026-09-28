import { z } from 'zod';
import { CATEGORY_IDS, LIMITS, ORGANIZER_TYPE_IDS, POSTER_PALETTE_IDS, POSTER_STYLES, REFUND_POLICY_IDS } from './constants';
import { isValidAccountNumber, isValidOrgNumber, normalizePhone } from './validation';
import { isValidBirthdate } from './time';
import { MAX_PRICE_ORE } from './money';

// Validation messages users see are Norwegian (field-specific messages below override these).
z.config(z.locales.no());

const text = (max: number, min = 0, label = 'Feltet') =>
  z
    .string()
    .trim()
    .min(min, { error: min <= 1 ? `${label} må fylles ut.` : `${label} må ha minst ${min} tegn.` })
    .max(max, { error: `${label} kan ha maks ${max} tegn.` })
    // Strip control characters (except newlines/tabs) – keeps stored text clean.
    // eslint-disable-next-line no-control-regex
    .transform((v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ''));

const isoDate = z.iso.datetime({ offset: true, error: 'Ugyldig dato.' });
const id = z.string().regex(/^[0-9A-Za-z_-]{6,64}$/, { error: 'Ugyldig id.' });
const ore = z.number().int({ error: 'Beløpet må være et heltall i øre.' }).min(0).max(MAX_PRICE_ORE);

export const phoneSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) {
      ctx.addIssue({ code: 'custom', message: 'Skriv et gyldig mobilnummer, for eksempel 912 34 567.' });
      return z.NEVER;
    }
    return n;
  });

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: 'Skriv en gyldig e-postadresse.' }));

// ── Profile ────────────────────────────────────────────────────────────────
export const profileUpdateSchema = z
  .object({
    name: text(80, 2, 'Navn').optional(),
    email: emailSchema.nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    birthdate: z
      .string()
      .refine((v) => isValidBirthdate(v), { error: 'Skriv en gyldig fødselsdato.' })
      .nullable()
      .optional(),
    city: text(60, 0, 'By').nullable().optional(),
    prefs: z
      .object({
        email: z.boolean(),
        reminders: z.boolean(),
        waitlist: z.boolean(),
        marketing: z.boolean(),
      })
      .partial()
      .optional(),
  })
  .strict();
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

// ── Organizer ─────────────────────────────────────────────────────────────
export const organizerSchema = z
  .object({
    name: text(80, 2, 'Navn'),
    type: z.enum(ORGANIZER_TYPE_IDS),
    orgNumber: z
      .string()
      .trim()
      .transform((v) => v.replace(/\s/g, ''))
      .refine((v) => v === '' || isValidOrgNumber(v), { error: 'Organisasjonsnummeret er ikke gyldig.' })
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    description: text(1000, 0, 'Beskrivelse').default(''),
    city: text(60, 0, 'By').nullable().optional(),
    email: emailSchema,
    phone: phoneSchema.nullable().optional(),
    website: z
      .string()
      .trim()
      .max(200)
      .refine((v) => v === '' || /^https?:\/\/[^\s]+\.[^\s]+$/i.test(v), { error: 'Nettadressen må starte med https://' })
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    payoutAccount: z
      .string()
      .trim()
      .transform((v) => v.replace(/[\s.]/g, ''))
      .refine((v) => v === '' || isValidAccountNumber(v), { error: 'Kontonummeret er ikke gyldig.' })
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    palette: z.enum(POSTER_PALETTE_IDS).optional(),
    logoImageId: id.nullable().optional(),
  })
  .strict();
export type OrganizerInput = z.infer<typeof organizerSchema>;

// ── Events ────────────────────────────────────────────────────────────────
export const eventSettingsSchema = z
  .object({
    maxPerOrder: z.number().int().min(1).max(LIMITS.maxTicketsPerOrder),
    personalizedTickets: z.boolean(),
    transfersAllowed: z.boolean(),
    resaleAllowed: z.boolean(),
    refundPolicy: z.enum(REFUND_POLICY_IDS),
    queueEnabled: z.boolean(),
    queueRatePerMinute: z.number().int().min(5).max(5000),
    waitlistEnabled: z.boolean(),
    showRemaining: z.boolean(),
    requireVerifiedAge: z.boolean(),
  })
  .strict();

export const eventInputSchema = z
  .object({
    title: text(LIMITS.titleMax, 3, 'Tittel'),
    subtitle: text(120, 0, 'Undertittel').default(''),
    description: text(LIMITS.descriptionMax, 0, 'Beskrivelse').default(''),
    category: z.enum(CATEGORY_IDS, { error: 'Velg en kategori.' }),
    visibility: z.enum(['public', 'unlisted']).default('public'),
    startsAt: isoDate,
    endsAt: isoDate,
    doorsAt: isoDate.nullable().default(null),
    salesStartAt: isoDate.nullable().default(null),
    salesEndAt: isoDate.nullable().default(null),
    venue: z
      .object({
        name: text(80, 2, 'Sted'),
        address: text(120, 0, 'Adresse').default(''),
        postalCode: z
          .string()
          .trim()
          .refine((v) => v === '' || /^\d{4}$/.test(v), { error: 'Postnummer har 4 siffer.' })
          .default(''),
        city: text(60, 2, 'By'),
      })
      .strict(),
    ageLimit: z.number().int().min(0).max(30).nullable().default(null),
    poster: z
      .object({
        style: z.enum(POSTER_STYLES),
        palette: z.enum(POSTER_PALETTE_IDS),
        seed: z.number().int().min(0).max(1_000_000),
      })
      .strict(),
    coverImageId: id.nullable().default(null),
    lineup: z
      .array(z.object({ name: text(60, 1, 'Navn'), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null) }).strict())
      .max(30)
      .default([]),
    tags: z.array(text(24, 1, 'Stikkord')).max(8).default([]),
    settings: eventSettingsSchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    const start = Date.parse(v.startsAt);
    const end = Date.parse(v.endsAt);
    if (end <= start) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Slutt må være etter start.' });
    if (end - start > 14 * 86400000) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'Et arrangement kan vare maks 14 dager.' });
    if (v.doorsAt && Date.parse(v.doorsAt) > start) ctx.addIssue({ code: 'custom', path: ['doorsAt'], message: 'Dørene må åpne før start.' });
    if (v.salesStartAt && v.salesEndAt && Date.parse(v.salesEndAt) <= Date.parse(v.salesStartAt))
      ctx.addIssue({ code: 'custom', path: ['salesEndAt'], message: 'Salget må slutte etter at det starter.' });
    if (v.salesEndAt && Date.parse(v.salesEndAt) > end)
      ctx.addIssue({ code: 'custom', path: ['salesEndAt'], message: 'Salget kan ikke vare lenger enn arrangementet.' });
  });
export type EventInput = z.infer<typeof eventInputSchema>;

export const ticketTypeInputSchema = z
  .object({
    id: id.optional(),
    name: text(60, 2, 'Navn'),
    description: text(300, 0, 'Beskrivelse').default(''),
    priceOre: ore,
    capacity: z.number().int().min(1, { error: 'Antall må være minst 1.' }).max(100_000),
    maxPerOrder: z.number().int().min(1).max(LIMITS.maxTicketsPerOrder).nullable().default(null),
    salesStartAt: isoDate.nullable().default(null),
    salesEndAt: isoDate.nullable().default(null),
    hidden: z.boolean().default(false),
    accessCode: z
      .string()
      .trim()
      .max(40)
      .regex(/^[A-Za-z0-9ÆØÅæøå_-]*$/, { error: 'Koden kan bare inneholde bokstaver, tall, - og _.' })
      .nullable()
      .optional(),
    vatRate: z.union([z.literal(0), z.literal(12), z.literal(25)]).default(0),
    paused: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  })
  .strict();
export type TicketTypeInput = z.infer<typeof ticketTypeInputSchema>;

export const seatMapInputSchema = z
  .object({
    stageLabel: text(40, 1, 'Scene').default('Scene'),
    sections: z
      .array(
        z
          .object({
            id: z.string().regex(/^[A-Za-z0-9]{1,12}$/),
            name: text(40, 1, 'Seksjon'),
            ticketTypeId: id,
            rows: z
              .array(
                z
                  .object({
                    label: z.string().trim().min(1).max(4),
                    seats: z.number().int().min(1).max(80),
                    offset: z.number().int().min(0).max(40).default(0),
                    accessible: z.array(z.number().int().min(1).max(80)).max(80).default([]),
                  })
                  .strict(),
              )
              .min(1)
              .max(60),
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type SeatMapInput = z.infer<typeof seatMapInputSchema>;

// ── Buying ────────────────────────────────────────────────────────────────
export const orderCreateSchema = z
  .object({
    eventId: id,
    items: z
      .array(z.object({ ticketTypeId: id, qty: z.number().int().min(1).max(LIMITS.maxTicketsPerOrder) }).strict())
      .max(LIMITS.ticketTypesMax)
      .default([]),
    seatIds: z.array(z.string().min(3).max(80)).max(LIMITS.maxTicketsPerOrder).default([]),
    discountCode: z.string().trim().max(40).nullable().optional(),
    unlockToken: z.string().max(2000).nullable().optional(),
    queueToken: z.string().max(2000).nullable().optional(),
    resaleListingId: id.nullable().optional(),
    idempotencyKey: z.string().min(8).max(80).nullable().optional(),
  })
  .strict();
export type OrderCreateInput = z.infer<typeof orderCreateSchema>;

export const orderUpdateSchema = z
  .object({
    attendeeNames: z.array(text(80, 0, 'Navn')).max(LIMITS.maxTicketsPerOrder).optional(),
    discountCode: z.string().trim().max(40).nullable().optional(),
  })
  .strict();

export const orderPaySchema = z
  .object({
    method: z.enum(['vipps', 'card', 'free']),
    phone: phoneSchema.nullable().optional(),
    acceptTerms: z.literal(true, { error: 'Du må godta kjøpsvilkårene.' }),
    /** 'ios' when paying from the iOS app: the provider returns the buyer to the app (universal link). */
    client: z.enum(['web', 'ios']).optional(),
  })
  .strict();

export const unlockSchema = z.object({ code: z.string().trim().min(1).max(40) }).strict();

// ── Tickets ───────────────────────────────────────────────────────────────
export const transferCreateSchema = z
  .object({
    contact: z.string().trim().max(254).nullable().optional(),
    message: text(200, 0, 'Melding').nullable().optional(),
  })
  .strict();

export const resaleCreateSchema = z.object({ priceOre: ore.min(100, { error: 'Prisen må være minst 1 kr.' }) }).strict();

// ── Check-in ──────────────────────────────────────────────────────────────
export const checkinSchema = z
  .object({
    eventId: id,
    code: z.string().trim().min(3).max(200),
    gate: z.string().trim().max(40).nullable().optional(),
    /** Door staff typed the ticket number by hand. A QR code containing only the number is never accepted. */
    manual: z.boolean().optional(),
  })
  .strict();

export const manualCheckinSchema = z.object({ eventId: id, ticketId: id, undo: z.boolean().default(false) }).strict();
export const scannerLoginSchema = z.object({ code: z.string().trim().min(6).max(20) }).strict();
export const scannerCodeCreateSchema = z.object({ label: text(40, 1, 'Navn') }).strict();

// ── Organizer tools ───────────────────────────────────────────────────────
export const discountInputSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3, { error: 'Koden må ha minst 3 tegn.' })
      .max(30)
      .regex(/^[A-Z0-9ÆØÅ_-]+$/, { error: 'Koden kan bare inneholde bokstaver, tall, - og _.' }),
    kind: z.enum(['percent', 'fixed']),
    value: z.number().int().min(1),
    maxUses: z.number().int().min(1).max(100_000).nullable().default(null),
    ticketTypeIds: z.array(id).max(LIMITS.ticketTypesMax).default([]),
    validFrom: isoDate.nullable().default(null),
    validUntil: isoDate.nullable().default(null),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.kind === 'percent' && v.value > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Prosent kan maks være 100.' });
    if (v.kind === 'fixed' && v.value > MAX_PRICE_ORE) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Beløpet er for høyt.' });
  });
export type DiscountInput = z.infer<typeof discountInputSchema>;

export const guestTicketSchema = z
  .object({
    name: text(80, 2, 'Navn'),
    contact: z.string().trim().max(254).nullable().optional(),
    ticketTypeId: id,
    qty: z.number().int().min(1).max(20),
    message: text(200, 0, 'Melding').nullable().optional(),
  })
  .strict();

export const teamInviteSchema = z.object({ email: emailSchema, role: z.enum(['admin', 'staff']) }).strict();
export const cancelEventSchema = z.object({ reason: text(300, 5, 'Begrunnelse') }).strict();
export const refundSchema = z
  .object({
    ticketIds: z.array(id).max(200).default([]),
    includeFees: z.boolean().default(false),
    reason: text(200, 0, 'Begrunnelse').default(''),
  })
  .strict();

export const imageUploadSchema = z
  .object({
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    data: z.string().min(100).max(Math.ceil((LIMITS.imageMaxBytes * 4) / 3) + 8),
    width: z.number().int().min(16).max(4096),
    height: z.number().int().min(16).max(4096),
  })
  .strict();

export const platformSettingsSchema = z
  .object({
    feeFixedOre: z.number().int().min(0).max(10_000),
    feePercentBp: z.number().int().min(0).max(2000),
    feeMaxOre: z.number().int().min(0).max(50_000),
    resaleFeePercentBp: z.number().int().min(0).max(2000),
  })
  .strict();

export const organizerReviewSchema = z
  .object({ status: z.enum(['approved', 'rejected', 'suspended']), note: text(300, 0, 'Notat').nullable().default(null), verified: z.boolean().optional() })
  .strict();

export const payoutCreateSchema = z
  .object({ amountOre: ore.min(1), reference: text(60, 1, 'Referanse'), note: text(200, 0, 'Notat').default('') })
  .strict();

// ── Moderation (App Store Review Guideline 1.2) ───────────────────────────
export const REPORT_REASONS = ['offensive', 'fraud', 'illegal', 'misleading', 'other'] as const;

export const reportCreateSchema = z
  .object({
    kind: z.enum(['event', 'organizer']),
    targetId: id,
    reason: z.enum(REPORT_REASONS),
    message: text(1000, 0, 'Beskrivelsen').default(''),
  })
  .strict();
export type ReportCreateInput = z.infer<typeof reportCreateSchema>;

export const reportResolveSchema = z
  .object({
    /** dismiss: nothing wrong. resolve: handled outside TIKIT. takedown: hide the event. suspend: close the organizer. */
    action: z.enum(['dismiss', 'resolve', 'takedown', 'suspend']),
    note: text(300, 0, 'Notat').default(''),
  })
  .strict();
export type ReportResolveInput = z.infer<typeof reportResolveSchema>;
