import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Flag } from 'lucide-react';
import type { AdminReportRow } from '../../server/services/moderation';
import type { ReportStatus } from '../../shared/types';
import { formatAgo } from '../../shared/time';
import { useApi } from '../app/context';
import { errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { SegmentedControl } from '../components/ui/Controls';
import { EmptyState, Pill } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { ListSkeleton, QueryError } from '../components/ui/States';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { adminKey, useAdminQuery } from './shared';

/**
 * Moderation queue (App Store Review Guideline 1.2): reports about events and organizers. Apple expects
 * reports to be handled quickly – aim for within 24 hours. Every action is written to the audit log.
 */

type Action = 'dismiss' | 'resolve' | 'takedown' | 'suspend';

const STATE_LABEL: Record<AdminReportRow['targetState'], { label: string; tone: 'green' | 'orange' | 'red' | 'neutral' }> = {
  visible: { label: 'Synlig', tone: 'green' },
  taken_down: { label: 'Skjult', tone: 'orange' },
  suspended: { label: 'Arrangør stengt', tone: 'red' },
  gone: { label: 'Slettet', tone: 'neutral' },
};

export default function Reports() {
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [status, setStatus] = useState<ReportStatus>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const q = useAdminQuery<{ reports: AdminReportRow[] }>(`/reports?status=${status}`, { placeholderData: (p) => p });
  const list = q.data?.reports ?? [];

  const act = async (r: AdminReportRow, action: Action) => {
    const texts: Record<Action, { title: string; message: string; label: string; destructive?: boolean }> = {
      dismiss: { title: 'Avvise rapporten?', message: 'Innholdet er i orden. Rapporten lukkes.', label: 'Avvis' },
      resolve: { title: 'Merke som løst?', message: 'For eksempel etter at arrangøren har rettet innholdet.', label: 'Løst' },
      takedown: {
        title: `Skjule «${r.targetTitle}»?`,
        message: 'Arrangementet forsvinner fra TIKIT og kan ikke kjøpes. Solgte billetter gjelder fortsatt. Arrangøren får beskjed.',
        label: 'Skjul',
        destructive: true,
      },
      suspend: {
        title: 'Stenge arrangøren?',
        message: 'Alle arrangementene deres forsvinner fra TIKIT, og de kan ikke publisere nye. Eierne får beskjed.',
        label: 'Steng',
        destructive: true,
      },
    };
    const t = texts[action];
    const ok = await confirm({ title: t.title, message: t.message, confirmLabel: t.label, destructive: t.destructive });
    if (!ok) return;
    setBusy(`${r.id}:${action}`);
    try {
      await api.post(`/admin/reports/${r.id}/resolve`, { action, note: '' });
      await qc.invalidateQueries({ queryKey: adminKey() });
      toast({ message: 'Rapporten er behandlet', tone: 'success' });
    } catch (err) {
      toast({ message: errorMessage(err), tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page title="Rapporter" large wide>
      <div className="mx-4 mb-4">
        <SegmentedControl
          label="Status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Åpne' },
            { value: 'resolved', label: 'Løste' },
            { value: 'dismissed', label: 'Avviste' },
          ]}
        />
      </div>
      {q.isLoading && <ListSkeleton rows={4} />}
      {q.isError && <QueryError error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && list.length === 0 && (
        <EmptyState icon={<Flag />} title={status === 'open' ? 'Ingen åpne rapporter' : 'Ingen rapporter her'} message={status === 'open' ? 'Nye rapporter kommer hit og til support-e-posten.' : undefined} />
      )}
      {list.length > 0 && (
        <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
          {list.map((r) => {
            const state = STATE_LABEL[r.targetState];
            return (
              <div key={r.id} className="px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="neutral">{r.kind === 'event' ? 'Arrangement' : 'Arrangør'}</Pill>
                  <Pill tone={state.tone}>{state.label}</Pill>
                  {r.reports > 1 && <Pill tone="red">{r.reports} rapporter</Pill>}
                  <span className="ml-auto text-footnote text-label-2">{formatAgo(r.createdAt)}</span>
                </div>
                <p className="mt-2 text-headline font-semibold">
                  {r.targetLink ? (
                    <Link to={r.targetLink} className="text-label">
                      {r.targetTitle}
                    </Link>
                  ) : (
                    r.targetTitle
                  )}
                </p>
                <p className="text-subhead text-label-2">{r.reasonLabel}</p>
                {r.message && <p className="mt-1.5 whitespace-pre-line text-body">{r.message}</p>}
                {r.resolution && <p className="mt-1.5 text-footnote text-label-2">Behandlet: {r.resolution}</p>}
                {r.status === 'open' && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="gray" loading={busy === `${r.id}:dismiss`} onClick={() => void act(r, 'dismiss')}>
                      Avvis
                    </Button>
                    <Button size="sm" variant="gray" loading={busy === `${r.id}:resolve`} onClick={() => void act(r, 'resolve')}>
                      Løst
                    </Button>
                    {r.kind === 'event' && r.targetState === 'visible' && (
                      <Button size="sm" variant="destructive" loading={busy === `${r.id}:takedown`} onClick={() => void act(r, 'takedown')}>
                        Skjul arrangementet
                      </Button>
                    )}
                    {r.targetState !== 'suspended' && r.targetState !== 'gone' && (
                      <Button size="sm" variant="destructive" loading={busy === `${r.id}:suspend`} onClick={() => void act(r, 'suspend')}>
                        Steng arrangøren
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Page>
  );
}
