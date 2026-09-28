import { Building2, CalendarDays, Flag, LayoutDashboard, Settings, Shield, Users } from 'lucide-react';
import { useAuth } from '../app/auth';
import { useConfig } from '../api/hooks';
import { SectionShell, type ShellNavItem } from '../components/layout/SectionShell';
import { Page } from '../components/layout/Page';
import { CenterSpinner, RequireLogin } from '../components/ui/States';
import { EmptyState } from '../components/ui/Feedback';
import { LinkButton } from '../components/ui/Button';
import { DemoButton } from '../demo/DemoPanel';
import { isDemoBuild } from '../lib/device';

const NAV: ShellNavItem[] = [
  { to: '/admin', label: 'Oversikt', icon: <LayoutDashboard />, end: true },
  { to: '/admin/arrangorer', label: 'Arrangører', icon: <Building2 /> },
  { to: '/admin/arrangementer', label: 'Arrangementer', short: 'Eventer', icon: <CalendarDays /> },
  { to: '/admin/rapporter', label: 'Rapporter', icon: <Flag /> },
  { to: '/admin/brukere', label: 'Brukere', icon: <Users /> },
  { to: '/admin/innstillinger', label: 'Gebyrer', icon: <Settings /> },
];

export default function AdminShell() {
  const { me, loading } = useAuth();
  const config = useConfig().data;
  if (loading) return <CenterSpinner />;
  if (!me)
    return (
      <Page title="Plattformadmin" back="/">
        <RequireLogin reason="Logg inn som administrator.">{null}</RequireLogin>
      </Page>
    );
  if (me.role !== 'admin')
    return (
      <Page title="Plattformadmin" back="/">
        <EmptyState icon={<Shield />} title="Ingen tilgang" message="Denne delen er bare for TIKIT-administratorer." action={<LinkButton to="/">Til forsiden</LinkButton>} />
      </Page>
    );
  return (
    <SectionShell
      nav={NAV}
      backTo="/"
      header={
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-label text-bg">
            <Shield className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-headline font-semibold">Plattformadmin</p>
            <p className="truncate text-footnote text-label-2">{me.name}</p>
          </div>
        </div>
      }
      extra={isDemoBuild || config?.demoMode ? <DemoButton wide /> : undefined}
    />
  );
}
