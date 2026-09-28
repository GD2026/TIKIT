import { Link } from 'react-router';
import { Receipt } from 'lucide-react';
import { formatNok } from '../../shared/money';
import { formatDateShort } from '../../shared/time';
import { useMyOrders } from '../api/hooks';
import { Page } from '../components/layout/Page';
import { EmptyState, Pill } from '../components/ui/Feedback';
import { ListSkeleton, QueryError, RequireLogin } from '../components/ui/States';
import { EventImage } from '../components/event/EventImage';
import { ORDER_STATUS } from '../lib/labels';

function Orders() {
  const q = useMyOrders();
  if (q.isLoading) return <ListSkeleton rows={4} />;
  if (q.isError) return <QueryError error={q.error} onRetry={() => void q.refetch()} />;
  const orders = (q.data?.orders ?? []).filter((o) => o.status !== 'expired' || o.paidAt);
  if (orders.length === 0) return <EmptyState icon={<Receipt />} title="Ingen kjøp ennå" message="Kvitteringer for alt du kjøper i TIKIT samles her." />;
  return (
    <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
      {orders.map((o) => {
        const s = ORDER_STATUS[o.status];
        const to = o.status === 'reserved' || o.status === 'pending_payment' ? `/kasse/${o.id}` : `/ordre/${o.id}`;
        const qty = o.items.reduce((n, i) => n + i.qty, 0);
        return (
          <Link key={o.id} to={to} className="flex items-center gap-3 px-4 py-3 no-underline text-label transition-colors hover:bg-fill-4">
            <EventImage poster={o.event.poster} coverUrl={o.event.coverUrl} title={o.event.title} className="h-14 w-12 shrink-0 rounded-[10px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-headline font-semibold">{o.event.title}</p>
              <p className="truncate text-subhead text-label-2 tabular">
                {formatDateShort(o.paidAt ?? o.createdAt)} · {qty === 1 ? '1 billett' : `${qty} billetter`} · {o.totalOre === 0 ? 'Gratis' : formatNok(o.totalOre)}
              </p>
            </div>
            <Pill tone={s.tone}>{s.label}</Pill>
          </Link>
        );
      })}
    </div>
  );
}

export default function PurchaseHistory() {
  return (
    <Page title="Kjøpshistorikk" back="/profil">
      <RequireLogin>
        <Orders />
      </RequireLogin>
    </Page>
  );
}
