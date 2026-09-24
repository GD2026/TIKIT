import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminOverview } from '../../server/services/admin';
import { ORGANIZER_TYPES } from '../../shared/constants';
import { formatNok, formatNokCompact, formatNokWhole } from '../../shared/money';
import { formatAgo } from '../../shared/time';
import { useApi } from '../app/context';
import { errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { ColumnChart, StatTile } from '../components/charts/Charts';
import { SegmentedControl } from '../components/ui/Controls';
import { Button } from '../components/ui/Button';
import { CenterSpinner, QueryError } from '../components/ui/States';
import { useToast } from '../components/ui/Overlays';
import { Card, dayLabels } from '../organizer/shared';
import { adminKey, useAdminQuery } from './shared';

export default function Overview() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useAdminQuery<AdminOverview>('/overview');
  const [measure, setMeasure] = useState<'gmv' | 'fees' | 'tickets'>('gmv');
  const [busy, setBusy] = useState<string | null>(null);
  const d = q.data;

  const approve = async (id: string, name: string) => {
    setBusy(id);
    try {
      await api.post(`/admin/organizers/${id}/review`, { status: 'approved', note: null });
      await qc.invalidateQueries({ queryKey: adminKey() });
      toast({ message: `${name} er godkjent`, tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page title="Oversikt" large wide>
      {q.isLoading && <CenterSpinner />}
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {d && (
        <>
          <div className="mx-4 mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Omsetning (brutto)" value={formatNokWhole(d.gmvOre)} caption="Billetter og gebyrer" />
            <StatTile label="Servicegebyrer" value={formatNokWhole(d.feesOre)} caption="TIKITs inntekt" />
            <StatTile label="Solgte billetter" value={d.ticketsSold.toLocaleString('nb-NO')} caption={`${d.users} brukere`} />
            <StatTile label="Arrangører" value={d.organizers.approved} caption={`${d.organizers.pending} venter · ${d.events.upcoming} kommende arrangementer`} />
          </div>
          <Card className="mx-4 mb-5">
            <SegmentedControl
              label="Vis"
              className="mb-4 max-w-sm"
              value={measure}
              onChange={setMeasure}
              options={[
                { value: 'gmv', label: 'Omsetning' },
                { value: 'fees', label: 'Gebyrer' },
                { value: 'tickets', label: 'Billetter' },
              ]}
            />
            <ColumnChart
              title={measure === 'gmv' ? 'Omsetning per dag, siste 30 dager' : measure === 'fees' ? 'Servicegebyrer per dag, siste 30 dager' : 'Solgte billetter per dag, siste 30 dager'}
              data={d.series.map((s) => {
                const l = dayLabels(s.date);
                return { key: s.date, label: l.short, fullLabel: l.full, value: measure === 'gmv' ? s.gmvOre : measure === 'fees' ? s.feesOre : s.tickets };
              })}
              format={(v) => (measure === 'tickets' ? `${v} billetter` : formatNok(v))}
              axisFormat={(v) => (measure === 'tickets' ? String(Math.round(v)) : formatNokCompact(v).replace(' kr', ''))}
            />
          </Card>
          <section className="mx-4 mb-6" aria-labelledby="venter">
            <div className="mb-2 flex items-baseline justify-between px-1">
              <h2 id="venter" className="text-title3 font-bold">
                Venter på godkjenning
              </h2>
              <Link to="/admin/arrangorer" className="text-subhead text-tint">
                Alle arrangører
              </Link>
            </div>
            {d.pendingOrganizers.length === 0 ? (
              <Card>
                <p className="py-3 text-center text-subhead text-label-2">Ingen søknader venter.</p>
              </Card>
            ) : (
              <ul className="overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
                {d.pendingOrganizers.map((o) => (
                  <li key={o.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body font-medium">{o.name}</p>
                      <p className="truncate text-footnote text-label-2">
                        {ORGANIZER_TYPES.find((t) => t.id === o.type)?.label} · {o.city ?? 'ukjent by'} · søkte {formatAgo(o.createdAt)}
                      </p>
                    </div>
                    <Button size="sm" loading={busy === o.id} onClick={() => void approve(o.id, o.name)}>
                      Godkjenn
                    </Button>
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
