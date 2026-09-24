import type { CategoryId, OrganizerTypeId, PosterPaletteId, PosterStyle, RefundPolicyId, VatRate } from './constants';

export type ID = string;
/** ISO-8601 UTC timestamp produced by Date#toISOString(). */
export type ISODate = string;

export type ProviderId = 'vipps' | 'google' | 'apple';
export type PaymentMethodId = 'vipps' | 'card';
export type PlatformRole = 'user' | 'admin';
export type OrgRole = 'owner' | 'admin' | 'staff';

// ─────────────────────────────────────────────────────────────────────────────
// Stored documents
// ─────────────────────────────────────────────────────────────────────────────

export interface NotificationPrefs {
  email: boolean;
  reminders: boolean;
  waitlist: boolean;
  marketing: boolean;
}

export interface User {
  id: ID;
  name: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null; // E.164, e.g. +4791234567
  phoneVerified: boolean;
  birthdate: string | null; // YYYY-MM-DD
  birthdateVerified: boolean; // verified by Vipps (Folkeregisteret)
  city: string | null;
  role: PlatformRole;
  prefs: NotificationPrefs;
  banned: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
  lastLoginAt: ISODate | null;
  deletedAt: ISODate | null;
}

export interface Identity {
  id: ID;
  userId: ID;
  provider: ProviderId;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  demo: boolean;
  createdAt: ISODate;
  lastUsedAt: ISODate;
}

export interface Session {
  id: string; // sha256(token)
  userId: ID | null; // null for scanner-only sessions
  kind: 'user' | 'scanner';
  scanner: { eventId: ID; organizerId: ID; codeId: ID; label: string } | null;
  createdAt: ISODate;
  expiresAt: ISODate;
  lastSeenAt: ISODate;
  userAgent: string | null;
}

export type OrganizerStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export interface Organizer {
  id: ID;
  slug: string;
  name: string;
  type: OrganizerTypeId;
  orgNumber: string | null;
  description: string;
  city: string | null;
  email: string;
  phone: string | null;
  website: string | null;
  logoImageId: ID | null;
  palette: PosterPaletteId;
  payoutAccount: string | null; // 11-digit Norwegian account number
  status: OrganizerStatus;
  verified: boolean;
  statusNote: string | null;
  createdBy: ID;
  createdAt: ISODate;
  updatedAt: ISODate;
  approvedAt: ISODate | null;
}

export interface OrgMember {
  id: ID;
  organizerId: ID;
  userId: ID;
  role: OrgRole;
  createdAt: ISODate;
}

export interface OrgInvite {
  id: ID;
  organizerId: ID;
  email: string;
  role: OrgRole;
  invitedBy: ID;
  status: 'pending' | 'accepted' | 'revoked';
  createdAt: ISODate;
}

export type EventStatus = 'draft' | 'published' | 'cancelled';

export interface PosterSpec {
  style: PosterStyle;
  palette: PosterPaletteId;
  seed: number;
}

export interface Venue {
  name: string;
  address: string;
  postalCode: string;
  city: string;
}

export interface LineupItem {
  name: string;
  time: string | null; // "22:30" Oslo wall time
}

export interface EventSettings {
  maxPerOrder: number;
  personalizedTickets: boolean;
  transfersAllowed: boolean;
  resaleAllowed: boolean;
  refundPolicy: RefundPolicyId;
  queueEnabled: boolean;
  queueRatePerMinute: number;
  waitlistEnabled: boolean;
  showRemaining: boolean;
  requireVerifiedAge: boolean;
}

export interface EventDoc {
  id: ID;
  organizerId: ID;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  category: CategoryId;
  status: EventStatus;
  visibility: 'public' | 'unlisted';
  startsAt: ISODate;
  endsAt: ISODate;
  doorsAt: ISODate | null;
  salesStartAt: ISODate | null;
  salesEndAt: ISODate | null;
  venue: Venue;
  city: string;
  ageLimit: number | null;
  poster: PosterSpec;
  coverImageId: ID | null;
  lineup: LineupItem[];
  tags: string[];
  settings: EventSettings;
  seated: boolean;
  featured: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
  publishedAt: ISODate | null;
  cancelledAt: ISODate | null;
  cancelReason: string | null;
}

export interface TicketType {
  id: ID;
  eventId: ID;
  name: string;
  description: string;
  priceOre: number;
  capacity: number;
  sold: number;
  maxPerOrder: number | null;
  salesStartAt: ISODate | null;
  salesEndAt: ISODate | null;
  hidden: boolean;
  accessCodeHash: string | null;
  vatRate: VatRate;
  sortOrder: number;
  paused: boolean;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Hold {
  id: ID;
  orderId: ID;
  eventId: ID;
  ticketTypeId: ID;
  qty: number;
  seatIds: ID[];
  expiresAt: ISODate;
  createdAt: ISODate;
}

export type OrderStatus = 'reserved' | 'pending_payment' | 'paid' | 'cancelled' | 'expired' | 'refunded' | 'partially_refunded';
export type OrderKind = 'standard' | 'resale' | 'comp';

export interface OrderItem {
  ticketTypeId: ID;
  name: string;
  qty: number;
  unitPriceOre: number; // after discount
  listPriceOre: number; // before discount
  feeOre: number; // per ticket
  vatRate: VatRate;
  seatIds: ID[];
}

export interface OrderDiscount {
  codeId: ID;
  code: string;
  amountOre: number;
}

export interface RefundEntry {
  id: ID;
  amountOre: number;
  ticketOre: number;
  feeOre: number;
  kind: 'ticket' | 'resale_payout' | 'event_cancelled' | 'failed_fulfillment';
  ticketIds: ID[];
  reason: string;
  by: string | null;
  at: ISODate;
}

export interface Order {
  id: ID;
  ref: string;
  userId: ID;
  eventId: ID;
  organizerId: ID;
  kind: OrderKind;
  status: OrderStatus;
  items: OrderItem[];
  attendeeNames: string[];
  discount: OrderDiscount | null;
  subtotalOre: number; // list price total
  discountOre: number;
  feeOre: number;
  totalOre: number;
  refundedOre: number;
  refunds: RefundEntry[];
  resaleListingId: ID | null;
  paymentId: ID | null;
  paymentMethod: PaymentMethodId | 'free' | 'comp' | null;
  idemKey: string | null;
  buyer: { name: string; email: string | null; phone: string | null };
  expiresAt: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
  paidAt: ISODate | null;
  cancelledAt: ISODate | null;
  failureReason: string | null;
}

export type PaymentStatus = 'creating' | 'pending' | 'authorized' | 'captured' | 'failed' | 'cancelled' | 'expired' | 'refunded' | 'partially_refunded';

export interface Payment {
  id: ID;
  orderId: ID;
  provider: 'vipps' | 'stripe' | 'demo';
  method: PaymentMethodId;
  providerRef: string; // Vipps reference or Stripe Checkout session id
  amountOre: number;
  status: PaymentStatus;
  capturedOre: number;
  refundedOre: number;
  redirectUrl: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
  lastError: string | null;
}

export type TicketStatus = 'valid' | 'used' | 'cancelled' | 'refunded';
export type TicketKind = 'paid' | 'comp' | 'resale' | 'free';

export interface SeatRef {
  id: ID;
  section: string;
  row: string;
  number: number;
}

export interface Ticket {
  id: ID;
  number: string; // TK-7F3K9Q-01
  orderId: ID; // order that funded the current owner's ticket
  originalOrderId: ID;
  eventId: ID;
  organizerId: ID;
  ticketTypeId: ID;
  typeName: string;
  pricePaidOre: number; // what the current owner paid (0 for comp/transfer recipients: see purchaserId)
  purchaserId: ID; // user who paid for the funding order
  ownerId: ID;
  holderName: string;
  seat: SeatRef | null;
  kind: TicketKind;
  status: TicketStatus;
  secret: string; // rotates on transfer/resale
  checkedInAt: ISODate | null;
  checkedInBy: string | null;
  transferId: ID | null;
  resaleListingId: ID | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Transfer {
  id: ID;
  ticketId: ID;
  eventId: ID;
  fromUserId: ID;
  toUserId: ID | null;
  toContact: string | null;
  tokenHash: string;
  message: string | null;
  status: 'pending' | 'accepted' | 'cancelled' | 'expired';
  kind: 'transfer' | 'guest';
  createdAt: ISODate;
  expiresAt: ISODate;
  acceptedAt: ISODate | null;
}

export interface ResaleListing {
  id: ID;
  ticketId: ID;
  eventId: ID;
  ticketTypeId: ID;
  sellerId: ID;
  priceOre: number;
  status: 'active' | 'reserved' | 'sold' | 'cancelled';
  reservedByOrderId: ID | null;
  reservedUntil: ISODate | null;
  buyerOrderId: ID | null;
  payoutOre: number;
  createdAt: ISODate;
  soldAt: ISODate | null;
}

export interface DiscountCode {
  id: ID;
  eventId: ID;
  organizerId: ID;
  code: string; // upper-case
  kind: 'percent' | 'fixed';
  value: number; // percent 1–100, or øre per ticket
  maxUses: number | null;
  used: number;
  ticketTypeIds: ID[]; // empty = all
  validFrom: ISODate | null;
  validUntil: ISODate | null;
  active: boolean;
  createdAt: ISODate;
}

export interface WaitlistEntry {
  id: ID;
  eventId: ID;
  userId: ID;
  status: 'waiting' | 'notified' | 'removed';
  createdAt: ISODate;
  notifiedAt: ISODate | null;
}

export interface SaleAlert {
  id: string; // `${userId}:${eventId}`
  userId: ID;
  eventId: ID;
  createdAt: ISODate;
  notifiedAt: ISODate | null;
}

export interface QueueState {
  id: ID; // = eventId
  eventId: ID;
  opensAt: ISODate;
  ratePerMinute: number;
  frozen: boolean;
  earlyCount: number;
  nextPosition: number;
  createdAt: ISODate;
}

export interface QueueEntry {
  id: ID;
  eventId: ID;
  userId: ID;
  joinedAt: ISODate;
  rand: number;
  position: number | null;
  status: 'waiting' | 'admitted' | 'done' | 'left';
  admittedAt: ISODate | null;
}

export type CheckinResult = 'ok' | 'already_used' | 'invalid' | 'wrong_event' | 'cancelled' | 'expired_code' | 'undo';

export interface CheckinLog {
  id: ID;
  eventId: ID;
  ticketId: ID | null;
  result: CheckinResult;
  actor: string; // user id or scanner code label
  gate: string | null;
  manual: boolean;
  at: ISODate;
}

export interface ScannerCode {
  id: ID;
  eventId: ID;
  organizerId: ID;
  label: string;
  codeHash: string;
  createdBy: ID;
  createdAt: ISODate;
  revoked: boolean;
  lastUsedAt: ISODate | null;
}

export type NotificationKind =
  | 'order_confirmed'
  | 'transfer_received'
  | 'transfer_accepted'
  | 'resale_sold'
  | 'resale_bought'
  | 'waitlist_available'
  | 'sale_started'
  | 'event_reminder'
  | 'event_cancelled'
  | 'event_changed'
  | 'refund_issued'
  | 'organizer_status'
  | 'team_invite'
  | 'guest_ticket';

export interface AppNotification {
  id: ID;
  userId: ID;
  kind: NotificationKind;
  title: string;
  body: string;
  link: string | null;
  readAt: ISODate | null;
  createdAt: ISODate;
}

export interface Favorite {
  id: string; // `${userId}:${eventId}`
  userId: ID;
  eventId: ID;
  createdAt: ISODate;
}

export interface Follow {
  id: string; // `${userId}:${organizerId}`
  userId: ID;
  organizerId: ID;
  createdAt: ISODate;
}

export interface ImageDoc {
  id: ID;
  ownerId: ID;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  data: string; // base64
  width: number;
  height: number;
  bytes: number;
  createdAt: ISODate;
}

export interface SeatDef {
  id: ID;
  number: number;
  accessible: boolean;
}

export interface SeatRow {
  label: string;
  seats: SeatDef[];
  offset: number; // leading empty seat slots for staggered rows
}

export interface SeatSection {
  id: ID;
  name: string;
  ticketTypeId: ID;
  rows: SeatRow[];
}

export interface SeatMap {
  id: ID; // = eventId
  eventId: ID;
  stageLabel: string;
  sections: SeatSection[];
  updatedAt: ISODate;
}

export interface SeatStateEntry {
  status: 'held' | 'sold' | 'blocked';
  orderId: ID | null;
  until: ISODate | null;
  ticketId: ID | null;
}

export interface SeatState {
  id: ID; // = eventId
  eventId: ID;
  seats: Record<ID, SeatStateEntry>;
  updatedAt: ISODate;
}

export interface Payout {
  id: ID;
  organizerId: ID;
  amountOre: number;
  note: string;
  reference: string;
  createdBy: ID;
  createdAt: ISODate;
}

export interface PlatformSettings {
  id: 'platform';
  feeFixedOre: number;
  feePercentBp: number;
  feeMaxOre: number;
  feeVatRate: number;
  resaleFeePercentBp: number;
  updatedAt: ISODate;
}

export interface OutboxEmail {
  id: ID;
  to: string;
  subject: string;
  text: string;
  html: string;
  createdAt: ISODate;
  status: 'sent' | 'failed' | 'logged';
}

export interface AuditEntry {
  id: ID;
  actorId: string | null;
  action: string;
  entity: string;
  entityId: string;
  data: Record<string, unknown> | null;
  at: ISODate;
}

export interface KvDoc {
  id: string;
  value: unknown;
  updatedAt: ISODate;
}

/**
 * Money that has to move at a payment provider (a refund, or giving back a payment that must not be kept).
 * Written in the same transaction as the business change and retried until the provider confirms, so a
 * provider hiccup never leaves "refunded" in TIKIT but the money still with us.
 */
export interface PaymentJob {
  id: ID;
  paymentId: ID;
  orderId: ID;
  /** refund: pay back `amountOre` of a captured payment. reverse: cancel or refund whatever the payment turned into. */
  kind: 'refund' | 'reverse';
  amountOre: number;
  idempotencyKey: string;
  reason: string;
  status: 'pending' | 'done' | 'failed';
  attempts: number;
  nextAttemptAt: ISODate;
  lockedUntil: ISODate | null;
  lastError: string | null;
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ─────────────────────────────────────────────────────────────────────────────
// API DTOs (what the client sees)
// ─────────────────────────────────────────────────────────────────────────────

export interface Me {
  id: ID;
  name: string;
  email: string | null;
  emailVerified: boolean;
  phone: string | null;
  birthdate: string | null;
  birthdateVerified: boolean;
  city: string | null;
  role: PlatformRole;
  prefs: NotificationPrefs;
  providers: ProviderId[];
  organizations: { id: ID; name: string; slug: string; role: OrgRole; status: OrganizerStatus }[];
  unreadNotifications: number;
  createdAt: ISODate;
}

export interface ScannerMe {
  kind: 'scanner';
  eventId: ID;
  organizerId: ID;
  label: string;
  eventTitle: string;
}

export interface OrganizerPublic {
  id: ID;
  slug: string;
  name: string;
  type: OrganizerTypeId;
  description: string;
  city: string | null;
  verified: boolean;
  logoUrl: string | null;
  palette: PosterPaletteId;
  followers: number;
  website: string | null;
}

export type SaleState = 'upcoming' | 'on_sale' | 'sold_out' | 'ended' | 'cancelled' | 'past' | 'draft';

export interface EventCard {
  id: ID;
  slug: string;
  title: string;
  subtitle: string;
  category: CategoryId;
  startsAt: ISODate;
  endsAt: ISODate;
  city: string;
  venueName: string;
  ageLimit: number | null;
  poster: PosterSpec;
  coverUrl: string | null;
  organizerName: string;
  organizerSlug: string;
  organizerVerified: boolean;
  priceFromOre: number | null;
  saleState: SaleState;
  salesStartAt: ISODate | null;
  lowAvailability: boolean;
  featured: boolean;
  status: EventStatus;
}

export interface TicketTypePublic {
  id: ID;
  name: string;
  description: string;
  priceOre: number;
  feeOre: number;
  state: 'on_sale' | 'sold_out' | 'not_started' | 'ended' | 'paused';
  available: number | null; // null = hidden by organizer
  low: boolean;
  maxPerOrder: number;
  salesStartAt: ISODate | null;
  salesEndAt: ISODate | null;
  unlocked: boolean; // hidden type revealed with an access code
  seated: boolean;
}

export interface EventDetail {
  event: EventCard & {
    description: string;
    venue: Venue;
    doorsAt: ISODate | null;
    salesEndAt: ISODate | null;
    lineup: LineupItem[];
    tags: string[];
    settings: Pick<
      EventSettings,
      'maxPerOrder' | 'personalizedTickets' | 'transfersAllowed' | 'resaleAllowed' | 'refundPolicy' | 'queueEnabled' | 'waitlistEnabled' | 'requireVerifiedAge'
    >;
    seated: boolean;
    cancelReason: string | null;
    visibility: 'public' | 'unlisted';
  };
  organizer: OrganizerPublic;
  ticketTypes: TicketTypePublic[];
  hasHiddenTypes: boolean;
  resale: { count: number; fromPriceOre: number | null };
  viewer: {
    favorite: boolean;
    onWaitlist: boolean;
    saleAlert: boolean;
    ticketCount: number;
    queue: QueueStatus | null;
  };
}

export interface QueueStatus {
  entryId: ID;
  eventId: ID;
  status: 'before_open' | 'waiting' | 'admitted' | 'expired' | 'sold_out';
  position: number | null;
  ahead: number | null;
  total: number;
  opensAt: ISODate;
  etaSeconds: number | null;
  token: string | null;
  admittedUntil: ISODate | null;
}

export interface OrderDTO {
  id: ID;
  ref: string;
  kind: OrderKind;
  status: OrderStatus;
  event: EventCard & { venue: Venue; settings: { personalizedTickets: boolean; refundPolicy: RefundPolicyId } };
  items: OrderItem[];
  attendeeNames: string[];
  discount: OrderDiscount | null;
  subtotalOre: number;
  discountOre: number;
  feeOre: number;
  totalOre: number;
  refundedOre: number;
  expiresAt: ISODate;
  createdAt: ISODate;
  paidAt: ISODate | null;
  paymentMethod: Order['paymentMethod'];
  payment: { status: PaymentStatus; method: PaymentMethodId; redirectUrl: string | null } | null;
  ticketIds: ID[];
  seats: SeatRef[];
  organizer: { name: string; orgNumber: string | null; email: string };
  vat: { ticketsVatOre: number; feeVatOre: number };
  buyer: Order['buyer'];
  failureReason: string | null;
}

export interface TicketDTO {
  id: ID;
  number: string;
  status: TicketStatus;
  kind: TicketKind;
  typeName: string;
  holderName: string;
  seat: SeatRef | null;
  pricePaidOre: number;
  secret: string | null; // only for the owner and valid tickets
  checkedInAt: ISODate | null;
  event: EventCard & { venue: Venue; doorsAt: ISODate | null; settings: Pick<EventSettings, 'transfersAllowed' | 'resaleAllowed' | 'refundPolicy'> };
  orderId: ID;
  orderRef: string;
  canTransfer: boolean;
  canResell: boolean;
  canRefund: boolean;
  refundDeadline: ISODate | null;
  resaleMaxOre: number;
  transfer: { id: ID; status: Transfer['status']; toContact: string | null; link: string | null; createdAt: ISODate } | null;
  resale: { id: ID; priceOre: number; status: ResaleListing['status']; payoutOre: number } | null;
  ageVerified: boolean;
  receivedFrom: string | null;
}

export type NotificationDTO = AppNotification;

export interface AppConfig {
  demoMode: boolean;
  appName: string;
  publicUrl: string;
  providers: { id: ProviderId; demo: boolean }[];
  paymentMethods: { id: PaymentMethodId; demo: boolean }[];
  wallet: { apple: boolean; google: boolean };
  fees: { fixedOre: number; percentBp: number; maxOre: number };
  serverTime: ISODate;
  qrStepSeconds: number;
  operator: { name: string; orgNumber: string | null; supportEmail: string | null };
}

export interface Paged<T> {
  items: T[];
  total: number;
}
