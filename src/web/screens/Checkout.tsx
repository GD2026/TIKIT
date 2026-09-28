import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, CreditCard, Info, Tag, TimerReset, X } from 'lucide-react';
import type { OrderDTO, PaymentMethodId } from '../../shared/types';
import { formatNok } from '../../shared/money';
import { formatCountdown, formatEventWhen } from '../../shared/time';
import { useApi } from '../app/context';
import { useAuth } from '../app/auth';
import { qk, useConfig, useOrder } from '../api/hooks';
import { ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { BottomBar } from '../components/layout/BottomBar';
import { EventImage } from '../components/event/EventImage';
import { Button, LinkButton } from '../components/ui/Button';
import { EmptyState, Spinner } from '../components/ui/Feedback';
import { TextField } from '../components/ui/Field';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { CenterSpinner, QueryError, RequireLogin } from '../components/ui/States';
import { useCountdown } from '../lib/hooks';
import { followUrl, isExternalUrl } from '../lib/links';
import { isNativeApp } from '../lib/device';
import { cn } from '../lib/cn';

function VippsMark({ className }: { className?: string }) {
  return (
    // Brand mark (logotype: exempt from contrast rules); the method name is written out next to it.
    <span data-brand-mark className={cn('inline-flex h-8 w-12 items-center justify-center rounded-[8px] bg-[var(--vipps)] text-[0.78rem] font-extrabold text-white', className)} aria-hidden="true">
      vipps
    </span>
  );
}

function CardMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex h-8 w-12 items-center justify-center rounded-[8px] bg-fill-3 text-label', className)} aria-hidden="true">
      <CreditCard className="h-5 w-5" />
    </span>
  );
}

function Line({ label, value, strong, tone }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; tone?: 'green' }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1.5', strong && 'pt-3')}>
      <span className={cn(strong ? 'text-headline font-semibold' : 'text-body text-label-2')}>{label}</span>
      <span className={cn('tabular', strong ? 'text-title3 font-bold' : 'text-body', tone === 'green' && 'text-green')}>{value}</span>
    </div>
  );
}

function CheckoutBody({ orderId }: { orderId: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const { me } = useAuth();
  const config = useConfig().data;
  const orderQ = useOrder(orderId);
  const order = orderQ.data;

  const [method, setMethod] = useState<PaymentMethodId | null>(null);
  const [terms, setTerms] = useState(false);
  const [names, setNames] = useState<string[]>([]);
  const [nameErrors, setNameErrors] = useState<Record<number, string>>({});
  const [codeOpen, setCodeOpen] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'pay' | 'code' | 'cancel' | 'sync'>(null);
  const synced = useRef(false);

  const setOrder = (o: OrderDTO) => qc.setQueryData(qk.order(o.id), o);

  // Coming back from Vipps/card without finishing: ask the provider what happened.
  useEffect(() => {
    if (!order || synced.current || order.status !== 'pending_payment') return;
    synced.current = true;
    void api
      .post<OrderDTO>(`/orders/${order.id}/sync`)
      .then((o) => {
        setOrder(o);
        if (o.status === 'paid') navigate(`/ordre/${o.id}`, { replace: true });
      })
      .catch(() => {});
    // Runs once per status change on purpose; the latest order/api are read when it fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.status]);

  // Default payment method and prefilled names.
  const methods = useMemo(() => config?.paymentMethods ?? [], [config]);
  useEffect(() => {
    if (!method && methods.length > 0) setMethod(methods.find((m) => m.id === 'vipps')?.id ?? methods[0]!.id);
  }, [methods, method]);
  const qtyTotal = order?.items.reduce((s, i) => s + i.qty, 0) ?? 0;
  useEffect(() => {
    if (!order) return;
    setNames((prev) => {
      if (prev.length === qtyTotal) return prev;
      return Array.from({ length: qtyTotal }, (_, i) => order.attendeeNames[i] ?? prev[i] ?? (i === 0 ? (me?.name ?? '') : ''));
    });
  }, [order, qtyTotal, me?.name]);

  const msLeft = useCountdown(order && (order.status === 'reserved' || order.status === 'pending_payment') ? order.expiresAt : null);
  useEffect(() => {
    if (order && (order.status === 'reserved' || order.status === 'pending_payment') && msLeft === 0) void orderQ.refetch();
  }, [msLeft, order, orderQ]);

  if (orderQ.isLoading) return <CenterSpinner />;
  if (orderQ.isError || !order)
    return <QueryError error={orderQ.error} onRetry={() => void orderQ.refetch()} notFound={<EmptyState title="Fant ikke bestillingen" message="Den kan ha utløpt eller tilhøre en annen konto." />} />;

  const e = order.event;
  if (order.status === 'paid' || order.status === 'partially_refunded' || order.status === 'refunded') {
    return (
      <EmptyState
        icon={<Check />}
        title="Bestillingen er betalt"
        message="Billettene ligger under Billetter."
        action={<LinkButton to={`/ordre/${order.id}`}>Vis kvittering</LinkButton>}
      />
    );
  }
  if (order.status === 'expired' || order.status === 'cancelled') {
    return (
      <EmptyState
        icon={<TimerReset />}
        title={order.status === 'expired' ? 'Reservasjonen har utløpt' : 'Bestillingen er avbrutt'}
        message={order.failureReason ?? 'Billettene er frigitt. Velg billetter på nytt for å kjøpe.'}
        action={<LinkButton to={`/e/${e.slug}`}>Velg billetter på nytt</LinkButton>}
      />
    );
  }

  const pending = order.status === 'pending_payment';
  const free = order.totalOre === 0;
  const personalized = e.settings.personalizedTickets && order.kind === 'standard';
  const urgent = msLeft < 120_000;
  const cancelled = params.get('avbrutt') === '1';

  const applyCode = async (value: string | null) => {
    setBusy('code');
    setCodeError(null);
    try {
      const o = await api.patch<OrderDTO>(`/orders/${order.id}`, { discountCode: value });
      setOrder(o);
      if (value) {
        toast({ message: 'Rabattkoden er brukt', tone: 'success' });
        setCode('');
        setCodeOpen(false);
      }
    } catch (err) {
      setCodeError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const pay = async () => {
    if (personalized) {
      const errs: Record<number, string> = {};
      names.forEach((n, i) => {
        if (n.trim().length < 2) errs[i] = 'Skriv navnet til den som skal bruke billetten.';
      });
      setNameErrors(errs);
      if (Object.keys(errs).length > 0) {
        document.getElementById('navn')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
    }
    if (!terms) {
      toast({ message: 'Du må godta kjøpsvilkårene', tone: 'error' });
      return;
    }
    setBusy('pay');
    try {
      if (personalized && order.status === 'reserved') {
        await api.patch<OrderDTO>(`/orders/${order.id}`, { attendeeNames: names.map((n) => n.trim()) });
      }
      const res = await api.post<{ order: OrderDTO; redirectUrl: string | null }>(`/orders/${order.id}/pay`, {
        method: free ? 'free' : method,
        phone: method === 'vipps' ? (me?.phone ?? null) : null,
        acceptTerms: true,
        ...(isNativeApp ? { client: 'ios' } : {}),
      });
      setOrder(res.order);
      if (res.order.status === 'paid') {
        await qc.invalidateQueries({ queryKey: qk.tickets });
        navigate(`/ordre/${order.id}?retur=1`, { replace: true });
        return;
      }
      if (import.meta.env.MODE === 'native' && res.redirectUrl && isExternalUrl(res.redirectUrl)) {
        // iOS app: Vipps opens in the Vipps app, cards in an in-app Safari sheet (src/web/native/payments.ts).
        const { openPayment } = await import('../native/payments');
        await openPayment(api, order.id, res.redirectUrl, {
          paid: () => {
            void qc.invalidateQueries({ queryKey: qk.tickets });
            navigate(`/ordre/${order.id}?retur=1`, { replace: true });
          },
          stopped: () => void orderQ.refetch(),
        });
      } else if (res.redirectUrl) followUrl(res.redirectUrl, navigate);
    } catch (err) {
      if (err instanceof ApiError && (err.code === 'order_expired' || err.code === 'order_not_payable')) void orderQ.refetch();
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const checkStatus = async () => {
    setBusy('sync');
    try {
      const o = await api.post<OrderDTO>(`/orders/${order.id}/sync`);
      setOrder(o);
      if (o.status === 'paid') navigate(`/ordre/${o.id}?retur=1`, { replace: true });
      else if (o.status === 'pending_payment') toast({ message: 'Betalingen er ikke fullført ennå', tone: 'info' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    const ok = await confirm({ title: 'Avbryte kjøpet?', message: 'Billettene frigis til andre kjøpere.', confirmLabel: 'Avbryt kjøpet', cancelLabel: 'Fortsett å handle', destructive: true });
    if (!ok) return;
    setBusy('cancel');
    try {
      await api.post(`/orders/${order.id}/cancel`);
      qc.removeQueries({ queryKey: qk.order(order.id) });
      navigate(`/e/${e.slug}`, { replace: true });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
      setBusy(null);
    }
  };

  const payLabel = free
    ? 'Bekreft bestillingen'
    : method === 'vipps'
      ? `Betal ${formatNok(order.totalOre)} med Vipps`
      : `Betal ${formatNok(order.totalOre)} med kort`;

  let ticketIndex = 0;

  return (
    <>
      <div
        role="timer"
        aria-live="off"
        className={cn('mx-4 mb-4 flex items-center gap-3 rounded-md px-4 py-3', urgent ? 'bg-orange-soft text-orange' : 'bg-tint-soft text-tint')}
      >
        <TimerReset className="h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="flex-1 text-subhead font-semibold">
          {pending ? 'Betalingen pågår – billettene holdes i ' : 'Billettene er reservert til deg i '}
          <span className="tabular">{formatCountdown(msLeft)}</span>
        </p>
      </div>

      {cancelled && !pending && (
        <div role="status" className="mx-4 mb-4 flex items-start gap-3 rounded-md bg-fill-4 px-4 py-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-label-2" aria-hidden="true" />
          <p className="text-subhead">Betalingen ble avbrutt, og ingen penger er trukket. Du kan prøve igjen eller velge en annen betalingsmåte.</p>
        </div>
      )}

      <div className="mx-4 mb-6 flex items-center gap-3 rounded-lg bg-grouped-2 p-3">
        <EventImage poster={e.poster} coverUrl={e.coverUrl} title={e.title} className="h-[72px] w-[58px] shrink-0 rounded-[12px]" />
        <div className="min-w-0">
          <p className="truncate text-headline font-semibold">{e.title}</p>
          <p className="text-subhead text-label-2">{formatEventWhen(e.startsAt)}</p>
          <p className="truncate text-subhead text-label-2">
            {e.venue.name}, {e.venue.city}
          </p>
        </div>
      </div>

      <section aria-labelledby="bestilling" className="mb-6">
        <h2 id="bestilling" className="mb-1.5 px-8 text-footnote uppercase tracking-[0.02em] text-label-2">
          Bestilling {order.ref}
        </h2>
        <div className="mx-4 rounded-md bg-grouped-2 px-4 py-2">
          {order.items.map((i) => (
            <div key={i.ticketTypeId} className="flex items-baseline justify-between gap-4 py-2">
              <div className="min-w-0">
                <p className="text-body font-medium">
                  {i.qty} × {i.name}
                </p>
                {i.unitPriceOre !== i.listPriceOre && (
                  <p className="text-footnote text-green">
                    Rabatt: {formatNok(i.listPriceOre)} → {formatNok(i.unitPriceOre)}
                  </p>
                )}
              </div>
              <span className="text-body tabular">{formatNok(i.qty * i.listPriceOre)}</span>
            </div>
          ))}
          {order.seats.length > 0 && (
            <p className="pb-2 text-subhead text-label-2">{order.seats.map((s) => `${s.section}, rad ${s.row}, sete ${s.number}`).join(' · ')}</p>
          )}
          <div className="hairline-t mt-1 pt-1.5">
            {order.discountOre > 0 && <Line label={`Rabatt (${order.discount?.code ?? ''})`} value={`−${formatNok(order.discountOre)}`} tone="green" />}
            {order.feeOre > 0 && <Line label="Servicegebyr" value={formatNok(order.feeOre)} />}
            <Line label="Totalt" value={free ? 'Gratis' : formatNok(order.totalOre)} strong />
          </div>
        </div>
        {order.feeOre > 0 && <p className="mt-1.5 px-8 text-footnote text-label-2">Servicegebyret dekker betaling, levende billetter og kundestøtte. Inkl. mva. {formatNok(order.vat.feeVatOre + order.vat.ticketsVatOre)}.</p>}
      </section>

      {order.kind === 'standard' && !pending && (
        <section className="mb-6" aria-label="Rabattkode">
          {order.discount ? (
            <div className="mx-4 flex items-center gap-3 rounded-md bg-green-soft px-4 py-3">
              <Tag className="h-5 w-5 text-green" aria-hidden="true" />
              <p className="flex-1 text-subhead">
                Rabattkoden <strong className="font-semibold">{order.discount.code}</strong> er brukt
              </p>
              <button type="button" onClick={() => void applyCode(null)} disabled={busy === 'code'} className="flex h-11 w-11 items-center justify-center rounded-full text-label-2" aria-label="Fjern rabattkoden">
                {busy === 'code' ? <Spinner size={16} /> : <X className="h-5 w-5" />}
              </button>
            </div>
          ) : (
            <div className="mx-4 rounded-md bg-grouped-2">
              <button type="button" onClick={() => setCodeOpen((v) => !v)} aria-expanded={codeOpen} className="flex min-h-12 w-full items-center gap-3 px-4 text-left">
                <Tag className="h-5 w-5 text-tint" aria-hidden="true" />
                <span className="flex-1 text-body">Har du en rabattkode?</span>
                <ChevronDown className={cn('h-5 w-5 text-label-3 transition-transform', codeOpen && 'rotate-180')} aria-hidden="true" />
              </button>
              {codeOpen && (
                <form
                  className="flex items-start gap-2 px-4 pb-4"
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    if (code.trim()) void applyCode(code.trim());
                  }}
                >
                  <TextField
                    label="Rabattkode"
                    labelHidden
                    placeholder="Rabattkode"
                    value={code}
                    onChange={(ev) => setCode(ev.target.value.toUpperCase())}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                    error={codeError}
                    className="flex-1"
                    maxLength={40}
                  />
                  <Button type="submit" variant="tinted" className="h-12" loading={busy === 'code'} disabled={!code.trim()}>
                    Bruk
                  </Button>
                </form>
              )}
            </div>
          )}
        </section>
      )}

      {personalized && (
        <section id="navn" aria-labelledby="navn-tittel" className="mb-6 scroll-mt-24">
          <h2 id="navn-tittel" className="mb-1.5 px-8 text-footnote uppercase tracking-[0.02em] text-label-2">
            Navn på billettene
          </h2>
          <div className="mx-4 flex flex-col gap-3 rounded-md bg-grouped-2 p-4">
            {order.items.flatMap((item) =>
              Array.from({ length: item.qty }, () => {
                const idx = ticketIndex++;
                return (
                  <TextField
                    key={idx}
                    label={`Billett ${idx + 1} – ${item.name}`}
                    value={names[idx] ?? ''}
                    onChange={(ev) => {
                      const v = ev.target.value;
                      setNames((prev) => prev.map((n, i) => (i === idx ? v : n)));
                      if (nameErrors[idx]) setNameErrors((prev) => ({ ...prev, [idx]: '' }));
                    }}
                    autoComplete={idx === 0 ? 'name' : 'off'}
                    error={nameErrors[idx] || null}
                    disabled={pending}
                    maxLength={80}
                  />
                );
              }),
            )}
          </div>
          <p className="mt-1.5 px-8 text-footnote text-label-2">Arrangøren krever navn på hver billett. Navnet kan bli sjekket mot legitimasjon i døra.</p>
        </section>
      )}

      {!free && (
        <section aria-labelledby="betaling" className="mb-6">
          <h2 id="betaling" className="mb-1.5 px-8 text-footnote uppercase tracking-[0.02em] text-label-2">
            Betalingsmåte
          </h2>
          <div role="radiogroup" aria-labelledby="betaling" className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
            {methods.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={method === m.id}
                onClick={() => setMethod(m.id)}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-fill-4"
              >
                {m.id === 'vipps' ? <VippsMark /> : <CardMark />}
                <span className="min-w-0 flex-1">
                  <span className="block text-body font-medium">{m.id === 'vipps' ? 'Vipps' : 'Betalingskort'}</span>
                  <span className="block text-footnote text-label-2">
                    {m.id === 'vipps' ? 'Bekreft i Vipps-appen' : 'Visa og Mastercard'}
                    {m.demo ? ' · demo' : ''}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn('flex h-6 w-6 items-center justify-center rounded-full', method === m.id ? 'bg-tint-fill text-on-tint' : 'shadow-[inset_0_0_0_2px_var(--label-4)]')}
                >
                  {method === m.id && <Check className="h-4 w-4" strokeWidth={3} />}
                </span>
              </button>
            ))}
          </div>
          {methods.length === 0 && <p className="mx-4 text-subhead text-red">Ingen betalingsmåter er tilgjengelige akkurat nå.</p>}
        </section>
      )}

      <div className="mx-4 mb-4">
        <label className="flex cursor-pointer items-start gap-3 rounded-md bg-grouped-2 px-4 py-3.5">
          <input type="checkbox" checked={terms} onChange={(ev) => setTerms(ev.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--tint-fill)]" />
          <span className="text-subhead">
            Jeg godtar{' '}
            <Link to="/vilkar" className="text-tint underline underline-offset-2">
              kjøpsvilkårene
            </Link>
            . Billetter til arrangementer på en bestemt dato har ikke angrerett, men kan refunderes etter arrangørens regler.
          </span>
        </label>
      </div>

      <div className="mb-2 text-center">
        <Button variant="plain" onClick={() => void cancel()} disabled={!!busy}>
          Avbryt kjøpet
        </Button>
      </div>
      <p className="mx-6 text-center text-footnote text-label-2">
        Selges av {order.organizer.name}
        {order.organizer.orgNumber ? ` (org.nr. ${order.organizer.orgNumber})` : ''} via TIKIT. Spørsmål?{' '}
        <Link to="/hjelp" className="text-tint underline underline-offset-2">
          Hjelp
        </Link>
      </p>

      <BottomBar>
        {pending ? (
          <div className="flex gap-2">
            <Button size="lg" variant="gray" className="flex-1" loading={busy === 'sync'} disabled={!!busy} onClick={() => void checkStatus()}>
              Sjekk status
            </Button>
            <Button size="lg" className="flex-1" loading={busy === 'pay'} disabled={!!busy || (!free && !method) || msLeft === 0} onClick={() => void pay()}>
              Betal på nytt
            </Button>
          </div>
        ) : (
          <Button
            size="lg"
            full
            variant={!free && method === 'vipps' ? 'vipps' : 'filled'}
            loading={busy === 'pay'}
            disabled={!!busy || (!free && !method) || msLeft === 0}
            onClick={() => void pay()}
          >
            {payLabel}
          </Button>
        )}
      </BottomBar>
    </>
  );
}

export default function Checkout() {
  const { orderId } = useParams();
  return (
    <Page title="Kasse" back="/billetter">
      <RequireLogin reason="Logg inn for å fullføre kjøpet.">{orderId && <CheckoutBody orderId={orderId} />}</RequireLogin>
    </Page>
  );
}
