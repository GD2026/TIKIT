import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { CalendarPlus, CircleAlert, Clock, Ticket } from 'lucide-react';
import type { OrderDTO } from '../../shared/types';
import { formatEventWhen } from '../../shared/time';
import { useApi } from '../app/context';
import { qk, useOrder } from '../api/hooks';
import { Page } from '../components/layout/Page';
import { EventImage } from '../components/event/EventImage';
import { Button, LinkButton } from '../components/ui/Button';
import { EmptyState, Pill, Spinner } from '../components/ui/Feedback';
import { Receipt } from '../components/order/Receipt';
import { ORDER_STATUS } from '../lib/labels';
import { CenterSpinner, QueryError, RequireLogin } from '../components/ui/States';
import { apiUrl, canDownload, googleCalendarUrl } from '../lib/links';
import { isIOS } from '../lib/device';
import { haptic } from '../lib/haptics';


function SuccessMark() {
  const reduced = useReducedMotion();
  return (
    <div className="relative mx-auto h-24 w-24" aria-hidden="true">
      <motion.div
        className="absolute inset-0 rounded-full bg-green-fill"
        initial={reduced ? false : { scale: 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 14, stiffness: 260 }}
      />
      <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full">
        <motion.path
          d="M14 25l7 7 13-15"
          fill="none"
          stroke="#fff"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ delay: 0.2, duration: 0.45, ease: 'easeOut' }}
        />
      </svg>
    </div>
  );
}

function OrderBody({ orderId }: { orderId: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const returning = params.get('retur') === '1';
  const orderQ = useOrder(orderId);
  const order = orderQ.data;
  const [polling, setPolling] = useState(false);
  const attempts = useRef(0);
  const celebrated = useRef(false);

  // After returning from the payment provider, ask it for the result until it settles.
  useEffect(() => {
    if (!order || order.status !== 'pending_payment') {
      setPolling(false);
      return;
    }
    setPolling(true);
    let cancelled = false;
    const tick = async () => {
      if (cancelled || attempts.current > 40) {
        setPolling(false);
        return;
      }
      attempts.current++;
      try {
        const o = await api.post<OrderDTO>(`/orders/${orderId}/sync`);
        if (cancelled) return;
        qc.setQueryData(qk.order(orderId), o);
        if (o.status !== 'pending_payment') return;
      } catch {
        /* keep trying */
      }
      window.setTimeout(() => void tick(), Math.min(1000 + attempts.current * 400, 5000));
    };
    void tick();
    return () => {
      cancelled = true;
    };
    // Restarts only when the status changes, not on every refetch of the same order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.status, orderId, api, qc]);

  useEffect(() => {
    if (order?.status === 'paid' && !celebrated.current) {
      celebrated.current = true;
      if (returning) haptic('success');
      void qc.invalidateQueries({ queryKey: qk.tickets });
      void qc.invalidateQueries({ queryKey: qk.myOrders });
      void qc.invalidateQueries({ queryKey: qk.me });
    }
  }, [order?.status, returning, qc]);

  if (orderQ.isLoading) return <CenterSpinner />;
  if (orderQ.isError || !order) return <QueryError error={orderQ.error} onRetry={() => void orderQ.refetch()} notFound={<EmptyState title="Fant ikke bestillingen" />} />;

  const e = order.event;
  const ticketsLink = order.ticketIds.length === 1 ? `/billetter/${order.ticketIds[0]}` : '/billetter';

  let hero: React.ReactNode = null;
  if (order.status === 'pending_payment') {
    hero = (
      <div className="px-6 py-10 text-center" role="status">
        <Spinner size={36} />
        <h2 className="mt-5 text-title2 font-bold">Bekrefter betalingen …</h2>
        <p className="mt-2 text-body text-label-2">Dette tar vanligvis bare noen sekunder. Du trenger ikke gjøre noe.</p>
        {!polling && (
          <Button className="mt-6" variant="tinted" onClick={() => navigate(`/kasse/${order.id}`)}>
            Til kassen
          </Button>
        )}
      </div>
    );
  } else if (order.status === 'paid' || order.status === 'partially_refunded') {
    hero = (
      <div className="px-6 pb-8 pt-6 text-center">
        {returning && order.status === 'paid' ? <SuccessMark /> : null}
        <h2 className="mt-5 text-title1 font-bold">{returning ? 'Kjøpet er fullført!' : 'Billettene er dine'}</h2>
        <p className="mx-auto mt-2 max-w-sm text-body text-label-2">
          {order.ticketIds.length === 1 ? 'Billetten ligger klar i appen.' : `${order.ticketIds.length} billetter ligger klare i appen.`}
          {order.buyer.email ? ` Kvitteringen er sendt til ${order.buyer.email}.` : ''}
        </p>
        <div className="mx-auto mt-6 flex max-w-sm flex-col gap-3">
          <LinkButton to={ticketsLink} size="lg" full icon={<Ticket className="h-5 w-5" />}>
            {order.ticketIds.length === 1 ? 'Vis billetten' : 'Vis billettene'}
          </LinkButton>
          {/* Same rule as on the ticket: a calendar file on Apple devices (opens Calendar), Google Calendar elsewhere. */}
          {canDownload && order.ticketIds[0] && (isIOS() || /Mac/.test(navigator.platform)) ? (
            <a
              href={apiUrl(`/tickets/${order.ticketIds[0]}/calendar.ics`)}
              className="press inline-flex h-[52px] items-center justify-center gap-2 rounded-full bg-fill-3 text-headline font-semibold text-label no-underline"
            >
              <CalendarPlus className="h-5 w-5" aria-hidden="true" /> Legg i kalenderen
            </a>
          ) : (
            <a
              href={googleCalendarUrl({ title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, venue: e.venue, details: `Ordre ${order.ref}. Billettene ligger i TIKIT.` })}
              target="_blank"
              rel="noopener noreferrer"
              className="press inline-flex h-[52px] items-center justify-center gap-2 rounded-full bg-fill-3 text-headline font-semibold text-label no-underline"
            >
              <CalendarPlus className="h-5 w-5" aria-hidden="true" /> Legg i Google Kalender
            </a>
          )}
        </div>
      </div>
    );
  } else if (order.status === 'reserved') {
    hero = (
      <div className="px-6 py-10 text-center">
        <CircleAlert className="mx-auto h-14 w-14 text-orange" aria-hidden="true" />
        <h2 className="mt-4 text-title2 font-bold">Betalingen ble ikke fullført</h2>
        <p className="mt-2 text-body text-label-2">Ingen penger er trukket. Billettene er fortsatt reservert til deg en liten stund.</p>
        <Button size="lg" className="mt-6" onClick={() => navigate(`/kasse/${order.id}`, { replace: true })}>
          Prøv igjen
        </Button>
      </div>
    );
  } else if (order.status === 'expired' || order.status === 'cancelled') {
    hero = (
      <div className="px-6 py-10 text-center">
        <Clock className="mx-auto h-14 w-14 text-label-3" aria-hidden="true" />
        <h2 className="mt-4 text-title2 font-bold">Kjøpet ble ikke fullført</h2>
        <p className="mt-2 text-body text-label-2">{order.failureReason ?? 'Reservasjonen utløp, og billettene ble frigitt. Du er ikke belastet.'}</p>
        <LinkButton to={`/e/${e.slug}`} size="lg" className="mt-6">
          Til arrangementet
        </LinkButton>
      </div>
    );
  } else if (order.status === 'refunded') {
    hero = (
      <div className="px-6 py-8 text-center">
        <h2 className="text-title2 font-bold">Bestillingen er refundert</h2>
        <p className="mt-2 text-body text-label-2">Pengene går tilbake til betalingsmåten du brukte. Det kan ta noen virkedager før de vises.</p>
      </div>
    );
  }

  const status = ORDER_STATUS[order.status];

  return (
    <>
      {hero}
      <div className="mx-4 mb-6 flex items-center gap-3 rounded-lg bg-grouped-2 p-3">
        <EventImage poster={e.poster} coverUrl={e.coverUrl} title={e.title} className="h-[72px] w-[58px] shrink-0 rounded-[12px]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-headline font-semibold">{e.title}</p>
          <p className="text-subhead text-label-2">{formatEventWhen(e.startsAt)}</p>
          <p className="truncate text-subhead text-label-2">{e.venue.name}</p>
        </div>
        <Pill tone={status.tone}>{status.label}</Pill>
      </div>
      {(order.status === 'paid' || order.status === 'partially_refunded' || order.status === 'refunded') && <Receipt order={order} />}
    </>
  );
}

export default function OrderPage() {
  const { orderId } = useParams();
  return (
    <Page title="Bestilling" back="/billetter">
      <RequireLogin reason="Logg inn for å se bestillingen.">{orderId && <OrderBody orderId={orderId} />}</RequireLogin>
    </Page>
  );
}
