import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, ScanLine, Trash2 } from 'lucide-react';
import type { ScannerCode } from '../../shared/types';
import type { CheckinStats } from '../../server/services/checkin';
import { formatAgo, formatTime } from '../../shared/time';
import { useApi } from '../app/context';
import { type ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { TextField } from '../components/ui/Field';
import { EmptyState, Pill } from '../components/ui/Feedback';
import { Button, LinkButton } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { CenterSpinner, ListSkeleton, QueryError } from '../components/ui/States';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { BarList, Meter } from '../components/charts/Charts';
import { copyText } from '../lib/share';
import { Card, canManage, orgKey, useOrg, useOrgQuery } from './shared';

type CodeRow = Omit<ScannerCode, 'codeHash'>;

const RESULT_LABEL: Record<string, { label: string; tone: 'green' | 'orange' | 'red' | 'neutral' }> = {
  ok: { label: 'Godkjent', tone: 'green' },
  already_used: { label: 'Allerede brukt', tone: 'orange' },
  invalid: { label: 'Ugyldig', tone: 'red' },
  wrong_event: { label: 'Feil arrangement', tone: 'red' },
  cancelled: { label: 'Ikke gyldig', tone: 'red' },
  expired_code: { label: 'Utløpt kode', tone: 'orange' },
  undo: { label: 'Angret', tone: 'neutral' },
};

function formatCode(code: string): string {
  return code.replace(/(\d{4})(?=\d)/g, '$1-');
}

function NewCodeSheet({ open, onClose, eventId }: { open: boolean; onClose: () => void; eventId: string }) {
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const close = () => {
    onClose();
    window.setTimeout(() => {
      setCreated(null);
      setLabel('');
    }, 300);
  };
  const submit = async () => {
    if (!label.trim()) return;
    setBusy(true);
    try {
      const res = await api.post<{ code: string }>(`/org/${org.id}/events/${eventId}/scanner-codes`, { label: label.trim() });
      setCreated(res.code);
      await qc.invalidateQueries({ queryKey: orgKey(org.id) });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={close} locked={busy} title={created ? 'Skannerkoden er klar' : 'Ny skannerkode'}>
      {!created ? (
        <form
          className="flex flex-col gap-4 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-subhead text-label-2">Dørvakter logger inn på skanneren med koden – uten egen konto. Koden gjelder bare dette arrangementet og kan trekkes tilbake når som helst.</p>
          <TextField label="Navn på døra eller personen" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="For eksempel Hovedinngang" data-autofocus />
          <Button type="submit" size="lg" full loading={busy} disabled={!label.trim()}>
            Lag kode
          </Button>
        </form>
      ) : (
        <div className="flex flex-col items-center gap-4 pb-2 text-center">
          <p className="font-mono text-[1.8rem] font-bold tracking-[0.06em] tabular">{formatCode(created)}</p>
          <p className="text-subhead text-label-2">Koden vises bare nå. Gi den til dørvakten – de åpner TIKIT, velger «Dørvakt?» og skriver koden.</p>
          <Button
            full
            variant="gray"
            icon={<Copy className="h-4 w-4" />}
            onClick={async () => {
              const ok = await copyText(created);
              toast({ message: ok ? 'Koden er kopiert' : 'Kunne ikke kopiere', tone: ok ? 'success' : 'error' });
            }}
          >
            Kopier koden
          </Button>
          <Button variant="plain" onClick={close}>
            Ferdig
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export default function CheckinSetup() {
  const { eventId } = useParams();
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const manage = canManage(org.role);
  const stats = useQuery<CheckinStats, ApiError>({ queryKey: orgKey(org.id, 'checkin', eventId), queryFn: () => api.get(`/checkin/${eventId}/stats`), refetchInterval: 10_000 });
  const codes = useOrgQuery<{ codes: CodeRow[] }>(org.id, `/events/${eventId}/scanner-codes`, { enabled: manage });
  const [newOpen, setNewOpen] = useState(false);

  const revoke = async (c: CodeRow) => {
    const ok = await confirm({ title: `Trekke tilbake «${c.label}»?`, message: 'Skanneren som bruker koden, logges ut med en gang.', confirmLabel: 'Trekk tilbake', destructive: true });
    if (!ok) return;
    try {
      await api.del(`/org/${org.id}/scanner-codes/${c.id}`);
      await qc.invalidateQueries({ queryKey: orgKey(org.id) });
      toast({ message: 'Koden er trukket tilbake', tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    }
  };

  const s = stats.data;
  return (
    <Page title="Innsjekk" back={`/arrangor/${org.id}/arrangementer/${eventId}`} wide>
      <div className="mx-4 mb-5 flex flex-wrap gap-3">
        <LinkButton to={`/skann/${eventId}`} size="lg" icon={<ScanLine className="h-5 w-5" />}>
          Åpne skanneren
        </LinkButton>
      </div>
      {stats.isLoading && <CenterSpinner className="min-h-40" />}
      {stats.isError && <QueryError error={stats.error} onRetry={() => void stats.refetch()} />}
      {s && (
        <div className="mx-4 mb-6 grid gap-4 lg:grid-cols-2">
          <Card>
            <p className="text-footnote text-label-2">Sjekket inn</p>
            <p className="mt-1 text-[2.4rem] font-bold leading-none">
              {s.checkedIn}
              <span className="text-title3 font-normal text-label-2"> av {s.total}</span>
            </p>
            <Meter value={s.checkedIn} max={Math.max(1, s.total)} label="Sjekket inn" className="mt-3" />
            {s.byGate.length > 0 && (
              <div className="mt-4 hairline-t pt-3">
                <p className="mb-1 text-subhead font-semibold">Per dør</p>
                <ul className="text-subhead">
                  {s.byGate.map((g) => (
                    <li key={g.gate} className="flex justify-between py-0.5">
                      <span>{g.gate}</span>
                      <span className="text-label-2 tabular">{g.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
          <Card>
            <BarList
              title="Per billettype"
              format={(v) => `${v} inne`}
              rows={s.byType.map((t) => ({ key: t.ticketTypeId, label: t.name, value: t.checkedIn, max: Math.max(1, t.total), caption: `${t.checkedIn} av ${t.total}` }))}
            />
          </Card>
          <Card className="lg:col-span-2">
            <p className="mb-2 text-headline font-semibold">Siste skanninger</p>
            {s.recent.length === 0 ? (
              <p className="py-3 text-subhead text-label-2">Ingen skanninger ennå.</p>
            ) : (
              <ul className="[&>*+*]:hairline-t">
                {s.recent.slice(0, 12).map((r) => {
                  const l = RESULT_LABEL[r.result] ?? { label: r.result, tone: 'neutral' as const };
                  return (
                    <li key={r.id} className="flex items-center gap-3 py-2">
                      <span className="w-12 shrink-0 text-footnote text-label-2 tabular">{formatTime(r.at)}</span>
                      <span className="min-w-0 flex-1 truncate text-subhead">
                        {r.holderName ?? 'Ukjent kode'}
                        {r.typeName ? ` · ${r.typeName}` : ''}
                        <span className="text-label-2"> · {r.gate ?? r.actor}</span>
                      </span>
                      <Pill tone={l.tone}>{l.label}</Pill>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      )}

      {manage && (
        <section className="mx-4 mb-6">
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <h2 className="text-title3 font-bold">Skannerkoder</h2>
            <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>
              Ny kode
            </Button>
          </div>
          {codes.isLoading && <ListSkeleton rows={2} className="mx-0" />}
          {codes.isError && <QueryError error={codes.error} onRetry={() => void codes.refetch()} />}
          {codes.data && codes.data.codes.length === 0 && (
            <EmptyState icon={<KeyRound />} title="Ingen skannerkoder" message="Lag en kode per dør eller dørvakt. Da ser dere hvem som skannet hva." className="py-8" />
          )}
          {codes.data && codes.data.codes.length > 0 && (
            <ul className="overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
              {codes.data.codes.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium">{c.label}</p>
                    <p className="text-footnote text-label-2">{c.revoked ? 'Trukket tilbake' : c.lastUsedAt ? `Sist brukt ${formatAgo(c.lastUsedAt)}` : 'Ikke brukt ennå'}</p>
                  </div>
                  {!c.revoked && (
                    <Button size="sm" variant="destructive" icon={<Trash2 className="h-4 w-4" />} onClick={() => void revoke(c)}>
                      Trekk tilbake
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {eventId && <NewCodeSheet open={newOpen} onClose={() => setNewOpen(false)} eventId={eventId} />}
    </Page>
  );
}
