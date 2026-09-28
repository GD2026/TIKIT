import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BadgeCheck,
  Bell,
  BellRing,
  CalendarDays,
  Check,
  Flag,
  Heart,
  KeyRound,
  ListChecks,
  MapPin,
  Repeat2,
  Share,
  ShieldCheck,
  Ticket as TicketIcon,
  TriangleAlert,
} from 'lucide-react';
import type { EventDetail, LineupItem, OrderDTO, TicketTypePublic } from '../../shared/types';
import type { ResaleOffer } from '../../server/services/tickets';
import { REFUND_POLICIES, categoryLabel } from '../../shared/constants';
import { formatNok } from '../../shared/money';
import { formatCountdown, formatDateLong, formatDateShort, formatRelativeDay, formatTime, formatTimeRange, osloParts } from '../../shared/time';
import { useApi } from '../app/context';
import { useLoginGate } from '../app/auth';
import { getUnlockToken, qk, setUnlockToken, useEvent } from '../api/hooks';
import { ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { BottomBar } from '../components/layout/BottomBar';
import { EventImage } from '../components/event/EventImage';
import { OrgAvatar } from '../components/event/OrgAvatar';
import { Button } from '../components/ui/Button';
import { EmptyState, Pill } from '../components/ui/Feedback';
import { Stepper } from '../components/ui/Controls';
import { Sheet } from '../components/ui/Sheet';
import { TextField } from '../components/ui/Field';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { CenterSpinner, QueryError } from '../components/ui/States';
import { IconButton } from '../components/ui/Button';
import { useCountdown } from '../lib/hooks';
import { safeSession } from '../lib/storage';
import { appUrl, mapsUrl } from '../lib/links';
import { shareLink } from '../lib/share';
import { haptic } from '../lib/haptics';
import { cn } from '../lib/cn';
import { ReportSheet } from '../components/moderation/ReportSheet';

type Selection = Record<string, number>;

function newIdemKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Program in the order it happens. Times are Oslo wall-clock "HH:MM"; acts after midnight belong to the
 * same night, so each time is measured from three hours before doors open. Acts without a time keep
 * their place at the end.
 */
function programOrder(lineup: LineupItem[], reference: string): LineupItem[] {
  const p = osloParts(reference);
  const origin = (p.hour * 60 + p.minute - 180 + 1440) % 1440;
  const minutes = (t: string | null) => {
    const m = t ? /^(\d{1,2}):(\d{2})$/.exec(t) : null;
    return m ? (Number(m[1]) * 60 + Number(m[2]) - origin + 1440) % 1440 : Number.POSITIVE_INFINITY;
  };
  return lineup
    .map((l, i) => ({ l, i, k: minutes(l.time) }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.l);
}

function typeStatusText(t: TicketTypePublic): string | null {
  switch (t.state) {
    case 'sold_out':
      return 'Utsolgt';
    case 'not_started':
      return t.salesStartAt ? `Salg ${formatRelativeDay(t.salesStartAt).toLowerCase()} kl. ${formatTime(t.salesStartAt)}` : 'Salget har ikke startet';
    case 'ended':
      return 'Salget er over';
    case 'paused':
      return 'Midlertidig stengt';
    default:
      return null;
  }
}

function TicketTypeRow({
  t,
  qty,
  max,
  onChange,
  disabled,
}: {
  t: TicketTypePublic;
  qty: number;
  max: number;
  onChange: (n: number) => void;
  disabled: boolean;
}) {
  const status = typeStatusText(t);
  const buyable = t.state === 'on_sale' && !t.seated;
  return (
    <div className="flex gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* Unavailable types are quieter through colour, not opacity, so every line keeps 4.5:1. */}
          <h3 className={cn('text-headline font-semibold', t.state !== 'on_sale' && 'text-label-2')}>{t.name}</h3>
          {t.unlocked && (
            <Pill tone="tint" icon={<KeyRound />}>
              Låst opp
            </Pill>
          )}
          {t.low && t.state === 'on_sale' && <Pill tone="orange">Få igjen</Pill>}
        </div>
        <p className="mt-0.5 text-callout tabular">
          <span className="font-semibold">{t.priceOre === 0 ? 'Gratis' : formatNok(t.priceOre)}</span>
          {t.feeOre > 0 && <span className="text-label-2"> + {formatNok(t.feeOre)} gebyr</span>}
        </p>
        {t.description && <p className="mt-1 text-subhead text-label-2">{t.description}</p>}
        {t.state === 'on_sale' && t.available !== null && t.available <= 50 && (
          <p className="mt-1 text-footnote font-medium text-orange tabular">{t.available === 1 ? '1 billett igjen' : `${t.available} billetter igjen`}</p>
        )}
        {status && <p className="mt-1 text-footnote font-semibold text-label-2">{status}</p>}
        {t.seated && t.state === 'on_sale' && <p className="mt-1 text-footnote text-label-2">Nummerert plass – velg sete i salkartet.</p>}
      </div>
      {buyable && (
        <div className="flex shrink-0 items-center">
          <Stepper value={qty} max={max} onChange={onChange} label={t.name} disabled={disabled} />
        </div>
      )}
    </div>
  );
}

function Fact({ icon, title, children, href }: { icon: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; href?: string }) {
  const body = (
    <>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-fill-3 text-label [&_svg]:h-[18px] [&_svg]:w-[18px]" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body font-medium">{title}</span>
        {children && <span className="mt-0.5 block text-subhead text-label-2">{children}</span>}
      </span>
    </>
  );
  if (href)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="flex gap-3 px-4 py-3 text-label no-underline transition-colors hover:bg-fill-4 active:bg-fill-3">
        {body}
      </a>
    );
  return <div className="flex gap-3 px-4 py-3">{body}</div>;
}

function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320 || text.split('\n').length > 6;
  return (
    <div>
      <p className={cn('whitespace-pre-line text-body leading-[1.45]', !open && long && 'line-clamp-6')}>{text}</p>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-1 h-11 text-body font-medium text-tint">
          {open ? 'Vis mindre' : 'Vis mer'}
        </button>
      )}
    </div>
  );
}

function UnlockSheet({ open, onClose, eventId, onUnlocked }: { open: boolean; onClose: () => void; eventId: string; onUnlocked: (count: number) => void }) {
  const api = useApi();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const existing = getUnlockToken(eventId);
      const res = await api.post<{ token: string; unlocked: string[] }>(`/events/${eventId}/unlock`, { code: code.trim() }, existing ? { 'X-Tikit-Unlock': existing } : {});
      setUnlockToken(eventId, res.token);
      setCode('');
      onUnlocked(res.unlocked.length);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} locked={busy} title="Tilgangskode">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-4 pb-2"
      >
        <p className="text-subhead text-label-2">Noen billettyper er skjult og krever en kode fra arrangøren, for eksempel for russestyrer eller gjestelister.</p>
        <TextField
          label="Kode"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={40}
          error={error}
          data-autofocus
        />
        <Button type="submit" size="lg" full loading={busy} disabled={!code.trim()}>
          Lås opp
        </Button>
      </form>
    </Sheet>
  );
}

function ResaleSheet({ open, onClose, detail, onBuy, busyId }: { open: boolean; onClose: () => void; detail: EventDetail; onBuy: (offer: ResaleOffer) => void; busyId: string | null }) {
  const api = useApi();
  const offers = useQuery<{ offers: ResaleOffer[] }, ApiError>({
    queryKey: qk.resale(detail.event.id),
    queryFn: () => api.get(`/events/${detail.event.id}/resale`),
    enabled: open,
  });
  return (
    <Sheet open={open} onClose={onClose} title="Videresalg" locked={!!busyId}>
      <p className="mb-4 text-subhead text-label-2">
        Billetter fra andre kjøpere, solgt gjennom TIKIT. Prisen er aldri høyere enn det selgeren betalte, og billetten får ny QR-kode når du kjøper den.
      </p>
      {offers.isLoading && <CenterSpinner className="min-h-40" />}
      {offers.isError && <QueryError error={offers.error} onRetry={() => void offers.refetch()} />}
      {offers.data && offers.data.offers.length === 0 && <EmptyState title="Ingen billetter til salgs akkurat nå" message="Prøv igjen senere – billetter kan dukke opp frem til arrangementet." />}
      {offers.data && offers.data.offers.length > 0 && (
        <div className="overflow-hidden rounded-md bg-grouped-2">
          {offers.data.offers.map((o, i) => (
            <div key={o.id} className={cn('flex items-center gap-3 px-4 py-3', i > 0 && 'hairline-t')}>
              <div className="min-w-0 flex-1">
                <p className="text-headline font-semibold">{o.typeName}</p>
                <p className="text-subhead text-label-2 tabular">
                  {formatNok(o.priceOre)} + {formatNok(o.feeOre)} gebyr
                  {o.seat ? ` · ${o.seat.section}, rad ${o.seat.row}, sete ${o.seat.number}` : ''}
                </p>
              </div>
              <Button size="sm" loading={busyId === o.id} disabled={!!busyId} onClick={() => onBuy(o)}>
                Kjøp
              </Button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export default function EventPage() {
  const { slug } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const gate = useLoginGate();

  const [eventId, setEventId] = useState<string | null>(null);
  const [, setUnlockNonce] = useState(0);
  const q = useEvent(slug, eventId, {
    // Keep showing the event while it refetches with a new access-code token (same slug only).
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === slug ? prev : undefined),
  });
  const detail = q.data;
  useEffect(() => {
    if (detail && detail.event.id !== eventId) setEventId(detail.event.id);
  }, [detail, eventId]);

  const selectionKey = `tikit-selection:${slug ?? ''}`;
  const [qty, setQty] = useState<Selection>(() => {
    const saved = safeSession.getJSON<{ at: number; qty: Selection } | null>(selectionKey, null);
    return saved && Date.now() - saved.at < 30 * 60000 ? saved.qty : {};
  });
  useEffect(() => {
    safeSession.setJSON(selectionKey, { at: Date.now(), qty });
  }, [qty, selectionKey]);

  const [unlockOpen, setUnlockOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [resaleOpen, setResaleOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [resaleBusy, setResaleBusy] = useState<string | null>(null);

  const e = detail?.event;
  const queue = detail?.viewer.queue ?? null;
  const queueToken = queue?.status === 'admitted' ? queue.token : null;
  const admittedMs = useCountdown(queue?.status === 'admitted' ? queue.admittedUntil : null);
  const salesCountdown = useCountdown(e?.saleState === 'upcoming' ? e.salesStartAt : null);

  // Refresh when the sale opens so the ticket list becomes buyable without a manual reload.
  useEffect(() => {
    if (e?.saleState === 'upcoming' && e.salesStartAt) {
      const ms = new Date(e.salesStartAt).getTime() - Date.now();
      if (ms > 0 && ms < 2 ** 31 - 1) {
        const t = window.setTimeout(() => void q.refetch(), ms + 800);
        return () => window.clearTimeout(t);
      }
    }
    return undefined;
  }, [e?.saleState, e?.salesStartAt, q]);

  const types = useMemo(() => detail?.ticketTypes ?? [], [detail]);
  const maxTotal = e?.settings.maxPerOrder ?? 8;
  const totalQty = Object.values(qty).reduce((s, n) => s + n, 0);
  const totalOre = types.reduce((s, t) => s + (qty[t.id] ?? 0) * (t.priceOre + t.feeOre), 0);
  const feeTotal = types.reduce((s, t) => s + (qty[t.id] ?? 0) * t.feeOre, 0);
  const seatedOnSale = types.some((t) => t.seated && t.state === 'on_sale');
  const anyOnSale = types.some((t) => t.state === 'on_sale');

  // Drop selections for types that are no longer buyable (sold out while browsing).
  const cleanQty = useMemo(() => {
    const out: Selection = {};
    for (const t of types) {
      const n = qty[t.id] ?? 0;
      if (n > 0 && t.state === 'on_sale' && !t.seated) out[t.id] = Math.min(n, t.available ?? n);
    }
    return out;
  }, [qty, types]);

  if (q.isLoading) return <CenterSpinner />;
  if (q.isError || !detail || !e)
    return (
      <Page title="Arrangement" back="/">
        <QueryError
          error={q.error}
          onRetry={() => void q.refetch()}
          notFound={<EmptyState icon={<TicketIcon />} title="Fant ikke arrangementet" message="Lenken kan være feil, eller arrangementet er fjernet." />}
        />
      </Page>
    );

  const queueActive = e.settings.queueEnabled && (e.saleState === 'on_sale' || e.saleState === 'upcoming');
  const mustQueue = queueActive && !queueToken;
  const unlockToken = getUnlockToken(e.id);

  const refresh = () => qc.invalidateQueries({ queryKey: ['event', slug] });

  const toggle = async (kind: 'favorite' | 'alert' | 'waitlist', on: boolean) => {
    const path = kind === 'favorite' ? 'favorite' : kind === 'alert' ? 'alert' : 'waitlist';
    setBusy(kind);
    try {
      if (on) await api.post(`/events/${e.id}/${path}`);
      else await api.del(`/events/${e.id}/${path}`);
      haptic('light');
      await refresh();
      if (kind === 'favorite') await qc.invalidateQueries({ queryKey: qk.favorites });
      if (kind === 'alert' && on) toast({ message: 'Vi varsler deg når billettsalget åpner', tone: 'success' });
      if (kind === 'waitlist' && on) toast({ message: 'Du står på ventelisten', tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const handleBuyError = async (err: unknown) => {
    if (err instanceof ApiError) {
      if (err.code === 'age_required') {
        const ok = await confirm({ title: 'Fødselsdato mangler', message: err.message, confirmLabel: 'Gå til profil' });
        if (ok) navigate('/profil/rediger');
        return;
      }
      if (err.code === 'age_verification_required') {
        const ok = await confirm({ title: 'Bekreft alderen med Vipps', message: err.message, confirmLabel: 'Koble til Vipps' });
        if (ok) navigate('/profil/innlogging');
        return;
      }
      if (err.code === 'queue_required' || err.code === 'queue_token_invalid') {
        navigate(`/e/${e.slug}/ko`);
        return;
      }
      if (err.code === 'sold_out' || err.code === 'not_enough_tickets' || err.code === 'event_not_on_sale' || err.code === 'invalid_ticket_type') void refresh();
    }
    toast({ message: errorMessage(err), tone: 'error' });
  };

  const buy = () =>
    gate('Logg inn for å kjøpe billetter', () => {
      void (async () => {
        const items = Object.entries(cleanQty).map(([ticketTypeId, n]) => ({ ticketTypeId, qty: n }));
        if (items.length === 0) return;
        setBusy('buy');
        try {
          const order = await api.post<OrderDTO>('/orders', { eventId: e.id, items, unlockToken, queueToken, idempotencyKey: newIdemKey() });
          safeSession.remove(selectionKey);
          setQty({});
          navigate(`/kasse/${order.id}`);
        } catch (err) {
          await handleBuyError(err);
        } finally {
          setBusy(null);
        }
      })();
    });

  const buyResale = (offer: ResaleOffer) =>
    gate('Logg inn for å kjøpe billetter', () => {
      void (async () => {
        setResaleBusy(offer.id);
        try {
          const order = await api.post<OrderDTO>('/orders', { eventId: e.id, resaleListingId: offer.id, idempotencyKey: newIdemKey() });
          setResaleOpen(false);
          navigate(`/kasse/${order.id}`);
        } catch (err) {
          await qc.invalidateQueries({ queryKey: qk.resale(e.id) });
          await handleBuyError(err);
        } finally {
          setResaleBusy(null);
        }
      })();
    });

  const share = async () => {
    const res = await shareLink({ title: e.title, text: `${e.title} – ${formatDateShort(e.startsAt)} på ${e.venue.name}`, url: appUrl(`/e/${e.slug}`) });
    if (res === 'copied') toast({ message: 'Lenken er kopiert', tone: 'success' });
    if (res === 'failed') toast({ message: 'Kunne ikke dele lenken', tone: 'error' });
  };

  const refund = REFUND_POLICIES.find((p) => p.id === e.settings.refundPolicy);
  const canInteract = e.saleState !== 'cancelled' && e.saleState !== 'past';

  // ── Bottom action ───────────────────────────────────────────────────────────
  let action: React.ReactNode = null;
  if (e.saleState === 'on_sale' && mustQueue) {
    action = (
      <Button size="lg" full onClick={() => gate('Logg inn for å stille deg i kø', () => navigate(`/e/${e.slug}/ko`))}>
        {queue && (queue.status === 'waiting' || queue.status === 'before_open') ? `Tilbake til køen${queue.position ? ` · plass ${queue.position}` : ''}` : 'Still deg i kø'}
      </Button>
    );
  } else if (e.saleState === 'upcoming') {
    action = (
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 pl-3">
          <p className="text-footnote text-label-2">Salget åpner om</p>
          <p className="text-headline font-bold tabular" aria-live="off">
            {e.salesStartAt ? formatCountdown(salesCountdown) : 'snart'}
          </p>
        </div>
        {queueActive ? (
          <Button size="lg" onClick={() => gate('Logg inn for å stille deg i kø', () => navigate(`/e/${e.slug}/ko`))}>
            {queue ? 'Til køen' : 'Still deg i kø'}
          </Button>
        ) : (
          <Button
            size="lg"
            variant={detail.viewer.saleAlert ? 'tinted' : 'filled'}
            loading={busy === 'alert'}
            icon={detail.viewer.saleAlert ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
            onClick={() => gate('Logg inn for å få varsel', () => void toggle('alert', !detail.viewer.saleAlert))}
          >
            {detail.viewer.saleAlert ? 'Varsel på' : 'Varsle meg'}
          </Button>
        )}
      </div>
    );
  } else if (e.saleState === 'on_sale' && totalQty > 0) {
    action = (
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 pl-3">
          <p className="text-headline font-bold tabular">{totalOre === 0 ? 'Gratis' : formatNok(totalOre)}</p>
          <p className="truncate text-footnote text-label-2 tabular">
            {totalQty === 1 ? '1 billett' : `${totalQty} billetter`}
            {feeTotal > 0 ? ' inkl. gebyr' : ''}
          </p>
        </div>
        <Button size="lg" loading={busy === 'buy'} onClick={buy}>
          {totalOre === 0 ? 'Hent billetter' : 'Til betaling'}
        </Button>
      </div>
    );
  } else if (e.saleState === 'on_sale' && seatedOnSale) {
    action = (
      <Button size="lg" full onClick={() => navigate(`/e/${e.slug}/seter`)}>
        Velg seter
      </Button>
    );
  } else if (e.saleState === 'on_sale' && anyOnSale) {
    action = (
      <Button
        size="lg"
        full
        variant="tinted"
        onClick={() => document.getElementById('billetter')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      >
        Velg billetter
      </Button>
    );
  } else if (e.saleState === 'sold_out') {
    action = (
      <div className="flex gap-2">
        {detail.resale.count > 0 && (
          <Button size="lg" className="flex-1" icon={<Repeat2 className="h-5 w-5" />} onClick={() => setResaleOpen(true)}>
            Videresalg · {detail.resale.count}
          </Button>
        )}
        {e.settings.waitlistEnabled && (
          <Button
            size="lg"
            className="flex-1"
            variant={detail.viewer.onWaitlist ? 'tinted' : detail.resale.count > 0 ? 'gray' : 'filled'}
            loading={busy === 'waitlist'}
            icon={detail.viewer.onWaitlist ? <Check className="h-5 w-5" /> : undefined}
            onClick={() => gate('Logg inn for å stå på ventelisten', () => void toggle('waitlist', !detail.viewer.onWaitlist))}
          >
            {detail.viewer.onWaitlist ? 'På ventelisten' : 'Venteliste'}
          </Button>
        )}
      </div>
    );
  }

  return (
    <Page
      title={e.title}
      back="/"
      overlay
      overlayThreshold={320}
      actions={
        <>
          <IconButton label="Del arrangementet" variant="glass" size={44} onClick={() => void share()}>
            <Share className="h-5 w-5" />
          </IconButton>
          {canInteract && (
            <IconButton
              label={detail.viewer.favorite ? 'Fjern fra favoritter' : 'Legg til i favoritter'}
              variant="glass"
              size={44}
              aria-pressed={detail.viewer.favorite}
              disabled={busy === 'favorite'}
              onClick={() => gate('Logg inn for å lagre favoritter', () => void toggle('favorite', !detail.viewer.favorite))}
            >
              <Heart className={cn('h-5 w-5', detail.viewer.favorite && 'fill-[var(--red-fill)] text-red')} />
            </IconButton>
          )}
        </>
      }
    >
      <div className="relative">
        <EventImage poster={e.poster} coverUrl={e.coverUrl} title={e.title} eager className="aspect-square max-h-[62dvh] w-full sm:mx-4 sm:mt-[calc(64px+var(--safe-top))] sm:aspect-[16/10] sm:w-[calc(100%-32px)] sm:rounded-[26px]" />
      </div>

      <div className="px-4 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="neutral">{categoryLabel(e.category)}</Pill>
          {e.status === 'draft' && <Pill tone="orange">Utkast – bare synlig for arrangøren</Pill>}
          {e.visibility === 'unlisted' && e.status !== 'draft' && <Pill tone="neutral">Skjult lenke</Pill>}
        </div>
        <div aria-hidden="true" className="display mt-3 text-[clamp(1.6rem,8.6vw,2.1rem)] leading-[1.02] [text-wrap:balance] [overflow-wrap:anywhere] hyphens-auto">
          {e.title}
        </div>
        {e.subtitle && <p className="mt-2 text-title3 text-label-2">{e.subtitle}</p>}
        <Link to={`/a/${detail.organizer.slug}`} className="mt-4 flex items-center gap-3 rounded-[14px] no-underline text-label">
          <OrgAvatar name={detail.organizer.name} logoUrl={detail.organizer.logoUrl} palette={detail.organizer.palette} size={40} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-headline font-semibold">
              <span className="truncate">{detail.organizer.name}</span>
              {detail.organizer.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-tint" aria-label="Verifisert arrangør" />}
            </span>
            <span className="block text-subhead text-label-2">Arrangør</span>
          </span>
        </Link>
      </div>

      {detail.viewer.ticketCount > 0 && (
        <Link to="/billetter" className="mx-4 mt-5 flex items-center gap-3 rounded-md bg-tint-soft px-4 py-3 text-tint no-underline">
          <TicketIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-headline font-semibold">
            Du har {detail.viewer.ticketCount === 1 ? '1 billett' : `${detail.viewer.ticketCount} billetter`} hit
          </span>
          <span className="text-subhead font-semibold">Vis</span>
        </Link>
      )}

      {e.saleState === 'cancelled' && (
        <div role="status" className="mx-4 mt-5 rounded-md bg-red-soft px-4 py-3.5">
          <p className="flex items-center gap-2 text-headline font-semibold text-red">
            <TriangleAlert className="h-5 w-5" aria-hidden="true" /> Arrangementet er avlyst
          </p>
          {e.cancelReason && <p className="mt-1 text-subhead">{e.cancelReason}</p>}
          <p className="mt-1 text-subhead text-label-2">Alle kjøpte billetter refunderes automatisk til betalingsmåten som ble brukt.</p>
        </div>
      )}

      {queue?.status === 'admitted' && e.saleState === 'on_sale' && (
        <div role="status" className="mx-4 mt-5 rounded-md bg-green-soft px-4 py-3.5">
          <p className="text-headline font-semibold text-green">Det er din tur!</p>
          <p className="mt-0.5 text-subhead tabular">Velg billetter innen {formatCountdown(admittedMs)} – ellers går plassen videre.</p>
        </div>
      )}

      <div className="mx-4 mt-5 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
        <Fact icon={<CalendarDays />} title={formatDateLong(e.startsAt)}>
          {formatTimeRange(e.startsAt, e.endsAt)}
          {e.doorsAt ? ` · Dørene åpner ${formatTime(e.doorsAt)}` : ''}
        </Fact>
        <Fact icon={<MapPin />} title={e.venue.name} href={mapsUrl(e.venue)}>
          {[e.venue.address, [e.venue.postalCode, e.venue.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')} · Vis i kart
        </Fact>
        {e.ageLimit ? (
          <Fact icon={<ShieldCheck />} title={`Aldersgrense ${e.ageLimit} år`}>
            {e.settings.requireVerifiedAge ? 'Alderen må være bekreftet med Vipps for å kjøpe.' : 'Ta med gyldig legitimasjon.'}
          </Fact>
        ) : null}
      </div>

      {(types.length > 0 || detail.hasHiddenTypes) && e.saleState !== 'cancelled' && e.saleState !== 'past' && (
        <section id="billetter" aria-labelledby="billetter-tittel" className="mt-7 scroll-mt-24">
          <div className="flex items-end justify-between px-4 pb-2">
            <h2 id="billetter-tittel" className="text-title2 font-bold">
              Billetter
            </h2>
            {e.saleState === 'on_sale' && !seatedOnSale && <span className="text-footnote text-label-2 tabular">Maks {maxTotal} per kjøp</span>}
          </div>
          {mustQueue && e.saleState === 'on_sale' && (
            <p className="mx-4 mb-3 rounded-md bg-fill-4 px-4 py-3 text-subhead text-label-2">
              Stor pågang: billettene selges gjennom en digital kø. Still deg i køen for å få kjøpe.
            </p>
          )}
          <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
            {types.map((t) => {
              const others = totalQty - (qty[t.id] ?? 0);
              const max = Math.max(0, Math.min(t.maxPerOrder, t.available ?? t.maxPerOrder, maxTotal - others));
              return (
                <TicketTypeRow
                  key={t.id}
                  t={t}
                  qty={cleanQty[t.id] ?? 0}
                  max={Math.max(max, cleanQty[t.id] ?? 0)}
                  disabled={mustQueue || busy === 'buy'}
                  onChange={(n) => setQty((prev) => ({ ...prev, [t.id]: Math.max(0, n) }))}
                />
              );
            })}
            {detail.hasHiddenTypes && (
              <button type="button" onClick={() => setUnlockOpen(true)} className="flex min-h-11 w-full items-center gap-3 px-4 py-3 text-left text-tint transition-colors hover:bg-fill-4">
                <KeyRound className="h-5 w-5" aria-hidden="true" />
                <span className="flex-1 text-body">Har du en tilgangskode?</span>
              </button>
            )}
          </div>
          {e.saleState === 'on_sale' && detail.resale.count > 0 && (
            <button
              type="button"
              onClick={() => setResaleOpen(true)}
              className="mx-4 mt-3 flex w-[calc(100%-32px)] items-center gap-3 rounded-md bg-grouped-2 px-4 py-3 text-left transition-colors hover:bg-fill-4"
            >
              <Repeat2 className="h-5 w-5 text-tint" aria-hidden="true" />
              <span className="flex-1">
                <span className="block text-body">Videresalg</span>
                <span className="block text-subhead text-label-2 tabular">
                  {detail.resale.count} {detail.resale.count === 1 ? 'billett' : 'billetter'} fra {formatNok(detail.resale.fromPriceOre ?? 0)}
                </span>
              </span>
            </button>
          )}
        </section>
      )}

      {e.description && (
        <section aria-labelledby="om" className="mt-7 px-4">
          <h2 id="om" className="mb-2 text-title2 font-bold">
            Om arrangementet
          </h2>
          <Description text={e.description} />
        </section>
      )}

      {e.lineup.length > 0 && (
        <section aria-labelledby="program" className="mt-7">
          <h2 id="program" className="mb-2 px-4 text-title2 font-bold">
            Program
          </h2>
          <ol className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
            {programOrder(e.lineup, e.doorsAt ?? e.startsAt).map((l, i) => (
              <li key={`${l.name}-${i}`} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-12 shrink-0 text-subhead font-semibold text-tint tabular">{l.time ?? '–'}</span>
                <span className="min-w-0 text-body">{l.name}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="info" className="mt-7">
        <h2 id="info" className="mb-2 px-4 text-title2 font-bold">
          Godt å vite
        </h2>
        <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
          <Fact icon={<ListChecks />} title={refund?.label ?? 'Refusjon'}>
            {refund?.description}
          </Fact>
          {e.settings.personalizedTickets && (
            <Fact icon={<ShieldCheck />} title="Personlige billetter">
              Hver billett må ha navnet til den som skal bruke den.
            </Fact>
          )}
        </div>
      </section>

      {e.status === 'published' && (
        <div className="mt-6 px-4 text-center">
          <button type="button" onClick={() => setReportOpen(true)} className="inline-flex min-h-11 items-center gap-1.5 px-2 text-subhead text-label-2 underline-offset-2 hover:underline">
            <Flag className="h-4 w-4" aria-hidden="true" /> Rapporter arrangementet
          </button>
        </div>
      )}

      {action && <BottomBar aboveTabBar>{action}</BottomBar>}
      <ReportSheet open={reportOpen} onClose={() => setReportOpen(false)} kind="event" targetId={e.id} targetName={e.title} />

      <UnlockSheet
        open={unlockOpen}
        onClose={() => setUnlockOpen(false)}
        eventId={e.id}
        onUnlocked={(n) => {
          toast({ message: n === 1 ? 'Låste opp 1 billettype' : `Låste opp ${n} billettyper`, tone: 'success' });
          // The stored token changed: re-render so the query re-keys and refetches with it.
          setUnlockNonce((n) => n + 1);
        }}
      />
      <ResaleSheet open={resaleOpen} onClose={() => setResaleOpen(false)} detail={detail} onBuy={buyResale} busyId={resaleBusy} />
    </Page>
  );
}
