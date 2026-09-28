import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Accessibility, Check, Minus, Plus, X } from 'lucide-react';
import type { OrderDTO } from '../../shared/types';
import type { PublicSeatMap } from '../../server/services/events';
import { formatNok } from '../../shared/money';
import { formatEventWhen } from '../../shared/time';
import { useApi } from '../app/context';
import { useLoginGate } from '../app/auth';
import { getUnlockToken, qk, useEvent } from '../api/hooks';
import { ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { BottomBar } from '../components/layout/BottomBar';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/Feedback';
import { CenterSpinner, QueryError } from '../components/ui/States';
import { useToast } from '../components/ui/Overlays';
import { haptic } from '../lib/haptics';
import { cn } from '../lib/cn';

interface SeatInfo {
  id: string;
  section: string;
  row: string;
  number: number;
  priceOre: number;
  feeOre: number;
}

const SIZES = [22, 28, 36] as const;

function idemKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export default function SeatSelect() {
  const { slug } = useParams();
  const api = useApi();
  const navigate = useNavigate();
  const toast = useToast();
  const gate = useLoginGate();
  const [eventId, setEventId] = useState<string | null>(null);
  const detailQ = useEvent(slug, eventId);
  const detail = detailQ.data;
  useEffect(() => {
    if (detail && detail.event.id !== eventId) setEventId(detail.event.id);
  }, [detail, eventId]);

  const mapQ = useQuery<PublicSeatMap, ApiError>({
    queryKey: qk.seatMap(detail?.event.id ?? '', null),
    queryFn: () => api.get(`/events/${detail!.event.id}/seatmap`),
    enabled: !!detail?.event.seated,
    refetchInterval: 20_000,
  });

  const [selected, setSelected] = useState<string[]>([]);
  const [sizeIdx, setSizeIdx] = useState(1);
  const [busy, setBusy] = useState(false);
  const seatSize = SIZES[sizeIdx]!;

  const onSaleTypes = useMemo(() => new Set((detail?.ticketTypes ?? []).filter((t) => t.state === 'on_sale').map((t) => t.id)), [detail]);

  const seatIndex = useMemo(() => {
    const m = new Map<string, SeatInfo>();
    for (const s of mapQ.data?.sections ?? []) {
      for (const r of s.rows) for (const seat of r.seats) m.set(seat.id, { id: seat.id, section: s.name, row: r.label, number: seat.number, priceOre: s.priceOre, feeOre: s.feeOre });
    }
    return m;
  }, [mapQ.data]);

  // Drop selected seats that someone else took in the meantime.
  useEffect(() => {
    if (!mapQ.data || selected.length === 0) return;
    const free = new Set<string>();
    for (const s of mapQ.data.sections) for (const r of s.rows) for (const seat of r.seats) if (seat.state === 'free') free.add(seat.id);
    if (selected.some((id) => !free.has(id))) {
      setSelected((prev) => prev.filter((id) => free.has(id)));
      toast({ message: 'Et av setene du valgte ble nettopp tatt', tone: 'info' });
    }
  }, [mapQ.data, selected, toast]);

  if (detailQ.isLoading) return <CenterSpinner />;
  if (detailQ.isError || !detail) return <Page title="Velg seter" back="/"><QueryError error={detailQ.error} onRetry={() => void detailQ.refetch()} /></Page>;

  const e = detail.event;
  const max = e.settings.maxPerOrder;
  const queue = detail.viewer.queue;
  const queueToken = queue?.status === 'admitted' ? queue.token : null;
  const mustQueue = e.settings.queueEnabled && !queueToken;

  const toggleSeat = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= max) {
        toast({ message: `Du kan velge maks ${max} seter per kjøp`, tone: 'info' });
        return prev;
      }
      haptic('light');
      return [...prev, id];
    });
  };

  const seats = selected.map((id) => seatIndex.get(id)).filter((s): s is SeatInfo => !!s);
  const total = seats.reduce((s, x) => s + x.priceOre + x.feeOre, 0);
  const fees = seats.reduce((s, x) => s + x.feeOre, 0);

  const proceed = () =>
    gate('Logg inn for å kjøpe billetter', () => {
      void (async () => {
        setBusy(true);
        try {
          const order = await api.post<OrderDTO>('/orders', { eventId: e.id, seatIds: selected, items: [], unlockToken: getUnlockToken(e.id), queueToken, idempotencyKey: idemKey() });
          navigate(`/kasse/${order.id}`, { replace: false });
        } catch (err) {
          if (err instanceof ApiError && err.code === 'seat_unavailable') {
            const taken = (err.details?.seatIds as string[] | undefined) ?? [];
            setSelected((prev) => prev.filter((id) => !taken.includes(id)));
            void mapQ.refetch();
          }
          if (err instanceof ApiError && (err.code === 'queue_required' || err.code === 'queue_token_invalid')) {
            navigate(`/e/${e.slug}/ko`);
            return;
          }
          toast({ message: errorMessage(err), tone: 'error' });
        } finally {
          setBusy(false);
        }
      })();
    });

  return (
    <Page
      title="Velg seter"
      back={`/e/${e.slug}`}
      wide
      actions={
        <div className="flex items-center gap-1">
          <IconButton label="Mindre seter" disabled={sizeIdx === 0} onClick={() => setSizeIdx((i) => Math.max(0, i - 1))}>
            <Minus className="h-4 w-4" />
          </IconButton>
          <IconButton label="Større seter" disabled={sizeIdx === SIZES.length - 1} onClick={() => setSizeIdx((i) => Math.min(SIZES.length - 1, i + 1))}>
            <Plus className="h-4 w-4" />
          </IconButton>
        </div>
      }
    >
      <div className="px-4 pb-3">
        <p className="text-headline font-semibold">{e.title}</p>
        <p className="text-subhead text-label-2">
          {formatEventWhen(e.startsAt)} · {e.venue.name}
        </p>
      </div>

      {mustQueue && (
        <div className="mx-4 mb-4 flex items-center gap-3 rounded-md bg-orange-soft px-4 py-3">
          <p className="flex-1 text-subhead">Billettene selges gjennom en digital kø. Still deg i køen først.</p>
          <Button size="sm" onClick={() => navigate(`/e/${e.slug}/ko`)}>
            Til køen
          </Button>
        </div>
      )}

      <div className="mx-4 mb-3 flex flex-wrap gap-x-4 gap-y-2 text-footnote text-label-2" aria-label="Forklaring">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-full border-2 border-[var(--tint)]" /> Ledig
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-full bg-tint-fill" /> Valgt
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-full bg-fill" /> Opptatt
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Accessibility className="h-3.5 w-3.5" aria-hidden="true" /> Rullestolplass
        </span>
      </div>

      {mapQ.isLoading && <CenterSpinner className="min-h-60" />}
      {mapQ.isError && <QueryError error={mapQ.error} onRetry={() => void mapQ.refetch()} notFound={<EmptyState title="Salkartet er ikke klart" message="Arrangøren har ikke publisert salkartet ennå." />} />}
      {mapQ.data && (
        <div className="mx-4 overflow-auto rounded-lg bg-grouped-2 p-4" style={{ maxHeight: 'calc(100dvh - 300px)', minHeight: 260 }}>
          <div className="mx-auto w-max min-w-full">
            <div className="mx-auto mb-6 flex h-9 w-3/4 min-w-[200px] items-center justify-center rounded-b-[40px] rounded-t-[8px] bg-fill-3 text-footnote font-bold uppercase tracking-[0.12em] text-label-2">
              {mapQ.data.stageLabel}
            </div>
            {mapQ.data.sections.map((s) => {
              const sellable = onSaleTypes.has(s.ticketTypeId);
              return (
                <section key={s.id} aria-label={`${s.name}, ${formatNok(s.priceOre)}`} className="mb-6 last:mb-0">
                  <h2 className="mb-2 text-center text-subhead font-semibold">
                    {s.name} · <span className="tabular">{formatNok(s.priceOre)}</span>
                    {!sellable && <span className="text-label-2"> · ikke i salg</span>}
                  </h2>
                  <div className="flex flex-col items-center gap-1.5">
                    {s.rows.map((r) => (
                      <div key={r.label} className="flex items-center gap-1.5">
                        <span className="w-6 text-right text-caption1 font-semibold text-label-2" aria-hidden="true">
                          {r.label}
                        </span>
                        {Array.from({ length: r.offset }, (_, i) => (
                          <span key={`o${i}`} style={{ width: seatSize, height: seatSize }} aria-hidden="true" />
                        ))}
                        {r.seats.map((seat) => {
                          const isSel = selected.includes(seat.id);
                          const available = seat.state === 'free' && sellable;
                          return (
                            <button
                              key={seat.id}
                              type="button"
                              disabled={!available && !isSel}
                              aria-pressed={isSel}
                              aria-label={`${s.name}, rad ${r.label}, sete ${seat.number}${seat.accessible ? ', rullestolplass' : ''}, ${isSel ? 'valgt' : available ? 'ledig' : 'opptatt'}`}
                              onClick={() => toggleSeat(seat.id)}
                              className={cn(
                                'relative flex shrink-0 items-center justify-center rounded-full text-[0.6rem] font-bold transition-transform active:scale-90',
                                "before:absolute before:-inset-[3px] before:content-['']",
                                isSel ? 'bg-tint-fill text-on-tint' : available ? 'border-2 border-[var(--tint)] text-tint' : 'bg-fill text-transparent',
                              )}
                              style={{ width: seatSize, height: seatSize }}
                            >
                              {isSel ? (
                                <Check className="h-3/5 w-3/5" strokeWidth={3} aria-hidden="true" />
                              ) : seat.accessible ? (
                                <Accessibility className={cn('h-3/5 w-3/5', !available && 'text-label-3')} aria-hidden="true" />
                              ) : seatSize >= 28 && available ? (
                                seat.number
                              ) : null}
                            </button>
                          );
                        })}
                        <span className="w-6 text-caption1 font-semibold text-label-2" aria-hidden="true">
                          {r.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {seats.length > 0 && (
        <div className="mx-4 mt-3 flex flex-wrap gap-2" aria-label="Valgte seter">
          {seats.map((s) => (
            <span key={s.id} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-tint-soft pl-3.5 pr-1 text-subhead font-semibold text-tint">
              {s.section}, rad {s.row}, sete {s.number}
              <button type="button" onClick={() => toggleSeat(s.id)} aria-label={`Fjern ${s.section}, rad ${s.row}, sete ${s.number}`} className="relative flex h-8 w-8 items-center justify-center rounded-full before:absolute before:-inset-1.5 before:content-['']">
                <X className="h-4 w-4" />
              </button>
            </span>
          ))}
        </div>
      )}

      <BottomBar>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 pl-3">
            {seats.length === 0 ? (
              <p className="text-subhead text-label-2">Trykk på ledige seter. Maks {max} per kjøp.</p>
            ) : (
              <>
                <p className="text-headline font-bold tabular">{formatNok(total)}</p>
                <p className="truncate text-footnote text-label-2 tabular">
                  {seats.length === 1 ? '1 sete' : `${seats.length} seter`}
                  {fees > 0 ? ` · inkl. ${formatNok(fees)} gebyr` : ''}
                </p>
              </>
            )}
          </div>
          <Button size="lg" disabled={seats.length === 0 || mustQueue} loading={busy} onClick={proceed}>
            Fortsett
          </Button>
        </div>
      </BottomBar>
    </Page>
  );
}
