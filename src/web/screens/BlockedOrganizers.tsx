import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff } from 'lucide-react';
import { useApi } from '../app/context';
import { type ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { EmptyState } from '../components/ui/Feedback';
import { Row, Section } from '../components/ui/List';
import { Button } from '../components/ui/Button';
import { ListSkeleton, QueryError, RequireLogin } from '../components/ui/States';
import { useToast } from '../components/ui/Overlays';

/** Organizers this person has hidden (services/moderation.ts). Their events stay out of Utforsk and Søk. */
function BlockedList() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery<{ organizers: { id: string; slug: string; name: string }[] }, ApiError>({
    queryKey: ['blocked'],
    queryFn: () => api.get('/me/blocked'),
  });

  const unblock = async (id: string, name: string) => {
    setBusy(id);
    try {
      await api.del(`/organizers/${id}/block`);
      await qc.invalidateQueries({ queryKey: ['blocked'] });
      await qc.invalidateQueries({ queryKey: ['home'] });
      await qc.invalidateQueries({ queryKey: ['events'] });
      await qc.invalidateQueries({ queryKey: ['organizer'] });
      toast({ message: `${name} vises igjen`, tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <ListSkeleton rows={3} />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  const list = q.data?.organizers ?? [];
  if (list.length === 0)
    return <EmptyState icon={<EyeOff />} title="Ingen skjulte arrangører" message="Du kan skjule en arrangør fra arrangørsiden. Da vises ikke arrangementene deres i Utforsk og Søk." />;
  return (
    <Section className="mx-4" footer="Arrangementene til skjulte arrangører vises ikke i Utforsk og Søk for deg.">
      {list.map((o) => (
        <Row
          key={o.id}
          title={o.name}
          accessory={
            <Button size="sm" variant="gray" loading={busy === o.id} onClick={() => void unblock(o.id, o.name)}>
              Vis igjen
            </Button>
          }
        />
      ))}
    </Section>
  );
}

export default function BlockedOrganizers() {
  return (
    <Page title="Skjulte arrangører" back="/profil">
      <RequireLogin>
        <BlockedList />
      </RequireLogin>
    </Page>
  );
}
