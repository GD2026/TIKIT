import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Bell, CircleUser, Compass, LayoutDashboard, LogIn, Search, Shield, Sparkles, Ticket } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useMe, useTickets } from '../../api/hooks';
import { Logo } from '../brand/Brand';
import { Avatar } from '../ui/Avatar';
import { isDemoBuild } from '../../lib/device';
import { DemoButton } from '../../demo/DemoPanel';
import { useConfig } from '../../api/hooks';

interface TabDef {
  to: string;
  label: string;
  icon: (active: boolean) => ReactNode;
  match: (path: string) => boolean;
}

const TABS: TabDef[] = [
  { to: '/', label: 'Utforsk', icon: (a) => <Compass className="h-6 w-6" strokeWidth={a ? 2.4 : 1.9} fill={a ? 'currentColor' : 'none'} fillOpacity={a ? 0.18 : 0} />, match: (p) => p === '/' || p.startsWith('/e/') || p.startsWith('/a/') },
  { to: '/billetter', label: 'Billetter', icon: (a) => <Ticket className="h-6 w-6" strokeWidth={a ? 2.4 : 1.9} fill={a ? 'currentColor' : 'none'} fillOpacity={a ? 0.18 : 0} />, match: (p) => p.startsWith('/billetter') },
  { to: '/profil', label: 'Profil', icon: (a) => <CircleUser className="h-6 w-6" strokeWidth={a ? 2.4 : 1.9} fill={a ? 'currentColor' : 'none'} fillOpacity={a ? 0.18 : 0} />, match: (p) => p.startsWith('/profil') || p.startsWith('/varsler') },
];

function TabBar() {
  const { pathname } = useLocation();
  const me = useMe().data?.me ?? null;
  const unread = me?.unreadNotifications ?? 0;
  const searchActive = pathname.startsWith('/sok');
  return (
    <nav
      aria-label="Hovedmeny"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-end justify-center gap-3 px-4 lg:hidden"
      style={{ paddingBottom: 'max(var(--tabbar-gap), var(--safe-bottom))' }}
    >
      <div className="glass pointer-events-auto flex h-[var(--tabbar-height)] items-center gap-1 rounded-full p-1.5">
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'press relative flex h-full min-w-[76px] flex-col items-center justify-center gap-0.5 rounded-full px-3 no-underline transition-colors',
                active ? 'bg-fill-3 text-tint' : 'text-label',
              )}
            >
              {tab.icon(active)}
              <span className="text-[0.66rem] font-semibold leading-none">{tab.label}</span>
              {tab.to === '/profil' && unread > 0 && (
                <span className="absolute right-4 top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--badge)] px-1 text-[0.62rem] font-bold text-white" aria-label={`${unread} uleste varsler`}>
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </Link>
          );
        })}
      </div>
      <Link
        to="/sok"
        aria-label="Søk"
        aria-current={searchActive ? 'page' : undefined}
        className={cn('glass press pointer-events-auto flex h-[var(--tabbar-height)] w-[var(--tabbar-height)] items-center justify-center rounded-full no-underline', searchActive ? 'text-tint' : 'text-label')}
      >
        <Search className="h-6 w-6" strokeWidth={searchActive ? 2.6 : 2} />
      </Link>
    </nav>
  );
}

function SideLink({ to, icon, children, end, badge }: { to: string; icon: ReactNode; children: ReactNode; end?: boolean; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex h-10 items-center gap-3 rounded-[10px] px-3 text-body no-underline transition-colors [&_svg]:h-5 [&_svg]:w-5',
          isActive ? 'bg-tint-soft font-semibold text-tint' : 'text-label hover:bg-fill-4',
        )
      }
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {!!badge && <span className="rounded-full bg-[var(--badge)] px-1.5 text-caption2 font-bold text-white">{badge}</span>}
    </NavLink>
  );
}

function Sidebar() {
  const meQ = useMe();
  const me = meQ.data?.me ?? null;
  const tickets = useTickets(!!me).data?.tickets ?? [];
  const upcoming = tickets.filter((t) => t.status === 'valid' && new Date(t.event.endsAt) > new Date()).length;
  const cfg = useConfig().data;
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[272px] flex-col border-r border-[var(--separator)] bg-grouped-2/80 px-3 pb-4 backdrop-blur-xl lg:flex" style={{ paddingTop: 'calc(var(--safe-top) + 20px)' }}>
      <Link to="/" className="mb-6 px-2 no-underline text-label" aria-label="TIKIT – til forsiden">
        <Logo />
      </Link>
      <nav aria-label="Hovedmeny" className="flex flex-col gap-0.5">
        <SideLink to="/" end icon={<Compass />}>
          Utforsk
        </SideLink>
        <SideLink to="/sok" icon={<Search />}>
          Søk
        </SideLink>
        <SideLink to="/billetter" icon={<Ticket />} badge={upcoming}>
          Billetter
        </SideLink>
        {me && (
          <SideLink to="/varsler" icon={<Bell />} badge={me.unreadNotifications}>
            Varsler
          </SideLink>
        )}
        <SideLink to="/profil" icon={<CircleUser />}>
          Profil
        </SideLink>
      </nav>
      <div className="mt-6">
        <p className="mb-1 px-3 text-footnote font-semibold uppercase tracking-[0.04em] text-label-2">For arrangører</p>
        <nav aria-label="Arrangør" className="flex flex-col gap-0.5">
          {me?.organizations.map((o) => (
            <SideLink key={o.id} to={`/arrangor/${o.id}`} icon={<LayoutDashboard />}>
              {o.name}
            </SideLink>
          ))}
          {!me?.organizations.length && (
            <SideLink to="/arrangor" icon={<Sparkles />}>
              Selg billetter
            </SideLink>
          )}
          {me?.role === 'admin' && (
            <SideLink to="/admin" icon={<Shield />}>
              Plattformadmin
            </SideLink>
          )}
        </nav>
      </div>
      <div className="mt-auto flex flex-col gap-2">
        {(isDemoBuild || cfg?.demoMode) && <DemoButton wide />}
        {me ? (
          <Link to="/profil" className="flex items-center gap-3 rounded-[14px] p-2 no-underline text-label hover:bg-fill-4">
            <Avatar name={me.name} size={36} />
            <span className="min-w-0">
              <span className="block truncate text-subhead font-semibold">{me.name}</span>
              <span className="block truncate text-footnote text-label-2">{me.email ?? me.phone ?? ''}</span>
            </span>
          </Link>
        ) : (
          !meQ.isLoading && (
            <Link to="/logg-inn" className="press flex h-11 items-center justify-center gap-2 rounded-full bg-tint-fill text-headline font-semibold text-on-tint no-underline">
              <LogIn className="h-5 w-5" /> Logg inn
            </Link>
          )
        )}
      </div>
    </aside>
  );
}

/** Buyer app frame: floating tab bar on phones/tablets, sidebar on desktop. */
export function AppShell() {
  return (
    <div
      className="min-h-dvh [--sidebar-w:0px] lg:[--sidebar-w:272px]"
      style={{ ['--page-bottom' as string]: 'calc(var(--tabbar-height) + max(var(--tabbar-gap), var(--safe-bottom)) + 28px)' }}
    >
      <a href="#innhold" className="sr-only z-50 rounded-full bg-tint-fill px-4 py-2 text-on-tint focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Hopp til innhold
      </a>
      <Sidebar />
      <div className="lg:pl-[272px] lg:[--page-bottom:64px]">
        <Outlet />
      </div>
      <TabBar />
    </div>
  );
}
