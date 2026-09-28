import { Link } from 'react-router';
import { Landmark, Wallet } from 'lucide-react';
import type { SettlementData } from '../../server/services/stats';
import { formatNok, formatNokWhole } from '../../shared/money';
import { formatDateShort } from '../../shared/time';
import { ApiError } from '../api/client';
import { Page } from '../components/layout/Page';
import { StatTile } from '../components/charts/Charts';
import { EmptyState } from '../components/ui/Feedback';
import { CenterSpinner, QueryError } from '../components/ui/States';
import { Card, canManage, useOrg, useOrgQuery } from './shared';

function formatAccount(a: string): string {
  return a.length === 11 ? `${a.slice(0, 4)} ${a.slice(4, 6)} ${a.slice(6)}` : a;
}

export default function Settlement() {
  const { org } = useOrg();
  const q = useOrgQuery<SettlementData>(org.id, '/settlement', { enabled: canManage(org.role) });
  const d = q.data;
  return (
    <Page title="Oppgjør" large wide>
      {!canManage(org.role) ? (
        <QueryError error={new ApiError('forbidden', 'Du må være administrator for å se oppgjøret.', 403)} />
      ) : q.isLoading ? (
        <CenterSpinner />
      ) : q.isError || !d ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="mx-4 mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Til gode" value={formatNokWhole(d.totals.balanceOre)} caption="Netto salg minus utbetalt" />
            <StatTile label="Netto billettsalg" value={formatNokWhole(d.totals.netOre)} caption={`${formatNok(d.totals.refundsOre)} refundert`} />
            <StatTile label="Utbetalt" value={formatNokWhole(d.totals.paidOutOre)} caption={`${d.payouts.length} utbetalinger`} />
            <StatTile label="Kommende arrangementer" value={formatNokWhole(d.totals.pendingOre)} caption="Utbetales etter arrangementet" />
          </div>

          <Card className="mx-4 mb-6 flex items-center gap-3">
            <Landmark className="h-6 w-6 shrink-0 text-label-2" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-headline font-semibold">Utbetaling til {d.payoutAccount ? formatAccount(d.payoutAccount) : 'konto mangler'}</p>
              <p className="text-subhead text-label-2">
                {d.payoutAccount ? 'Oppgjøret utbetales etter hvert arrangement. Servicegebyret betales av kjøperne og går til TIKIT.' : 'Legg inn kontonummer under Innstillinger, så vi kan betale ut.'}
              </p>
            </div>
            {!d.payoutAccount && (
              <Link to={`/arrangor/${org.id}/innstillinger`} className="shrink-0 text-subhead font-semibold text-tint">
                Legg til
              </Link>
            )}
          </Card>

          <section className="mx-4 mb-6" aria-labelledby="per-arr">
            <h2 id="per-arr" className="mb-2 px-1 text-title3 font-bold">
              Per arrangement
            </h2>
            {d.events.length === 0 ? (
              <Card>
                <EmptyState icon={<Wallet />} title="Ingen salg ennå" className="py-6" />
              </Card>
            ) : (
              <>
              {/* Phones: one row per event, net amount on the right. */}
              <ul className="overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t md:hidden">
                {d.events.map((e) => (
                  <li key={e.id}>
                    <Link to={`/arrangor/${org.id}/arrangementer/${e.id}`} className="flex items-center gap-3 px-4 py-3 no-underline text-label transition-colors hover:bg-fill-4">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium">{e.title}</span>
                        <span className="block text-footnote text-label-2 tabular">
                          {formatDateShort(e.startsAt)} · {e.tickets === 1 ? '1 billett' : `${e.tickets} billetter`}
                          {e.refundsOre > 0 ? ` · ${formatNok(e.refundsOre)} refundert` : ''}
                        </span>
                      </span>
                      <span className="shrink-0 text-right tabular">
                        <span className="block text-body font-semibold">{formatNok(e.netOre)}</span>
                        <span className="block text-footnote text-label-2">netto</span>
                      </span>
                    </Link>
                  </li>
                ))}
                <li className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-body font-semibold">Totalt</span>
                  <span className="text-body font-semibold tabular">{formatNok(d.totals.netOre)}</span>
                </li>
              </ul>
              <div className="hidden overflow-x-auto rounded-md bg-grouped-2 md:block">
                <table className="w-full text-subhead">
                  <thead>
                    <tr className="text-left text-footnote text-label-2">
                      <th scope="col" className="px-4 py-2.5 font-medium">
                        Arrangement
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">
                        Billetter
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">
                        Brutto
                      </th>
                      <th scope="col" className="px-3 py-2.5 text-right font-medium">
                        Refundert
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-medium">
                        Netto
                      </th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {d.events.map((e) => (
                      <tr key={e.id} className="hairline-t">
                        <td className="px-4 py-2.5">
                          <Link to={`/arrangor/${org.id}/arrangementer/${e.id}`} className="font-medium text-label no-underline hover:underline">
                            {e.title}
                          </Link>
                          <span className="block text-footnote text-label-2">{formatDateShort(e.startsAt)}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">{e.tickets}</td>
                        <td className="px-3 py-2.5 text-right">{formatNok(e.grossOre)}</td>
                        <td className="px-3 py-2.5 text-right">{e.refundsOre > 0 ? `−${formatNok(e.refundsOre)}` : '–'}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">{formatNok(e.netOre)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="hairline-t font-semibold">
                      <td className="px-4 py-2.5">Totalt</td>
                      <td className="px-3 py-2.5 text-right">{d.events.reduce((n, e) => n + e.tickets, 0)}</td>
                      <td className="px-3 py-2.5 text-right">{formatNok(d.totals.grossOre)}</td>
                      <td className="px-3 py-2.5 text-right">{d.totals.refundsOre > 0 ? `−${formatNok(d.totals.refundsOre)}` : '–'}</td>
                      <td className="px-4 py-2.5 text-right">{formatNok(d.totals.netOre)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              </>
            )}
          </section>

          <section className="mx-4 mb-6" aria-labelledby="utbet">
            <h2 id="utbet" className="mb-2 px-1 text-title3 font-bold">
              Utbetalinger
            </h2>
            {d.payouts.length === 0 ? (
              <Card>
                <p className="py-3 text-center text-subhead text-label-2">Ingen utbetalinger ennå.</p>
              </Card>
            ) : (
              <ul className="overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
                {d.payouts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block text-body">{p.reference}</span>
                      <span className="block text-footnote text-label-2">
                        {formatDateShort(p.createdAt)}
                        {p.note ? ` · ${p.note}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 font-semibold tabular">{formatNok(p.amountOre)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </Page>
  );
}
