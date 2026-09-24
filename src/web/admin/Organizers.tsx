import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, Building2 } from 'lucide-react';
import type { AdminOrganizerRow } from '../../server/services/admin';
import type { OrganizerStatus } from '../../shared/types';
import { ORGANIZER_TYPES } from '../../shared/constants';
import { formatNok, parseKroner } from '../../shared/money';
import { formatDateShort } from '../../shared/time';
import { useApi } from '../app/context';
import { ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { SegmentedControl, Switch } from '../components/ui/Controls';
import { EmptyState, Pill, type PillTone } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { TextArea, TextField } from '../components/ui/Field';
import { Sheet } from '../components/ui/Sheet';
import { ListSkeleton, QueryError } from '../components/ui/States';
import { useToast } from '../components/ui/Overlays';
import { adminKey, useAdminQuery } from './shared';

const STATUS: Record<OrganizerStatus, { label: string; tone: PillTone }> = {
  pending: { label: 'Venter', tone: 'orange' },
  approved: { label: 'Godkjent', tone: 'green' },
  rejected: { label: 'Avslått', tone: 'red' },
  suspended: { label: 'Suspendert', tone: 'red' },
};

function OrgSheet({ org, onClose }: { org: AdminOrganizerRow | null; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [payoutNote, setPayoutNote] = useState('');

  const review = async (status: 'approved' | 'rejected' | 'suspended', verified?: boolean) => {
    if (!org) return;
    setBusy(status + (verified === undefined ? '' : 'v'));
    try {
      await api.post(`/admin/organizers/${org.id}/review`, { status, note: note.trim() || null, ...(verified === undefined ? {} : { verified }) });
      await qc.invalidateQueries({ queryKey: adminKey() });
      toast({ message: 'Lagret', tone: 'success' });
      onClose();
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const payout = async () => {
    if (!org) return;
    const ore = parseKroner(amount);
    if (!ore || ore < 1 || !reference.trim()) {
      toast({ message: 'Skriv beløp og referanse', tone: 'error' });
      return;
    }
    setBusy('payout');
    try {
      await api.post(`/admin/organizers/${org.id}/payouts`, { amountOre: ore, reference: reference.trim(), note: payoutNote.trim() });
      await qc.invalidateQueries({ queryKey: adminKey() });
      toast({ message: `Utbetaling på ${formatNok(ore)} er registrert`, tone: 'success' });
      setAmount('');
      setReference('');
      setPayoutNote('');
    } catch (err) {
      toast({ message: err instanceof ApiError ? err.message : errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open={!!org} onClose={onClose} title={org?.name} size="large">
      {org && (
        <div className="flex flex-col gap-5 pb-4">
          <div className="rounded-md bg-grouped-2 px-4 py-3 text-subhead">
            <p>
              <span className="text-label-2">Type:</span> {ORGANIZER_TYPES.find((t) => t.id === org.type)?.label}
            </p>
            <p>
              <span className="text-label-2">By:</span> {org.city ?? '–'}
            </p>
            <p>
              <span className="text-label-2">Org.nr.:</span> {org.orgNumber ?? '–'}
            </p>
            <p>
              <span className="text-label-2">E-post:</span> {org.email}
            </p>
            <p>
              <span className="text-label-2">Konto:</span> {org.payoutAccount ?? 'mangler'}
            </p>
            <p>
              <span className="text-label-2">Medlemmer / arrangementer:</span> {org.members} / {org.events}
            </p>
            {org.description && <p className="mt-2 whitespace-pre-line">{org.description}</p>}
          </div>
          <div className="rounded-md bg-grouped-2 p-4">
            <p className="mb-3 text-headline font-semibold">Status</p>
            <TextArea label="Notat til arrangøren (valgfritt)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={300} />
            <div className="mt-3 flex flex-wrap gap-2">
              {org.status !== 'approved' && (
                <Button loading={busy === 'approved'} onClick={() => void review('approved')}>
                  Godkjenn
                </Button>
              )}
              {org.status === 'pending' && (
                <Button variant="destructive" loading={busy === 'rejected'} onClick={() => void review('rejected')}>
                  Avslå
                </Button>
              )}
              {org.status === 'approved' && (
                <Button variant="destructive" loading={busy === 'suspended'} onClick={() => void review('suspended')}>
                  Suspender
                </Button>
              )}
            </div>
            {org.status === 'approved' && (
              <label className="mt-4 flex items-center justify-between gap-3">
                <span>
                  <span className="block text-body">Verifisert arrangør</span>
                  <span className="block text-footnote text-label-2">Viser et merke ved navnet i appen</span>
                </span>
                <Switch checked={org.verified} onChange={(v) => void review('approved', v)} label="Verifisert arrangør" disabled={!!busy} />
              </label>
            )}
          </div>
          <div className="rounded-md bg-grouped-2 p-4">
            <p className="text-headline font-semibold">Oppgjør</p>
            <p className="mb-3 text-subhead text-label-2 tabular">
              Netto salg {formatNok(org.netRevenueOre)} · utbetalt {formatNok(org.paidOutOre)} · til gode {formatNok(org.netRevenueOre - org.paidOutOre)}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Beløp (kr)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <TextField label="Referanse" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} placeholder="Bankreferanse" />
            </div>
            <TextField label="Notat (valgfritt)" value={payoutNote} onChange={(e) => setPayoutNote(e.target.value)} maxLength={200} className="mt-3" />
            <Button className="mt-3" variant="tinted" loading={busy === 'payout'} onClick={() => void payout()}>
              Registrer utbetaling
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export default function Organizers() {
  const [status, setStatus] = useState<'all' | OrganizerStatus>('pending');
  const q = useAdminQuery<{ organizers: AdminOrganizerRow[] }>(`/organizers${status === 'all' ? '' : `?status=${status}`}`);
  const [open, setOpen] = useState<AdminOrganizerRow | null>(null);
  const list = q.data?.organizers ?? [];
  return (
    <Page title="Arrangører" large wide>
      <div className="mx-4 mb-4 max-w-lg">
        <SegmentedControl
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'pending', label: 'Venter' },
            { value: 'approved', label: 'Godkjent' },
            { value: 'suspended', label: 'Suspendert' },
            { value: 'all', label: 'Alle' },
          ]}
        />
      </div>
      {q.isLoading && <ListSkeleton rows={4} />}
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && list.length === 0 && <EmptyState icon={<Building2 />} title="Ingen arrangører her" />}
      {list.length > 0 && (
        <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
          {list.map((o) => {
            const s = STATUS[o.status];
            return (
              <button key={o.id} type="button" onClick={() => setOpen(o)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-fill-4">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-body font-medium">
                    {o.name}
                    {o.verified && <BadgeCheck className="h-4 w-4 shrink-0 text-tint" aria-label="Verifisert" />}
                  </p>
                  <p className="truncate text-footnote text-label-2 tabular">
                    {o.city ?? '–'} · {o.events} arrangementer · netto {formatNok(o.netRevenueOre)} · siden {formatDateShort(o.createdAt)}
                  </p>
                </div>
                <Pill tone={s.tone}>{s.label}</Pill>
              </button>
            );
          })}
        </div>
      )}
      <OrgSheet key={open?.id ?? 'none'} org={open} onClose={() => setOpen(null)} />
    </Page>
  );
}
