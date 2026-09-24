import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UserX } from 'lucide-react';
import type { AdminUserRow } from '../../server/services/admin';
import { formatAgo, formatDateShort } from '../../shared/time';
import { useApi } from '../app/context';
import { errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { SearchField } from '../components/ui/Field';
import { EmptyState, Pill } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { Avatar } from '../components/ui/Avatar';
import { ListSkeleton, QueryError } from '../components/ui/States';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { useDebounced } from '../lib/hooks';
import { adminKey, useAdminQuery } from './shared';

export default function Users() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const term = useDebounced(search.trim(), 250);
  const q = useAdminQuery<{ users: AdminUserRow[] }>(`/users${term ? `?q=${encodeURIComponent(term)}` : ''}`, { placeholderData: (p) => p });
  const [busy, setBusy] = useState<string | null>(null);
  const list = q.data?.users ?? [];

  const toggleBan = async (u: AdminUserRow) => {
    const ok = await confirm({
      title: u.banned ? `Oppheve sperringen av ${u.name}?` : `Sperre ${u.name}?`,
      message: u.banned ? 'Personen kan logge inn og kjøpe igjen.' : 'Personen logges ut og kan ikke logge inn eller kjøpe. Billetter de har, gjelder fortsatt.',
      confirmLabel: u.banned ? 'Opphev' : 'Sperr',
      destructive: !u.banned,
    });
    if (!ok) return;
    setBusy(u.id);
    try {
      await api.post(`/admin/users/${u.id}/ban`, { banned: !u.banned });
      await qc.invalidateQueries({ queryKey: adminKey() });
      toast({ message: u.banned ? 'Sperringen er opphevet' : 'Brukeren er sperret', tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page title="Brukere" large wide>
      <div className="mx-4 mb-4">
        <SearchField value={search} onChange={setSearch} placeholder="Navn, e-post eller mobil" label="Søk i brukere" />
      </div>
      {q.isLoading && <ListSkeleton rows={6} />}
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && list.length === 0 && <EmptyState icon={<UserX />} title="Ingen treff" />}
      {list.length > 0 && (
        <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
          {list.map((u) => (
            <div key={u.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={u.name} size={36} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 truncate text-body font-medium">
                  {u.name}
                  {u.role === 'admin' && <Pill tone="tint">Admin</Pill>}
                  {u.banned && <Pill tone="red">Sperret</Pill>}
                </p>
                <p className="truncate text-footnote text-label-2">
                  {[u.email, u.phone].filter(Boolean).join(' · ') || 'Ingen kontaktinfo'} · {u.providers.join(', ')} · {u.tickets} billetter · {u.lastLoginAt ? `sist inne ${formatAgo(u.lastLoginAt)}` : `siden ${formatDateShort(u.createdAt)}`}
                </p>
              </div>
              {u.role !== 'admin' && (
                <Button size="sm" variant={u.banned ? 'gray' : 'destructive'} loading={busy === u.id} onClick={() => void toggleBan(u)}>
                  {u.banned ? 'Opphev' : 'Sperr'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </Page>
  );
}
