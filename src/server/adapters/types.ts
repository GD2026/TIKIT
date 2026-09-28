import type { PaymentMethodId, ProviderId } from '../../shared/types';

/** Profile returned by an identity provider after a successful login. */
export interface ExternalProfile {
  provider: ProviderId;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  phone: string | null; // E.164
  phoneVerified: boolean;
  birthdate: string | null; // YYYY-MM-DD
  birthdateVerified: boolean;
  demo: boolean;
  /** A grant that must be revoked at the provider when the account is deleted (Sign in with Apple). */
  revocation?: { clientId: string; token: string } | null;
}

/** Data kept in a signed cookie between redirect and callback. */
export interface OAuthTransaction {
  provider: ProviderId;
  state: string;
  nonce: string;
  codeVerifier: string | null;
  returnTo: string;
  mode: 'login' | 'link';
  /**
   * The account a new login method is being linked to. Kept in the signed transaction because Apple's
   * callback is a cross-site POST, which doesn't carry the (SameSite=Lax) session cookie.
   */
  linkUserId?: string | null;
  /**
   * Set when the login was started by the iOS app: the PKCE-style challenge the finished login is bound to.
   * The callback then hands back a one-time code (tikit://auth/callback?code=…) instead of a cookie.
   */
  native?: string | null;
  createdAt: number;
}

export interface OAuthAdapter {
  readonly provider: ProviderId;
  /** 'form_post' callbacks arrive as cross-site POSTs (Sign in with Apple). */
  readonly responseMode: 'query' | 'form_post';
  createAuthorizationUrl(args: { redirectUri: string; state: string; nonce: string; codeVerifier: string | null }): Promise<string>;
  finishAuthorization(args: { request: Request; redirectUri: string; txn: OAuthTransaction }): Promise<ExternalProfile>;
  readonly usesPkce: boolean;
}

export type ProviderPaymentState = 'pending' | 'authorized' | 'captured' | 'failed' | 'cancelled' | 'expired' | 'refunded';

export interface ProviderPaymentStatus {
  state: ProviderPaymentState;
  authorizedOre: number;
  capturedOre: number;
  refundedOre: number;
}

export interface CreatePaymentArgs {
  paymentId: string;
  reference: string;
  amountOre: number;
  description: string;
  returnUrl: string;
  cancelUrl: string;
  customerPhone: string | null;
  customerEmail: string | null;
  lines: { name: string; qty: number; unitAmountOre: number }[];
}

export interface PaymentAdapter {
  readonly provider: 'vipps' | 'stripe' | 'demo';
  readonly method: PaymentMethodId;
  /** Tickets are delivered immediately, so authorized payments are captured right after fulfilment. */
  readonly needsCapture: boolean;
  createPayment(args: CreatePaymentArgs): Promise<{ providerRef: string; redirectUrl: string }>;
  getStatus(providerRef: string): Promise<ProviderPaymentStatus>;
  capture(providerRef: string, amountOre: number, idempotencyKey: string): Promise<void>;
  refund(providerRef: string, amountOre: number, idempotencyKey: string): Promise<void>;
  cancel(providerRef: string): Promise<void>;
  /**
   * Verifies an incoming webhook. Returns null when the signature is invalid (answered with 401),
   * otherwise the provider reference it concerns – or `providerRef: null` for events we don't need.
   */
  handleWebhook?(request: Request, rawBody: string): Promise<{ providerRef: string | null } | null>;
}

/** Input from the iOS app's native Sign in with Apple button (see src/node/integrations/apple/native.ts). */
export interface AppleNativeInput {
  identityToken: string;
  authorizationCode: string | null;
  /** SHA-256 (hex) of the server-issued nonce, as the app passed it to Apple. */
  expectedNonceHash: string;
  givenName: string | null;
  familyName: string | null;
}

export interface AppleNativeAdapter {
  /** True when the iOS app's native button can be used (bundle ID configured); revoking works regardless. */
  readonly nativeSignIn: boolean;
  /** Verifies the identity token and returns the profile. Throws when the token is invalid. */
  verify(input: AppleNativeInput): Promise<ExternalProfile>;
  /** Revokes a refresh token at Apple (account deletion, unlinking Apple). */
  revoke(clientId: string, token: string): Promise<void>;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  readonly kind: 'resend' | 'outbox';
  send(msg: MailMessage): Promise<void>;
}

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export interface WalletPassInput {
  ticketId: string;
  number: string;
  eventTitle: string;
  venue: string;
  startsAt: string;
  holderName: string;
  typeName: string;
  seat: string | null;
  barcode: string;
  colors: { background: string; foreground: string; label: string };
  organizer: string;
}

export interface WalletAdapter {
  apple: ((input: WalletPassInput) => Promise<Uint8Array>) | null;
  google: ((input: WalletPassInput) => Promise<string>) | null;
}

export const consoleLogger: Logger = {
  info: (msg, data) => console.log(`[tikit] ${msg}`, data ?? ''),
  warn: (msg, data) => console.warn(`[tikit] ${msg}`, data ?? ''),
  error: (msg, data) => console.error(`[tikit] ${msg}`, data ?? ''),
};
