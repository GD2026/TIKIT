import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { MapPin, Ticket as TicketIcon } from 'lucide-react';
import type { TicketDTO } from '../../shared/types';
import { formatRelativeDay, formatTime } from '../../shared/time';
import { useTickets } from '../api/hooks';
import { Page } from '../components/layout/Page';
import { SegmentedControl } from '../components/ui/Controls';
import { EmptyState, Pill, Skeleton } from '../components/ui/Feedback';
import { LinkButton } from '../components/ui/Button';
import { QueryError, RequireLogin } from '../components/ui/States';
import { EventImage } from '../components/event/EventImage';
import { passState } from '../components/ticket/TicketPass';
import { useNow } from '../lib/hooks';
import { cn } from '../lib/cn';

interface Group {
  eventId: string;
  tickets: TicketDTO[];
  first: TicketDTO;
  upcoming: boolean;
}

function groupTickets(tickets: TicketDTO[], now: number): Group[] {
  const map = new Map<string, TicketDTO[]>();
  for (const t of tickets) {
    const list = map.get(t.event.id) ?? [];
    list.push(t);
    map.set(t.event.id, list);
  }
  return [...map.values()].map((list) => {
    const usable = list.filter((t) => t.status === 'valid' || t.status === 'used');
    const first = usable[0] ?? list[0]!;
    const upcoming = new Date(first.event.endsAt).getTime() > now && usable.length > 0 && first.event.saleState !== 'cancelled';
    return { eventId: first.event.id, tickets: usable.length > 0 ? usable : list, first, upcoming };
  });
}

function countdownLabel(startsAt: string, endsAt: string, now: Date): string {
  const start = new Date(startsAt).getTime();
  if (start <= now.getTime() && new Date(endsAt).getTime() > now.getTime()) return 'Pågår nå';
  const rel = formatRelativeDay(startsAt, now);
  return `${rel} · ${formatTime(startsAt)}`;
}

function TicketStack({ group, now }: { group: Group; now: Date }) {
  const t = group.first;
  const e = t.event;
  const count = group.tickets.length;
  const state = passState(t, now.getTime());
  const note =
    state === 'transfer' ? 'Overføres' : state === 'resale' ? 'Til salgs' : state === 'used' ? 'Sjekket inn' : state === 'event_cancelled' ? 'Avlyst' : state === 'refunded' ? 'Refundert' : null;
  return (
    <Link to={`/billetter/${t.id}`} className="press group relative block no-underline" aria-label={`${e.title}, ${count === 1 ? '1 billett' : `${count} billetter`}`}>
      {count > 1 && (
        <>
          <span aria-hidden="true" className="absolute inset-x-6 -bottom-3 h-8 rounded-b-[22px] bg-fill-2" />
          {count > 2 && <span aria-hidden="true" className="absolute inset-x-10 -bottom-5 h-8 rounded-b-[22px] bg-fill-3" />}
        </>
      )}
      <div className="relative overflow-hidden rounded-[26px] shadow-[var(--card-shadow)]">
        <EventImage poster={e.poster} coverUrl={e.coverUrl} title={e.title} className="aspect-[16/10] w-full" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.05)_20%,rgba(0,0,0,0.78)_100%)]" aria-hidden="true" />
        <div className="absolute left-4 top-4 flex gap-2">
          <Pill tone="glass">{countdownLabel(e.startsAt, e.endsAt, now)}</Pill>
          {note && <Pill tone="glass">{note}</Pill>}
        </div>
        <div className="absolute inset-x-0 bottom-0 p-4 text-white">
          <h2 className="display text-[1.5rem] leading-[1.03] text-white [text-wrap:balance] [overflow-wrap:anywhere] hyphens-auto">{e.title}</h2>
          <div className="mt-1.5 flex items-center justify-between gap-3">
            <p className="flex min-w-0 items-center gap-1 text-subhead text-white/90">
              <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {e.venue.name}, {e.venue.city}
              </span>
            </p>
            <span className="glass-clear inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-subhead font-semibold">
              <TicketIcon className="h-4 w-4" aria-hidden="true" />
              {count}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function PastRow({ group }: { group: Group }) {
  const t = group.first;
  const e = t.event;
  const state = passState(t);
  return (
    <Link to={`/billetter/${t.id}`} className="flex items-center gap-3 px-4 py-3 no-underline text-label transition-colors hover:bg-fill-4">
      <EventImage poster={e.poster} coverUrl={e.coverUrl} title={e.title} className="h-14 w-12 shrink-0 rounded-[10px] grayscale-[35%]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-headline font-semibold">{e.title}</p>
        <p className="truncate text-subhead text-label-2">
          {formatRelativeDay(e.startsAt)} · {group.tickets.length === 1 ? '1 billett' : `${group.tickets.length} billetter`}
        </p>
      </div>
      <Pill tone={state === 'refunded' || state === 'event_cancelled' ? 'neutral' : state === 'used' ? 'green' : 'neutral'}>
        {state === 'used' ? 'Brukt' : state === 'refunded' ? 'Refundert' : state === 'event_cancelled' ? 'Avlyst' : 'Ferdig'}
      </Pill>
    </Link>
  );
}

function TicketsBody() {
  const q = useTickets();
  const now = useNow(30_000);
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const groups = useMemo(() => groupTickets(q.data?.tickets ?? [], now.getTime()), [q.data, now]);
  const upcoming = groups.filter((g) => g.upcoming).sort((a, b) => a.first.event.startsAt.localeCompare(b.first.event.startsAt));
  const past = groups.filter((g) => !g.upcoming).sort((a, b) => b.first.event.startsAt.localeCompare(a.first.event.startsAt));

  if (q.isLoading)
    return (
      <div className="flex flex-col gap-5 px-4 pt-2" aria-busy="true" aria-label="Laster billetter">
        <Skeleton className="aspect-[16/10] w-full rounded-[26px]" />
        <Skeleton className="aspect-[16/10] w-full rounded-[26px]" />
      </div>
    );
  if (q.isError && !q.data) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <>
      <div className="px-4 pb-5">
        <SegmentedControl
          label="Vis billetter"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'upcoming', label: 'Kommende', badge: upcoming.length || undefined },
            { value: 'past', label: 'Tidligere' },
          ]}
        />
      </div>
      {tab === 'upcoming' &&
        (upcoming.length === 0 ? (
          <EmptyState
            icon={<TicketIcon />}
            title="Ingen kommende billetter"
            message="Billettene du kjøper eller får overført havner her – klare til å vises i døra, også uten nett."
            action={<LinkButton to="/">Finn noe å gå på</LinkButton>}
          />
        ) : (
          <div className={cn('grid gap-8 px-4 pb-4 sm:grid-cols-2')}>
            {upcoming.map((g) => (
              <TicketStack key={g.eventId} group={g} now={now} />
            ))}
          </div>
        ))}
      {tab === 'past' &&
        (past.length === 0 ? (
          <EmptyState icon={<TicketIcon />} title="Ingen tidligere billetter" message="Billetter til arrangementer som er ferdige, vises her." />
        ) : (
          <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
            {past.map((g) => (
              <PastRow key={g.eventId} group={g} />
            ))}
          </div>
        ))}
    </>
  );
}

export default function Tickets() {
  return (
    <Page title="Billetter" large>
      <RequireLogin reason="Logg inn for å se billettene dine. De ligger trygt på kontoen, også om du bytter telefon." icon={<TicketIcon />}>
        <TicketsBody />
      </RequireLogin>
    </Page>
  );
}
