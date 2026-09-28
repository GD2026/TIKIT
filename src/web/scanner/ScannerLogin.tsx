import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { LogOut, ScanLine } from 'lucide-react';
import type { OrgEventSummary } from '../../server/services/events';
import { formatDateShort, formatTime } from '../../shared/time';
import { useApi } from '../app/context';
import { useAuth } from '../app/auth';
import { qk } from '../api/hooks';
import { ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { TextField } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { IconTile, Row, Section } from '../components/ui/List';
import { CenterSpinner } from '../components/ui/States';

function formatInput(v: string): string {
  const digits = v.replace(/\D/g, '').slice(0, 12);
  return digits.replace(/(\d{4})(?=\d)/g, '$1-');
}

export default function ScannerLogin() {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me, scanner, loading } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const orgs = me?.organizations.filter((o) => o.status === 'approved') ?? [];
  const eventsQ = useQueries({
    queries: orgs.map((o) => ({
      queryKey: ['org', o.id, '/events'],
      queryFn: () => api.get<{ events: OrgEventSummary[] }>(`/org/${o.id}/events`),
      staleTime: 30_000,
    })),
  });
  const soon = Date.now() + 14 * 86400000;
  const recent = Date.now() - 12 * 3600000;
  const events = eventsQ
    .flatMap((q, i) => (q.data?.events ?? []).map((e) => ({ e, org: orgs[i]! })))
    .filter(({ e }) => e.card.status === 'published' && new Date(e.card.endsAt).getTime() > recent && new Date(e.card.startsAt).getTime() < soon)
    .sort((a, b) => a.e.card.startsAt.localeCompare(b.e.card.startsAt));

  const login = async () => {
    const digits = code.replace(/\D/g, '');
    if (digits.length !== 12) {
      setError('Koden har 12 siffer.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ eventId: string }>('/scanner/login', { code: digits });
      await qc.invalidateQueries({ queryKey: qk.me });
      navigate(`/skann/${res.eventId}`, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'invalid_scanner_code' ? err.message : errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <CenterSpinner />;

  return (
    <Page title="Billettskanner" back="/" large>
      {scanner && (
        <div className="mx-4 mb-6 rounded-lg bg-grouped-2 p-5">
          <p className="text-headline font-semibold">Du er logget inn som skanner</p>
          <p className="mt-1 text-subhead text-label-2">
            {scanner.eventTitle} · {scanner.label}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button icon={<ScanLine className="h-4 w-4" />} onClick={() => navigate(`/skann/${scanner.eventId}`)}>
              Fortsett å skanne
            </Button>
            <Button
              variant="gray"
              icon={<LogOut className="h-4 w-4" />}
              onClick={async () => {
                await api.post('/scanner/logout').catch(() => {});
                qc.clear();
              }}
            >
              Logg ut
            </Button>
          </div>
        </div>
      )}

      {me && orgs.length > 0 && (
        <div className="mx-4">
          <Section header="Dine arrangementer" footer={events.length === 0 && eventsQ.every((q) => !q.isLoading) ? 'Ingen publiserte arrangementer de neste to ukene.' : undefined}>
            {events.map(({ e, org }) => (
              <Row
                key={e.card.id}
                icon={
                  <IconTile color="#30B0C7">
                    <ScanLine />
                  </IconTile>
                }
                title={e.card.title}
                subtitle={`${org.name} · ${formatDateShort(e.card.startsAt)} kl. ${formatTime(e.card.startsAt)} · ${e.checkedIn}/${e.sold} inne`}
                to={`/skann/${e.card.id}`}
              />
            ))}
            {events.length === 0 && eventsQ.some((q) => q.isLoading) && <div className="px-4 py-4"><CenterSpinner className="min-h-0" /></div>}
          </Section>
        </div>
      )}

      {!scanner && (
        <section className="mx-4 mb-6 rounded-lg bg-grouped-2 p-5" aria-labelledby="kode-tittel">
          <h2 id="kode-tittel" className="text-headline font-semibold">
            Logg inn med skannerkode
          </h2>
          <p className="mt-1 text-subhead text-label-2">Dørvakter trenger ingen konto – bruk koden fra arrangøren.</p>
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void login();
            }}
          >
            <TextField
              label="Skannerkode"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="0000-0000-0000"
              value={code}
              onChange={(e) => setCode(formatInput(e.target.value))}
              error={error}
              className="[&_input]:font-mono [&_input]:tracking-[0.08em]"
            />
            {me && <p className="text-footnote text-label-2">Du blir logget ut av kontoen din på denne enheten mens du skanner.</p>}
            <Button type="submit" size="lg" full loading={busy} disabled={code.replace(/\D/g, '').length !== 12}>
              Start skanneren
            </Button>
          </form>
        </section>
      )}
    </Page>
  );
}
