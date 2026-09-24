import { Link } from 'react-router';
import { useNow } from '../../lib/hooks';
import { BadgeCheck, MapPin } from 'lucide-react';
import type { EventCard } from '../../../shared/types';
import { formatNok } from '../../../shared/money';
import { formatCountdown, formatDateShort, formatRelativeDay, formatTime, monthShort, osloParts, weekdayShort } from '../../../shared/time';
import { cn } from '../../lib/cn';
import { Pill } from '../ui/Feedback';
import { EventImage } from './EventImage';

/** Ticket-stub style date stamp. */
export function DateStamp({ iso, className, tone = 'glass' }: { iso: string; className?: string; tone?: 'glass' | 'plain' }) {
  const p = osloParts(iso);
  return (
    <span
      className={cn(
        'inline-flex min-w-[46px] flex-col items-center rounded-[12px] px-2 py-1.5 leading-none',
        tone === 'glass' ? 'glass-clear' : 'bg-fill-3 text-label',
        className,
      )}
      aria-label={formatDateShort(iso)}
    >
      <span className="text-[0.62rem] font-bold tracking-[0.08em] opacity-85">{monthShort(iso)}</span>
      <span className="display mt-0.5 text-[1.3rem] leading-none" style={{ fontStretch: '100%' }}>
        {p.day}
      </span>
      <span className="mt-0.5 text-[0.62rem] font-semibold uppercase opacity-80">{weekdayShort(iso).replace('.', '')}</span>
    </span>
  );
}

export function SaleStatus({ event, compact }: { event: EventCard; compact?: boolean }) {
  switch (event.saleState) {
    case 'sold_out':
      return <Pill tone="neutral">Utsolgt</Pill>;
    case 'cancelled':
      return <Pill tone="red">Avlyst</Pill>;
    case 'past':
      return <Pill tone="neutral">Ferdig</Pill>;
    case 'ended':
      return <Pill tone="neutral">Salget er over</Pill>;
    case 'draft':
      return <Pill tone="orange">Utkast</Pill>;
    case 'upcoming':
      return <Pill tone="tint">{event.salesStartAt ? `Salg ${formatRelativeDay(event.salesStartAt).toLowerCase()} ${formatTime(event.salesStartAt)}` : 'Salget åpner snart'}</Pill>;
    default:
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className={cn('font-semibold tabular text-label', compact ? 'text-subhead' : 'text-callout')}>
            {event.priceFromOre === null ? '' : event.priceFromOre === 0 ? 'Gratis' : `Fra ${formatNok(event.priceFromOre)}`}
          </span>
          {event.lowAvailability && <Pill tone="orange">Få igjen</Pill>}
        </span>
      );
  }
}

/** Large featured card (App Store "Today" style). */
export function HeroCard({ event, className }: { event: EventCard; className?: string }) {
  return (
    <Link
      to={`/e/${event.slug}`}
      className={cn('press group relative block aspect-[4/5] overflow-hidden rounded-[26px] no-underline shadow-[var(--card-shadow)] sm:aspect-[16/11]', className)}
    >
      <EventImage poster={event.poster} coverUrl={event.coverUrl} title={event.title} className="absolute inset-0" eager />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0)_35%,rgba(0,0,0,0.78)_100%)]" aria-hidden="true" />
      <div className="absolute left-3.5 top-3.5">
        <DateStamp iso={event.startsAt} />
      </div>
      {event.ageLimit ? (
        <div className="absolute right-3.5 top-3.5">
          <Pill tone="glass">{event.ageLimit} år</Pill>
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-0 p-5 text-white">
        <h3 className="display text-[clamp(1.4rem,7vw,1.75rem)] leading-[1.02] text-white [text-wrap:balance] [overflow-wrap:anywhere] hyphens-auto">{event.title}</h3>
        <p className="mt-2 flex items-center gap-1 text-subhead text-white/90">
          <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            {formatTime(event.startsAt)} · {event.venueName}, {event.city}
          </span>
        </p>
        <div className="mt-3 flex items-center gap-2">
          <span className="glass-clear rounded-full px-3 py-1.5 text-subhead font-semibold">
            {event.saleState === 'on_sale'
              ? event.priceFromOre === 0
                ? 'Gratis'
                : event.priceFromOre !== null
                  ? `Fra ${formatNok(event.priceFromOre)}`
                  : 'Kjøp billett'
              : event.saleState === 'sold_out'
                ? 'Utsolgt'
                : event.saleState === 'upcoming'
                  ? 'Billettslipp snart'
                  : event.saleState === 'cancelled'
                    ? 'Avlyst'
                    : 'Se detaljer'}
          </span>
          {event.lowAvailability && <span className="rounded-full bg-[var(--orange-fill)] px-3 py-1.5 text-subhead font-semibold text-black">Få igjen</span>}
        </div>
      </div>
    </Link>
  );
}

/** Poster tile for horizontal rows. */
export function TileCard({ event, className }: { event: EventCard; className?: string }) {
  return (
    <Link to={`/e/${event.slug}`} className={cn('press group block w-[168px] shrink-0 no-underline sm:w-[190px]', className)}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-[18px] shadow-[var(--card-shadow)]">
        <EventImage poster={event.poster} coverUrl={event.coverUrl} title={event.title} className="absolute inset-0" />
        <div className="absolute left-2 top-2">
          <DateStamp iso={event.startsAt} />
        </div>
        {(event.saleState === 'sold_out' || event.saleState === 'cancelled') && (
          <div className="absolute inset-x-2 bottom-2">
            <Pill tone="dark">{event.saleState === 'sold_out' ? 'Utsolgt' : 'Avlyst'}</Pill>
          </div>
        )}
      </div>
      <h3 className="mt-2 line-clamp-2 text-subhead font-semibold leading-snug text-label">{event.title}</h3>
      <p className="mt-0.5 truncate text-footnote text-label-2">
        {formatTime(event.startsAt)} · {event.city}
      </p>
      <div className="mt-1">
        <SaleStatus event={event} compact />
      </div>
    </Link>
  );
}

/** Compact list row. */
export function RowCard({ event, className, trailing }: { event: EventCard; className?: string; trailing?: React.ReactNode }) {
  return (
    <Link to={`/e/${event.slug}`} className={cn('flex items-center gap-3 px-4 py-3 no-underline transition-colors hover:bg-fill-4 active:bg-fill-3', className)}>
      <EventImage poster={event.poster} coverUrl={event.coverUrl} title={event.title} className="h-[76px] w-[62px] shrink-0 rounded-[12px]" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-headline font-semibold text-label">{event.title}</h3>
        <p className="truncate text-subhead font-medium text-tint tabular">
          {formatDateShort(event.startsAt)} · {formatTime(event.startsAt)}
        </p>
        <p className="flex items-center gap-1 text-subhead text-label-2">
          <span className="truncate">
            {event.venueName}, {event.city}
          </span>
          {event.organizerVerified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-tint" aria-label="Verifisert arrangør" />}
        </p>
        <div className="mt-1">{trailing ?? <SaleStatus event={event} compact />}</div>
      </div>
    </Link>
  );
}

/** Upcoming ticket drop with live countdown. */
export function CountdownCard({ event, className }: { event: EventCard; className?: string }) {
  const now = useNow(1000);
  const ms = event.salesStartAt ? new Date(event.salesStartAt).getTime() - now.getTime() : 0;
  return (
    <Link to={`/e/${event.slug}`} className={cn('press relative block w-[280px] shrink-0 overflow-hidden rounded-[22px] no-underline shadow-[var(--card-shadow)]', className)}>
      <EventImage poster={event.poster} coverUrl={event.coverUrl} title={event.title} className="h-[150px] w-full" />
      <div className="absolute inset-x-0 top-0 h-[150px] bg-[linear-gradient(180deg,rgba(0,0,0,0)_30%,rgba(0,0,0,0.65)_100%)]" aria-hidden="true" />
      <div className="absolute inset-x-0 top-[96px] px-4 text-white">
        <p className="text-footnote font-semibold text-white/85">{ms > 0 ? 'Billettsalget åpner om' : 'Billettsalget har åpnet'}</p>
        <p className="display text-[1.5rem] leading-none tabular text-white" style={{ fontStretch: '100%' }} aria-live="off">
          {ms > 0 ? formatCountdown(ms) : 'Nå!'}
        </p>
      </div>
      <div className="bg-grouped-2 px-4 py-3">
        <h3 className="truncate text-headline font-semibold text-label">{event.title}</h3>
        <p className="truncate text-subhead text-label-2">
          {formatDateShort(event.startsAt)} · {event.city}
        </p>
      </div>
    </Link>
  );
}
