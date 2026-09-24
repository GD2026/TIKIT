import { Link } from 'react-router';
import {
  Bell,
  Heart,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Receipt,
  ScanLine,
  Shield,
  ShieldCheck,
  Sparkles,
  UserLock,
} from 'lucide-react';
import type { ProviderId } from '../../shared/types';
import { useConfig } from '../api/hooks';
import { LoginPanel, useAuth } from '../app/auth';
import { Page } from '../components/layout/Page';
import { IconTile, Row, Section } from '../components/ui/List';
import { Avatar } from '../components/ui/Avatar';
import { CenterSpinner } from '../components/ui/States';
import { useConfirm } from '../components/ui/Overlays';
import { DemoButton } from '../demo/DemoPanel';
import { isDemoBuild } from '../lib/device';

const PROVIDER_NAMES: Record<ProviderId, string> = { vipps: 'Vipps', apple: 'Apple', google: 'Google' };
const ROLE_NAMES = { owner: 'Eier', admin: 'Administrator', staff: 'Dørvakt/ansatt' } as const;
const ORG_STATUS = { pending: 'Venter på godkjenning', approved: 'Godkjent', rejected: 'Avslått', suspended: 'Suspendert' } as const;

function SupportSection() {
  return (
    <Section header="Hjelp og informasjon">
      <Row
        icon={
          <IconTile color="#30B0C7">
            <LifeBuoy />
          </IconTile>
        }
        title="Hjelp"
        subtitle="Vanlige spørsmål, kjøpsvilkår og personvern"
        to="/hjelp"
      />
    </Section>
  );
}

export default function Profile() {
  const { me, loading, logout, startProvider } = useAuth();
  const config = useConfig().data;
  const confirm = useConfirm();
  const showDemo = isDemoBuild || !!config?.demoMode;

  if (loading)
    return (
      <Page title="Profil" large>
        <CenterSpinner />
      </Page>
    );

  if (!me) {
    return (
      <Page title="Profil" large>
        <div className="mx-4 mb-7 rounded-[22px] bg-grouped-2 px-5 py-6">
          <LoginPanel compact onProvider={(p) => startProvider(p, { returnTo: '/profil' })} />
        </div>
        {showDemo && (
          <div className="mx-4 mb-7 lg:hidden">
            <DemoButton wide />
          </div>
        )}
        <Section header="Arrangør eller dørvakt?" className="mx-4">
          <Row
            icon={
              <IconTile color="#FF5E3A">
                <Sparkles />
              </IconTile>
            }
            title="Selg billetter med TIKIT"
            to="/arrangor"
          />
          <Row
            icon={
              <IconTile color="#30B0C7">
                <ScanLine />
              </IconTile>
            }
            title="Billettskanner for dørvakter"
            to="/skann"
          />
        </Section>
        <div className="mx-4">
          <SupportSection />
        </div>
      </Page>
    );
  }

  const providers = me.providers.map((p) => PROVIDER_NAMES[p]).join(', ');
  const needsAge = !me.birthdateVerified;

  return (
    <Page title="Profil" large>
      <div className="mx-4">
        <Link to="/profil/rediger" className="mb-7 flex items-center gap-4 rounded-[22px] bg-grouped-2 p-4 no-underline text-label transition-colors hover:bg-fill-4">
          <Avatar name={me.name} size={60} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-title3 font-bold">{me.name}</span>
            <span className="block truncate text-subhead text-label-2">{me.email ?? me.phone ?? 'Legg til e-post'}</span>
            <span className="mt-0.5 block text-subhead font-medium text-tint">Rediger profil</span>
          </span>
        </Link>

        {needsAge && (
          <Link to="/profil/innlogging" className="mb-7 flex items-start gap-3 rounded-[18px] bg-tint-soft px-4 py-3.5 no-underline">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-tint" aria-hidden="true" />
            <span>
              <span className="block text-headline font-semibold text-tint">Bekreft alderen med Vipps</span>
              <span className="block text-subhead text-label">Noen arrangementer krever bekreftet alder. Koble til Vipps én gang, så slipper du å vise legitimasjon for å kjøpe.</span>
            </span>
          </Link>
        )}

        <Section header="Kjøp">
          <Row
            icon={
              <IconTile color="#34C759">
                <Receipt />
              </IconTile>
            }
            title="Kjøpshistorikk og kvitteringer"
            to="/profil/kjop"
          />
          <Row
            icon={
              <IconTile color="#FF2D55">
                <Heart />
              </IconTile>
            }
            title="Favoritter"
            to="/profil/favoritter"
          />
          <Row
            icon={
              <IconTile color="#FF9500">
                <Bell />
              </IconTile>
            }
            title="Varsler"
            to="/varsler"
            value={
              me.unreadNotifications > 0 ? (
                <span className="rounded-full bg-[var(--badge)] px-2 py-0.5 text-footnote font-bold text-white">{me.unreadNotifications}</span>
              ) : undefined
            }
          />
        </Section>

        <Section header="Konto">
          <Row
            icon={
              <IconTile color="#5856D6">
                <KeyRound />
              </IconTile>
            }
            title="Innloggingsmetoder"
            subtitle={providers}
            to="/profil/innlogging"
          />
          <Row
            icon={
              <IconTile color="#8E8E93">
                <UserLock />
              </IconTile>
            }
            title="Personvern og data"
            to="/profil/personvern"
          />
        </Section>

        <Section header="For arrangører" footer={me.organizations.length === 0 ? 'Russegrupper, skoler, utesteder og foreninger kan selge billetter med TIKIT.' : undefined}>
          {me.organizations.map((o) => (
            <Row
              key={o.id}
              icon={
                <IconTile color="#FF5E3A">
                  <LayoutDashboard />
                </IconTile>
              }
              title={o.name}
              subtitle={`${ROLE_NAMES[o.role]} · ${ORG_STATUS[o.status]}`}
              to={`/arrangor/${o.id}`}
            />
          ))}
          <Row
            icon={
              <IconTile color="#FF9500">
                <Sparkles />
              </IconTile>
            }
            title={me.organizations.length === 0 ? 'Selg billetter med TIKIT' : 'Opprett ny arrangør'}
            to={me.organizations.length === 0 ? '/arrangor' : '/arrangor/ny'}
          />
          <Row
            icon={
              <IconTile color="#30B0C7">
                <ScanLine />
              </IconTile>
            }
            title="Billettskanner"
            subtitle="Sjekk inn gjester i døra"
            to="/skann"
          />
          {me.role === 'admin' && (
            <Row
              icon={
                <IconTile color="#1C1C1E">
                  <Shield />
                </IconTile>
              }
              title="Plattformadmin"
              to="/admin"
            />
          )}
        </Section>

        <SupportSection />

        {showDemo && (
          <div className="mb-7 lg:hidden">
            <DemoButton wide />
          </div>
        )}

        <Section>
          <Row
            icon={
              <IconTile color="#FF3B30">
                <LogOut />
              </IconTile>
            }
            title="Logg ut"
            destructive
            chevron={false}
            onClick={async () => {
              const ok = await confirm({ title: 'Logge ut?', message: 'Billettene ligger trygt på kontoen og er tilbake når du logger inn igjen.', confirmLabel: 'Logg ut', destructive: true });
              if (ok) await logout();
            }}
          />
        </Section>
      </div>
    </Page>
  );
}
