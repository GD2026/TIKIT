import { useState } from 'react';
import { useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Percent, Plus } from 'lucide-react';
import type { DiscountWithStats } from '../../server/services/discounts';
import type { OrgEventDetail } from '../../server/services/events';
import { formatNok, oreToInput, parseKroner } from '../../shared/money';
import { formatDateShort, osloLocalToUtc, toOsloInput } from '../../shared/time';
import { useApi } from '../app/context';
import { ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { TextField } from '../components/ui/Field';
import { Chip, EmptyState, Pill } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { SegmentedControl, Switch } from '../components/ui/Controls';
import { Sheet } from '../components/ui/Sheet';
import { ListSkeleton, QueryError } from '../components/ui/States';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { canManage, orgKey, useOrg, useOrgQuery } from './shared';

interface Draft {
  code: string;
  kind: 'percent' | 'fixed';
  value: string;
  maxUses: string;
  ticketTypeIds: string[];
  validFrom: string;
  validUntil: string;
  active: boolean;
}

function toDraft(d: DiscountWithStats | null): Draft {
  if (!d) return { code: '', kind: 'percent', value: '20', maxUses: '', ticketTypeIds: [], validFrom: '', validUntil: '', active: true };
  return {
    code: d.code,
    kind: d.kind,
    value: d.kind === 'percent' ? String(d.value) : oreToInput(d.value),
    maxUses: d.maxUses === null ? '' : String(d.maxUses),
    ticketTypeIds: d.ticketTypeIds,
    validFrom: d.validFrom ? toOsloInput(d.validFrom) : '',
    validUntil: d.validUntil ? toOsloInput(d.validUntil) : '',
    active: d.active,
  };
}

function iso(local: string): string | null {
  if (!local) return null;
  try {
    return osloLocalToUtc(local).toISOString();
  } catch {
    return null;
  }
}

function DiscountSheet({ open, editing, onClose, detail }: { open: boolean; editing: DiscountWithStats | null; onClose: () => void; detail: OrgEventDetail }) {
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [d, setD] = useState<Draft>(() => toDraft(editing));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  const save = async () => {
    const value = d.kind === 'percent' ? Number(d.value) : parseKroner(d.value);
    const local: Record<string, string> = {};
    if (!/^[A-Za-z0-9ÆØÅæøå_-]{3,30}$/.test(d.code.trim())) local.code = 'Minst 3 tegn: bokstaver, tall, - og _.';
    if (value === null || !Number.isFinite(value) || value < 1) local.value = d.kind === 'percent' ? 'Skriv en prosent fra 1 til 100.' : 'Skriv et beløp.';
    if (d.kind === 'percent' && value !== null && value > 100) local.value = 'Maks 100 %.';
    setErrors(local);
    if (Object.keys(local).length) return;
    setBusy(true);
    const body = {
      code: d.code.trim().toUpperCase(),
      kind: d.kind,
      value: d.kind === 'percent' ? Math.round(value!) : value,
      maxUses: d.maxUses ? Number(d.maxUses) : null,
      ticketTypeIds: d.ticketTypeIds,
      validFrom: iso(d.validFrom),
      validUntil: iso(d.validUntil),
      active: d.active,
    };
    try {
      if (editing) await api.put(`/org/${org.id}/discounts/${editing.id}`, body);
      else await api.post(`/org/${org.id}/events/${detail.event.id}/discounts`, body);
      await qc.invalidateQueries({ queryKey: orgKey(org.id) });
      toast({ message: editing ? 'Rabattkoden er oppdatert' : `Rabattkoden ${body.code} er klar`, tone: 'success' });
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    const ok = await confirm({ title: `Slette ${editing.code}?`, message: 'Er koden brukt, deaktiveres den i stedet, så statistikken beholdes.', confirmLabel: 'Slett', destructive: true });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await api.del<{ result: 'deleted' | 'deactivated' }>(`/org/${org.id}/discounts/${editing.id}`);
      await qc.invalidateQueries({ queryKey: orgKey(org.id) });
      toast({ message: res.result === 'deleted' ? 'Rabattkoden er slettet' : 'Rabattkoden er deaktivert', tone: 'success' });
      onClose();
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} locked={busy} title={editing ? `Rediger ${editing.code}` : 'Ny rabattkode'} size="large">
      <form
        className="flex flex-col gap-4 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        <TextField label="Kode" value={d.code} onChange={(e) => set('code', e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={30} error={errors.code} placeholder="STYRET20" />
        <SegmentedControl
          label="Type rabatt"
          value={d.kind}
          onChange={(v) => set('kind', v)}
          options={[
            { value: 'percent', label: 'Prosent' },
            { value: 'fixed', label: 'Kroner per billett' },
          ]}
        />
        <TextField
          label={d.kind === 'percent' ? 'Prosent' : 'Kroner per billett'}
          inputMode="decimal"
          value={d.value}
          onChange={(e) => set('value', e.target.value)}
          error={errors.value}
          trailing={<span className="pr-2 text-body text-label-2">{d.kind === 'percent' ? '%' : 'kr'}</span>}
        />
        <TextField label="Maks antall bruk (valgfritt)" inputMode="numeric" value={d.maxUses} onChange={(e) => set('maxUses', e.target.value)} placeholder="Ubegrenset" error={errors.maxUses} hint="Én bruk = én bestilling." />
        <div>
          <p className="mb-2 px-1 text-subhead font-medium text-label-2">Gjelder billettyper</p>
          <div className="flex flex-wrap gap-2">
            <Chip selected={d.ticketTypeIds.length === 0} onClick={() => set('ticketTypeIds', [])}>
              Alle
            </Chip>
            {detail.ticketTypes.map((t) => (
              <Chip
                key={t.id}
                selected={d.ticketTypeIds.includes(t.id)}
                onClick={() => set('ticketTypeIds', d.ticketTypeIds.includes(t.id) ? d.ticketTypeIds.filter((x) => x !== t.id) : [...d.ticketTypeIds, t.id])}
              >
                {t.name}
              </Chip>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Gyldig fra (valgfritt)" type="datetime-local" value={d.validFrom} onChange={(e) => set('validFrom', e.target.value)} />
          <TextField label="Gyldig til (valgfritt)" type="datetime-local" value={d.validUntil} onChange={(e) => set('validUntil', e.target.value)} />
        </div>
        <label className="flex items-center justify-between gap-3 rounded-md bg-grouped-2 px-4 py-3">
          <span className="text-body">Aktiv</span>
          <Switch checked={d.active} onChange={(v) => set('active', v)} label="Aktiv" />
        </label>
        <Button type="submit" size="lg" full loading={busy}>
          {editing ? 'Lagre' : 'Opprett rabattkode'}
        </Button>
        {editing && (
          <Button variant="destructive" full onClick={() => void remove()} disabled={busy}>
            Slett rabattkoden
          </Button>
        )}
      </form>
    </Sheet>
  );
}

export default function Discounts() {
  const { eventId } = useParams();
  const { org } = useOrg();
  const detail = useOrgQuery<OrgEventDetail>(org.id, `/events/${eventId}`);
  const q = useOrgQuery<{ discounts: DiscountWithStats[] }>(org.id, `/events/${eventId}/discounts`, { enabled: canManage(org.role) });
  const [sheet, setSheet] = useState<{ open: boolean; editing: DiscountWithStats | null; n: number }>({ open: false, editing: null, n: 0 });
  const list = q.data?.discounts ?? [];

  return (
    <Page title="Rabattkoder" back={`/arrangor/${org.id}/arrangementer/${eventId}`}>
      {!canManage(org.role) ? (
        <QueryError error={new ApiError('forbidden', 'Du må være administrator for å se rabattkoder.', 403)} />
      ) : (
        <>
          <div className="mx-4 mb-4 flex items-center justify-between gap-3">
            <p className="text-subhead text-label-2">Kjøpere skriver koden i kassen.</p>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setSheet((s) => ({ open: true, editing: null, n: s.n + 1 }))} disabled={!detail.data}>
              Ny kode
            </Button>
          </div>
          {q.isLoading && <ListSkeleton rows={3} />}
          {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
          {q.data && list.length === 0 && <EmptyState icon={<Percent />} title="Ingen rabattkoder" message="Lag koder for russestyret, early bird-kampanjer eller samarbeidspartnere." />}
          {list.length > 0 && (
            <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
              {list.map((dc) => (
                <button key={dc.id} type="button" onClick={() => setSheet((s) => ({ open: true, editing: dc, n: s.n + 1 }))} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fill-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-body font-semibold">{dc.code}</p>
                    <p className="text-footnote text-label-2 tabular">
                      {dc.kind === 'percent' ? `${dc.value} %` : `${formatNok(dc.value)} per billett`} · brukt {dc.paidUses}
                      {dc.maxUses ? ` av ${dc.maxUses}` : ''} · −{formatNok(dc.discountGivenOre)}
                      {dc.validUntil ? ` · til ${formatDateShort(dc.validUntil)}` : ''}
                    </p>
                  </div>
                  <Pill tone={dc.active ? 'green' : 'neutral'}>{dc.active ? 'Aktiv' : 'Av'}</Pill>
                </button>
              ))}
            </div>
          )}
          {detail.data && <DiscountSheet key={sheet.n} open={sheet.open} editing={sheet.editing} onClose={() => setSheet((s) => ({ ...s, open: false }))} detail={detail.data} />}
        </>
      )}
    </Page>
  );
}
