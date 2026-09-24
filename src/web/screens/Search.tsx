import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { MapPin, SearchX } from 'lucide-react';
import { CATEGORIES, CATEGORY_IDS, type CategoryId } from '../../shared/constants';
import { useEvents } from '../api/hooks';
import { Page } from '../components/layout/Page';
import { SearchField } from '../components/ui/Field';
import { Chip, EmptyState } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { ListSkeleton, QueryError } from '../components/ui/States';
import { RowCard } from '../components/event/EventCards';
import { CityPickerSheet } from '../components/event/CityPicker';
import { useDebounced } from '../lib/hooks';
import { cn } from '../lib/cn';

const WHEN = [
  { id: 'today', label: 'I dag' },
  { id: 'weekend', label: 'Denne helgen' },
] as const;
type WhenId = (typeof WHEN)[number]['id'];

function isCategory(v: string | null): v is CategoryId {
  return !!v && (CATEGORY_IDS as readonly string[]).includes(v);
}
function isWhen(v: string | null): v is WhenId {
  return !!v && WHEN.some((w) => w.id === v);
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [cityOpen, setCityOpen] = useState(false);
  const debounced = useDebounced(q.trim(), 250);

  const kategori = params.get('kategori');
  const category = isCategory(kategori) ? kategori : undefined;
  const nar = params.get('nar');
  const when = isWhen(nar) ? nar : undefined;
  const city = params.get('by') || undefined;

  const setParam = (key: string, value: string | undefined) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  // Keep the search term in the URL so results can be shared and survive reloads.
  const paramQ = params.get('q') ?? '';
  useEffect(() => {
    if (paramQ !== debounced) setParam('q', debounced || undefined);
    // Only when the typed term settles – not when the URL changes for other reasons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const filtered = !!(debounced || category || city || when);
  const results = useEvents({ q: debounced || undefined, category, city, when, limit: '100' });
  const events = results.data?.events ?? [];

  const reset = () => {
    setQ('');
    setParams(new URLSearchParams(), { replace: true });
  };

  return (
    <Page title="Søk" large wide>
      <div className="px-4 pb-3">
        <SearchField value={q} onChange={setQ} placeholder="Arrangement, sted eller arrangør" label="Søk etter arrangementer" />
      </div>

      <div className="no-scrollbar mb-1 flex gap-2 overflow-x-auto px-4 py-1" role="group" aria-label="Filtre">
        <Chip selected={!!city} onClick={() => setCityOpen(true)} icon={<MapPin />}>
          {city ?? 'Alle byer'}
        </Chip>
        {WHEN.map((w) => (
          <Chip key={w.id} selected={when === w.id} onClick={() => setParam('nar', when === w.id ? undefined : w.id)}>
            {w.label}
          </Chip>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2 px-4 py-1" role="group" aria-label="Kategori">
        {CATEGORIES.filter((c) => c.id !== 'annet').map((c) => (
          <Chip key={c.id} selected={category === c.id} onClick={() => setParam('kategori', category === c.id ? undefined : c.id)}>
            {c.label}
          </Chip>
        ))}
      </div>

      <section aria-labelledby="treff">
        <div className="flex items-baseline justify-between px-4 pb-2.5">
          <h2 id="treff" className="text-title2 font-bold">
            {filtered ? 'Treff' : 'Alle kommende'}
          </h2>
          {results.data && (
            <span className="text-subhead text-label-2 tabular" aria-live="polite">
              {events.length === 1 ? '1 arrangement' : `${events.length} arrangementer`}
            </span>
          )}
        </div>
        {results.isLoading && <ListSkeleton rows={6} />}
        {results.isError && <QueryError error={results.error} onRetry={() => void results.refetch()} />}
        {results.data && events.length === 0 && (
          <EmptyState
            icon={<SearchX />}
            title="Ingen treff"
            message="Prøv et annet søkeord, en annen by eller færre filtre."
            action={
              <Button variant="tinted" onClick={reset}>
                Nullstill søket
              </Button>
            }
          />
        )}
        {events.length > 0 && (
          <div className={cn('mx-4 overflow-hidden rounded-md bg-grouped-2 transition-opacity', results.isPlaceholderData && 'opacity-60')}>
            {events.map((e, i) => (
              <RowCard key={e.id} event={e} className={i > 0 ? 'hairline-t' : undefined} />
            ))}
          </div>
        )}
      </section>

      <CityPickerSheet open={cityOpen} onClose={() => setCityOpen(false)} value={city ?? null} onChange={(c) => setParam('by', c ?? undefined)} />
    </Page>
  );
}
