import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Heart } from 'lucide-react';
import { useApi } from '../app/context';
import { qk, useFavorites } from '../api/hooks';
import { errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { EmptyState } from '../components/ui/Feedback';
import { LinkButton } from '../components/ui/Button';
import { ListSkeleton, QueryError, RequireLogin } from '../components/ui/States';
import { RowCard } from '../components/event/EventCards';
import { useToast } from '../components/ui/Overlays';

function FavoriteList() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useFavorites();
  const [busy, setBusy] = useState<string | null>(null);

  const remove = async (id: string) => {
    setBusy(id);
    try {
      await api.del(`/events/${id}/favorite`);
      await qc.invalidateQueries({ queryKey: qk.favorites });
      await qc.invalidateQueries({ queryKey: ['event'] });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  const events = q.data?.events ?? [];
  if (events.length === 0)
    return (
      <EmptyState
        icon={<Heart />}
        title="Ingen favoritter ennå"
        message="Trykk på hjertet på et arrangement for å lagre det her."
        action={<LinkButton to="/">Utforsk arrangementer</LinkButton>}
      />
    );
  return (
    <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
      {events.map((e) => (
        <div key={e.id} className="relative">
          <RowCard event={e} className="pr-16" />
          <button
            type="button"
            onClick={() => void remove(e.id)}
            disabled={busy === e.id}
            aria-label={`Fjern ${e.title} fra favoritter`}
            className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-red disabled:opacity-40"
          >
            <Heart className="h-5 w-5 fill-[var(--red-fill)]" />
          </button>
        </div>
      ))}
    </div>
  );
}

export default function Favorites() {
  return (
    <Page title="Favoritter" back="/profil">
      <RequireLogin>
        <FavoriteList />
      </RequireLogin>
    </Page>
  );
}
