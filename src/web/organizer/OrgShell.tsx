import { useNavigate, useParams } from 'react-router';
import { CalendarDays, LayoutDashboard, ScanLine, Settings, Users, Wallet } from 'lucide-react';
import type { OrgDetail } from '../../server/services/organizers';
import { useAuth } from '../app/auth';
import { useConfig } from '../api/hooks';
import { SectionShell, type ShellNavItem } from '../components/layout/SectionShell';
import { Page } from '../components/layout/Page';
import { OrgAvatar } from '../components/event/OrgAvatar';
import { CenterSpinner, QueryError, RequireLogin } from '../components/ui/States';
import { EmptyState } from '../components/ui/Feedback';
import { LinkButton } from '../components/ui/Button';
import { DemoButton } from '../demo/DemoPanel';
import { isDemoBuild } from '../lib/device';
import { canManage, useOrgQuery, type OrgContext } from './shared';

const ROLE = { owner: 'Eier', admin: 'Administrator', staff: 'Dørvakt/ansatt' } as const;

function Inner({ orgId }: { orgId: string }) {
  const navigate = useNavigate();
  const { me } = useAuth();
  const config = useConfig().data;
  const q = useOrgQuery<OrgDetail>(orgId, '');
  if (q.isLoading) return <CenterSpinner />;
  if (q.isError || !q.data)
    return (
      <Page title="Arrangør" back="/arrangor">
        <QueryError
          error={q.error}
          onRetry={() => void q.refetch()}
          notFound={<EmptyState title="Fant ikke arrangøren" message="Du har kanskje ikke tilgang, eller lenken er feil." action={<LinkButton to="/arrangor">Mine arrangører</LinkButton>} />}
        />
      </Page>
    );
  const org = q.data;
  const base = `/arrangor/${orgId}`;
  const manage = canManage(org.role);
  const nav: ShellNavItem[] = [
    { to: base, label: 'Oversikt', icon: <LayoutDashboard />, end: true },
    { to: `${base}/arrangementer`, label: 'Arrangementer', short: 'Eventer', icon: <CalendarDays /> },
    ...(manage ? [{ to: `${base}/oppgjor`, label: 'Oppgjør', icon: <Wallet /> }] : []),
    { to: `${base}/team`, label: 'Team', icon: <Users />, desktopOnly: true },
    { to: `${base}/innstillinger`, label: 'Innstillinger', short: 'Mer', icon: <Settings />, match: [`${base}/team`] },
  ];
  const context: OrgContext = { org, refetch: () => void q.refetch() };
  const orgs = me?.organizations ?? [];

  return (
    <SectionShell
      nav={nav}
      context={context}
      backTo="/"
      header={
        <div className="flex items-center gap-3">
          <OrgAvatar name={org.name} logoUrl={org.logoImageId ? `/api/images/${org.logoImageId}` : null} palette={org.palette} size={44} />
          <div className="min-w-0">
            {orgs.length > 1 ? (
              <label className="relative block">
                <span className="sr-only">Bytt arrangør</span>
                <select
                  value={org.id}
                  onChange={(e) => navigate(`/arrangor/${e.target.value}`)}
                  className="w-full max-w-[180px] cursor-pointer appearance-none truncate bg-transparent pr-5 text-headline font-semibold outline-none"
                >
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <svg aria-hidden="true" viewBox="0 0 12 8" className="pointer-events-none absolute right-0 top-1/2 h-2 w-3 -translate-y-1/2 text-label-2">
                  <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </label>
            ) : (
              <p className="truncate text-headline font-semibold">{org.name}</p>
            )}
            <p className="truncate text-footnote text-label-2">{ROLE[org.role]}</p>
          </div>
        </div>
      }
      extra={
        <div className="flex flex-col gap-2">
          <LinkButton to="/skann" variant="gray" full icon={<ScanLine className="h-4 w-4" />}>
            Skann billetter
          </LinkButton>
          {(isDemoBuild || config?.demoMode) && <DemoButton wide />}
        </div>
      }
    />
  );
}

export default function OrgShell() {
  const { orgId } = useParams();
  const { me, loading } = useAuth();
  if (loading) return <CenterSpinner />;
  if (!me)
    return (
      <Page title="Arrangørpanel" back="/">
        <RequireLogin reason="Logg inn for å åpne arrangørpanelet.">{null}</RequireLogin>
      </Page>
    );
  return <Inner key={orgId} orgId={orgId!} />;
}
