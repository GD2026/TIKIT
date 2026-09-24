import { Link } from 'react-router';
import { BadgeCheck, ChartColumn, Clock, CreditCard, LayoutDashboard, Plus, Repeat2, ScanLine, ShieldCheck, Users } from 'lucide-react';
import { formatNok } from '../../shared/money';
import { useConfig } from '../api/hooks';
import { useAuth } from '../app/auth';
import { Page } from '../components/layout/Page';
import { IconTile, Row, Section } from '../components/ui/List';
import { Button, LinkButton } from '../components/ui/Button';
import { CenterSpinner } from '../components/ui/States';
import { LogoMark } from '../components/brand/Brand';

const STATUS = { pending: 'Venter på godkjenning', approved: 'Godkjent', rejected: 'Avslått', suspended: 'Suspendert' } as const;
const ROLE = { owner: 'Eier', admin: 'Administrator', staff: 'Dørvakt/ansatt' } as const;

const FEATURES = [
  { icon: <CreditCard />, color: '#FF5B24', title: 'Vipps og kort', text: 'Kjøperne betaler med Vipps eller kort på sekunder.' },
  { icon: <ShieldCheck />, color: '#3B4CF2', title: 'Levende billetter', text: 'QR-koden fornyes hvert 15. sekund – skjermbilder og falske billetter stoppes i døra.' },
  { icon: <Clock />, color: '#FF9500', title: 'Kø for billettslipp', text: 'Rettferdig digital kø med loddtrekning når pågangen er stor.' },
  { icon: <Repeat2 />, color: '#12B886', title: 'Trygt videresalg', text: 'Kjøpere kan selge billetter videre i appen – aldri over prisen de betalte.' },
  { icon: <ScanLine />, color: '#30B0C7', title: 'Skanner på mobilen', text: 'Dørvaktene skanner med egen kode, også med dårlig dekning.' },
  { icon: <ChartColumn />, color: '#5856D6', title: 'Salg i sanntid', text: 'Følg salget, deltakerlister og oppgjør live.' },
];

export default function OrgHome() {
  const { me, loading, openLogin } = useAuth();
  const config = useConfig().data;
  const fees = config?.fees;

  if (loading) return <CenterSpinner />;

  return (
    <Page title="For arrangører" back="/" large>
      {me && me.organizations.length > 0 && (
        <div className="mx-4">
          <Section header="Dine arrangører">
            {me.organizations.map((o) => (
              <Row
                key={o.id}
                icon={
                  <IconTile color="#FF5E3A">
                    <LayoutDashboard />
                  </IconTile>
                }
                title={o.name}
                subtitle={`${ROLE[o.role]} · ${STATUS[o.status]}`}
                to={`/arrangor/${o.id}`}
              />
            ))}
            <Row
              icon={
                <IconTile color="#8E8E93">
                  <Plus />
                </IconTile>
              }
              title="Opprett ny arrangør"
              to="/arrangor/ny"
            />
          </Section>
        </div>
      )}

      <section className="mx-4 mb-7 overflow-hidden rounded-[26px] bg-grouped-2 p-6">
        <LogoMark size={52} />
        <h2 className="mt-4 text-title1 font-bold [text-wrap:balance]">Selg billetter til russetreff, fester, busslanseringer og revyer</h2>
        <p className="mt-2 text-body text-label-2">
          Gratis for arrangører: kjøperen betaler et lite servicegebyr
          {fees ? ` (${formatNok(fees.fixedOre)} + ${(fees.percentBp / 100).toLocaleString('nb-NO')} %, maks ${formatNok(fees.maxOre)} per billett)` : ''}, og dere får hele billettprisen.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          {me ? (
            <LinkButton to="/arrangor/ny" size="lg">
              Opprett arrangør
            </LinkButton>
          ) : (
            <Button size="lg" onClick={() => openLogin({ reason: 'Logg inn for å opprette en arrangørkonto', returnTo: '/arrangor/ny' })}>
              Kom i gang
            </Button>
          )}
          <Link to="/hjelp" className="press inline-flex h-[52px] items-center rounded-full bg-fill-3 px-6 text-headline font-semibold text-label no-underline">
            Vanlige spørsmål
          </Link>
        </div>
      </section>

      <div className="mx-4 mb-8 grid gap-3 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="flex gap-3 rounded-lg bg-grouped-2 p-4">
            <IconTile color={f.color}>{f.icon}</IconTile>
            <div>
              <h3 className="text-headline font-semibold">{f.title}</h3>
              <p className="mt-0.5 text-subhead text-label-2">{f.text}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mx-4 mb-6 flex items-start gap-3 rounded-lg bg-tint-soft p-4">
        <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 text-tint" aria-hidden="true" />
        <p className="text-subhead">
          Nye arrangører godkjennes av TIKIT før første arrangement publiseres. Dere kan lage arrangementer og billetter mens dere venter.
        </p>
      </div>
      <div className="mx-4 mb-4 flex items-center gap-3 rounded-lg bg-grouped-2 p-4">
        <Users className="h-5 w-5 shrink-0 text-label-2" aria-hidden="true" />
        <p className="text-subhead text-label-2">Flere i styret? Inviter dem som administratorer eller dørvakter når kontoen er opprettet.</p>
      </div>
    </Page>
  );
}
