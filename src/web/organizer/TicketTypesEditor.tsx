import { useState } from 'react';
import { useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from 'lucide-react';
import type { OrgEventDetail, OrgTicketType } from '../../server/services/events';
import { LIMITS } from '../../shared/constants';
import { formatNok, oreToInput, parseKroner } from '../../shared/money';
import { osloLocalToUtc, toOsloInput } from '../../shared/time';
import { useApi } from '../app/context';
import { ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { BottomBar } from '../components/layout/BottomBar';
import { SelectField, TextArea, TextField } from '../components/ui/Field';
import { Button, IconButton } from '../components/ui/Button';
import { Pill } from '../components/ui/Feedback';
import { Switch } from '../components/ui/Controls';
import { CenterSpinner, QueryError } from '../components/ui/States';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { cn } from '../lib/cn';
import { canManage, orgKey, useOrg, useOrgQuery } from './shared';

interface Draft {
  key: string;
  id?: string;
  name: string;
  description: string;
  price: string;
  capacity: string;
  maxPerOrder: string;
  salesStartAt: string;
  salesEndAt: string;
  hidden: boolean;
  accessCode: string;
  hasAccessCode: boolean;
  vatRate: 0 | 12 | 25;
  paused: boolean;
  sold: number;
  held: number;
  seated: boolean;
}

let seq = 0;
const k = () => `t${++seq}`;

function toDraft(t: OrgTicketType, seated: boolean): Draft {
  return {
    key: k(),
    id: t.id,
    name: t.name,
    description: t.description,
    price: oreToInput(t.priceOre),
    capacity: String(t.capacity),
    maxPerOrder: t.maxPerOrder === null ? '' : String(t.maxPerOrder),
    salesStartAt: t.salesStartAt ? toOsloInput(t.salesStartAt) : '',
    salesEndAt: t.salesEndAt ? toOsloInput(t.salesEndAt) : '',
    hidden: t.hidden,
    accessCode: '',
    hasAccessCode: t.hasAccessCode,
    vatRate: t.vatRate,
    paused: t.paused,
    sold: t.sold,
    held: t.held,
    seated,
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

function TypeCard({ d, index, count, onChange, onRemove, onMove, errors }: { d: Draft; index: number; count: number; onChange: (p: Partial<Draft>) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void; errors: Record<string, string> }) {
  const [open, setOpen] = useState(!d.id);
  const e = (f: string) => errors[`ticketTypes.${index}.${f}`] || null;
  return (
    <div className="mb-3 overflow-hidden rounded-md bg-grouped-2">
      <div className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className={cn('h-5 w-5 shrink-0 text-label-3 transition-transform', !open && '-rotate-90')} aria-hidden="true" />
          <span className="min-w-0">
            <span className="block truncate text-headline font-semibold">{d.name || 'Ny billettype'}</span>
            <span className="block text-footnote text-label-2 tabular">
              {parseKroner(d.price) === 0 ? 'Gratis' : formatNok(parseKroner(d.price) ?? 0)} · {d.sold} solgt av {d.capacity || 0}
              {d.held > 0 ? ` · ${d.held} reservert` : ''}
            </span>
          </span>
        </button>
        {d.hidden && <Pill tone="tint">Skjult</Pill>}
        {d.paused && <Pill tone="orange">Pause</Pill>}
        <IconButton label="Flytt opp" variant="plain" disabled={index === 0} onClick={() => onMove(-1)}>
          <ArrowUp className="h-4 w-4" />
        </IconButton>
        <IconButton label="Flytt ned" variant="plain" disabled={index === count - 1} onClick={() => onMove(1)}>
          <ArrowDown className="h-4 w-4" />
        </IconButton>
      </div>
      {open && (
        <div className="flex flex-col gap-4 px-4 pb-4 hairline-t pt-4">
          <TextField label="Navn" value={d.name} onChange={(ev) => onChange({ name: ev.target.value })} maxLength={60} error={e('name')} />
          <TextArea label="Beskrivelse (valgfritt)" value={d.description} onChange={(ev) => onChange({ description: ev.target.value })} rows={2} maxLength={300} error={e('description')} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <TextField label="Pris (kr)" inputMode="decimal" value={d.price} onChange={(ev) => onChange({ price: ev.target.value })} error={e('priceOre')} hint={d.sold > 0 ? 'Endring gjelder nye kjøp' : undefined} />
            <TextField
              label="Antall"
              inputMode="numeric"
              value={d.capacity}
              onChange={(ev) => onChange({ capacity: ev.target.value })}
              disabled={d.seated}
              hint={d.seated ? 'Styres av salkartet' : d.sold > 0 ? `Minst ${d.sold}` : undefined}
              error={e('capacity')}
            />
            <TextField label="Maks per kjøp" inputMode="numeric" placeholder="Som arrangementet" value={d.maxPerOrder} onChange={(ev) => onChange({ maxPerOrder: ev.target.value })} error={e('maxPerOrder')} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Salg fra (valgfritt)" type="datetime-local" value={d.salesStartAt} onChange={(ev) => onChange({ salesStartAt: ev.target.value })} error={e('salesStartAt')} />
            <TextField label="Salg til (valgfritt)" type="datetime-local" value={d.salesEndAt} onChange={(ev) => onChange({ salesEndAt: ev.target.value })} error={e('salesEndAt')} />
          </div>
          <SelectField
            label="Mva. på billetten"
            value={String(d.vatRate)}
            onChange={(ev) => onChange({ vatRate: Number(ev.target.value) as 0 | 12 | 25 })}
            options={[
              { value: '0', label: '0 % (unntatt fra mva.)' },
              { value: '12', label: '12 %' },
              { value: '25', label: '25 %' },
            ]}
            hint="Mange kulturarrangementer er unntatt fra mva. Er dere usikre, spør en regnskapsfører."
          />
          <div className="-mx-4 hairline-t">
            <label className="flex min-h-12 items-center gap-3 px-4 py-2.5">
              <span className="flex-1">
                <span className="block text-body">Skjult billettype</span>
                <span className="block text-footnote text-label-2">Vises bare for dem som har tilgangskoden</span>
              </span>
              <Switch checked={d.hidden} onChange={(v) => onChange({ hidden: v })} label="Skjult billettype" />
            </label>
            {d.hidden && (
              <div className="px-4 pb-3">
                <TextField
                  label={d.hasAccessCode ? 'Ny tilgangskode (tom = behold dagens)' : 'Tilgangskode'}
                  value={d.accessCode}
                  onChange={(ev) => onChange({ accessCode: ev.target.value })}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={40}
                  error={e('accessCode')}
                  hint="Del koden med dem som skal kjøpe, for eksempel russestyret."
                />
              </div>
            )}
            <label className="flex min-h-12 items-center gap-3 px-4 py-2.5 hairline-t">
              <span className="flex-1">
                <span className="block text-body">Sett salget på pause</span>
                <span className="block text-footnote text-label-2">Stopper salget av denne typen midlertidig</span>
              </span>
              <Switch checked={d.paused} onChange={(v) => onChange({ paused: v })} label="Sett salget på pause" />
            </label>
          </div>
          {d.sold === 0 && !d.seated && (
            <Button variant="destructive" size="sm" className="self-start" icon={<Trash2 className="h-4 w-4" />} onClick={onRemove}>
              Slett billettypen
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function EditorBody({ detail }: { detail: OrgEventDetail }) {
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const seatedIds = new Set(detail.seatMap?.sections.map((s) => s.ticketTypeId) ?? []);
  const [drafts, setDrafts] = useState<Draft[]>(() => detail.ticketTypes.map((t) => toDraft(t, seatedIds.has(t.id))));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const update = (key: string, patch: Partial<Draft>) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    setDirty(true);
  };
  const move = (i: number, dir: -1 | 1) => {
    setDrafts((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
    setDirty(true);
  };

  const save = async () => {
    const local: Record<string, string> = {};
    drafts.forEach((d, i) => {
      if (d.name.trim().length < 2) local[`ticketTypes.${i}.name`] = 'Skriv et navn.';
      if (parseKroner(d.price) === null) local[`ticketTypes.${i}.priceOre`] = 'Ugyldig pris.';
      const cap = Number(d.capacity);
      if (!d.seated && (!Number.isInteger(cap) || cap < 1)) local[`ticketTypes.${i}.capacity`] = 'Minst 1.';
      if (!d.seated && Number.isInteger(cap) && cap < d.sold) local[`ticketTypes.${i}.capacity`] = `Kan ikke være lavere enn ${d.sold} solgte.`;
      if (d.maxPerOrder && (!Number.isInteger(Number(d.maxPerOrder)) || Number(d.maxPerOrder) < 1)) local[`ticketTypes.${i}.maxPerOrder`] = 'Ugyldig antall.';
      if (d.hidden && !d.hasAccessCode && !d.accessCode.trim()) local[`ticketTypes.${i}.accessCode`] = 'Skriv en tilgangskode.';
    });
    setErrors(local);
    if (Object.keys(local).length) {
      toast({ message: 'Noen felt må rettes', tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      await api.put(`/org/${org.id}/events/${detail.event.id}/ticket-types`, {
        ticketTypes: drafts.map((d, i) => ({
          ...(d.id ? { id: d.id } : {}),
          name: d.name.trim(),
          description: d.description.trim(),
          priceOre: parseKroner(d.price) ?? 0,
          capacity: d.seated ? Math.max(1, Number(d.capacity) || 1) : Number(d.capacity),
          maxPerOrder: d.maxPerOrder ? Math.min(LIMITS.maxTicketsPerOrder, Number(d.maxPerOrder)) : null,
          salesStartAt: iso(d.salesStartAt),
          salesEndAt: iso(d.salesEndAt),
          hidden: d.hidden,
          accessCode: d.hidden && d.accessCode.trim() ? d.accessCode.trim() : null,
          vatRate: d.vatRate,
          paused: d.paused,
          sortOrder: i,
        })),
      });
      await qc.invalidateQueries({ queryKey: orgKey(org.id) });
      await qc.invalidateQueries({ queryKey: ['event'] });
      setDirty(false);
      toast({ message: 'Billettypene er lagret', tone: 'success' });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-4">
      <p className="mb-4 px-2 text-subhead text-label-2">Kjøperen ser billettypene i denne rekkefølgen. Servicegebyret til TIKIT kommer i tillegg til prisen.</p>
      {drafts.map((d, i) => (
        <TypeCard
          key={d.key}
          d={d}
          index={i}
          count={drafts.length}
          errors={errors}
          onChange={(p) => update(d.key, p)}
          onMove={(dir) => move(i, dir)}
          onRemove={async () => {
            const ok = await confirm({ title: `Slette «${d.name || 'billettypen'}»?`, confirmLabel: 'Slett', destructive: true });
            if (ok) {
              setDrafts((prev) => prev.filter((x) => x.key !== d.key));
              setDirty(true);
            }
          }}
        />
      ))}
      {drafts.length < LIMITS.ticketTypesMax && (
        <Button
          variant="tinted"
          className="mb-4"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => {
            setDrafts((prev) => [
              ...prev,
              { key: k(), name: '', description: '', price: '', capacity: '100', maxPerOrder: '', salesStartAt: '', salesEndAt: '', hidden: false, accessCode: '', hasAccessCode: false, vatRate: 0, paused: false, sold: 0, held: 0, seated: false },
            ]);
            setDirty(true);
          }}
        >
          Legg til billettype
        </Button>
      )}
      <BottomBar aboveTabBar>
        <Button size="lg" full loading={busy} disabled={!dirty} onClick={() => void save()}>
          {dirty ? 'Lagre billettyper' : 'Ingen endringer'}
        </Button>
      </BottomBar>
    </div>
  );
}

export default function TicketTypesEditor() {
  const { eventId } = useParams();
  const { org } = useOrg();
  const q = useOrgQuery<OrgEventDetail>(org.id, `/events/${eventId}`);
  return (
    <Page title="Billettyper" back={`/arrangor/${org.id}/arrangementer/${eventId}`}>
      {!canManage(org.role) ? (
        <QueryError error={new ApiError('forbidden', 'Du må være administrator for å endre billettyper.', 403)} />
      ) : q.isLoading ? (
        <CenterSpinner />
      ) : q.isError || !q.data ? (
        <QueryError error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <EditorBody key={q.data.event.updatedAt} detail={q.data} />
      )}
    </Page>
  );
}
