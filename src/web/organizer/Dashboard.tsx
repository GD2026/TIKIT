import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CalendarPlus, CircleAlert, Clock, Plus } from 'lucide-react';
import type { DashboardData } from '../../server/services/stats';
import { formatNok, formatNokCompact, formatNokWhole } from '../../shared/money';
import { formatAgo, formatDateShort, formatTime } from '../../shared/time';
import { Page } from '../components/layout/Page';
import { ColumnChart, Meter, StatTile } from '../components/charts/Charts';
import { SegmentedControl } from '../components/ui/Controls';
import { EmptyState, Pill, Skeleton } from '../components/ui/Feedback';
import { LinkButton } from '../components/ui/Button';
import { QueryError } from '../components/ui/States';
import { Card, canManage, dayLabels, useOrg, useOrgQuery } from './shared';

function StatusBanner() {
  const { org } = useOrg();
  if (org.status === 'approved') return null;
  const text =
    org.status === 'pending'
      ? { title: 'Venter på godkjenning', body: 'Dere kan lage arrangementer og billetter nå. Når TIKIT har godkjent arrangøren, kan dere publisere.', tone: 'bg-orange-soft text-orange' }
      : org.status === 'rejected'
        ? { title: 'Søknaden ble ikke godkjent', body: org.statusNote ?? 'Ta kontakt med TIKIT for mer informasjon.', tone: 'bg-red-soft text-red' }
        : { title: 'Arrangøren er suspendert', body: org.statusNote ?? 'Billettsalget er stoppet. Ta kontakt med TIKIT.', tone: 'bg-red-soft text-red' };
  return (
    <div role="status" className={`mx-4 mb-5 flex gap-3 rounded-md px-4 py-3.5 ${text.tone}`}>
      {org.status === 'pending' ? <Clock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /> : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />}
      <div>
        <p className="text-headline font-semibold">{text.title}</p>
        <p className="mt-0.5 text-subhead text-label">{text.body}</p>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { org } = useOrg();
  const q = useOrgQuery<DashboardData>(org.id, '/dashboard');
  const [measure, setMeasure] = useState<'tickets' | 'revenue'>('tickets');
  const d = q.data;
  const manage = canManage(org.role);

  const series = useMemo(
    () =>
      (d?.series ?? []).map((s) => {
        const l = dayLabels(s.date);
        return { key: s.date, label: l.short, fullLabel: l.full, value: measure === 'revenue' ? s.revenueOre : s.tickets };
      }),
    [d, measure],
  );

  return (
    <Page
      title="Oversikt"
      large
      wide
      subtitle={org.name}
      largeAccessory={
        manage ? (
          <LinkButton to={`/arrangor/${org.id}/arrangementer/ny`} size="sm" icon={<Plus className="h-4 w-4" />} className="mb-1">
            Nytt arrangement
          </LinkButton>
        ) : undefined
      }
    >
      <StatusBanner />
      {q.isLoading && (
        <div className="mx-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[92px] rounded-md" />
          ))}
        </div>
      )}
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {d && (
        <>
          <div className="mx-4 mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {d.canSeeRevenue && <StatTile label="Billettinntekt" value={formatNokWhole(d.kpis.revenueOre)} caption="Etter refusjoner, totalt" />}
            <StatTile label="Solgte billetter" value={d.kpis.ticketsSold.toLocaleString('nb-NO')} caption={`${d.kpis.orders} ordre`} />
            <StatTile label="I dag" value={`${d.kpis.todayTickets} billetter`} caption={d.canSeeRevenue ? formatNok(d.kpis.todayRevenueOre) : undefined} />
            {d.canSeeRevenue ? (
              <StatTile label="Snitt per ordre" value={formatNokWhole(d.kpis.avgOrderOre)} caption={`${d.kpis.upcomingEvents} kommende arrangementer`} />
            ) : (
              <StatTile label="Kommende arrangementer" value={d.kpis.upcomingEvents} />
            )}
          </div>

          <Card className="mx-4 mb-5">
            {d.canSeeRevenue && (
              <SegmentedControl
                label="Vis"
                className="mb-4 max-w-xs"
                value={measure}
                onChange={setMeasure}
                options={[
                  { value: 'tickets', label: 'Billetter' },
                  { value: 'revenue', label: 'Inntekt' },
                ]}
              />
            )}
            <ColumnChart
              title={measure === 'revenue' ? 'Billettinntekt per dag, siste 30 dager' : 'Solgte billetter per dag, siste 30 dager'}
              data={series}
              format={(v) => (measure === 'revenue' ? formatNok(v) : v === 1 ? '1 billett' : `${v} billetter`)}
              axisFormat={(v) => (measure === 'revenue' ? formatNokCompact(v).replace(' kr', '') : String(Math.round(v)))}
              emptyText="Ingen salg de siste 30 dagene"
            />
          </Card>

          <div className="grid gap-5 lg:grid-cols-2 lg:px-4">
            <section aria-labelledby="topp" className="mx-4 lg:mx-0">
              <h2 id="topp" className="mb-2 px-1 text-title3 font-bold">
                Arrangementer
              </h2>
              {d.topEvents.length === 0 ? (
                <Card>
                  <EmptyState
                    icon={<CalendarPlus />}
                    title="Ingen arrangementer ennå"
                    message="Lag det første arrangementet – det tar et par minutter."
                    action={manage ? <LinkButton to={`/arrangor/${org.id}/arrangementer/ny`}>Nytt arrangement</LinkButton> : undefined}
                    className="py-6"
                  />
                </Card>
              ) : (
                <div className="overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
                  {d.topEvents.map((e) => (
                    <Link key={e.id} to={`/arrangor/${org.id}/arrangementer/${e.id}`} className="block px-4 py-3 no-underline text-label transition-colors hover:bg-fill-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="truncate text-headline font-semibold">{e.title}</p>
                        {d.canSeeRevenue && <span className="shrink-0 text-subhead text-label-2 tabular">{formatNok(e.revenueOre)}</span>}
                      </div>
                      <p className="mb-2 text-footnote text-label-2">
                        {formatDateShort(e.startsAt)} kl. {formatTime(e.startsAt)} {e.status === 'draft' ? '· Utkast' : e.status === 'cancelled' ? '· Avlyst' : ''}
                      </p>
                      <Meter value={e.sold} max={Math.max(e.capacity, e.sold)} label={`Solgt for ${e.title}`} />
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {d.canSeeRevenue && (
              <section aria-labelledby="siste" className="mx-4 mt-2 lg:mx-0 lg:mt-0">
                <h2 id="siste" className="mb-2 px-1 text-title3 font-bold">
                  Siste salg
                </h2>
                {d.recentOrders.length === 0 ? (
                  <Card>
                    <p className="py-4 text-center text-subhead text-label-2">Salg dukker opp her i sanntid.</p>
                  </Card>
                ) : (
                  <ul className="overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
                    {d.recentOrders.map((o) => (
                      <li key={o.id} className="flex items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body font-medium">{o.buyerName}</p>
                          <p className="truncate text-footnote text-label-2">
                            {o.eventTitle} · {o.tickets === 1 ? '1 billett' : `${o.tickets} billetter`}
                            {o.kind === 'resale' ? ' · videresalg' : ''}
                          </p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-subhead font-semibold tabular">{o.kind === 'resale' ? <Pill tone="neutral">Videresalg</Pill> : formatNok(o.ticketOre)}</p>
                          <p className="text-footnote text-label-2">{formatAgo(o.at)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        </>
      )}
    </Page>
  );
}
