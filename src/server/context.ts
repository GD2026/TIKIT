import type { PaymentMethodId, ProviderId } from '../shared/types';
import type { Logger, Mailer, OAuthAdapter, PaymentAdapter, WalletAdapter } from './adapters/types';
import type { Store } from './store/types';

export interface ServerConfig {
  /** Public origin, no trailing slash, e.g. https://tikit.no */
  publicUrl: string;
  /** Enables demo login/payments for providers without keys, demo endpoints and seed data. */
  demoMode: boolean;
  production: boolean;
  /** 32+ chars. Signs cookies, queue tokens, unlock tokens and transfer links. */
  sessionSecret: string;
  cookieSecure: boolean;
  adminEmails: string[];
  cronSecret: string | null;
  /** Router mode of the web client ('browser' in production, 'hash' in the single-file demo). */
  linkStyle: 'path' | 'hash';
  /** Legal operator of the platform, shown in terms, receipts and help. */
  operatorName?: string;
  operatorOrgNumber?: string | null;
  supportEmail?: string | null;
}

export interface Deps {
  store: Store;
  config: ServerConfig;
  clock: () => Date;
  oauth: Partial<Record<ProviderId, OAuthAdapter>>;
  payments: Partial<Record<PaymentMethodId, PaymentAdapter>>;
  mailer: Mailer;
  log: Logger;
  wallet: WalletAdapter | null;
  /** Resolves the client IP for rate limiting. */
  clientIp: (req: Request, raw?: unknown) => string;
}

/** Builds an absolute link to a client route, honouring the client's router mode. */
export function appLink(config: ServerConfig, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  // Hash style (single-file demo): publicUrl is the page URL without its hash.
  return config.linkStyle === 'hash' ? `${config.publicUrl}#${clean}` : `${config.publicUrl}${clean}`;
}
