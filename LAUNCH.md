# TIKIT – lansering

*Oppdatert 24. september 2026*

| | Status |
| --- | --- |
| **Kode** | Klar for produksjon. Alle kontroller er grønne (se under). |
| **Demo** | Live: <https://claude.ai/artifact/HxXzJv9BQJTE4x4pepNUna> – hele appen kjører i nettleseren, innlogging og betaling er simulert. |
| **Render** | To Blueprints er klare: `render.staging.yaml` (gratis demo) og `render.yaml` (produksjon). Ikke publisert ennå – det krever at du er logget inn på GitHub og Render. |
| **Ekte salg** | Venter på avtaler og nøkler som bare eieren kan skaffe (se «Det som gjenstår»). |

## Kontroller (kjørt 24.09.2026)

- TypeScript og ESLint: ingen feil
- 81 enhets- og API-tester (minnelager)
- 29 API-tester mot SQL-lageret – både innebygd PGlite og ekte Postgres 16
- 18 ende-til-ende-tester i Chromium (iPhone lys, iPhone mørk, PC) med tilgjengelighetssjekk (axe)
- Produksjonsbygget går gjennom

`./scripts/deploy.sh` kjører alt dette i riktig rekkefølge.

## Hva gjennomgangen fant – og hva som er rettet

Fire uavhengige gjennomganger (sikkerhet, penger og billetter, brukergrensesnitt, drift) fant 47 konkrete problemer. Alle er rettet, og de viktigste er dekket av nye tester (`tests/api/launch-fixes.test.ts`).

**Penger og billetter**
- Billettnummeret alene slapp folk inn i døra – også den som hadde solgt billetten videre. Nå godtas nummeret bare når dørvakten taster det inn, og da med beskjed om ID-kontroll. En billett som bytter eier får nytt nummer.
- Refusjoner kunne betales ut to ganger, og refusjoner eller utbetalinger som feilet hos Vipps ble aldri prøvd igjen. Nå går alle pengeoverføringer via **betalingsjobber** som lagres sammen med endringen og prøves igjen til leverandøren bekrefter.
- En betaling som var erstattet («Betal på nytt») kunne fortsatt gjennomføres og trekkes. Nå lukkes den hos Vipps/Stripe med én gang.
- Avlysning i samme øyeblikk som en betaling kunne gi betalte billetter uten refusjon. Rettet med låsing – testet mot ekte Postgres.
- «Maks per bestilling» gjaldt ikke per person, så én konto kunne kjøpe opp hele kapasiteten. Nå gjelder grensen per person og arrangement.
- Billetter kunne holdes reservert i timevis ved å trykke «Betal» igjen og igjen. Nå er grensen 30 minutter fra bestillingen.
- Køen fulgte ikke med når salgsstarten ble flyttet, og hver statusforespørsel låste køen i databasen. Begge deler er rettet.
- Oppgjøret til arrangøren ble feil ved avlysning etter videresalg under kostpris. Rettet.

**Sikkerhet**
- Dørvakter kunne laste ned alle kjøperes e-post og telefonnummer via en arrangør de selv opprettet. Rettet.
- Vipps-bekreftet alder kunne flyttes til en annen person. Nå hører navn og alder sammen, og bekreftelsen fjernes når Vipps kobles fra kontoen.
- `DEMO_MODE` i produksjon kunne gi gratis billetter og admin-tilgang. Nå nekter serveren å starte med demomodus og ekte nøkler samtidig, og demo-admin er stengt i produksjon.
- Også rettet: åpen videresending etter innlogging, Sign in with Apple bak Render sin proxy, kobling av Apple til en konto, overføringsmail som kunne brukes til svindelmail, dørvakter som så omsetning og rabattkoder, og offline-billetter som kunne vises for feil person på en delt telefon.

**Drift**
- Bygget ville feilet på Render (`NODE_ENV=production` hoppet over byggeverktøyene). Rettet.
- Bak Render delte alle besøkende samme grense for antall forespørsler, så en billettslipp ville gitt «for mange forespørsler» til alle. Rettet (`CLIENT_IP_HEADER`).
- Også rettet: ingen størrelsesgrense på forespørsler (kunne krasje serveren), produksjon uten database, e-post som kunne holde igjen et kjøp, oppdateringer som ikke nådde installerte apper, utrulling som kuttet betalinger midt i, tabell-låsing ved hver oppstart og en database som var åpen mot internett.

**Brukergrensesnitt**
- Av/på-bryterne var tegnet feil overalt. Lange titler som BUSSLANSERING gikk utenfor skjermen på mobil. «Flere innstillinger» lukket seg mens man brukte den. Arrangementer med gamle kategorier kunne ikke lagres. Kvitteringen manglet arrangørens kontaktinfo, som vilkårene lover.
- I tillegg: kontrast, skjermleser, tekstfeil og en dørskanner der «Tilbake» logget ut uten å spørre.

## Det som gjenstår – bare du kan gjøre dette

1. **Legg koden på GitHub.** Pakk ut `tikit.zip` (den har hele Git-historikken) og kjør:
   ```bash
   cd tikit
   git remote add origin https://github.com/<ditt-brukernavn>/tikit.git   # lag et privat, tomt repo først
   git push -u origin main
   ```
   Eller åpne mappen i GitHub Desktop og trykk *Publish repository* (velg *Private*).
2. **Demo på Render (gratis).** Logg inn på render.com med GitHub → *New* → *Blueprint* → velg `tikit`-repoet → skriv `render.staging.yaml` under *Blueprint Path* → *Apply*. Etter noen minutter ligger demoen på `https://tikit-demo.onrender.com` (eller lignende).
3. **Vipps MobilePay.** Søk om nettbetaling og «Logg inn med Vipps» for Din Russetid AS (signeres med BankID), og hent produksjonsnøklene. Se [docs/oppsett.md](docs/oppsett.md) §1.
4. **Domene.** For eksempel `tikit.no`: sjekk om det er ledig, kjøp det og koble det til Render.
5. **Resend** for e-post: opprett konto og verifiser avsenderdomenet (DNS). Det er påkrevd i produksjon.
6. **Produksjon på Render.** Opprett Blueprinten fra `render.yaml`. Den bruker betalte planer, så du må legge inn betalingskort hos Render. Fyll inn nøklene, registrer Vipps-webhooken og følg sjekklisten i [docs/drift.md](docs/drift.md).
7. **Valgfritt:** Google-innlogging (gratis), Apple-innlogging (krever Apple Developer Program), Stripe for kort.
8. **Juridisk og regnskap.** Gå gjennom kjøpsvilkår og personvern (`/vilkar`, `/personvernerklaering`) med en rådgiver, og avklar MVA på servicegebyret med regnskapsfører.
9. **Første ekte test.** Gjør kjøp, refusjon, overføring, videresalg og innsjekk med ekte Vipps før dere åpner salget.

`OPERATOR_NAME` og `OPERATOR_ORG_NUMBER` står allerede i Blueprintene (Din Russetid AS, 936 491 243). Endre dem der hvis et annet selskap skal stå som formidler.

## Kjente begrensninger (bevisst utsatt)

- Grensen for antall forespørsler holdes i minnet per server-instans.
- Betalingsjobber som gir opp etter ti forsøk vises i loggen og i admin-loggen (`payment_job.failed`), men har ennå ingen egen side i admin.
- E-post som feiler prøves på nytt i minnet. En omstart midt i forsøkene kan miste den e-posten (billetten ligger uansett i appen).
- En betaling som kommer inn etter at reservasjonen gikk ut, kan bruke en rabattkode én gang mer enn maks. Kunden har da allerede betalt rabattert pris.
- Køen blir ikke nullstilt hvis salgsstarten flyttes *etter* at køen har åpnet. Plassene står, og slippet starter på det nye tidspunktet.
