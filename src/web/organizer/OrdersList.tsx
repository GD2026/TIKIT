import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListOrdered, Undo2 } from 'lucide-react';
import type { OrderDTO, OrderKind, OrderStatus, RefundEntry, SeatRef, TicketKind, TicketStatus } from '../../shared/types';
import { formatNok } from '../../shared/money';
import { formatDateShort, formatTime } from '../../shared/time';
import { useApi } from '../app/context';
import { ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { SearchField, TextField } from '../components/ui/Field';
import { EmptyState, Pill } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { Switch } from '../components/ui/Controls';
import { Sheet } from '../components/ui/Sheet';
import { ListSkeleton, QueryError, CenterSpinner } from '../components/ui/States';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { Receipt } from '../components/order/Receipt';
import { ORDER_STATUS, TICKET_STATUS } from '../lib/labels';
import { useDebounced } from '../lib/hooks';
import { cn } from '../lib/cn';
import { canManage, orgKey, useOrg, useOrgQuery } from './shared';

interface OrderRow {
  id: string;
  ref: string;
  kind: OrderKind;
  status: OrderStatus;
  buyerName: string;
  buyerEmail: string | null;
  tickets: number;
  totalOre: number;
  ticketOre: number;
  feeOre: number;
  refundedOre: number;
  discountCode: string | null;
  paymentMethod: OrderDTO['paymentMethod'];
  paidAt: string | null;
  createdAt: string;
}

interface OrderDetail {
  order: OrderDTO;
  refunds: RefundEntry[];
  tickets: { id: string; number: string; typeName: string; holderName: string; status: TicketStatus; kind: TicketKind; pricePaidOre: number; seat: SeatRef | null; checkedInAt: string | null; currentOrder: boolean }[];
}

function OrderSheet({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<string[]>([]);
  const [includeFees, setIncludeFees] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const q = useQuery<OrderDetail, ApiError>({ queryKey: orgKey(org.id, 'order', orderId), queryFn: () => api.get(`/org/${org.id}/orders/${orderId}`), enabled: !!orderId });

  const refundable = (q.data?.tickets ?? []).filter((t) => t.status === 'valid' || t.status === 'used');
  const selectedTickets = refundable.filter((t) => selected.includes(t.id));
  const estimate = selectedTickets.reduce((n, t) => n + t.pricePaidOre, 0);

  const refund = async () => {
    if (!q.data) return;
    const ok = await confirm({
      title: `Refundere ${selectedTickets.length === 1 ? '1 billett' : `${selectedTickets.length} billetter`}?`,
      message: `Omtrent ${formatNok(estimate)}${includeFees ? ' pluss servicegebyr' : ''} går tilbake til kjøperens betalingsmåte. Billettene slutter å virke med en gang.`,
      confirmLabel: 'Refunder',
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.post<{ refundedOre: number; tickets: number }>(`/org/${org.id}/orders/${q.data.order.id}/refund`, { ticketIds: selected, includeFees, reason: reason.trim() });
      toast({ message: `${formatNok(res.refundedOre)} er refundert`, tone: 'success' });
      setSelected([]);
      setReason('');
      await qc.invalidateQueries({ queryKey: orgKey(org.id) });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!orderId} onClose={onClose} locked={busy} title={q.data ? `Ordre ${q.data.order.ref}` : 'Ordre'} size="large">
      {q.isLoading && <CenterSpinner className="min-h-40" />}
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <div className="pb-4">
          <div className="mb-4 rounded-md bg-grouped-2 px-4 py-3">
            <p className="text-headline font-semibold">{q.data.order.buyer.name}</p>
            <p className="text-subhead text-label-2">{[q.data.order.buyer.email, q.data.order.buyer.phone].filter(Boolean).join(' · ') || 'Ingen kontaktinfo'}</p>
          </div>
          <h3 className="mb-1.5 px-4 text-footnote uppercase tracking-[0.02em] text-label-2">Billetter</h3>
          <div className="mb-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
            {q.data.tickets.map((t) => {
              const canPick = (t.status === 'valid' || t.status === 'used') && t.currentOrder;
              const s = TICKET_STATUS[t.status];
              return (
                <label key={t.id} className={cn('flex items-center gap-3 px-4 py-3', canPick && 'cursor-pointer')}>
                  <input
                    type="checkbox"
                    disabled={!canPick || busy}
                    checked={selected.includes(t.id)}
                    onChange={(e) => setSelected((prev) => (e.target.checked ? [...prev, t.id] : prev.filter((x) => x !== t.id)))}
                    className="h-5 w-5 accent-[var(--tint-fill)]"
                    aria-label={`Velg billett ${t.number}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body">
                      {t.holderName} · {t.typeName}
                    </span>
                    <span className="block text-footnote text-label-2 tabular">
                      {t.number}
                      {t.seat ? ` · ${t.seat.section}, rad ${t.seat.row}, sete ${t.seat.number}` : ''} · {formatNok(t.pricePaidOre)}
                      {!t.currentOrder ? ' · overført/solgt videre' : ''}
                    </span>
                  </span>
                  <Pill tone={s.tone}>{s.label}</Pill>
                </label>
              );
            })}
          </div>
          {refundable.length > 0 && (
            <div className="mb-5 rounded-md bg-grouped-2 p-4">
              <p className="text-headline font-semibold">Refusjon</p>
              <p className="mb-3 text-subhead text-label-2">Velg billettene over. Refusjonen går til kjøperens betalingsmåte.</p>
              <label className="mb-3 flex items-center justify-between gap-3">
                <span className="text-body">Refunder også servicegebyret</span>
                <Switch checked={includeFees} onChange={setIncludeFees} label="Refunder også servicegebyret" />
              </label>
              <TextField label="Begrunnelse (vises for kjøperen)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="mb-3" />
              <Button variant="destructive" full loading={busy} disabled={selected.length === 0} icon={<Undo2 className="h-4 w-4" />} onClick={() => void refund()}>
                {selected.length === 0 ? 'Velg billetter å refundere' : `Refunder ${selectedTickets.length} (${formatNok(estimate)}${includeFees ? ' + gebyr' : ''})`}
              </Button>
            </div>
          )}
          {q.data.refunds.length > 0 && (
            <>
              <h3 className="mb-1.5 px-4 text-footnote uppercase tracking-[0.02em] text-label-2">Refusjoner</h3>
              <ul className="mb-5 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
                {q.data.refunds.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block text-body">{r.reason || 'Refusjon'}</span>
                      <span className="block text-footnote text-label-2">
                        {formatDateShort(r.at)} kl. {formatTime(r.at)} · {r.ticketIds.length} billetter
                      </span>
                    </span>
                    <span className="shrink-0 text-body tabular">−{formatNok(r.amountOre)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <Receipt order={q.data.order} />
        </div>
      )}
    </Sheet>
  );
}

export default function OrdersList() {
  const { eventId } = useParams();
  const { org } = useOrg();
  const q = useOrgQuery<{ orders: OrderRow[] }>(org.id, `/events/${eventId}/orders`, { enabled: canManage(org.role) });
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const term = useDebounced(search.trim().toLowerCase(), 150);
  const rows = useMemo(() => {
    const all = q.data?.orders ?? [];
    if (!term) return all;
    return all.filter((o) => [o.ref, o.buyerName, o.buyerEmail ?? '', o.discountCode ?? ''].some((v) => v.toLowerCase().includes(term)));
  }, [q.data, term]);

  return (
    <Page title="Ordre" back={`/arrangor/${org.id}/arrangementer/${eventId}`} wide>
      {!canManage(org.role) ? (
        <QueryError error={new ApiError('forbidden', 'Du må være administrator for å se ordre.', 403)} />
      ) : (
        <>
          <div className="mx-4 mb-4">
            <SearchField value={search} onChange={setSearch} placeholder="Navn, e-post, ordrenr. eller kode" label="Søk i ordre" />
          </div>
          {q.isLoading && <ListSkeleton rows={6} />}
          {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
          {q.data && rows.length === 0 && <EmptyState icon={<ListOrdered />} title={term ? 'Ingen treff' : 'Ingen ordre ennå'} />}
          {rows.length > 0 && (
            <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
              {rows.map((o) => {
                const s = ORDER_STATUS[o.status];
                return (
                  <button key={o.id} type="button" onClick={() => setOpen(o.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fill-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium">{o.buyerName}</p>
                      <p className="truncate text-footnote text-label-2 tabular">
                        {o.ref} · {o.tickets} {o.tickets === 1 ? 'billett' : 'billetter'} · {formatDateShort(o.paidAt ?? o.createdAt)} {formatTime(o.paidAt ?? o.createdAt)}
                        {o.discountCode ? ` · ${o.discountCode}` : ''}
                        {o.kind === 'resale' ? ' · videresalg' : o.kind === 'comp' ? ' · gjest' : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-body font-semibold tabular">{formatNok(o.ticketOre)}</p>
                      {o.status !== 'paid' && <Pill tone={s.tone}>{s.label}</Pill>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <p className="mx-6 mt-3 text-footnote text-label-2">Beløpene viser billettpris etter rabatt. Servicegebyret går til TIKIT.</p>
          <OrderSheet orderId={open} onClose={() => setOpen(null)} />
        </>
      )}
    </Page>
  );
}
