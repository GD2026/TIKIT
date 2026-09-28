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

const UPDATED = '24. september 2026';

/** The operator's name and contact line as configured on the server (OPERATOR_NAME, OPERATOR_ORG_NUMBER, SUPPORT_EMAIL). */
function useOperator() {
  const config = useConfig().data;
  const op = config?.operator ?? { name: 'TIKIT', orgNumber: null, supportEmail: null };
  return { ...op, who: `${op.name}${op.orgNumber ? ` (org.nr. ${op.orgNumber})` : ''}`, contact: op.supportEmail ? ` på ${op.supportEmail}` : '' };
}

function Terms() {
  const config = useConfig().data;
  const op = useOperator();
  const fees = config?.fees ?? { fixedOre: 500, percentBp: 350, maxOre: 4900 };
  return (
    <>
      <p className="mb-6 text-subhead text-label-2">Sist oppdatert {UPDATED}</p>
      <Part title="1. Hvem er vi">
        <p>
          TIKIT er en markedsplass for billetter som drives av {op.who}. Arrangøren av hvert arrangement er selger av billettene og ansvarlig for selve arrangementet. TIKIT formidler
          salget, leverer billettene og tar imot betalingen på vegne av arrangøren. Hvem arrangøren er, står på arrangementssiden og på kvitteringen.
        </p>
      </Part>
      <Part title="2. Konto">
        <p>
          Du logger inn med Vipps, Apple eller Google og er ansvarlig for det som skjer på kontoen din. Er du under 18 år, må du betale med penger du selv kan disponere, for eksempel
          egne penger eller lommepenger.
        </p>
      </Part>
      <Part title="3. Kjøp og pris">
        <p>
          Prisen du ser før du betaler, er totalprisen inkludert merverdiavgift der det gjelder. Den består av billettprisen og et servicegebyr til TIKIT på {formatNok(fees.fixedOre)} +{' '}
          {(fees.percentBp / 100).toLocaleString('nb-NO')} % av billettprisen, maks {formatNok(fees.maxOre)} per billett. Gratisbilletter har ikke gebyr.
        </p>
        <p>
          Billettene holdes av til deg i 10 minutter, og i opptil 30 minutter fra bestillingen mens du betaler. Fullføres ikke betalingen i tide, går billettene til andre. Arrangøren kan
          sette et maks antall billetter per person for arrangementet – grensen gjelder alle kjøpene dine til sammen.
        </p>
        <p>
          Ved populære billettslipp kan det være kø. Alle som stiller seg i kø før salget åpner, får plass etter loddtrekning, og de som kommer etterpå, stiller seg bakerst.
        </p>
        <p>Kjøpet er bindende når betalingen er godkjent. Du får kvittering på e-post og billettene i appen.</p>
      </Part>
      <Part title="4. Betaling">
        <p>
          Du betaler med Vipps eller kort. Kortbetaling håndteres av Stripe, og TIKIT ser aldri kortnummeret. Beløpet reserveres og trekkes når billettene er utstedt. Blir billettene
          utsolgt før betalingen er fullført, blir du ikke belastet, og et reservert beløp frigis eller betales tilbake.
        </p>
      </Part>
      <Part title="5. Angrerett, avlysning og refusjon">
        <p>Billetter til arrangementer på en bestemt dato er unntatt fra angrerett, jf. angrerettloven § 22 bokstav m.</p>
        <p>
          Arrangøren bestemmer om billetter kan refunderes, og fram til når: aldri, 7 dager før, 48 timer før eller fram til start. Regelen står på arrangementssiden før du kjøper. Når du
          selv refunderer, får du tilbake billettprisen, men ikke servicegebyret.
        </p>
        <p>Avlyses arrangementet, får du automatisk tilbake hele beløpet, inkludert servicegebyret.</p>
        <p>Flyttes arrangementet eller endres det vesentlig, og vil du ikke beholde billetten, har du rett til å få pengene tilbake. Ta kontakt med arrangøren eller TIKIT.</p>
        <p>Refusjoner går tilbake til betalingsmåten du brukte. Det kan ta 3–5 virkedager før beløpet vises.</p>
      </Part>
      <Part title="6. Billetten">
        <p>
          Billetten vises som en levende QR-kode i appen som fornyes jevnlig. Skjermbilder og kopier er ikke gyldige, og hver billett kan bare brukes én gang. Viser du billettnummeret i
          stedet for QR-koden, må du vise legitimasjon. Arrangøren kan be om legitimasjon og nekte adgang ved brudd på aldersgrense eller husregler.
        </p>
        <p>Personlige billetter gjelder bare for personen som står på billetten.</p>
      </Part>
      <Part title="7. Overføring og videresalg">
        <p>Du kan overføre billetter i appen når arrangøren tillater det. Billetten får da ny kode og nytt nummer, og den gamle blir ugyldig.</p>
        <p>
          Videresalg skjer bare gjennom TIKIT og aldri for mer enn du betalte, i tråd med lov om forbud mot prispåslag ved videresalg av billetter til kultur- og idrettsarrangementer.
          Selges billetten, får du salgsprisen tilbake til betalingsmåten du brukte – aldri mer enn du betalte. Billetter som er solgt eller overført utenfor TIKIT, kan bli sperret.
        </p>
      </Part>
      <Part title="8. Misbruk">
        <p>
          Vi kan sperre kontoer og kansellere kjøp som skyldes svindel, automatisert oppkjøp, oppkjøp for videresalg med fortjeneste eller annet misbruk. Betalingen for et kansellert kjøp
          blir da refundert.
        </p>
      </Part>
      <Part title="9. Ansvar">
        <p>
          Arrangøren er ansvarlig for arrangementet: innhold, gjennomføring, sikkerhet og adgang. TIKIT er ansvarlig for at billettene leveres riktig, og for at betalinger og refusjoner
          håndteres som beskrevet her. Vi er ikke ansvarlige for indirekte tap, som reise eller overnatting, med mindre tapet skyldes grov uaktsomhet fra oss. Ingenting i disse vilkårene
          begrenser rettighetene du har etter ufravikelig forbrukerlovgivning.
        </p>
      </Part>
      <Part title="10. Endringer">
        <p>Et kjøp følger vilkårene som gjaldt da du kjøpte. Endringer gjelder bare kjøp som gjøres etter at de er publisert.</p>
      </Part>
      <Part title="11. Kontakt og klage">
        <p>
          Spørsmål om arrangementet går til arrangøren (kontaktinfo står på kvitteringen). Spørsmål om kjøpet eller appen går til TIKIT{op.contact}. Kommer vi ikke til enighet, kan du få
          hjelp fra Forbrukertilsynet og klage til Forbrukerklageutvalget. Norsk lov gjelder.
        </p>
      </Part>
    </>
  );
}

function PrivacyPolicy() {
  const op = useOperator();
  return (
    <>
      <p className="mb-6 text-subhead text-label-2">Sist oppdatert {UPDATED}</p>
      <Part title="Hvem som er ansvarlig">
        <p>
          {op.who} er behandlingsansvarlig for personopplysningene i TIKIT{op.supportEmail ? `, og du når oss på ${op.supportEmail}` : ''}. Arrangøren blir selvstendig
          behandlingsansvarlig for opplysningene de får om deltakerne på sitt arrangement.
        </p>
      </Part>
      <Part title="Hva vi samler inn">
        <p>
          Fra innloggingen: navn og e-post, og ved Vipps også mobilnummer og fødselsdato. Navn og fødselsdato fra Vipps kommer fra Folkeregisteret og regnes som bekreftet. Vi får aldri
          passordet ditt.
        </p>
        <p>
          Når du bruker TIKIT: bestillinger og betalingsreferanser (aldri kortnummer), billetter og navnene på dem, overføringer (mottakers e-post eller mobilnummer og hilsen),
          videresalg, køplasser, ventelister, salgsvarsler, favoritter, varsler og innsjekk i døra. For sikkerhet lagrer vi innloggingsøkten som en hash og nettleserens navn. IP-adressen
          brukes kort for å begrense misbruk, men lagres ikke.
        </p>
      </Part>
      <Part title="Hvorfor">
        <p>
          For å levere billetter og kvitteringer, overføringer, videresalg og refusjoner (avtale), sjekke aldersgrenser arrangøren har satt (avtale og arrangørens plikt), forhindre svindel
          og misbruk (berettiget interesse) og oppfylle bokføringsreglene (rettslig forpliktelse). Tips og nyheter sender vi bare hvis du har sagt ja, og du kan trekke det tilbake når som
          helst.
        </p>
        <p>
          Vi selger aldri data og bruker dem ikke til reklame eller profilering. Den eneste automatiske avgjørelsen er at et kjøp til et arrangement med aldersgrense avvises når alderen er
          under grensen.
        </p>
      </Part>
      <Part title="Hvem som får opplysningene">
        <p>
          Arrangøren får navn og kontaktinformasjon til kjøpere og navn på billettene til sitt arrangement. Dørvakter ser bare navn, billettype og om alderen er bekreftet. Mottakeren av en
          billett du overfører, ser navnet ditt og hilsenen din.
        </p>
        <p>
          Leverandører som behandler data på våre vegne: drift (Render, servere i Frankfurt, nettverk fra Cloudflare) og e-post (Resend). Vipps MobilePay, Stripe, Google og Apple
          behandler opplysninger etter sine egne vilkår når du bruker dem. Noen leverandører er selskaper i USA. Overføring skjer da med grunnlag i EU–USA-rammeverket for personvern
          eller EUs standardavtaler.
        </p>
      </Part>
      <Part title="Hvor lenge">
        <p>
          Profilen lagres til du sletter kontoen. Bestillinger oppbevares i fem år etter utgangen av regnskapsåret (bokføringsloven) og anonymiseres deretter. Navn på billetter og
          innsjekklogger slettes eller anonymiseres ett år etter arrangementet, og køplasser og ventelister 30 dager etter. Mottakers kontaktinfo ved overføring slettes etter 90 dager, og
          varsler etter ett år. Innloggingsøkter utløper etter 30 dager uten bruk.
        </p>
      </Part>
      <Part title="Dine rettigheter">
        <p>
          Du kan se, laste ned og slette dataene dine under Profil → Personvern og data. Du har også rett til å få rettet feil, begrense behandlingen, protestere og få dataene utlevert
          (dataportabilitet). Vi svarer innen én måned. Du kan klage til Datatilsynet.
        </p>
      </Part>
      <Part title="Sikkerhet">
        <p>
          Alt sendes kryptert, databasen er bare tilgjengelig internt, og innloggingsøkter lagres som hash. Ved brudd på personopplysningssikkerheten varsler vi Datatilsynet innen 72
          timer, og deg hvis det kan gi høy risiko for deg.
        </p>
      </Part>
      <Part title="Informasjonskapsler og lokal lagring">
        <p>
          TIKIT bruker bare det som er strengt nødvendig: en innloggingskapsel, en kortvarig kapsel under innlogging, innstillinger som byen du har valgt, og billetter som er lagret på
          telefonen så de virker uten nett. Vi bruker ingen sporing, statistikk eller annonsekapsler. Du kan slette alt i nettleserens innstillinger for nettstedsdata.
        </p>
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
