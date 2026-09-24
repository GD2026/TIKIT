import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { formatNok } from '../../shared/money';
import { useConfig } from '../api/hooks';
import { Page } from '../components/layout/Page';

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-title3 font-bold">{title}</h2>
      <div className="space-y-2.5 text-body leading-relaxed text-label">{children}</div>
    </section>
  );
}

const UPDATED = '23. september 2026';

function Terms() {
  const config = useConfig().data;
  const op = config?.operator ?? { name: 'TIKIT', orgNumber: null, supportEmail: null };
  const fees = config?.fees ?? { fixedOre: 500, percentBp: 350, maxOre: 4900 };
  const who = `${op.name}${op.orgNumber ? ` (org.nr. ${op.orgNumber})` : ''}`;
  return (
    <>
      <p className="mb-6 text-subhead text-label-2">Sist oppdatert {UPDATED}</p>
      <Part title="1. Hvem er vi">
        <p>
          TIKIT er en markedsplass for billetter som drives av {who}. Arrangøren av hvert arrangement er selger av billettene og ansvarlig for arrangementet. TIKIT formidler salget,
          leverer billettene og tar imot betalingen på vegne av arrangøren.
        </p>
      </Part>
      <Part title="2. Kjøp og pris">
        <p>
          Prisen du ser før du betaler, er totalprisen. Den består av billettprisen og et servicegebyr til TIKIT på {formatNok(fees.fixedOre)} + {fees.percentBp / 100} % av billettprisen,
          maks {formatNok(fees.maxOre)} per billett. Gratisbilletter har ikke gebyr.
        </p>
        <p>Billetter reserveres i en kort periode mens du betaler. Fullføres ikke betalingen i tide, frigis de til andre.</p>
        <p>Kjøpet er bindende når betalingen er godkjent. Du får kvittering på e-post og billettene i appen.</p>
      </Part>
      <Part title="3. Angrerett og refusjon">
        <p>
          Billetter til arrangementer på en bestemt dato er unntatt fra angrerett etter angrerettloven. Arrangøren bestemmer om og når billetter kan refunderes – regelen står på
          arrangementssiden. Når du selv refunderer, betales billettprisen tilbake, men ikke servicegebyret.
        </p>
        <p>Avlyses arrangementet, refunderes hele beløpet, inkludert servicegebyret, automatisk til betalingsmåten du brukte.</p>
      </Part>
      <Part title="4. Billetten">
        <p>
          Billetten vises som en levende QR-kode i appen som fornyes jevnlig. Skjermbilder og kopier er ikke gyldige. Hver billett kan bare brukes én gang. Arrangøren kan be om
          legitimasjon og nekte adgang ved brudd på aldersgrense eller husregler.
        </p>
        <p>Personlige billetter gjelder bare for personen som står på billetten.</p>
      </Part>
      <Part title="5. Overføring og videresalg">
        <p>Du kan overføre billetter i appen når arrangøren tillater det. Billetten får da ny kode, og den gamle blir ugyldig.</p>
        <p>
          Videresalg skjer bare gjennom TIKIT og aldri for mer enn du betalte, i tråd med lov om forbud mot prispåslag ved videresalg av billetter til kultur- og idrettsarrangementer.
          Billetter som er solgt eller overført utenfor TIKIT, kan bli sperret.
        </p>
      </Part>
      <Part title="6. Konto og misbruk">
        <p>
          Du logger inn med Vipps, Apple eller Google. Du er ansvarlig for det som skjer på kontoen din. Vi kan sperre kontoer som brukes til svindel, oppkjøp for videresalg med
          fortjeneste eller annet misbruk.
        </p>
      </Part>
      <Part title="7. Kontakt og klage">
        <p>
          Spørsmål om arrangementet går til arrangøren (kontaktinfo står på kvitteringen). Spørsmål om kjøpet eller appen går til TIKIT{op.supportEmail ? ` på ${op.supportEmail}` : ''}.
          Kommer vi ikke til enighet, kan du klage til Forbrukertilsynet og Forbrukerklageutvalget.
        </p>
      </Part>
    </>
  );
}

function PrivacyPolicy() {
  const config = useConfig().data;
  const op = config?.operator ?? { name: 'TIKIT', orgNumber: null, supportEmail: null };
  return (
    <>
      <p className="mb-6 text-subhead text-label-2">Sist oppdatert {UPDATED}</p>
      <Part title="Behandlingsansvarlig">
        <p>
          {op.name}
          {op.orgNumber ? ` (org.nr. ${op.orgNumber})` : ''} er behandlingsansvarlig for personopplysningene i TIKIT. Arrangøren blir selvstendig behandlingsansvarlig for opplysningene de
          får om deltakerne på sitt arrangement.
        </p>
      </Part>
      <Part title="Hva vi samler inn">
        <p>Fra Vipps, Apple eller Google: navn, e-post og – ved Vipps – mobilnummer og fødselsdato. Vi får aldri passordet ditt.</p>
        <p>Når du bruker TIKIT: bestillinger, billetter, overføringer, favoritter, køplasser og varsler. Betalingskort håndteres av betalingsleverandøren – vi ser ikke kortnummeret.</p>
      </Part>
      <Part title="Hvorfor">
        <p>For å levere billettene og kvitteringer (avtale), sjekke aldersgrenser arrangøren har satt (avtale og rettslig forpliktelse), forhindre svindel (berettiget interesse) og oppfylle bokføringsreglene (rettslig forpliktelse). Tips og nyheter sender vi bare hvis du har sagt ja.</p>
      </Part>
      <Part title="Hvem som får opplysningene">
        <p>
          Arrangøren får navn og kontaktinformasjon til kjøpere og navn på billettene til sitt arrangement, for å gjennomføre det og kontrollere adgang. Dørvakter ser bare navn, billettype
          og om alderen er bekreftet. Vi bruker leverandører til betaling (Vipps MobilePay, kortinnløser), e-post og drift, som bare behandler data på våre vegne.
        </p>
      </Part>
      <Part title="Hvor lenge">
        <p>Profilen lagres til du sletter kontoen. Salgsdokumentasjon lagres så lenge bokføringsreglene krever, men uten navn og kontaktinfo etter at kontoen er slettet.</p>
      </Part>
      <Part title="Dine rettigheter">
        <p>
          Du kan se, laste ned og slette dataene dine under Profil → Personvern og data. Du har også rett til å få rettet feil, protestere på behandling og klage til Datatilsynet.
        </p>
      </Part>
      <Part title="Informasjonskapsler">
        <p>TIKIT bruker bare nødvendige informasjonskapsler for innlogging og sikkerhet. Vi bruker ikke sporing eller annonsekapsler.</p>
      </Part>
    </>
  );
}

export default function Legal() {
  const { pathname } = useLocation();
  const privacy = pathname.startsWith('/personvern');
  return (
    <Page title={privacy ? 'Personvernerklæring' : 'Kjøpsvilkår'} back="/profil">
      <article className="mx-auto max-w-2xl px-5 pb-10">{privacy ? <PrivacyPolicy /> : <Terms />}</article>
    </Page>
  );
}
