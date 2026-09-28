import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Gift, Users } from 'lucide-react';
import type { Attendee } from '../../server/services/checkin';
import type { GuestResult } from '../../server/services/guests';
import type { OrgEventDetail } from '../../server/services/events';
import { formatTime } from '../../shared/time';
import { useApi } from '../app/context';
import { ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { SearchField, SelectField, TextArea, TextField } from '../components/ui/Field';
import { EmptyState, Pill } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { SegmentedControl, Stepper } from '../components/ui/Controls';
import { Sheet } from '../components/ui/Sheet';
import { ListSkeleton, QueryError } from '../components/ui/States';
import { useToast } from '../components/ui/Overlays';
import { TICKET_STATUS } from '../lib/labels';
import { useDebounced } from '../lib/hooks';
import { apiUrl, canDownload, downloadApiFile, filesViaApp } from '../lib/links';
import { copyText } from '../lib/share';
import { canManage, orgKey, useOrg, useOrgQuery } from './shared';

function GuestSheet({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: OrgEventDetail }) {
  const { org } = useOrg();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const seated = new Set(detail.seatMap?.sections.map((s) => s.ticketTypeId) ?? []);
  const types = detail.ticketTypes.filter((t) => !seated.has(t.id));
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<GuestResult | null>(null);

  const close = () => {
    onClose();
    window.setTimeout(() => {
      setResult(null);
      setName('');
      setContact('');
      setQty(1);
      setMessage('');
      setErrors({});
    }, 300);
  };

  const submit = async () => {
    if (name.trim().length < 2) {
      setErrors({ name: 'Skriv navnet til gjesten.' });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const res = await api.post<GuestResult>(`/org/${org.id}/events/${detail.event.id}/guests`, {
        name: name.trim(),
        contact: contact.trim() || null,
        ticketTypeId: typeId,
        qty,
        message: message.trim() || null,
      });
      setResult(res);
      await qc.invalidateQueries({ queryKey: orgKey(org.id) });
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={close} locked={busy} title={result ? 'Gjestebilletter sendt' : 'Gjestebilletter'}>
      {!result ? (
        <form
          className="flex flex-col gap-4 pb-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-subhead text-label-2">Gratis billetter til artister, crew og gjester. De trekkes fra kapasiteten til billettypen.</p>
          <TextField label="Navn på gjesten" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} error={errors.name} />
          <TextField
            label="E-post eller mobil (valgfritt)"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            maxLength={254}
            error={errors.contact}
            hint="Har gjesten TIKIT med samme e-post/mobil, havner billettene rett i appen. Ellers får du lenker å sende."
          />
          {types.length === 0 ? (
            <p className="text-subhead text-red">Ingen billettyper uten salkart. Gjestebilletter kan ikke ha nummererte plasser.</p>
          ) : (
            <SelectField label="Billettype" value={typeId} onChange={(e) => setTypeId(e.target.value)} options={types.map((t) => ({ value: t.id, label: `${t.name} (${t.available} ledige)` }))} />
          )}
          <div className="flex items-center justify-between">
            <span className="text-body">Antall</span>
            <Stepper value={qty} min={1} max={20} onChange={setQty} label="Antall gjestebilletter" />
          </div>
          <TextArea label="Melding (valgfritt)" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={200} />
          <Button type="submit" size="lg" full loading={busy} disabled={types.length === 0} icon={<Gift className="h-4 w-4" />}>
            Send {qty === 1 ? 'billetten' : `${qty} billetter`}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4 pb-2">
          <p className="text-body">
            {result.delivered === 'account'
              ? `${result.recipientName ?? 'Gjesten'} har fått ${result.tickets === 1 ? 'billetten' : `${result.tickets} billetter`} rett i TIKIT-appen.`
              : `Send ${result.links.length === 1 ? 'lenken' : 'lenkene'} til gjesten. Hver lenke gir én billett og kan brukes én gang.`}
          </p>
          {result.links.map((l, i) => (
            <div key={l} className="flex items-center gap-2">
              <div className="min-w-0 flex-1 break-all rounded-[12px] bg-fill-3 px-3 py-2.5 font-mono text-caption1">{l}</div>
              <Button
                size="sm"
                variant="gray"
                icon={<Copy className="h-4 w-4" />}
                aria-label={`Kopier lenke ${i + 1}`}
                onClick={async () => {
                  const ok = await copyText(l);
                  toast({ message: ok ? 'Kopiert' : 'Kunne ikke kopiere', tone: ok ? 'success' : 'error' });
                }}
              >
                Kopier
              </Button>
            </div>
          ))}
          {result.links.length > 0 && <p className="text-footnote text-label-2">Lenkene vises bare nå. Ordrenummer: {result.ref}.</p>}
          <Button variant="plain" onClick={close}>
            Ferdig
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export default function Attendees() {
  const { eventId } = useParams();
  const { org } = useOrg();
  const manage = canManage(org.role);
  const detail = useOrgQuery<OrgEventDetail>(org.id, `/events/${eventId}`);
  const q = useOrgQuery<{ attendees: Attendee[] }>(org.id, `/events/${eventId}/attendees`, { refetchInterval: 20_000 });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all');
  const [guestOpen, setGuestOpen] = useState(false);
  const term = useDebounced(search.trim().toLowerCase(), 150);
  const api = useApi();
  const toast = useToast();

  const all = useMemo(() => q.data?.attendees ?? [], [q.data]);
  const rows = useMemo(() => {
    let list = all;
    if (filter === 'in') list = list.filter((a) => a.status === 'used');
    if (filter === 'out') list = list.filter((a) => a.status === 'valid');
    if (term) list = list.filter((a) => [a.holderName, a.number, a.buyerName, a.buyerEmail ?? '', a.typeName, a.seat ?? ''].some((v) => v.toLowerCase().includes(term)));
    return list;
  }, [all, filter, term]);
  const checkedIn = all.filter((a) => a.status === 'used').length;
  const active = all.filter((a) => a.status === 'valid' || a.status === 'used').length;

  return (
    <Page title="Deltakere" back={`/arrangor/${org.id}/arrangementer/${eventId}`} wide>
      <div className="mx-4 mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-subhead text-label-2 tabular">
          {active} billetter · {checkedIn} sjekket inn
        </p>
        {manage && detail.data && (
          <Button size="sm" icon={<Gift className="h-4 w-4" />} onClick={() => setGuestOpen(true)}>
            Gjestebilletter
          </Button>
        )}
        {manage &&
          (canDownload && filesViaApp() ? (
            <Button
              size="sm"
              variant="gray"
              icon={<Download className="h-4 w-4" />}
              onClick={() => void downloadApiFile(api, `/org/${org.id}/events/${eventId}/attendees.csv`, 'deltakere.csv').catch((err: unknown) => toast({ message: errorMessage(err), tone: 'error' }))}
            >
              Eksporter CSV
            </Button>
          ) : canDownload ? (
            <a href={apiUrl(`/org/${org.id}/events/${eventId}/attendees.csv`)} className="press inline-flex h-[34px] items-center gap-2 rounded-full bg-fill-3 px-3.5 text-subhead font-semibold text-label no-underline">
              <Download className="h-4 w-4" aria-hidden="true" /> Eksporter CSV
            </a>
          ) : (
            <Button size="sm" variant="gray" icon={<Download className="h-4 w-4" />} onClick={() => toast({ message: 'Nedlasting er ikke tilgjengelig i demoen', tone: 'info' })}>
              Eksporter CSV
            </Button>
          ))}
      </div>
      <div className="mx-4 mb-3">
        <SearchField value={search} onChange={setSearch} placeholder="Navn, billettnr. eller e-post" label="Søk i deltakere" />
      </div>
      <div className="mx-4 mb-4 max-w-md">
        <SegmentedControl
          label="Filter"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'Alle' },
            { value: 'out', label: 'Ikke inne' },
            { value: 'in', label: 'Sjekket inn' },
          ]}
        />
      </div>
      {q.isLoading && <ListSkeleton rows={6} />}
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && rows.length === 0 && <EmptyState icon={<Users />} title={term || filter !== 'all' ? 'Ingen treff' : 'Ingen deltakere ennå'} />}
      {rows.length > 0 && (
        <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
          {rows.map((a) => {
            const s = TICKET_STATUS[a.status];
            return (
              <div key={a.ticketId} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">{a.holderName}</p>
                  <p className="truncate text-footnote text-label-2 tabular">
                    {a.typeName}
                    {a.seat ? ` · ${a.seat}` : ''} · {a.number}
                    {a.kind === 'comp' ? ' · gjest' : ''}
                    {manage && a.buyerName !== a.holderName ? ` · kjøpt av ${a.buyerName}` : ''}
                  </p>
                </div>
                {a.status === 'used' && a.checkedInAt ? <Pill tone="green">Inne {formatTime(a.checkedInAt)}</Pill> : <Pill tone={s.tone}>{s.label}</Pill>}
              </div>
            );
          })}
        </div>
      )}
      {detail.data && <GuestSheet open={guestOpen} onClose={() => setGuestOpen(false)} detail={detail.data} />}
    </Page>
  );
}
