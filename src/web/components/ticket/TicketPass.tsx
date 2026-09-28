import { CircleCheck, Clock3, Repeat2, Send, XCircle } from 'lucide-react';
import type { TicketDTO } from '../../../shared/types';
import { posterPalette } from '../../../shared/constants';
import { LIMITS } from '../../../shared/constants';
import { formatDateShort, formatTime, osloParts } from '../../../shared/time';
import { EventImage } from '../event/EventImage';
import { QrCode } from './QrCode';
import { useLiveCode } from './useLiveCode';
import { cn } from '../../lib/cn';

export type PassState = 'live' | 'used' | 'refunded' | 'cancelled' | 'event_cancelled' | 'transfer' | 'resale' | 'ended' | 'unavailable';

export function passState(t: TicketDTO, now: number = Date.now()): PassState {
  if (t.status === 'used') return 'used';
  if (t.status === 'refunded') return 'refunded';
  if (t.status === 'cancelled') return 'cancelled';
  if (t.event.saleState === 'cancelled' || t.event.status === 'cancelled') return 'event_cancelled';
  if (t.transfer) return 'transfer';
  if (t.resale) return 'resale';
  if (new Date(t.event.endsAt).getTime() < now) return 'ended';
  return t.secret ? 'live' : 'unavailable';
}

const pad = (n: number) => String(n).padStart(2, '0');

function Field({ label, value, mono, className }: { label: string; value: React.ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-white/60">{label}</dt>
      <dd className={cn('mt-0.5 text-subhead font-semibold text-white [overflow-wrap:anywhere]', mono && 'font-mono tabular')}>{value}</dd>
    </div>
  );
}

function Stamp({ icon, title, detail }: { icon: React.ReactNode; title: string; detail?: string | null }) {
  return (
    <div className="flex aspect-square w-full flex-col items-center justify-center rounded-[20px] bg-white/10 px-6 text-center shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]">
      <span className="text-white/90 [&_svg]:h-14 [&_svg]:w-14" aria-hidden="true">
        {icon}
      </span>
      <p className="display mt-3 text-[1.35rem] leading-tight text-white" style={{ fontStretch: '110%' }}>
        {title}
      </p>
      {detail && <p className="mt-1 text-subhead text-white/75">{detail}</p>}
    </div>
  );
}

/**
 * The live ticket – TIKIT's signature. The QR code rotates every 15 seconds and a ticking clock and a
 * moving sheen show door staff at a glance that this is the real app, not a screenshot.
 */
export function TicketPass({ ticket, offsetMs, active, index, count }: { ticket: TicketDTO; offsetMs: number; active: boolean; index?: number; count?: number }) {
  const e = ticket.event;
  const [c0, c1, c2] = posterPalette(e.poster.palette);
  const state = passState(ticket);
  const live = useLiveCode(ticket.id, state === 'live' ? ticket.secret : null, offsetMs, active && state === 'live');
  const p = osloParts(live.now);
  const stepMs = LIMITS.qrStepSeconds * 1000;
  const remaining = Math.max(0, 1 - live.elapsedMs / stepMs);
  const secondsLeft = Math.ceil((stepMs - live.elapsedMs) / 1000);
  const seat = ticket.seat ? `${ticket.seat.section}, rad ${ticket.seat.row}, sete ${ticket.seat.number}` : null;

  let body: React.ReactNode;
  switch (state) {
    case 'live':
      body = (
        <>
          <div className="relative mx-auto w-full max-w-[264px] rounded-[22px] bg-white p-3.5 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
            {live.code ? (
              <QrCode value={live.code} className="block aspect-square w-full" label={`QR-kode for billett ${ticket.number}. Koden fornyes hvert ${LIMITS.qrStepSeconds}. sekund.`} />
            ) : (
              <div className="aspect-square w-full animate-pulse rounded-[8px] bg-black/5" role="img" aria-label="Lager QR-kode" />
            )}
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-black/10" aria-hidden="true">
              <div className="h-full origin-left rounded-full transition-transform duration-1000 ease-linear" style={{ transform: `scaleX(${remaining})`, background: c1 }} />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-center gap-2.5 text-white" aria-hidden="true">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inset-0 animate-ping rounded-full bg-[#34c759] opacity-75" />
              <span className="relative h-2.5 w-2.5 rounded-full bg-[#34c759]" />
            </span>
            <span className="font-mono text-[1.35rem] font-semibold tracking-[0.04em] tabular">
              {pad(p.hour)}:{pad(p.minute)}:{pad(p.second)}
            </span>
            <span className="text-footnote font-semibold uppercase tracking-[0.08em] text-white/70">{formatDateShort(new Date(live.now))}</span>
          </div>
          <p className="mt-1 text-center text-footnote text-white/70 tabular">Levende billett · ny kode om {secondsLeft} s</p>
        </>
      );
      break;
    case 'used':
      body = <Stamp icon={<CircleCheck />} title="Sjekket inn" detail={ticket.checkedInAt ? `${formatDateShort(ticket.checkedInAt)} kl. ${formatTime(ticket.checkedInAt)}` : null} />;
      break;
    case 'refunded':
      body = <Stamp icon={<XCircle />} title="Refundert" detail="Billetten er ikke lenger gyldig." />;
      break;
    case 'cancelled':
      body = <Stamp icon={<XCircle />} title="Kansellert" detail="Billetten er ikke lenger gyldig." />;
      break;
    case 'event_cancelled':
      body = <Stamp icon={<XCircle />} title="Avlyst" detail="Arrangementet er avlyst. Billetten refunderes automatisk." />;
      break;
    case 'transfer':
      body = <Stamp icon={<Send />} title="Overføres" detail="Venter på at mottakeren godtar. QR-koden er skjult så lenge." />;
      break;
    case 'resale':
      body = <Stamp icon={<Repeat2 />} title="Til salgs" detail="Billetten ligger ute for videresalg. QR-koden er skjult så lenge." />;
      break;
    case 'ended':
      body = <Stamp icon={<Clock3 />} title="Ferdig" detail="Arrangementet er over. Takk for at du kom!" />;
      break;
    default:
      body = <Stamp icon={<Clock3 />} title="Ikke tilgjengelig" detail="Billetten kan ikke vises akkurat nå." />;
  }

  return (
    <article
      aria-label={`Billett til ${e.title}, ${ticket.typeName}${seat ? `, ${seat}` : ''}${count && count > 1 && index !== undefined ? `, billett ${index + 1} av ${count}` : ''}`}
      className={cn('relative isolate mx-auto w-full max-w-[400px] overflow-hidden rounded-[30px] text-white shadow-[var(--lift-shadow)]', state !== 'live' && state !== 'used' && 'saturate-[0.6]')}
      style={{ background: `linear-gradient(165deg, ${c1} 0%, ${c0} 46%, ${c0} 100%)` }}
    >
      {/* moving sheen across the pass (not over the QR code) */}
      {state === 'live' && (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <span
            className="absolute -inset-y-1/2 left-0 w-1/3"
            style={{ background: `linear-gradient(90deg, transparent, ${c2}55, transparent)`, animation: 'tikit-sheen 3.6s ease-in-out infinite' }}
          />
        </span>
      )}

      <div className="relative h-[124px]">
        <EventImage poster={e.poster} coverUrl={e.coverUrl} title={e.title} className="absolute inset-0 -z-10" />
        <div className="absolute inset-0 -z-10" style={{ background: `linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.25) 45%, ${c0} 100%)` }} aria-hidden="true" />
        <div className="absolute inset-x-5 bottom-2.5">
          <h2 className="display line-clamp-2 text-[1.45rem] leading-[1.02] text-white [text-wrap:balance] [overflow-wrap:anywhere] hyphens-auto">{e.title}</h2>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-3 px-5 pt-3">
        <Field label="Dato" value={formatDateShort(e.startsAt)} />
        <Field label="Start" value={formatTime(e.startsAt)} />
        <Field label="Dører" value={e.doorsAt ? formatTime(e.doorsAt) : '–'} />
        <Field label="Sted" value={`${e.venue.name}, ${e.venue.city}`} className="col-span-3" />
      </dl>

      <div className="relative my-4 h-6" aria-hidden="true">
        <span className="absolute -left-3 top-0 h-6 w-6 rounded-full bg-grouped" />
        <span className="absolute -right-3 top-0 h-6 w-6 rounded-full bg-grouped" />
        <span className="absolute inset-x-5 top-1/2 border-t-2 border-dashed border-white/25" />
      </div>

      <div className="px-5">{body}</div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-3 px-5 pb-5 pt-5">
        <Field label="Navn" value={ticket.holderName} />
        <Field label="Billettype" value={ticket.typeName} />
        {seat && <Field label="Plass" value={seat} className="col-span-2" />}
        <Field label="Billettnr." value={ticket.number} mono />
        <Field label="Alder" value={e.ageLimit ? (ticket.ageVerified ? 'Bekreftet' : `${e.ageLimit} år – ta med leg.`) : 'Ingen grense'} />
      </dl>
      {count && count > 1 && index !== undefined && (
        <p className="pb-4 text-center text-footnote font-semibold text-white/70 tabular">
          Billett {index + 1} av {count}
        </p>
      )}
    </article>
  );
}
