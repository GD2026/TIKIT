import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, CalendarX, EyeOff, Flag, Globe } from 'lucide-react';
import type { EventCard, OrganizerPublic as OrgPublic } from '../../shared/types';
import { ORGANIZER_TYPES, posterPalette } from '../../shared/constants';
import { useApi } from '../app/context';
import { useLoginGate } from '../app/auth';
import { qk } from '../api/hooks';
import { type ApiError, errorMessage } from '../api/client';
import { Page } from '../components/layout/Page';
import { OrgAvatar } from '../components/event/OrgAvatar';
import { RowCard } from '../components/event/EventCards';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/Feedback';
import { CenterSpinner, QueryError } from '../components/ui/States';
import { useConfirm, useToast } from '../components/ui/Overlays';
import { Row, Section } from '../components/ui/List';
import { ReportSheet } from '../components/moderation/ReportSheet';

export default function OrganizerPublic() {
  const { slug } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const toast = useToast();
  const gate = useLoginGate();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const q = useQuery<{ organizer: OrgPublic; events: EventCard[]; following: boolean; blocked?: boolean }, ApiError>({
    queryKey: qk.organizer(slug ?? ''),
    queryFn: () => api.get(`/organizers/${encodeURIComponent(slug!)}`),
    enabled: !!slug,
  });

  if (q.isLoading) return <CenterSpinner />;
  if (q.isError || !q.data)
    return (
      <Page title="Arrangør" back="/">
        <QueryError error={q.error} onRetry={() => void q.refetch()} notFound={<EmptyState title="Fant ikke arrangøren" />} />
      </Page>
    );

  const { organizer: o, events, following } = q.data;
  const blocked = q.data.blocked ?? false;
  const [c0, c1] = posterPalette(o.palette);
  const type = ORGANIZER_TYPES.find((t) => t.id === o.type)?.label;

  const toggleFollow = () =>
    gate('Logg inn for å følge arrangører', () => {
      void (async () => {
        setBusy(true);
        try {
          if (following) await api.del(`/organizers/${o.id}/follow`);
          else await api.post(`/organizers/${o.id}/follow`);
          await qc.invalidateQueries({ queryKey: qk.organizer(slug ?? '') });
          await qc.invalidateQueries({ queryKey: ['home'] });
          if (!following) toast({ message: `Du følger ${o.name}. Vi sier fra om nye arrangementer.`, tone: 'success' });
        } catch (err) {
          toast({ message: errorMessage(err), tone: 'error' });
        } finally {
          setBusy(false);
        }
      })();
    });

  // Hiding an organizer keeps its events out of Utforsk and Søk for this person (Guideline 1.2 blocking).
  const toggleBlock = () =>
    gate('Logg inn for å skjule arrangører', () => {
      void (async () => {
        if (!blocked) {
          const ok = await confirm({
            title: `Skjule ${o.name}?`,
            message: 'Arrangementene deres vises ikke lenger i Utforsk og Søk for deg. Du kan angre under Profil → Skjulte arrangører.',
            confirmLabel: 'Skjul',
            destructive: true,
          });
          if (!ok) return;
        }
        try {
          if (blocked) await api.del(`/organizers/${o.id}/block`);
          else await api.post(`/organizers/${o.id}/block`);
          await qc.invalidateQueries({ queryKey: qk.organizer(slug ?? '') });
          await qc.invalidateQueries({ queryKey: ['home'] });
          await qc.invalidateQueries({ queryKey: ['events'] });
          toast({ message: blocked ? `${o.name} vises igjen` : `${o.name} er skjult`, tone: 'success' });
        } catch (err) {
          toast({ message: errorMessage(err), tone: 'error' });
        }
      })();
    });

  return (
    <Page title={o.name} back="/">
      <div className="mx-4 mb-6 overflow-hidden rounded-[26px] bg-grouped-2">
        <div className="h-24" style={{ background: `linear-gradient(120deg, ${c1}, ${c0})` }} aria-hidden="true" />
        <div className="-mt-10 px-5 pb-5">
          <OrgAvatar name={o.name} logoUrl={o.logoUrl} palette={o.palette} size={76} className="rounded-[20px] shadow-[0_0_0_4px_var(--bg-grouped-2)]" />
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="text-title2 font-bold">{o.name}</h2>
            {o.verified && (
              <span className="inline-flex items-center gap-1 text-subhead font-semibold text-tint">
                <BadgeCheck className="h-5 w-5" aria-hidden="true" /> Verifisert
              </span>
            )}
          </div>
          <p className="text-subhead text-label-2">
            {[type, o.city, o.followers === 1 ? '1 følger' : `${o.followers} følgere`].filter(Boolean).join(' · ')}
          </p>
          {o.description && <p className="mt-3 whitespace-pre-line text-body">{o.description}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant={following ? 'gray' : 'filled'} loading={busy} onClick={toggleFollow}>
              {following ? 'Følger' : 'Følg'}
            </Button>
            {o.website && (
              <a href={o.website} target="_blank" rel="noopener noreferrer nofollow" className="press inline-flex h-11 items-center gap-2 rounded-full bg-fill-3 px-5 text-headline font-semibold text-label no-underline">
                <Globe className="h-4 w-4" aria-hidden="true" /> Nettside
              </a>
            )}
          </div>
        </div>
      </div>

      <h2 className="mb-2 px-4 text-title2 font-bold">Kommende arrangementer</h2>
      {events.length === 0 ? (
        <EmptyState icon={<CalendarX />} title="Ingen kommende arrangementer" message="Følg arrangøren, så får du beskjed når noe nytt publiseres." />
      ) : (
        <div className="mx-4 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
          {events.map((e) => (
            <RowCard key={e.id} event={e} />
          ))}
        </div>
      )}

      <Section className="mx-4 mt-8" footer="Rapporter går til TIKIT, ikke til arrangøren. Vi følger opp innen ett døgn.">
        <Row icon={<Flag className="h-5 w-5 text-label-2" aria-hidden="true" />} title="Rapporter arrangør" onClick={() => setReporting(true)} />
        <Row icon={<EyeOff className="h-5 w-5 text-label-2" aria-hidden="true" />} title={blocked ? 'Vis arrangøren igjen' : 'Skjul arrangøren for meg'} onClick={toggleBlock} destructive={!blocked} />
      </Section>
      <ReportSheet open={reporting} onClose={() => setReporting(false)} kind="organizer" targetId={o.id} targetName={o.name} />
    </Page>
  );
}
