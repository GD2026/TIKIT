import { useState } from 'react';
import { Check, Wallet } from 'lucide-react';
import type { TicketDTO } from '../../../shared/types';
import { useApi } from '../../app/context';
import { useConfig } from '../../api/hooks';
import { errorMessage } from '../../api/client';
import { useToast } from '../ui/Overlays';
import { Spinner } from '../ui/Feedback';
import { apiUrl, canDownload } from '../../lib/links';
import { addAppleWalletPassInApp, walletViaApp } from '../../lib/wallet';
import { isIOS, isNativeApp } from '../../lib/device';

// Black with a hairline edge, like Apple's and Google's own wallet badges, so it reads in dark mode too.
const badge =
  'press flex h-[52px] w-full items-center justify-center gap-2.5 rounded-full bg-black px-5 text-headline font-semibold text-white ring-1 ring-inset ring-white/25 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';

function onAppleDevice(): boolean {
  return isNativeApp || isIOS() || (typeof navigator !== 'undefined' && /Mac/.test(navigator.platform));
}

/** «Legg til i Apple Lommebok» / «Google Lommebok»: the ticket as a pass that opens from the side button. */
export function WalletButtons({ ticket }: { ticket: TicketDTO }) {
  const api = useApi();
  const toast = useToast();
  const config = useConfig().data;
  const [busy, setBusy] = useState<'apple' | 'google' | null>(null);
  const [added, setAdded] = useState(false);

  if (!config || !canDownload) return null;
  const apple = config.wallet.apple && onAppleDevice();
  const google = config.wallet.google && !isNativeApp && !isIOS();
  if (!apple && !google) return null;

  const addInApp = async () => {
    setBusy('apple');
    try {
      const res = await addAppleWalletPassInApp(api, ticket.id);
      if (res.added) {
        setAdded(true);
        toast({ message: 'Billetten ligger i Lommebok', tone: 'success' });
      }
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const addToGoogle = async () => {
    setBusy('google');
    try {
      const res = await api.get<{ url: string }>(`/tickets/${ticket.id}/wallet/google`);
      window.location.assign(res.url);
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
      setBusy(null);
    }
  };

  const icon = (kind: 'apple' | 'google') => (busy === kind ? <Spinner size={18} className="text-current" /> : <Wallet className="h-5 w-5" aria-hidden="true" />);

  return (
    <div className="mx-4 mb-6 space-y-2.5">
      {apple &&
        (walletViaApp() ? (
          <button type="button" className={badge} onClick={() => void addInApp()} disabled={busy !== null} aria-busy={busy === 'apple' || undefined}>
            {added ? <Check className="h-5 w-5" aria-hidden="true" /> : icon('apple')}
            {added ? 'Lagt til i Apple Lommebok' : 'Legg til i Apple Lommebok'}
          </button>
        ) : (
          // Safari opens the .pkpass in its own «Legg til»-sheet; the session cookie comes along.
          <a className={badge} href={apiUrl(`/tickets/${ticket.id}/wallet/apple`)}>
            {icon('apple')}
            Legg til i Apple Lommebok
          </a>
        ))}
      {google && (
        <button type="button" className={badge} onClick={() => void addToGoogle()} disabled={busy !== null} aria-busy={busy === 'google' || undefined}>
          {icon('google')}
          Legg til i Google Lommebok
        </button>
      )}
      <p className="px-2 text-center text-footnote text-label-2">
        {apple ? 'Etterpå åpner du billetten med to trykk på sideknappen.' : 'På mange Android-telefoner åpnes Google Lommebok med to trykk på av/på-knappen.'} Kortet har en fast
        kode, så ikke del det.
      </p>
    </div>
  );
}
