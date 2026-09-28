import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Armchair, Ban, Copy, ExternalLink, Eye, EyeOff, Link2, ListOrdered, Pencil, Percent, ScanLine, Send, Ticket, Users } from 'lucide-react';
import type { EventDoc } from '../../shared/types';
import type { OrgEventDetail } from '../../server/services/events';
import type { EventStatsData } from '../../server/services/stats';
import { formatNok, formatNokWhole } from '../../shared/money';
import { formatDateLong, formatTimeRange } from '../../shared/time';
import { useApi } from '../app/context';
import { errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { IconTile, Row, Section } from '../components/ui/List';
import { Button } from '../components/ui/Button';
import { Pill } from '../components/ui/Feedback';
import { CenterSpinner, QueryError } from '../components/ui/States';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { BarList, ColumnChart, Meter, StatTile } from '../components/charts/Charts';
import { EventImage } from '../components/event/EventImage';
import { copyText } from '../lib/share';
import { appUrl } from '../lib/links';
import { Card, canManage, dayLabels, eventStatusPill, orgKey, useOrg, useOrgQuery } from './shared';

export default function EventHub() {
  const { eventId } = useParams();
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const manage = canManage(org.role);
  const q = useOrgQuery<OrgEventDetail>(org.id, `/events/${eventId}`);
  const stats = useOrgQuery<EventStatsData>(org.id, `/events/${eventId}/stats`, { refetchInterval: 30_000 });
  const [busy, setBusy] = useState<string | null>(null);

  if (q.isLoading) return <CenterSpinner />;
  if (q.isError || !q.data)
    return (
      <Page title="Arrangement" back={`/arrangor/${org.id}/arrangementer`}>
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      </Page>
    );

  const { event: e, ticketTypes } = q.data;
  const base = `/arrangor/${org.id}/arrangementer/${e.id}`;
  const now = new Date().toISOString();
  const saleState = e.status === 'cancelled' ? 'cancelled' : e.endsAt <= now ? 'past' : 'on_sale';
  const pill = eventStatusPill(e.status, saleState);
  const s = stats.data;
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: orgKey(org.id) });
    await qc.invalidateQueries({ queryKey: ['event'] });
    await qc.invalidateQueries({ queryKey: ['home'] });
  };

  const act = async (key: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await fn();
      await refresh();
      toast({ message, tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const publish = () => act('publish', () => api.post(`/org/${org.id}/events/${e.id}/publish`), 'Arrangementet er publisert!');
  const unpublish = async () => {
    const ok = await confirm({ title: 'Gjøre om til utkast?', message: 'Arrangementet forsvinner fra appen, og salget stopper. Solgte billetter gjelder fortsatt.', confirmLabel: 'Gjør om til utkast' });
    if (ok) await act('unpublish', () => api.post(`/org/${org.id}/events/${e.id}/unpublish`), 'Arrangementet er et utkast igjen');
  };
  const cancel = async () => {
    const reason = await confirm({
      title: 'Avlyse arrangementet?',
      message: 'Alle kjøpere får hele beløpet tilbake automatisk, inkludert servicegebyr, og blir varslet. Dette kan ikke angres.',
      confirmLabel: 'Avlys og refunder',
      destructive: true,
      input: { label: 'Begrunnelse til kjøperne', placeholder: 'For eksempel: Vi har dessverre mistet lokalet.', minLength: 5 },
    });
    if (typeof reason !== 'string') return;
    setBusy('cancel');
    try {
      const res = await api.post<{ refunded: number; failed: number }>(`/org/${org.id}/events/${e.id}/cancel`, { reason });
      await refresh();
      toast({
        message: res.failed > 0 ? `Avlyst. ${res.refunded} ordre refundert, ${res.failed} prøves igjen automatisk.` : `Avlyst. ${res.refunded} ordre er refundert.`,
        tone: res.failed > 0 ? 'info' : 'success',
        duration: 6000,
      });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const duplicate = async () => {
    setBusy('duplicate');
    try {
      const copy = await api.post<EventDoc>(`/org/${org.id}/events/${e.id}/duplicate`);
      await refresh();
      toast({ message: 'Kopien er lagret som utkast', tone: 'success' });
      navigate(`/arrangor/${org.id}/arrangementer/${copy.id}`);
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };
  const copyLink = async () => {
    const ok = await copyText(appUrl(`/e/${e.slug}`));
    toast({ message: ok ? 'Lenken er kopiert' : 'Kunne ikke kopiere lenken', tone: ok ? 'success' : 'error' });
  };

  const capacity = ticketTypes.reduce((n, t) => n + t.capacity, 0);
  const sold = ticketTypes.reduce((n, t) => n + t.sold, 0);
  const draftBlockers = [
    ticketTypes.length === 0 ? 'Legg til minst én billettype' : null,
    org.status !== 'approved' ? 'Arrangøren må godkjennes av TIKIT' : null,
    e.endsAt <= now ? 'Tidspunktet har passert' : null,
  ].filter((x): x is string => !!x);

  return (
    <Page title={e.title} back={`/arrangor/${org.id}/arrangementer`} wide>
      <div className="mx-4 mb-5 flex gap-4">
        <EventImage poster={e.poster} coverUrl={e.coverImageId ? `/api/images/${e.coverImageId}` : null} title={e.title} className="h-[120px] w-[96px] shrink-0 rounded-[16px]" />
        <div className="min-w-0 flex-1">
          <Pill tone={pill.tone}>{pill.label}</Pill>
          <h2 className="mt-1.5 text-title2 font-bold leading-tight">{e.title}</h2>
          <p className="mt-1 text-subhead text-label-2">
            {formatDateLong(e.startsAt)} · {formatTimeRange(e.startsAt, e.endsAt)}
          </p>
          <p className="text-subhead text-label-2">
            {e.venue.name}, {e.venue.city}
          </p>
        </div>
      </div>

      {e.status === 'draft' && manage && (
        <Card className="mx-4 mb-5">
          <p className="text-headline font-semibold">Klar til å publisere?</p>
          {draftBlockers.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-subhead text-label-2">
              {draftBlockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-subhead text-label-2">Når dere publiserer, blir arrangementet synlig{e.visibility === 'unlisted' ? ' for alle med lenken' : ' i TIKIT'} og salget åpner {e.salesStartAt ? 'på valgt tidspunkt' : 'med en gang'}.</p>
          )}
          <Button className="mt-4" loading={busy === 'publish'} disabled={draftBlockers.length > 0 || !!busy} onClick={() => void publish()} icon={<Send className="h-4 w-4" />}>
            Publiser
          </Button>
        </Card>
      )}

      {e.status === 'cancelled' && (
        <div className="mx-4 mb-5 rounded-md bg-red-soft px-4 py-3">
          <p className="text-headline font-semibold text-red">Arrangementet er avlyst</p>
          {e.cancelReason && <p className="mt-0.5 text-subhead">{e.cancelReason}</p>}
        </div>
      )}

      <div className="mx-4 mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-md bg-grouped-2 px-4 py-3.5">
          <p className="text-footnote text-label-2">Solgt</p>
          <p className="mt-1 text-title2 font-bold leading-tight">
            {sold} <span className="text-body font-normal text-label-2">av {capacity}</span>
          </p>
          <Meter value={sold} max={Math.max(capacity, sold)} label="Solgte billetter" showText={false} className="mt-2" />
        </div>
        {manage && s && <StatTile label="Billettinntekt" value={formatNokWhole(s.revenueOre)} caption={s.refundsOre > 0 ? `${formatNok(s.refundsOre)} refundert` : `${s.orders} ordre`} />}
        {s && <StatTile label="Sjekket inn" value={`${s.checkedIn}`} caption={sold > 0 ? `${Math.round((s.checkedIn / Math.max(1, sold)) * 100)} % av solgte` : 'Ingen solgt ennå'} />}
        {s && <StatTile label="Interesse" value={`${s.waitlist + s.saleAlerts}`} caption={`${s.waitlist} på venteliste · ${s.saleAlerts} varsler`} />}
      </div>

      {s && (
        <div className="mx-4 mb-5 grid gap-4 lg:grid-cols-2">
          <Card>
            <ColumnChart
              title="Solgte billetter per dag"
              data={s.series.map((x) => {
                const l = dayLabels(x.date);
                return { key: x.date, label: l.short, fullLabel: l.full, value: x.tickets };
              })}
              format={(v) => (v === 1 ? '1 billett' : `${v} billetter`)}
              axisFormat={(v) => String(Math.round(v))}
              emptyText="Ingen salg ennå"
            />
          </Card>
          <Card>
            <BarList
              title="Salg per billettype"
              format={(v) => `${v} solgt`}
              rows={s.byType.map((t) => ({
                key: t.id,
                label: t.name,
                value: t.sold,
                max: Math.max(t.capacity, t.sold),
                caption: `${t.sold} av ${t.capacity}${manage ? ` · ${formatNok(t.revenueOre)}` : ''}`,
              }))}
            />
            {s.discounts.length > 0 && (
              <div className="mt-5 hairline-t pt-4">
                <p className="mb-2 text-headline font-semibold">Rabattkoder brukt</p>
                <ul className="space-y-1 text-subhead">
                  {s.discounts.map((d) => (
                    <li key={d.code} className="flex justify-between gap-3">
                      <span className="font-mono">{d.code}</span>
                      <span className="text-label-2 tabular">
                        {d.uses === 1 ? 'brukt 1 gang' : `brukt ${d.uses} ganger`} · −{formatNok(d.discountOre)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(s.resale.active > 0 || s.resale.sold > 0) && (
              <p className="mt-4 text-subhead text-label-2">
                Videresalg: {s.resale.active} til salgs, {s.resale.sold} solgt.
              </p>
            )}
          </Card>
        </div>
      )}

      <div className="mx-4 grid gap-x-4 lg:grid-cols-2">
        <Section header="Administrer">
          {manage && (
            <Row
              icon={
                <IconTile color="#3B4CF2">
                  <Ticket />
                </IconTile>
              }
              title="Billettyper"
              value={ticketTypes.length}
              to={`${base}/billettyper`}
            />
          )}
          {manage && (
            <Row
              icon={
                <IconTile color="#AF52DE">
                  <Armchair />
                </IconTile>
              }
              title="Salkart"
              value={e.seated ? 'I bruk' : 'Ikke i bruk'}
              to={`${base}/salkart`}
            />
          )}
          {manage && (
            <Row
              icon={
                <IconTile color="#34C759">
                  <ListOrdered />
                </IconTile>
              }
              title="Ordre og refusjon"
              value={s ? s.orders : undefined}
              to={`${base}/ordre`}
            />
          )}
          <Row
            icon={
              <IconTile color="#FF9500">
                <Users />
              </IconTile>
            }
            title="Deltakere og gjestebilletter"
            to={`${base}/deltakere`}
          />
          {manage && (
            <Row
              icon={
                <IconTile color="#FF2D55">
                  <Percent />
                </IconTile>
              }
              title="Rabattkoder"
              to={`${base}/rabattkoder`}
            />
          )}
          <Row
            icon={
              <IconTile color="#30B0C7">
                <ScanLine />
              </IconTile>
            }
            title="Innsjekk og skannere"
            to={`${base}/innsjekk`}
          />
        </Section>
        <Section header="Arrangementet">
          <Row
            icon={
              <IconTile color="#8E8E93">
                <Eye />
              </IconTile>
            }
            title="Se arrangementssiden"
            to={`/e/${e.slug}`}
            accessory={<ExternalLink className="h-4 w-4 text-label-3" aria-hidden="true" />}
          />
          <Row
            icon={
              <IconTile color="#8E8E93">
                <Link2 />
              </IconTile>
            }
            title="Kopier lenke til salgssiden"
            onClick={() => void copyLink()}
            chevron={false}
          />
          {manage && e.status !== 'cancelled' && (
            <Row
              icon={
                <IconTile color="#5856D6">
                  <Pencil />
                </IconTile>
              }
              title="Rediger detaljer"
              to={`${base}/rediger`}
            />
          )}
          {manage && (
            <Row
              icon={
                <IconTile color="#5856D6">
                  <Copy />
                </IconTile>
              }
              title="Dupliser"
              subtitle="Lag et nytt utkast med samme oppsett"
              onClick={() => void duplicate()}
              disabled={busy === 'duplicate'}
              chevron={false}
            />
          )}
          {manage && e.status === 'published' && e.endsAt > now && (
            <Row
              icon={
                <IconTile color="#8E8E93">
                  <EyeOff />
                </IconTile>
              }
              title="Gjør om til utkast"
              onClick={() => void unpublish()}
              disabled={busy === 'unpublish'}
              chevron={false}
            />
          )}
          {manage && e.status !== 'cancelled' && e.endsAt > now && (
            <Row
              icon={
                <IconTile color="#FF3B30">
                  <Ban />
                </IconTile>
              }
              title="Avlys arrangementet"
              destructive
              onClick={() => void cancel()}
              disabled={busy === 'cancel'}
              chevron={false}
            />
          )}
        </Section>
      </div>
      <p className="mx-6 mb-6 text-footnote text-label-2">
        Offentlig lenke:{' '}
        <Link to={`/e/${e.slug}`} className="break-all text-tint underline underline-offset-2">
          {appUrl(`/e/${e.slug}`)}
        </Link>
      </p>
    </Page>
  );
}
