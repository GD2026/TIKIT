import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { Users } from 'lucide-react';
import type { QueueStatus } from '../../shared/types';
import { formatCountdown, formatTime } from '../../shared/time';
import { useApi } from '../app/context';
import { qk, useEvent, useQueueStatus } from '../api/hooks';
import { errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { Button } from '../components/ui/Button';
import { ProgressBar } from '../components/ui/Feedback';
import { CenterSpinner, QueryError, RequireLogin } from '../components/ui/States';
import { useConfirm } from '../components/ui/Overlays';
import { EventImage } from '../components/event/EventImage';
import { useCountdown, useWakeLock } from '../lib/hooks';
import { haptic } from '../lib/haptics';

function Rings({ children, active }: { children: React.ReactNode; active: boolean }) {
  const reduced = useReducedMotion();
  return (
    <div className="relative mx-auto flex h-56 w-56 items-center justify-center">
      {!reduced &&
        active &&
        [0, 1, 2].map((i) => (
          <motion.span
            key={i}
            aria-hidden="true"
            className="absolute inset-0 rounded-full border-2 border-[var(--tint)]"
            initial={{ scale: 0.55, opacity: 0.5 }}
            animate={{ scale: 1.05, opacity: 0 }}
            transition={{ duration: 3, repeat: Infinity, delay: i, ease: 'easeOut' }}
          />
        ))}
      <div className="relative flex h-40 w-40 flex-col items-center justify-center rounded-full bg-grouped-2 shadow-[var(--lift-shadow)]">{children}</div>
    </div>
  );
}

function QueueBody({ slug }: { slug: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [eventId, setEventId] = useState<string | null>(null);
  const detailQ = useEvent(slug, eventId);
  const detail = detailQ.data;
  useEffect(() => {
    if (detail && detail.event.id !== eventId) setEventId(detail.event.id);
  }, [detail, eventId]);

  const [joined, setJoined] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const joining = useRef(false);
  const statusQ = useQueueStatus(eventId, joined);
  const status: QueueStatus | null = statusQ.data?.status ?? null;

  const join = async (id: string) => {
    if (joining.current) return;
    joining.current = true;
    setJoinError(null);
    try {
      const s = await api.post<QueueStatus>(`/events/${id}/queue`);
      qc.setQueryData(qk.queue(id), { status: s });
      setJoined(true);
    } catch (err) {
      setJoinError(errorMessage(err));
    } finally {
      joining.current = false;
    }
  };

  useEffect(() => {
    if (eventId && !joined) void join(eventId);
    // eslint-disable-next-line
  }, [eventId]);

  useWakeLock(status?.status === 'waiting' || status?.status === 'before_open');

  const prevStatus = useRef<string | null>(null);
  useEffect(() => {
    if (status?.status === 'admitted' && prevStatus.current !== 'admitted') {
      haptic('success');
      void qc.invalidateQueries({ queryKey: ['event', slug] });
    }
    prevStatus.current = status?.status ?? null;
  }, [status?.status, qc, slug]);

  const opensIn = useCountdown(status?.status === 'before_open' ? status.opensAt : null);
  const admittedLeft = useCountdown(status?.status === 'admitted' ? status.admittedUntil : null);

  if (detailQ.isLoading || (!status && !joinError)) return <CenterSpinner label="Stiller deg i kø" />;
  if (detailQ.isError || !detail) return <QueryError error={detailQ.error} onRetry={() => void detailQ.refetch()} />;
  if (joinError)
    return (
      <div className="px-6 py-16 text-center">
        <p className="text-headline font-semibold">Kunne ikke stille deg i kø</p>
        <p className="mt-2 text-subhead text-label-2">{joinError}</p>
        <Button className="mt-6" onClick={() => eventId && void join(eventId)}>
          Prøv igjen
        </Button>
      </div>
    );

  const e = detail.event;
  const s = status!;
  const leave = async () => {
    const ok = await confirm({ title: 'Forlate køen?', message: 'Du mister plassen din og må stille deg bakerst hvis du kommer tilbake.', confirmLabel: 'Forlat køen', destructive: true });
    if (!ok) return;
    try {
      await api.del(`/events/${e.id}/queue`);
    } catch {
      /* already gone */
    }
    qc.removeQueries({ queryKey: qk.queue(e.id) });
    navigate(`/e/${e.slug}`, { replace: true });
  };
  const rejoin = async () => {
    try {
      await api.del(`/events/${e.id}/queue`);
    } catch {
      /* ignore */
    }
    setJoined(false);
    await join(e.id);
  };

  const pct = s.position && s.ahead !== null && s.position > 0 ? Math.round(((s.position - s.ahead) / s.position) * 100) : 0;

  return (
    <div className="px-4 pb-10">
      <div className="mb-8 flex items-center gap-3 rounded-lg bg-grouped-2 p-3">
        <EventImage poster={e.poster} coverUrl={e.coverUrl} title={e.title} className="h-14 w-12 shrink-0 rounded-[10px]" />
        <div className="min-w-0">
          <p className="truncate text-headline font-semibold">{e.title}</p>
          <p className="text-subhead text-label-2">{e.venue.name}</p>
        </div>
      </div>

      <div aria-live="polite" className="text-center">
        {s.status === 'before_open' && (
          <>
            <Rings active>
              <span className="text-footnote font-semibold text-label-2">Salget åpner om</span>
              <span className="display mt-1 text-[1.6rem] leading-none tabular" style={{ fontStretch: '100%' }}>
                {formatCountdown(opensIn)}
              </span>
            </Rings>
            <h2 className="mt-8 text-title2 font-bold">Du står i køen</h2>
            <p className="mx-auto mt-2 max-w-md text-body text-label-2">
              Når salget åpner kl. {formatTime(s.opensAt)}, trekkes rekkefølgen tilfeldig blant alle som står i køen før åpning. Det hjelper ikke å komme først – bare å være her i tide.
            </p>
          </>
        )}
        {s.status === 'waiting' && (
          <>
            <Rings active>
              <span className="text-footnote font-semibold text-label-2">Din plass</span>
              <span className="display mt-1 text-[2.4rem] leading-none tabular" style={{ fontStretch: '100%' }}>
                {s.position}
              </span>
            </Rings>
            <h2 className="mt-8 text-title2 font-bold">{s.ahead === 1 ? '1 person foran deg' : `${s.ahead ?? 0} personer foran deg`}</h2>
            <p className="mt-1 text-body text-label-2 tabular">
              {s.etaSeconds !== null ? (s.etaSeconds < 60 ? 'Under ett minutt igjen' : `Omtrent ${Math.ceil(s.etaSeconds / 60)} min igjen`) : ''}
            </p>
            <ProgressBar value={pct} max={100} className="mx-auto mt-5 max-w-xs" label="Fremdrift i køen" />
          </>
        )}
        {s.status === 'admitted' && (
          <>
            <Rings active={false}>
              <span className="display text-[1.5rem] leading-none text-green" style={{ fontStretch: '100%' }}>
                Din tur
              </span>
            </Rings>
            <h2 className="mt-8 text-title2 font-bold">Det er din tur!</h2>
            <p className="mt-2 text-body text-label-2 tabular">Du har {formatCountdown(admittedLeft)} på å velge billetter.</p>
            <Button size="lg" className="mt-6 min-w-60" onClick={() => navigate(e.seated ? `/e/${e.slug}/seter` : `/e/${e.slug}`, { replace: true })}>
              {e.seated ? 'Velg seter' : 'Velg billetter'}
            </Button>
          </>
        )}
        {s.status === 'expired' && (
          <>
            <h2 className="mt-6 text-title2 font-bold">Tiden din gikk ut</h2>
            <p className="mx-auto mt-2 max-w-md text-body text-label-2">Du fikk ikke startet et kjøp i tide, så plassen gikk videre. Du kan stille deg i kø igjen.</p>
            <Button size="lg" className="mt-6" onClick={() => void rejoin()}>
              Still deg i kø på nytt
            </Button>
          </>
        )}
        {s.status === 'sold_out' && (
          <>
            <h2 className="mt-6 text-title2 font-bold">Utsolgt</h2>
            <p className="mx-auto mt-2 max-w-md text-body text-label-2">Alle billettene er solgt. Bli med på ventelisten eller følg med på videresalg.</p>
            <Button size="lg" className="mt-6" onClick={() => navigate(`/e/${e.slug}`, { replace: true })}>
              Til arrangementet
            </Button>
          </>
        )}
      </div>

      <div className="mx-auto mt-10 flex max-w-md items-center justify-center gap-2 text-subhead text-label-2">
        <Users className="h-4 w-4" aria-hidden="true" />
        <span className="tabular">{s.total === 1 ? '1 person i køen' : `${s.total} personer i køen`}</span>
      </div>
      {(s.status === 'waiting' || s.status === 'before_open') && (
        <>
          <p className="mx-auto mt-3 max-w-md text-center text-footnote text-label-2">Du beholder plassen selv om du lukker appen. Vi oppdaterer automatisk.</p>
          <div className="mt-6 text-center">
            <Button variant="plain" onClick={() => void leave()}>
              Forlat køen
            </Button>
          </div>
        </>
      )}
      {statusQ.isError && <p className="mt-4 text-center text-footnote text-orange">Mistet forbindelsen – prøver igjen …</p>}
    </div>
  );
}

export default function QueuePage() {
  const { slug } = useParams();
  return (
    <Page title="Kø" back={slug ? `/e/${slug}` : '/'}>
      <RequireLogin reason="Logg inn for å stille deg i kø. Plassen din er knyttet til kontoen.">{slug && <QueueBody slug={slug} />}</RequireLogin>
    </Page>
  );
}
