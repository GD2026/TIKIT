import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarX, Star } from 'lucide-react';
import type { AdminEventRow } from '../../server/services/admin';
import { formatNok } from '../../shared/money';
import { formatDateShort } from '../../shared/time';
import { useApi } from '../app/context';
import { errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { SearchField } from '../components/ui/Field';
import { EmptyState, Pill } from '../components/ui/Feedback';
import { IconButton } from '../components/ui/Button';
import { ListSkeleton, QueryError } from '../components/ui/States';
import { useToast } from '../components/ui/Overlays';
import { EventImage } from '../components/event/EventImage';
import { useDebounced } from '../lib/hooks';
import { eventStatusPill } from '../organizer/shared';
import { adminKey, useAdminQuery } from './shared';

export default function Events() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 250);
  const q = useAdminQuery<{ events: AdminEventRow[] }>(`/events${term ? `?q=${encodeURIComponent(term)}` : ''}`, { placeholderData: (p) => p });
  const [busy, setBusy] = useState<string | null>(null);
  const list = q.data?.events ?? [];

  const feature = async (row: AdminEventRow) => {
    setBusy(row.card.id);
    try {
      await api.post(`/admin/events/${row.card.id}/feature`, { featured: !row.card.featured });
      await qc.invalidateQueries({ queryKey: adminKey() });
      await qc.invalidateQueries({ queryKey: ['home'] });
      toast({ message: row.card.featured ? 'Fjernet fra forsiden' : 'Vises nå som utvalgt på forsiden', tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page title="Arrangementer" large wide>
      <div className="mx-4 mb-4">
        <SearchField value={search} onChange={setSearch} placeholder="Tittel, sted eller arrangør" label="Søk i arrangementer" />
      </div>
      {q.isLoading && <ListSkeleton rows={6} />}
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && list.length === 0 && <EmptyState icon={<CalendarX />} title="Ingen treff" />}
      {list.length > 0 && (
        <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
          {list.map((r) => {
            const pill = eventStatusPill(r.card.status, r.card.saleState);
            return (
              <div key={r.card.id} className="flex items-center gap-3 px-4 py-3">
                <EventImage poster={r.card.poster} coverUrl={r.card.coverUrl} title={r.card.title} className="h-14 w-12 shrink-0 rounded-[10px]" />
                <Link to={`/e/${r.card.slug}`} className="min-w-0 flex-1 no-underline text-label">
                  <p className="truncate text-body font-medium">{r.card.title}</p>
                  <p className="truncate text-footnote text-label-2 tabular">
                    {r.card.organizerName} · {formatDateShort(r.card.startsAt)} · {r.sold}/{r.capacity} · {formatNok(r.gmvOre)}
                  </p>
                </Link>
                <Pill tone={pill.tone}>{pill.label}</Pill>
                <IconButton label={r.card.featured ? 'Fjern fra utvalgt' : 'Vis som utvalgt'} variant={r.card.featured ? 'tinted' : 'gray'} disabled={busy === r.card.id} onClick={() => void feature(r)} aria-pressed={r.card.featured}>
                  <Star className={r.card.featured ? 'h-4 w-4 fill-current' : 'h-4 w-4'} />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}
