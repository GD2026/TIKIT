import type { OrderDTO } from '../../../shared/types';
import { formatNok } from '../../../shared/money';
import { formatDateShort, formatTime } from '../../../shared/time';
import { useConfig } from '../../api/hooks';

export function paymentMethodLabel(m: OrderDTO['paymentMethod']): string {
  switch (m) {
    case 'vipps':
      return 'Vipps';
    case 'card':
      return 'Kort';
    case 'free':
      return 'Gratis';
    case 'comp':
      return 'Gjestebillett';
    default:
      return '–';
  }
}

export function Receipt({ order }: { order: OrderDTO }) {
  const op = useConfig().data?.operator;
  const rows: [string, string][] = [
    ['Ordrenummer', order.ref],
    ['Dato', order.paidAt ? `${formatDateShort(order.paidAt)} ${formatTime(order.paidAt)}` : `${formatDateShort(order.createdAt)} ${formatTime(order.createdAt)}`],
    ['Betalt med', paymentMethodLabel(order.paymentMethod)],
    ['Selger', `${order.organizer.name}${order.organizer.orgNumber ? `, org.nr. ${order.organizer.orgNumber}` : ''}`],
    // Help and the terms tell buyers the organizer's contact details are on the receipt.
    ...(order.organizer.email ? [['Kontakt arrangør', order.organizer.email] as [string, string]] : []),
    ['Formidler', op && op.name !== 'TIKIT' ? `TIKIT (${op.name}${op.orgNumber ? `, org.nr. ${op.orgNumber}` : ''})` : 'TIKIT'],
  ];
  return (
    <section aria-labelledby="kvittering" className="mb-6">
      <h2 id="kvittering" className="mb-1.5 px-8 text-footnote uppercase tracking-[0.02em] text-label-2">
        Kvittering
      </h2>
      <div className="mx-4 rounded-md bg-grouped-2 px-4 py-2">
        {order.items.map((i) => (
          <div key={i.ticketTypeId} className="flex justify-between gap-4 py-1.5 text-body">
            <span>
              {i.qty} × {i.name}
            </span>
            <span className="tabular">{formatNok(i.qty * i.listPriceOre)}</span>
          </div>
        ))}
        {order.seats.length > 0 && <p className="pb-1.5 text-subhead text-label-2">{order.seats.map((s) => `${s.section}, rad ${s.row}, sete ${s.number}`).join(' · ')}</p>}
        <div className="hairline-t mt-1 pt-1.5">
          {order.discountOre > 0 && (
            <div className="flex justify-between gap-4 py-1 text-body text-green">
              <span>Rabatt ({order.discount?.code})</span>
              <span className="tabular">−{formatNok(order.discountOre)}</span>
            </div>
          )}
          {order.feeOre > 0 && (
            <div className="flex justify-between gap-4 py-1 text-body text-label-2">
              <span>Servicegebyr</span>
              <span className="tabular">{formatNok(order.feeOre)}</span>
            </div>
          )}
          <div className="flex justify-between gap-4 py-2 text-headline font-semibold">
            <span>Totalt</span>
            <span className="tabular">{order.totalOre === 0 ? 'Gratis' : formatNok(order.totalOre)}</span>
          </div>
          {order.refundedOre > 0 && (
            <div className="flex justify-between gap-4 pb-2 text-body text-green">
              <span>Refundert</span>
              <span className="tabular">−{formatNok(order.refundedOre)}</span>
            </div>
          )}
          <p className="pb-2 text-footnote text-label-2 tabular">
            Herav mva.: billetter {formatNok(order.vat.ticketsVatOre)}, gebyr {formatNok(order.vat.feeVatOre)}
          </p>
        </div>
        <dl className="hairline-t py-2">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 py-1 text-subhead">
              <dt className="text-label-2">{k}</dt>
              <dd className="min-w-0 text-right [overflow-wrap:anywhere]">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

