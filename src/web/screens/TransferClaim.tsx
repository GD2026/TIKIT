import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Link2Off } from 'lucide-react';
import type { TransferPreview } from '../../server/services/tickets';
import { formatEventWhen } from '../../shared/time';
import { useApi } from '../app/context';
import { useAuth } from '../app/auth';
import { qk } from '../api/hooks';
import { type ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { EventImage } from '../components/event/EventImage';
import { Button, LinkButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/Feedback';
import { CenterSpinner, QueryError } from '../components/ui/States';
import { useToast } from '../components/ui/Overlays';

export default function TransferClaim() {
  const { token } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const { me, loading, openLogin } = useAuth();
  const [busy, setBusy] = useState(false);
  const q = useQuery<TransferPreview, ApiError>({
    queryKey: qk.transfer(token ?? ''),
    queryFn: () => api.get(`/transfers/${encodeURIComponent(token!)}`),
    enabled: !!token,
    retry: false,
  });

  const accept = async () => {
    if (!token) return;
    setBusy(true);
    try {
      const res = await api.post<{ ticketId: string }>(`/transfers/${encodeURIComponent(token)}/accept`);
      await qc.invalidateQueries({ queryKey: qk.tickets });
      toast({ message: 'Billetten er din!', tone: 'success' });
      navigate(`/billetter/${res.ticketId}`, { replace: true });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
      void q.refetch();
    } finally {
      setBusy(false);
    }
  };

  let content: React.ReactNode;
  if (q.isLoading || loading) content = <CenterSpinner />;
  else if (q.isError || !q.data)
    content = (
      <QueryError
        error={q.error}
        notFound={<EmptyState icon={<Link2Off />} title="Lenken virker ikke" message="Overføringslenken er ugyldig eller utløpt. Be avsenderen om en ny lenke." />}
        onRetry={() => void q.refetch()}
      />
    );
  else {
    const t = q.data;
    const e = t.event;
    const done = t.status !== 'pending';
    content = (
      <div className="px-4 pb-10">
        <div className="overflow-hidden rounded-[26px] bg-grouped-2 shadow-[var(--card-shadow)]">
          <EventImage poster={e.poster} coverUrl={e.coverUrl} title={e.title} className="aspect-[16/9] w-full" eager />
          <div className="p-5">
            <p className="flex items-center gap-2 text-subhead font-semibold text-tint">
              <Gift className="h-4 w-4" aria-hidden="true" />
              {t.kind === 'guest' ? `Gjestebillett fra ${t.fromName}` : `${t.fromName} har sendt deg en billett`}
            </p>
            <h2 className="display mt-2 text-[1.6rem] leading-[1.03] [text-wrap:balance] [overflow-wrap:anywhere] hyphens-auto">{e.title}</h2>
            <p className="mt-2 text-body text-label-2">
              {formatEventWhen(e.startsAt)} · {e.venueName}, {e.city}
            </p>
            <p className="mt-1 text-body">
              {t.typeName}
              {t.seat ? ` · ${t.seat.section}, rad ${t.seat.row}, sete ${t.seat.number}` : ''}
            </p>
            {t.message && <blockquote className="mt-4 rounded-[14px] bg-fill-4 px-4 py-3 text-body italic">«{t.message}»</blockquote>}
            {e.ageLimit ? <p className="mt-3 text-footnote text-label-2">Aldersgrense {e.ageLimit} år.</p> : null}
          </div>
        </div>

        <div className="mt-6">
          {done ? (
            <EmptyState
              title={t.status === 'accepted' ? 'Billetten er allerede hentet' : t.status === 'cancelled' ? 'Overføringen er avbrutt' : 'Lenken har utløpt'}
              message={t.status === 'accepted' ? 'Er det du som hentet den, ligger den under Billetter.' : 'Be avsenderen om en ny lenke.'}
              action={t.status === 'accepted' ? <LinkButton to="/billetter">Mine billetter</LinkButton> : undefined}
            />
          ) : t.isOwnTransfer ? (
            <p className="rounded-md bg-fill-4 px-4 py-3 text-center text-subhead">Dette er din egen overføring. Send lenken til den som skal ha billetten.</p>
          ) : !me ? (
            <div className="text-center">
              <p className="mb-4 text-subhead text-label-2">Logg inn for å legge billetten på kontoen din. Det tar noen sekunder.</p>
              <Button size="lg" full onClick={() => openLogin({ reason: 'Logg inn for å hente billetten', returnTo: `/overfor/${token}` })}>
                Logg inn og hent billetten
              </Button>
            </div>
          ) : (
            <>
              <Button size="lg" full loading={busy} onClick={() => void accept()}>
                Hent billetten
              </Button>
              <p className="mt-3 text-center text-footnote text-label-2">Billetten får ny QR-kode og legges på kontoen til {me.name}.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <Page title="Billett til deg" back="/">
      {content}
    </Page>
  );
}
