import { useState } from 'react';
import { Link } from 'react-router';
import { CalendarPlus, Plus } from 'lucide-react';
import type { OrgEventSummary } from '../../server/services/events';
import { formatNok } from '../../shared/money';
import { formatDateShort, formatTime } from '../../shared/time';
import { Page } from '../components/layout/Page';
import { SegmentedControl } from '../components/ui/Controls';
import { EmptyState, Pill } from '../components/ui/Feedback';
import { LinkButton } from '../components/ui/Button';
import { ListSkeleton, QueryError } from '../components/ui/States';
import { EventImage } from '../components/event/EventImage';
import { Meter } from '../components/charts/Charts';
import { canManage, eventStatusPill, useOrg, useOrgQuery } from './shared';

type Tab = 'upcoming' | 'drafts' | 'past';

export default function EventsList() {
  const { org } = useOrg();
  const q = useOrgQuery<{ events: OrgEventSummary[] }>(org.id, '/events');
  const [tab, setTab] = useState<Tab>('upcoming');
  const manage = canManage(org.role);
  const now = new Date().toISOString();
  const all = q.data?.events ?? [];
  const lists: Record<Tab, OrgEventSummary[]> = {
    upcoming: all.filter((e) => e.card.status === 'published' && e.card.endsAt > now).sort((a, b) => a.card.startsAt.localeCompare(b.card.startsAt)),
    drafts: all.filter((e) => e.card.status === 'draft').sort((a, b) => a.card.startsAt.localeCompare(b.card.startsAt)),
    past: all.filter((e) => e.card.status === 'cancelled' || (e.card.status === 'published' && e.card.endsAt <= now)).sort((a, b) => b.card.startsAt.localeCompare(a.card.startsAt)),
  };
  const list = lists[tab];

  return (
    <Page
      title="Arrangementer"
      large
      wide
      largeAccessory={
        manage ? (
          <LinkButton to={`/arrangor/${org.id}/arrangementer/ny`} size="sm" icon={<Plus className="h-4 w-4" />} className="mb-1">
            Nytt
          </LinkButton>
        ) : undefined
      }
    >
      <div className="mx-4 mb-4 max-w-md">
        <SegmentedControl
          label="Vis arrangementer"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'upcoming', label: 'Kommende', badge: undefined },
            { value: 'drafts', label: 'Utkast', badge: lists.drafts.length || undefined },
            { value: 'past', label: 'Tidligere' },
          ]}
        />
      </div>
      {q.isLoading && <ListSkeleton rows={4} />}
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && list.length === 0 && (
        <EmptyState
          icon={<CalendarPlus />}
          title={tab === 'drafts' ? 'Ingen utkast' : tab === 'past' ? 'Ingen tidligere arrangementer' : 'Ingen kommende arrangementer'}
          message={tab === 'upcoming' ? 'Publiserte arrangementer som ikke er ferdige, vises her.' : undefined}
          action={manage && tab !== 'past' ? <LinkButton to={`/arrangor/${org.id}/arrangementer/ny`}>Nytt arrangement</LinkButton> : undefined}
        />
      )}
      {list.length > 0 && (
        <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
          {list.map((e) => {
            const pill = eventStatusPill(e.card.status, e.card.saleState);
            return (
              <Link key={e.card.id} to={`/arrangor/${org.id}/arrangementer/${e.card.id}`} className="flex gap-3 px-4 py-3 no-underline text-label transition-colors hover:bg-fill-4">
                <EventImage poster={e.card.poster} coverUrl={e.card.coverUrl} title={e.card.title} className="h-[76px] w-[62px] shrink-0 rounded-[12px]" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-headline font-semibold">{e.card.title}</p>
                  <p className="text-footnote text-label-2">
                    {formatDateShort(e.card.startsAt)} kl. {formatTime(e.card.startsAt)} · {e.card.venueName}
                  </p>
                  <Meter value={e.sold} max={Math.max(e.capacity, e.sold)} label={`Solgt for ${e.card.title}`} className="mt-2" showText={false} />
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Pill tone={pill.tone}>{pill.label}</Pill>
                    <span className="text-footnote text-label-2 tabular">
                      {e.sold} / {e.capacity} solgt
                      {e.checkedIn > 0 ? ` · ${e.checkedIn} inne` : ''}
                      {manage ? ` · ${formatNok(e.revenueOre)}` : ''}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </Page>
  );
}
