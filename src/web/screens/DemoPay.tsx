import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FlaskConical } from 'lucide-react';
import type { DemoPaymentState } from '../../server/adapters/demo';
import { formatNok } from '../../shared/money';
import { useApi } from '../app/context';
import { type ApiError, errorMessage } from '../api/client';
import { Button } from '../components/ui/Button';
import { CenterSpinner, QueryError, RequireLogin } from '../components/ui/States';
import { useToast } from '../components/ui/Overlays';
import { followUrl } from '../lib/links';
import { useDocumentTitle } from '../lib/hooks';

/**
 * Demo stand-in for the payment provider's own page. Deliberately TIKIT-styled (it never imitates Vipps
 * or a card form) and it collects nothing – it only lets the tester approve or decline.
 */
function PayBody({ reference }: { reference: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState<'approve' | 'decline' | null>(null);
  const q = useQuery<DemoPaymentState, ApiError>({ queryKey: ['demopay', reference], queryFn: () => api.get(`/demo/payments/${encodeURIComponent(reference)}`), retry: false });

  if (q.isLoading) return <CenterSpinner />;
  if (q.isError || !q.data) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  const p = q.data;

  const act = async (action: 'approve' | 'decline') => {
    setBusy(action);
    try {
      const res = await api.post<{ returnUrl: string }>(`/demo/payments/${encodeURIComponent(reference)}/${action}`);
      followUrl(action === 'approve' ? res.returnUrl : p.cancelUrl, navigate, true);
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
      setBusy(null);
    }
  };

  const methodName = p.method === 'vipps' ? 'Vipps' : 'kort';

  return (
    <div className="min-h-dvh bg-grouped px-4 pb-[max(24px,var(--safe-bottom))] pt-[calc(var(--safe-top)+24px)]">
      <main id="innhold" className="mx-auto flex max-w-md flex-col">
        <div className="flex items-center gap-2 self-start rounded-full bg-orange-soft px-3 py-1.5 text-footnote font-semibold text-orange">
          <FlaskConical className="h-4 w-4" aria-hidden="true" /> Simulert betaling
        </div>
        {p.state !== 'pending' ? (
          <>
            <h1 className="mt-5 text-title1 font-bold">Betalingen er allerede behandlet</h1>
            <Button size="lg" className="mt-8" onClick={() => followUrl(p.state === 'cancelled' ? p.cancelUrl : p.returnUrl, navigate, true)}>
              Tilbake til TIKIT
            </Button>
          </>
        ) : (
          <>
            <h1 className="mt-5 text-title1 font-bold">Betal {formatNok(p.amountOre)}</h1>
            <p className="mt-1 text-body text-label-2">{p.description}</p>
            <div className="mt-6 rounded-lg bg-grouped-2 p-4">
              <ul className="space-y-1.5 text-body">
                {p.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-4">
                    <span>
                      {l.qty} × {l.name}
                    </span>
                    <span className="tabular">{formatNok(l.qty * l.unitAmountOre)}</span>
                  </li>
                ))}
              </ul>
              <div className="hairline-t mt-3 flex justify-between pt-3 text-headline font-semibold">
                <span>Totalt</span>
                <span className="tabular">{formatNok(p.amountOre)}</span>
              </div>
            </div>
            <p className="mt-4 text-subhead text-label-2">
              I den ekte appen sendes du nå til {p.method === 'vipps' ? 'Vipps-appen, der du bekrefter med Face ID eller PIN' : 'betalingsleverandørens sikre kortside'}. I demoen velger du
              bare utfallet – ingen penger trekkes, og ingen opplysninger sendes noe sted.
            </p>
            <div className="mt-8 flex flex-col gap-3">
              <Button size="lg" full loading={busy === 'approve'} disabled={!!busy} onClick={() => void act('approve')}>
                Godkjenn betalingen ({methodName})
              </Button>
              <Button size="lg" full variant="gray" loading={busy === 'decline'} disabled={!!busy} onClick={() => void act('decline')}>
                Avbryt betalingen
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function DemoPay() {
  const { ref } = useParams();
  useDocumentTitle('Simulert betaling');
  return (
    <RequireLogin reason="Logg inn igjen for å fullføre betalingen.">
      {ref && <PayBody reference={ref} />}
    </RequireLogin>
  );
}
