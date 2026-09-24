import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  CalendarPlus,
  ExternalLink,
  MapPin,
  Receipt,
  Repeat2,
  Send,
  SunMedium,
  Ticket as TicketIcon,
  Undo2,
  Wallet,
  WifiOff,
} from 'lucide-react';
import type { TicketDTO } from '../../shared/types';
import { formatNok } from '../../shared/money';
import { formatDateShort, formatTime } from '../../shared/time';
import { useApi } from '../app/context';
import { qk, useConfig, useTicket, useTickets } from '../api/hooks';
import { errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { IconTile, Row, Section } from '../components/ui/List';
import { EmptyState } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { CenterSpinner, QueryError, RequireLogin } from '../components/ui/States';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { TicketPass, passState } from '../components/ticket/TicketPass';
import { ResaleSheet, TransferSheet } from '../components/ticket/TicketSheets';
import { useClockOffset, useWakeLock } from '../lib/hooks';
import { apiUrl, canDownload, googleCalendarUrl, mapsUrl } from '../lib/links';
import { cn } from '../lib/cn';
import { isIOS } from '../lib/device';

function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function TicketActions({ ticket }: { ticket: TicketDTO }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const config = useConfig().data;
  const [transferOpen, setTransferOpen] = useState(false);
  const [resaleOpen, setResaleOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const e = ticket.event;

  const refresh = () => Promise.all([qc.invalidateQueries({ queryKey: qk.tickets }), qc.invalidateQueries({ queryKey: qk.ticket(ticket.id) })]);

  const run = async (key: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(key);
    try {
      await fn();
      await refresh();
      toast({ message: success, tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const cancelTransfer = async () => {
    if (!ticket.transfer) return;
    const ok = await confirm({ title: 'Avbryte overføringen?', message: 'Lenken slutter å virke, og billetten blir din igjen med ny QR-kode.', confirmLabel: 'Avbryt overføring', destructive: true });
    if (ok) await run('transfer', () => api.del(`/transfers/${ticket.transfer!.id}`), 'Overføringen er avbrutt');
  };
  const cancelResale = async () => {
    if (!ticket.resale) return;
    const ok = await confirm({ title: 'Trekke billetten fra salg?', message: 'Billetten blir din igjen og kan brukes som vanlig.', confirmLabel: 'Trekk fra salg' });
    if (ok) await run('resale', () => api.del(`/resale/${ticket.resale!.id}`), 'Billetten er trukket fra salg');
  };
  const refund = async () => {
    const ok = await confirm({
      title: 'Refundere billetten?',
      message: `Du får tilbake ${formatNok(ticket.pricePaidOre)} til betalingsmåten du brukte. Servicegebyret refunderes ikke. Billetten slutter å virke med en gang.`,
      confirmLabel: 'Refunder',
      destructive: true,
    });
    if (ok) await run('refund', () => api.post(`/tickets/${ticket.id}/refund`), 'Billetten er refundert');
  };
  const googleWallet = async () => {
    setBusy('wallet');
    try {
      const res = await api.get<{ url: string }>(`/tickets/${ticket.id}/wallet/google`);
      window.location.assign(res.url);
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const state = passState(ticket);
  const ownPurchase = !ticket.receivedFrom && (ticket.kind === 'paid' || ticket.kind === 'free' || ticket.kind === 'resale');

  return (
    <div className="mt-6">
      {ticket.transfer && (
        <div className="mx-4 mb-4 rounded-md bg-tint-soft px-4 py-3.5">
          <p className="text-headline font-semibold text-tint">Overføring venter</p>
          <p className="mt-0.5 text-subhead">
            {ticket.transfer.toContact ? `Sendt til ${ticket.transfer.toContact}. ` : ''}Billetten flyttes når mottakeren godtar lenken.
          </p>
          <Button size="sm" variant="gray" className="mt-3" loading={busy === 'transfer'} onClick={() => void cancelTransfer()}>
            Avbryt overføringen
          </Button>
        </div>
      )}
      {ticket.resale && (
        <div className="mx-4 mb-4 rounded-md bg-tint-soft px-4 py-3.5">
          <p className="text-headline font-semibold text-tint">{ticket.resale.status === 'reserved' ? 'Noen holder på å kjøpe billetten' : 'Til salgs i videresalg'}</p>
          <p className="mt-0.5 text-subhead tabular">
            Pris {formatNok(ticket.resale.priceOre)}. Du får {formatNok(ticket.resale.payoutOre)} tilbake når den er solgt.
          </p>
          {ticket.resale.status === 'active' && (
            <Button size="sm" variant="gray" className="mt-3" loading={busy === 'resale'} onClick={() => void cancelResale()}>
              Trekk fra salg
            </Button>
          )}
        </div>
      )}

      {(ticket.canTransfer || ticket.canResell || ticket.canRefund) && (
        <Section header="Kan du ikke komme?" className="mx-4">
          {ticket.canTransfer && (
            <Row
              icon={
                <IconTile color="#3B4CF2">
                  <Send />
                </IconTile>
              }
              title="Overfør til en venn"
              subtitle="Gratis – billetten får ny QR-kode"
              onClick={() => setTransferOpen(true)}
            />
          )}
          {ticket.canResell && (
            <Row
              icon={
                <IconTile color="#12B886">
                  <Repeat2 />
                </IconTile>
              }
              title="Selg videre i TIKIT"
              subtitle={`Til maks ${formatNok(ticket.resaleMaxOre)}`}
              onClick={() => setResaleOpen(true)}
            />
          )}
          {ticket.canRefund && (
            <Row
              icon={
                <IconTile color="#FF3B30">
                  <Undo2 />
                </IconTile>
              }
              title="Refunder billetten"
              subtitle={ticket.refundDeadline ? `Frist ${formatDateShort(ticket.refundDeadline)} kl. ${formatTime(ticket.refundDeadline)}` : undefined}
              onClick={() => void refund()}
              disabled={busy === 'refund'}
            />
          )}
        </Section>
      )}

      {state === 'live' && (config?.wallet.apple || config?.wallet.google) && (
        <Section header="Lommebok" className="mx-4" footer="Lommebok-kort har en fast kode. Bruk helst den levende billetten i appen.">
          {config.wallet.apple && canDownload && (
            <Row
              icon={
                <IconTile color="#000000">
                  <Wallet />
                </IconTile>
              }
              title="Legg til i Apple Wallet"
              href={apiUrl(`/tickets/${ticket.id}/wallet/apple`)}
            />
          )}
          {config.wallet.google && (
            <Row
              icon={
                <IconTile color="#1A73E8">
                  <Wallet />
                </IconTile>
              }
              title="Legg til i Google Wallet"
              onClick={() => void googleWallet()}
              disabled={busy === 'wallet'}
            />
          )}
        </Section>
      )}

      <Section header="Arrangementet" className="mx-4">
        <Row
          icon={
            <IconTile color="#FF9500">
              <MapPin />
            </IconTile>
          }
          title="Veibeskrivelse"
          subtitle={`${e.venue.name}, ${e.venue.address ? `${e.venue.address}, ` : ''}${e.venue.city}`}
          href={mapsUrl(e.venue)}
          accessory={<ExternalLink className="h-4 w-4 text-label-3" aria-hidden="true" />}
        />
        {/* One calendar action: a calendar file on Apple devices (opens Calendar), Google Calendar elsewhere. */}
        {canDownload && (isIOS() || /Mac/.test(navigator.platform)) ? (
          <Row
            icon={
              <IconTile color="#FF3B30">
                <CalendarPlus />
              </IconTile>
            }
            title="Legg i kalenderen"
            href={apiUrl(`/tickets/${ticket.id}/calendar.ics`)}
          />
        ) : (
          <Row
            icon={
              <IconTile color="#FF3B30">
                <CalendarPlus />
              </IconTile>
            }
            title="Legg i kalenderen"
            subtitle="Google Kalender"
            href={googleCalendarUrl({ title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, venue: e.venue, details: `Billett ${ticket.number}. Vis billetten i TIKIT.` })}
            accessory={<ExternalLink className="h-4 w-4 text-label-3" aria-hidden="true" />}
          />
        )}
        <Row
          icon={
            <IconTile color="#3B4CF2">
              <TicketIcon />
            </IconTile>
          }
          title="Vis arrangementet"
          to={`/e/${e.slug}`}
        />
        {ownPurchase && (
          <Row
            icon={
              <IconTile color="#30B0C7">
                <Receipt />
              </IconTile>
            }
            title="Kvittering"
            subtitle={`Ordre ${ticket.orderRef}`}
            to={`/ordre/${ticket.orderId}`}
          />
        )}
      </Section>

      {ticket.receivedFrom && <p className="mx-8 -mt-4 mb-6 text-footnote text-label-2">Billetten er overført til deg fra {ticket.receivedFrom}.</p>}

      <TransferSheet ticket={ticket} open={transferOpen} onClose={() => setTransferOpen(false)} />
      <ResaleSheet ticket={ticket} open={resaleOpen} onClose={() => setResaleOpen(false)} />
    </div>
  );
}

function TicketBody({ ticketId }: { ticketId: string }) {
  const list = useTickets();
  const single = useTicket(ticketId);
  const offset = useClockOffset();
  const online = useOnline();
  const railRef = useRef<HTMLDivElement>(null);

  const primary = single.data?.ticket ?? list.data?.tickets.find((t) => t.id === ticketId) ?? null;
  const siblings = useMemo(() => {
    if (!primary) return [];
    const all = list.data?.tickets ?? [];
    const same = all.filter((t) => t.event.id === primary.event.id && (t.status === 'valid' || t.status === 'used' || t.id === primary.id));
    return same.length > 0 ? same.map((t) => (t.id === primary.id ? primary : t)) : [primary];
  }, [list.data, primary]);
  const startIndex = Math.max(0, siblings.findIndex((t) => t.id === ticketId));
  const [index, setIndex] = useState(startIndex);
  const positioned = useRef(false);

  useEffect(() => {
    if (positioned.current || !railRef.current || siblings.length <= 1) return;
    const el = railRef.current;
    el.scrollLeft = startIndex * el.clientWidth;
    setIndex(startIndex);
    positioned.current = true;
  }, [siblings.length, startIndex]);

  const current = siblings[index] ?? primary;
  useWakeLock(!!current && passState(current) === 'live');

  if (!primary && (single.isLoading || list.isLoading)) return <CenterSpinner />;
  if (!primary)
    return (
      <QueryError
        error={single.error}
        onRetry={() => void single.refetch()}
        notFound={<EmptyState icon={<TicketIcon />} title="Fant ikke billetten" message="Den kan være overført, refundert eller tilhøre en annen konto." />}
      />
    );

  return (
    <>
      {!online && (
        <div role="status" className="mx-4 mb-3 flex items-center gap-2 rounded-md bg-fill-4 px-3.5 py-2.5 text-subhead">
          <WifiOff className="h-4 w-4 text-label-2" aria-hidden="true" /> Du er uten nett – billetten virker likevel.
        </div>
      )}
      <div
        ref={railRef}
        className={cn('no-scrollbar flex snap-x snap-mandatory overflow-x-auto', siblings.length > 1 && 'overscroll-x-contain')}
        onScroll={(ev) => {
          const el = ev.currentTarget;
          const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (i !== index) setIndex(i);
        }}
        role="region"
        tabIndex={0}
        aria-label={siblings.length > 1 ? `${siblings.length} billetter – sveip eller bruk piltastene for å bla` : 'Billett'}
        onKeyDown={(ev) => {
          if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
          ev.preventDefault();
          const el = ev.currentTarget;
          el.scrollBy({ left: (ev.key === 'ArrowRight' ? 1 : -1) * el.clientWidth, behavior: 'smooth' });
        }}
      >
        {siblings.map((t, i) => (
          <div key={t.id} className="w-full shrink-0 snap-center px-4 pt-1">
            <TicketPass ticket={t} offsetMs={offset} active={i === index} index={i} count={siblings.length} />
          </div>
        ))}
      </div>
      {siblings.length > 1 && (
        <div className="mt-4 flex justify-center gap-2" aria-hidden="true">
          {siblings.map((t, i) => (
            <span key={t.id} className={cn('h-2 rounded-full transition-all', i === index ? 'w-5 bg-label' : 'w-2 bg-label-4')} />
          ))}
        </div>
      )}
      {current && passState(current) === 'live' && (
        <p className="mx-6 mt-4 flex items-center justify-center gap-2 text-center text-footnote text-label-2">
          <SunMedium className="h-4 w-4 shrink-0" aria-hidden="true" /> Skru opp lysstyrken og hold telefonen rolig mot skanneren.
        </p>
      )}
      {current && <TicketActions key={current.id} ticket={current} />}
    </>
  );
}

export default function TicketDetail() {
  const { ticketId } = useParams();
  return (
    <Page title="Billett" back="/billetter">
      <RequireLogin reason="Logg inn for å vise billetten.">{ticketId && <TicketBody ticketId={ticketId} />}</RequireLogin>
    </Page>
  );
}
