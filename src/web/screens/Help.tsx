import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight, Mail } from 'lucide-react';
import { formatNok } from '../../shared/money';
import { useConfig } from '../api/hooks';
import { Page } from '../components/layout/Page';
import { copyText } from '../lib/share';
import { useToast } from '../components/ui/Overlays';

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group [&+&]:hairline-t">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-body font-medium [&::-webkit-details-marker]:hidden">
        <span className="flex-1">{q}</span>
        <ChevronDown className="h-5 w-5 shrink-0 text-label-3 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="space-y-2 px-4 pb-4 text-subhead leading-relaxed text-label-2">{children}</div>
    </details>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="mb-1.5 px-4 text-footnote uppercase tracking-[0.02em] text-label-2">{title}</h2>
      <div className="overflow-hidden rounded-md bg-grouped-2">{children}</div>
    </section>
  );
}

export default function Help() {
  const config = useConfig().data;
  const toast = useToast();
  const fees = config?.fees ?? { fixedOre: 500, percentBp: 350, maxOre: 4900 };
  const percent = (fees.percentBp / 100).toLocaleString('nb-NO', { maximumFractionDigits: 2 });
  const support = config?.operator.supportEmail ?? null;

  return (
    <Page title="Hjelp" back="/profil">
      <div className="mx-4">
        <Group title="Kjøpe billetter">
          <Faq q="Hvordan kjøper jeg billetter?">
            <p>Finn arrangementet, velg antall billetter og betal med Vipps eller kort. Billettene ligger under Billetter med en gang, og kvitteringen kommer på e-post.</p>
          </Faq>
          <Faq q="Hva koster det å bruke TIKIT?">
            <p>
              Du betaler billettprisen pluss et servicegebyr på {formatNok(fees.fixedOre)} + {percent} % av billettprisen, maks {formatNok(fees.maxOre)} per billett. Gratisbilletter har ikke
              gebyr. Du ser alltid totalprisen før du betaler.
            </p>
          </Faq>
          <Faq q="Hvorfor må jeg stå i kø?">
            <p>
              Ved store billettslipp selges billettene gjennom en digital kø, så ingen trenger å sitte og oppdatere siden. Står du i køen før salget åpner, trekkes rekkefølgen tilfeldig –
              det lønner seg ikke å være først, bare å være der i tide. Du beholder plassen selv om du lukker appen.
            </p>
          </Faq>
          <Faq q="Arrangementet har aldersgrense – hva gjør jeg?">
            <p>
              Logger du inn med Vipps, bekreftes alderen din automatisk. Ellers legger du inn fødselsdato i profilen. Noen arrangører krever bekreftet alder med Vipps. Ta uansett med
              legitimasjon i døra.
            </p>
          </Faq>
          <Faq q="Har jeg angrerett?">
            <p>
              Nei, billetter til arrangementer på en bestemt dato har ikke angrerett. Mange arrangører lar deg likevel refundere frem til en frist – det står på arrangementssiden. Kan du
              ikke komme, kan du også overføre eller selge billetten.
            </p>
          </Faq>
        </Group>

        <Group title="Levende billett">
          <Faq q="Hvorfor endrer QR-koden seg hele tiden?">
            <p>
              Koden fornyes hvert {config?.qrStepSeconds ?? 15}. sekund, og klokken på billetten tikker. Da ser dørvakten at billetten er ekte, og et skjermbilde slutter å virke etter et
              minutt. Det stopper svindel med kopierte billetter.
            </p>
          </Faq>
          <Faq q="Virker billetten uten nett?">
            <p>Ja. QR-koden lages på telefonen din. Åpne billetten én gang med nett før du drar, så ligger den klar selv om dekningen er dårlig i køen.</p>
          </Faq>
          <Faq q="Hvordan legger jeg TIKIT på hjemskjermen?">
            <p>iPhone: Åpne TIKIT i Safari, trykk på Del-knappen og velg «Legg til på Hjem-skjerm».</p>
            <p>Android: Åpne TIKIT i Chrome, trykk på menyen og velg «Installer app».</p>
          </Faq>
          <Faq q="Jeg har byttet telefon – hvor er billettene?">
            <p>Billettene ligger på kontoen din, ikke på telefonen. Logg inn med samme Vipps, Apple eller Google som før, så er de der.</p>
          </Faq>
        </Group>

        <Group title="Overføre og selge videre">
          <Faq q="Hvordan gir jeg billetten til en venn?">
            <p>Åpne billetten og velg «Overfør til en venn». Du får en lenke som du sender. Når vennen godtar, får billetten ny QR-kode og din slutter å virke. Det er gratis.</p>
          </Faq>
          <Faq q="Kan jeg selge billetten min?">
            <p>
              Hvis arrangøren tillater det, kan du legge den ut i TIKIT for maks det du betalte – lov om forbud mot prispåslag ved videresalg av billetter til kultur- og
              idrettsarrangementer forbyr å selge med fortjeneste. Når den er solgt, får du pengene tilbake på betalingsmåten du brukte.
            </p>
          </Faq>
          <Faq q="Hvorfor kan jeg ikke selge en billett jeg har fått?">
            <p>Bare den som kjøpte billetten kan selge den videre. Da kan vi alltid sørge for at prisen ikke går over det som ble betalt, og at pengene går til riktig person.</p>
          </Faq>
        </Group>

        <Group title="Refusjon og avlysning">
          <Faq q="Kan jeg få pengene tilbake?">
            <p>Det avgjør arrangøren. Står det at refusjon er mulig, finner du knappen på billetten frem til fristen. Servicegebyret refunderes ikke når du selv avbestiller.</p>
          </Faq>
          <Faq q="Hva skjer hvis arrangementet blir avlyst?">
            <p>Du får hele beløpet tilbake automatisk – også servicegebyret – til betalingsmåten du brukte. Du får varsel og e-post når refusjonen er sendt.</p>
          </Faq>
        </Group>

        <Group title="For arrangører">
          <Faq q="Hvordan kommer jeg i gang med å selge billetter?">
            <p>
              Opprett en arrangørkonto under{' '}
              <Link to="/arrangor" className="text-tint underline underline-offset-2">
                Selg billetter med TIKIT
              </Link>
              . Når den er godkjent, lager du arrangementet, legger inn billettyper og publiserer.
            </p>
          </Faq>
          <Faq q="Hvordan skanner vi billetter i døra?">
            <p>
              Bruk skanneren i TIKIT på hvilken som helst mobil. Lag skannerkoder til dørvaktene i arrangørpanelet – da trenger de ikke egen konto. Skanneren viser grønt, gult eller rødt og
              varsler om aldersgrense.
            </p>
          </Faq>
          <Faq q="Når får vi pengene?">
            <p>Du ser salg, refusjoner og saldo under Oppgjør. Utbetalingen går til kontonummeret dere har registrert.</p>
          </Faq>
        </Group>

        <nav aria-label="Vilkår" className="mb-6 overflow-hidden rounded-md bg-grouped-2 [&>*+*]:hairline-t">
          <Link to="/vilkar" className="flex min-h-11 items-center justify-between px-4 py-3 text-body text-label no-underline hover:bg-fill-4">
            Kjøpsvilkår <ChevronRight className="h-4 w-4 text-label-3" aria-hidden="true" />
          </Link>
          <Link to="/personvernerklaering" className="flex min-h-11 items-center justify-between px-4 py-3 text-body text-label no-underline hover:bg-fill-4">
            Personvernerklæring <ChevronRight className="h-4 w-4 text-label-3" aria-hidden="true" />
          </Link>
        </nav>

        <section className="mb-8 rounded-md bg-grouped-2 px-4 py-4">
          <h2 className="text-headline font-semibold">Fant du ikke svar?</h2>
          <p className="mt-1 text-subhead text-label-2">
            Spørsmål om selve arrangementet (tider, garderobe, program) svarer arrangøren på – kontaktinfo står på kvitteringen.
            {support ? ' For hjelp med TIKIT kan du skrive til oss:' : ''}
          </p>
          {support && (
            <button
              type="button"
              onClick={async () => {
                const ok = await copyText(support);
                toast({ message: ok ? 'E-postadressen er kopiert' : support, tone: ok ? 'success' : 'info' });
              }}
              className="mt-3 inline-flex h-11 items-center gap-2 rounded-full bg-tint-soft px-4 text-subhead font-semibold text-tint"
            >
              <Mail className="h-4 w-4" aria-hidden="true" /> {support}
            </button>
          )}
        </section>
      </div>
    </Page>
  );
}
