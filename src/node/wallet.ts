import path from 'node:path';
import type { Logger, WalletAdapter } from '../server/adapters/types';
import type { NodeConfig } from './config';
import { createAppleWallet, loadAppleWalletCredentials, loadAppleWalletImages } from './integrations/apple/wallet';
import { createGoogleWallet } from './integrations/google/wallet';

const DAY = 86_400_000;

/**
 * Apple and Google Wallet, when their keys are set. A broken certificate turns only the wallet off (with an
 * error in the log and in `npm run doctor`): tickets still work in the app.
 */
export function createWalletAdapter(cfg: NodeConfig, staticRoot: string, log: Logger, now: Date = new Date()): WalletAdapter | null {
  let apple: WalletAdapter['apple'] = null;
  let google: WalletAdapter['google'] = null;

  if (cfg.wallet.apple) {
    try {
      const creds = loadAppleWalletCredentials(cfg.wallet.apple);
      const expiresIn = creds.validTo.getTime() - now.getTime();
      const until = creds.validTo.toISOString().slice(0, 10);
      if (expiresIn <= 0) throw new Error(`Wallet-sertifikatet utløp ${until}. Lag et nytt i Apple Developer (se docs/oppsett.md §9).`);
      if (expiresIn < 30 * DAY) log.warn(`Apple Wallet-sertifikatet utløper ${until}. Forny det i Apple Developer.`);
      const wallet = createAppleWallet(creds, loadAppleWalletImages([path.join(staticRoot, 'wallet'), path.resolve('public/wallet')]));
      apple = (input) => wallet.build(input);
      log.info(`Apple Wallet: ${creds.passTypeId} (team ${creds.teamId})`);
    } catch (err) {
      log.error('Apple Wallet er slått av', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (cfg.wallet.google) {
    try {
      const wallet = createGoogleWallet({ ...cfg.wallet.google, publicUrl: cfg.publicUrl, issuerName: 'TIKIT' });
      google = (input) => wallet.build(input);
      log.info(`Google Wallet: utsteder ${wallet.issuerId} (${wallet.clientEmail})`);
    } catch (err) {
      log.error('Google Wallet er slått av', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  return apple || google ? { apple, google } : null;
}
