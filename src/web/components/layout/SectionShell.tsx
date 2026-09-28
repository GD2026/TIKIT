import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface ShellNavItem {
  to: string;
  label: string;
  /** Shorter label for the phone tab bar. */
  short?: string;
  icon: ReactNode;
  /** Exact match only (for index routes). */
  end?: boolean;
  /** Extra path prefixes that should mark this tab active. */
  match?: string[];
  /** Only in the desktop sidebar (reach it from another tab on phones). */
  desktopOnly?: boolean;
}

/**
 * Frame for the organizer and admin areas: sidebar on desktop, floating glass tab bar on phones –
 * the same navigation model as the buyer app, with its own sections.
 */
export function SectionShell({ nav, header, context, backTo = '/', backLabel = 'Til TIKIT', extra }: { nav: ShellNavItem[]; header: ReactNode; context?: unknown; backTo?: string; backLabel?: string; extra?: ReactNode }) {
  const { pathname } = useLocation();
  const isActive = (item: ShellNavItem) =>
    item.end ? pathname === item.to || pathname === `${item.to}/` : pathname === item.to || pathname.startsWith(`${item.to}/`) || !!item.match?.some((m) => pathname.startsWith(m));

  return (
    <div className="min-h-dvh [--sidebar-w:0px] lg:[--sidebar-w:272px]" style={{ ['--page-bottom' as string]: 'calc(var(--tabbar-height) + max(var(--tabbar-gap), var(--safe-bottom)) + 28px)' }}>
      <a href="#innhold" className="sr-only z-50 rounded-full bg-tint-fill px-4 py-2 text-on-tint focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Hopp til innhold
      </a>
      <aside
        className="fixed inset-y-0 left-0 z-40 hidden w-[272px] flex-col border-r border-[var(--separator)] bg-grouped-2/80 px-3 pb-4 backdrop-blur-xl lg:flex"
        style={{ paddingTop: 'calc(var(--safe-top) + 16px)' }}
      >
        <Link to={backTo} className="relative mb-4 inline-flex h-9 items-center gap-1.5 self-start rounded-full px-2 text-subhead font-medium text-tint no-underline hover:bg-fill-4 before:absolute before:inset-x-0 before:-inset-y-1 before:content-['']">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {backLabel}
        </Link>
        <div className="mb-5 px-2">{header}</div>
        <nav aria-label="Seksjoner" className="flex flex-col gap-0.5">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={() =>
                cn(
                  'flex h-10 items-center gap-3 rounded-[10px] px-3 text-body no-underline transition-colors [&_svg]:h-5 [&_svg]:w-5',
                  isActive(item) ? 'bg-tint-soft font-semibold text-tint' : 'text-label hover:bg-fill-4',
                )
              }
              aria-current={isActive(item) ? 'page' : undefined}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        {extra && <div className="mt-auto">{extra}</div>}
      </aside>
      <div className="lg:pl-[272px] lg:[--page-bottom:64px]">
        <Outlet context={context} />
      </div>
      <nav
        aria-label="Seksjoner"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 lg:hidden"
        style={{ paddingBottom: 'max(var(--tabbar-gap), var(--safe-bottom))' }}
      >
        <div className="glass pointer-events-auto flex h-[var(--tabbar-height)] items-center gap-1 rounded-full p-1.5">
          {nav.filter((item) => !item.desktopOnly).map((item, _i, shown) => {
            const active = isActive(item);
            // Six tabs still fit a 375 pt wide phone when each gets a little less room.
            const crowded = shown.length > 5;
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'press flex h-full flex-col items-center justify-center gap-0.5 rounded-full no-underline transition-colors [&_svg]:h-[22px] [&_svg]:w-[22px]',
                  crowded ? 'min-w-[52px] px-1' : 'min-w-[66px] px-2',
                  active ? 'bg-fill-3 text-tint' : 'text-label',
                )}
              >
                {item.icon}
                <span className="text-[0.64rem] font-semibold leading-none">{item.short ?? item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
