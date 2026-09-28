import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PlatformSettings } from '../../shared/types';
import { formatNok, oreToInput, parseKroner } from '../../shared/money';
import { feeForPrice } from '../../shared/pricing';
import { useApi } from '../app/context';
import { qk } from '../api/hooks';
import { errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { TextField } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { CenterSpinner, QueryError } from '../components/ui/States';
import { useToast } from '../components/ui/Overlays';
import { adminKey, useAdminQuery } from './shared';

const SAMPLES = [0, 5000, 20000, 34900, 49900, 89000, 150000];

export default function Settings() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useAdminQuery<PlatformSettings>('/settings');
  const [fixed, setFixed] = useState('');
  const [percent, setPercent] = useState('');
  const [max, setMax] = useState('');
  const [resale, setResale] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.data) return;
    setFixed(oreToInput(q.data.feeFixedOre));
    setPercent(String(q.data.feePercentBp / 100).replace('.', ','));
    setMax(oreToInput(q.data.feeMaxOre));
    setResale(String(q.data.resaleFeePercentBp / 100).replace('.', ','));
  }, [q.data]);

  const pct = (v: string) => {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  };
  const draft = { feeFixedOre: parseKroner(fixed) ?? NaN, feePercentBp: pct(percent), feeMaxOre: parseKroner(max) ?? NaN, resaleFeePercentBp: pct(resale) };
  const valid = Object.values(draft).every((v) => Number.isFinite(v) && v >= 0) && draft.feeFixedOre <= 10000 && draft.feePercentBp <= 2000 && draft.feeMaxOre <= 50000 && draft.resaleFeePercentBp <= 2000;

  const save = async () => {
    setBusy(true);
    try {
      await api.put('/admin/settings', draft);
      await qc.invalidateQueries({ queryKey: adminKey() });
      await qc.invalidateQueries({ queryKey: qk.config });
      toast({ message: 'Gebyrene er oppdatert for nye kjøp', tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Gebyrer" large>
      {q.isLoading && <CenterSpinner />}
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && (
        <div className="mx-4 pb-8">
          <p className="mb-4 px-1 text-subhead text-label-2">Servicegebyret betales av kjøperen per billett, avrundes til hele kroner og gjelder bare nye kjøp. Gratisbilletter har aldri gebyr.</p>
          <form
            className="mb-6 flex flex-col gap-4 rounded-md bg-grouped-2 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) void save();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField label="Fast del (kr)" inputMode="decimal" value={fixed} onChange={(e) => setFixed(e.target.value)} hint="Maks 100 kr" />
              <TextField label="Prosent av pris" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} hint="Maks 20 %" />
              <TextField label="Tak per billett (kr)" inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} hint="Maks 500 kr" />
            </div>
            <TextField label="Gebyr på videresalg (% av prisen, trekkes fra selgeren)" inputMode="decimal" value={resale} onChange={(e) => setResale(e.target.value)} hint="0 betyr at selgeren får hele prisen tilbake." />
            <Button type="submit" size="lg" loading={busy} disabled={!valid}>
              Lagre gebyrer
            </Button>
          </form>
          <h2 className="mb-1.5 px-4 text-footnote uppercase tracking-[0.02em] text-label-2">Eksempler</h2>
          <div className="overflow-hidden rounded-md bg-grouped-2">
            <table className="w-full text-subhead">
              <thead>
                <tr className="text-left text-footnote text-label-2">
                  <th scope="col" className="px-4 py-2 font-medium">
                    Billettpris
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Gebyr
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Kjøper betaler
                  </th>
                </tr>
              </thead>
              <tbody className="tabular">
                {SAMPLES.map((p) => {
                  const fee = valid ? feeForPrice(p, draft) : 0;
                  return (
                    <tr key={p} className="hairline-t">
                      <td className="px-4 py-2">{p === 0 ? 'Gratis' : formatNok(p)}</td>
                      <td className="px-4 py-2 text-right">{formatNok(fee)}</td>
                      <td className="px-4 py-2 text-right font-semibold">{formatNok(p + fee)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Page>
  );
}
