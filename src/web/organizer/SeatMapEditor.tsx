import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Accessibility, Plus, Rows3, Trash2, X } from 'lucide-react';
import type { OrgEventDetail, PublicSeatMap } from '../../server/services/events';
import { LIMITS } from '../../shared/constants';
import { useApi } from '../app/context';
import { ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { BottomBar } from '../components/layout/BottomBar';
import { SelectField, TextField } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { SegmentedControl } from '../components/ui/Controls';
import { CenterSpinner, QueryError } from '../components/ui/States';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { cn } from '../lib/cn';
import { canManage, orgKey, useOrg, useOrgQuery } from './shared';

interface RowDraft {
  key: string;
  label: string;
  seats: string;
  offset: string;
  accessible: string;
}
interface SectionDraft {
  key: string;
  id: string;
  name: string;
  ticketTypeId: string;
  rows: RowDraft[];
}

let seq = 0;
const k = () => `s${++seq}`;
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function nextRowLabel(rows: RowDraft[]): string {
  const last = rows[rows.length - 1]?.label ?? '';
  if (/^\d+$/.test(last)) return String(Number(last) + 1);
  const i = LETTERS.indexOf(last.toUpperCase());
  return i >= 0 && i < 25 ? LETTERS[i + 1]! : String(rows.length + 1);
}

function fromDetail(detail: OrgEventDetail): { stage: string; sections: SectionDraft[] } {
  const map = detail.seatMap;
  if (!map)
    return {
      stage: 'Scene',
      sections: [
        {
          key: k(),
          id: 'A',
          name: 'Sal',
          ticketTypeId: detail.ticketTypes[0]?.id ?? '',
          rows: ['A', 'B', 'C', 'D', 'E'].map((label) => ({ key: k(), label, seats: '14', offset: '0', accessible: '' })),
        },
      ],
    };
  return {
    stage: map.stageLabel,
    sections: map.sections.map((s) => ({
      key: k(),
      id: s.id,
      name: s.name,
      ticketTypeId: s.ticketTypeId,
      rows: s.rows.map((r) => ({
        key: k(),
        label: r.label,
        seats: String(r.seats.length),
        offset: String(r.offset),
        accessible: r.seats
          .filter((x) => x.accessible)
          .map((x) => x.number)
          .join(', '),
      })),
    })),
  };
}

function Preview({ sections, stage }: { sections: SectionDraft[]; stage: string }) {
  return (
    <div className="overflow-auto rounded-md bg-grouped-2 p-4" style={{ maxHeight: 360 }}>
      <div className="mx-auto w-max min-w-full">
        <div className="mx-auto mb-4 flex h-7 w-2/3 min-w-[160px] items-center justify-center rounded-b-[30px] rounded-t-[6px] bg-fill-3 text-caption1 font-bold uppercase tracking-[0.12em] text-label-2">{stage || 'Scene'}</div>
        {sections.map((s) => (
          <div key={s.key} className="mb-4">
            <p className="mb-1.5 text-center text-footnote font-semibold">{s.name || 'Seksjon'}</p>
            <div className="flex flex-col items-center gap-1">
              {s.rows.map((r) => {
                const n = Math.min(80, Math.max(0, Number(r.seats) || 0));
                const off = Math.min(40, Math.max(0, Number(r.offset) || 0));
                const acc = new Set(r.accessible.split(/[\s,;]+/).map(Number).filter(Boolean));
                return (
                  <div key={r.key} className="flex items-center gap-1" aria-hidden="true">
                    <span className="w-4 text-right text-[0.6rem] font-semibold text-label-3">{r.label}</span>
                    {Array.from({ length: off }, (_, i) => (
                      <span key={`o${i}`} className="h-2.5 w-2.5" />
                    ))}
                    {Array.from({ length: n }, (_, i) => (
                      <span key={i} className={cn('h-2.5 w-2.5 rounded-full', acc.has(i + 1) ? 'bg-green-fill' : 'bg-[var(--chart-series)]')} />
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LayoutEditor({ detail }: { detail: OrgEventDetail }) {
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const initial = useMemo(() => fromDetail(detail), [detail]);
  const [stage, setStage] = useState(initial.stage);
  const [sections, setSections] = useState<SectionDraft[]>(initial.sections);
  const [gen, setGen] = useState<Record<string, { rows: string; seats: string }>>({});
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const total = sections.reduce((n, s) => n + s.rows.reduce((a, r) => a + (Number(r.seats) || 0), 0), 0);

  const updateSection = (key: string, patch: Partial<SectionDraft>) => setSections((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  const updateRow = (sKey: string, rKey: string, patch: Partial<RowDraft>) =>
    setSections((prev) => prev.map((s) => (s.key === sKey ? { ...s, rows: s.rows.map((r) => (r.key === rKey ? { ...r, ...patch } : r)) } : s)));

  const save = async () => {
    if (detail.ticketTypes.length === 0) {
      toast({ message: 'Lag en billettype først – hver seksjon kobles til en billettype.', tone: 'error' });
      return;
    }
    const body = {
      stageLabel: stage.trim() || 'Scene',
      sections: sections.map((s, i) => ({
        id: (s.id || LETTERS[i] || `S${i}`).replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || `S${i}`,
        name: s.name.trim() || `Seksjon ${i + 1}`,
        ticketTypeId: s.ticketTypeId,
        rows: s.rows.map((r) => ({
          label: r.label.trim().slice(0, 4) || '?',
          seats: Math.max(1, Math.min(80, Number(r.seats) || 1)),
          offset: Math.max(0, Math.min(40, Number(r.offset) || 0)),
          accessible: [...new Set(r.accessible.split(/[\s,;]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 80))],
        })),
      })),
    };
    setBusy('save');
    try {
      await api.put(`/org/${org.id}/events/${detail.event.id}/seatmap`, body);
      await qc.invalidateQueries({ queryKey: orgKey(org.id) });
      await qc.invalidateQueries({ queryKey: ['seatmap'] });
      await qc.invalidateQueries({ queryKey: ['event'] });
      toast({ message: `Salkartet er lagret (${total} seter)`, tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    const ok = await confirm({ title: 'Fjerne salkartet?', message: 'Billettene selges da uten nummererte plasser.', confirmLabel: 'Fjern salkart', destructive: true });
    if (!ok) return;
    setBusy('delete');
    try {
      await api.del(`/org/${org.id}/events/${detail.event.id}/seatmap`);
      await qc.invalidateQueries({ queryKey: orgKey(org.id) });
      await qc.invalidateQueries({ queryKey: ['event'] });
      toast({ message: 'Salkartet er fjernet', tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-4">
      <p className="mb-4 px-2 text-subhead text-label-2">
        Med salkart velger kjøperne sete selv. Hver seksjon selges som en billettype, og antall billetter settes automatisk til antall seter. Salkartet kan ikke endres etter at seter er solgt.
      </p>
      <div className="mb-5 rounded-md bg-grouped-2 p-4">
        <TextField label="Tekst på scenen" value={stage} onChange={(e) => setStage(e.target.value)} maxLength={40} />
      </div>
      {sections.map((s) => (
        <div key={s.key} className="mb-5 rounded-md bg-grouped-2 p-4">
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <TextField label="Seksjon" value={s.name} onChange={(e) => updateSection(s.key, { name: e.target.value })} maxLength={40} />
            <SelectField
              label="Billettype"
              value={s.ticketTypeId}
              onChange={(e) => updateSection(s.key, { ticketTypeId: e.target.value })}
              options={[{ value: '', label: 'Velg billettype' }, ...detail.ticketTypes.map((t) => ({ value: t.id, label: t.name }))]}
            />
          </div>
          <div className="mb-2 grid grid-cols-[56px_1fr_1fr_1.4fr_40px] gap-2 px-1 text-caption1 font-semibold uppercase tracking-[0.04em] text-label-2">
            <span>Rad</span>
            <span>Seter</span>
            <span>Innrykk</span>
            <span className="inline-flex items-center gap-1">
              <Accessibility className="h-3.5 w-3.5" aria-hidden="true" /> Rullestol
            </span>
            <span className="sr-only">Fjern</span>
          </div>
          <div className="flex flex-col gap-2">
            {s.rows.map((r) => (
              <div key={r.key} className="grid grid-cols-[56px_1fr_1fr_1.4fr_40px] items-center gap-2">
                <input aria-label="Radnavn" value={r.label} maxLength={4} onChange={(e) => updateRow(s.key, r.key, { label: e.target.value.toUpperCase() })} className="h-10 rounded-[10px] bg-fill-3 px-2 text-center text-body outline-none focus:shadow-[0_0_0_2px_var(--tint)]" />
                <input aria-label={`Antall seter i rad ${r.label}`} inputMode="numeric" value={r.seats} onChange={(e) => updateRow(s.key, r.key, { seats: e.target.value })} className="h-10 min-w-0 rounded-[10px] bg-fill-3 px-2 text-body tabular outline-none focus:shadow-[0_0_0_2px_var(--tint)]" />
                <input aria-label={`Innrykk i rad ${r.label}`} inputMode="numeric" value={r.offset} onChange={(e) => updateRow(s.key, r.key, { offset: e.target.value })} className="h-10 min-w-0 rounded-[10px] bg-fill-3 px-2 text-body tabular outline-none focus:shadow-[0_0_0_2px_var(--tint)]" />
                <input aria-label={`Rullestolplasser i rad ${r.label} (setenummer)`} placeholder="1, 2" value={r.accessible} onChange={(e) => updateRow(s.key, r.key, { accessible: e.target.value })} className="h-10 min-w-0 rounded-[10px] bg-fill-3 px-2 text-body outline-none focus:shadow-[0_0_0_2px_var(--tint)]" />
                <button type="button" aria-label={`Fjern rad ${r.label}`} onClick={() => updateSection(s.key, { rows: s.rows.filter((x) => x.key !== r.key) })} className="flex h-10 w-10 items-center justify-center rounded-[10px] text-red hover:bg-red-soft" disabled={s.rows.length <= 1}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Button size="sm" variant="tinted" icon={<Plus className="h-4 w-4" />} onClick={() => updateSection(s.key, { rows: [...s.rows, { key: k(), label: nextRowLabel(s.rows), seats: s.rows[s.rows.length - 1]?.seats ?? '12', offset: '0', accessible: '' }] })} disabled={s.rows.length >= 60}>
              Legg til rad
            </Button>
            <div className="ml-auto flex items-end gap-2">
              <TextField label="Rader" inputMode="numeric" value={gen[s.key]?.rows ?? '8'} onChange={(e) => setGen((g) => ({ ...g, [s.key]: { rows: e.target.value, seats: g[s.key]?.seats ?? '16' } }))} className="w-20" />
              <TextField label="Seter" inputMode="numeric" value={gen[s.key]?.seats ?? '16'} onChange={(e) => setGen((g) => ({ ...g, [s.key]: { rows: g[s.key]?.rows ?? '8', seats: e.target.value } }))} className="w-20" />
              <Button
                size="sm"
                variant="gray"
                className="mb-1.5"
                icon={<Rows3 className="h-4 w-4" />}
                onClick={() => {
                  const rows = Math.max(1, Math.min(26, Number(gen[s.key]?.rows ?? 8) || 1));
                  const seats = Math.max(1, Math.min(80, Number(gen[s.key]?.seats ?? 16) || 1));
                  updateSection(s.key, { rows: Array.from({ length: rows }, (_, i) => ({ key: k(), label: LETTERS[i]!, seats: String(seats), offset: '0', accessible: '' })) });
                }}
              >
                Lag rader
              </Button>
            </div>
          </div>
          {sections.length > 1 && (
            <Button size="sm" variant="plain" className="mt-2 text-red" icon={<Trash2 className="h-4 w-4" />} onClick={() => setSections((prev) => prev.filter((x) => x.key !== s.key))}>
              Fjern seksjonen
            </Button>
          )}
        </div>
      ))}
      {sections.length < 12 && (
        <Button
          variant="tinted"
          className="mb-5"
          icon={<Plus className="h-4 w-4" />}
          onClick={() => setSections((prev) => [...prev, { key: k(), id: LETTERS[prev.length] ?? `S${prev.length}`, name: `Seksjon ${prev.length + 1}`, ticketTypeId: detail.ticketTypes[0]?.id ?? '', rows: [{ key: k(), label: 'A', seats: '12', offset: '0', accessible: '' }] }])}
        >
          Legg til seksjon
        </Button>
      )}
      <h2 className="mb-2 px-2 text-headline font-semibold">Forhåndsvisning · {total} seter</h2>
      <Preview sections={sections} stage={stage} />
      {total > LIMITS.maxSeatsPerMap && <p className="mt-2 px-2 text-footnote text-red">Maks {LIMITS.maxSeatsPerMap} seter per salkart.</p>}
      {detail.seatMap && (
        <Button variant="destructive" className="mt-5" loading={busy === 'delete'} onClick={() => void remove()} icon={<Trash2 className="h-4 w-4" />}>
          Fjern salkartet
        </Button>
      )}
      <BottomBar aboveTabBar>
        <Button size="lg" full loading={busy === 'save'} disabled={total === 0 || total > LIMITS.maxSeatsPerMap || sections.some((s) => !s.ticketTypeId)} onClick={() => void save()}>
          Lagre salkart
        </Button>
      </BottomBar>
    </div>
  );
}

function BlockSeats({ detail }: { detail: OrgEventDetail }) {
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const map = useQuery<PublicSeatMap, ApiError>({ queryKey: ['seatmap', detail.event.id, 'org'], queryFn: () => api.get(`/events/${detail.event.id}/seatmap`) });
  const [busy, setBusy] = useState<string | null>(null);
  if (map.isLoading) return <CenterSpinner className="min-h-40" />;
  if (map.isError || !map.data) return <QueryError error={map.error} onRetry={() => void map.refetch()} />;

  const toggle = async (seatId: string, blocked: boolean) => {
    setBusy(seatId);
    try {
      await api.post(`/org/${org.id}/events/${detail.event.id}/seats/block`, { seatIds: [seatId], blocked });
      await map.refetch();
      await qc.invalidateQueries({ queryKey: orgKey(org.id) });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-4">
      <p className="mb-4 px-2 text-subhead text-label-2">Trykk på et ledig sete for å sperre det (for eksempel for teknikk eller gjester). Trykk igjen for å åpne det for salg.</p>
      <div className="overflow-auto rounded-md bg-grouped-2 p-4">
        <div className="mx-auto w-max min-w-full">
          {map.data.sections.map((s) => (
            <div key={s.id} className="mb-5">
              <p className="mb-2 text-center text-subhead font-semibold">{s.name}</p>
              <div className="flex flex-col items-center gap-1.5">
                {s.rows.map((r) => (
                  <div key={r.label} className="flex items-center gap-1.5">
                    <span className="w-5 text-right text-caption1 font-semibold text-label-3">{r.label}</span>
                    {Array.from({ length: r.offset }, (_, i) => (
                      <span key={`o${i}`} className="h-7 w-7" />
                    ))}
                    {r.seats.map((seat) => (
                      <button
                        key={seat.id}
                        type="button"
                        disabled={seat.state === 'taken' || busy === seat.id}
                        aria-pressed={seat.state === 'blocked'}
                        aria-label={`${s.name}, rad ${r.label}, sete ${seat.number}: ${seat.state === 'blocked' ? 'sperret' : seat.state === 'taken' ? 'solgt eller reservert' : 'ledig'}`}
                        onClick={() => void toggle(seat.id, seat.state !== 'blocked')}
                        className={cn(
                          'flex h-7 w-7 items-center justify-center rounded-full text-[0.6rem] font-bold',
                          seat.state === 'blocked' ? 'bg-label text-bg' : seat.state === 'taken' ? 'bg-fill text-transparent' : 'border-2 border-[var(--tint)] text-tint',
                        )}
                      >
                        {seat.state === 'blocked' ? <X className="h-3.5 w-3.5" /> : seat.number}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SeatMapEditor() {
  const { eventId } = useParams();
  const { org } = useOrg();
  const q = useOrgQuery<OrgEventDetail>(org.id, `/events/${eventId}`);
  const [mode, setMode] = useState<'layout' | 'block'>('layout');
  return (
    <Page title="Salkart" back={`/arrangor/${org.id}/arrangementer/${eventId}`} wide>
      <div className="mx-auto max-w-3xl">
        {!canManage(org.role) ? (
          <QueryError error={new ApiError('forbidden', 'Du må være administrator for å endre salkartet.', 403)} />
        ) : q.isLoading ? (
          <CenterSpinner />
        ) : q.isError || !q.data ? (
          <QueryError error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            {q.data.seatMap && (
              <div className="mx-4 mb-4 max-w-sm">
                <SegmentedControl
                  label="Modus"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'layout', label: 'Oppsett' },
                    { value: 'block', label: 'Sperr seter' },
                  ]}
                />
              </div>
            )}
            {mode === 'block' && q.data.seatMap ? <BlockSeats detail={q.data} /> : <LayoutEditor key={q.data.seatMap?.updatedAt ?? 'new'} detail={q.data} />}
          </>
        )}
      </div>
    </Page>
  );
}
