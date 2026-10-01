# TIKIT – lansering

*Oppdatert 1. oktober 2026*

| | Status |
| --- | --- |
| **Kode** | Klar for produksjon. Alle kontroller er grønne (se under). |
| **GitHub** | `GD2026/TIKIT`, grenen `claude/tikit-ticket-solution-kog2ak` (med hele historikken) |
| **Demo** | Live: <https://claude.ai/artifact/HxXzJv9BQJTE4x4pepNUna>. Hele appen kjører i nettleseren, og innlogging og betaling er simulert. |
| **Render** | Tre Blueprints er klare: `render.staging.yaml` (gratis demo), `render.supabase.yaml` (produksjon med Supabase) og `render.yaml` (produksjon med Render Postgres). Ikke publisert ennå. |
| **iOS-app** | Xcode-prosjektet i `ios/` kompilerer uten feil med Xcode 26.6 (GitHub Actions på macOS). Neste steg er å signere og teste på en ekte iPhone. Se [docs/ios.md](docs/ios.md). |
| **App Store** | Gjennomgått mot Apples retningslinjer, og det som manglet i koden, er bygget. Se [docs/app-store/](docs/app-store/README.md). |
| **Ekte salg** | Venter på avtaler og nøkler som bare eieren kan skaffe (se «Det som gjenstår»). `npm run doctor` viser hva som mangler. |

## Kontroller (kjørt 28.09.2026)

- TypeScript og ESLint: ingen feil
- 115 enhets- og API-tester (minnelager), inkludert iOS-innlogging, Apple-innlogging og tilbakekalling, App Review-tilgang, moderering, Supabase-oppsett, konfigurasjon og lommebok-kort (signert `.pkpass` kontrollert med openssl, Google-lenke, innsjekk med kortet og at det slutter å virke etter overføring)
- API-testene mot SQL-lageret: PGlite, og mot ekte Postgres (43 flyttester og 33 lagringstester)
- 24 ende-til-ende-tester i Chromium (iPhone lys, iPhone mørk, PC) med tilgjengelighetssjekk (axe), og iOS-bygget kjørt mot API-et fra en annen opprinnelse (CORS, token, retur fra betaling, billett uten nett)
- Produksjonsbygget og iOS-bygget (`vite --mode native`) går gjennom. Nettbygget inneholder ingen iOS-kode.
- `npm audit`: 0 sårbarheter

`./scripts/deploy.sh` kjører alt dette i riktig rekkefølge. **GitHub Actions** kjører det samme automatisk på hver pull request (`.github/workflows/ci.yml`, med ekte Postgres 17), og kompilerer iOS-appen på macOS når `ios/` endres (`ios.yml`).

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

Sikkerhet, samsvar og full go/no-go-vurdering står i [docs/go-no-go.md](docs/go-no-go.md). Personvernerklæring, kjøpsvilkår og informasjonskapsler (norsk og engelsk) ligger i [docs/juridisk/](docs/juridisk/).

## Det som gjenstår – bare du kan gjøre dette

1. **GitHub:** ✅ gjort. Slå sammen grenen `claude/tikit-ticket-solution-kog2ak` til `main` når du er fornøyd (pull request på GitHub).
2. **Demo på Render (gratis).** Logg inn på render.com med GitHub → *New* → *Blueprint* → velg `tikit`-repoet → skriv `render.staging.yaml` under *Blueprint Path* → *Apply*. Etter noen minutter ligger demoen på `https://tikit-demo.onrender.com` (eller lignende).
3. **Vipps MobilePay.** Søk om nettbetaling og «Logg inn med Vipps» for Din Russetid AS (signeres med BankID), og hent produksjonsnøklene. Se [docs/oppsett.md](docs/oppsett.md) §1.
4. **Domene.** For eksempel `tikit.no`: sjekk om det er ledig, kjøp det og koble det til Render.
5. **Resend** for e-post: opprett konto og verifiser avsenderdomenet (DNS). Det er påkrevd i produksjon.
6. **Database og produksjon på Render.** Med **Supabase:** lag prosjektet (Frankfurt, Pro-plan for backup) og bruk Blueprinten `render.supabase.yaml` (se [docs/oppsett.md §1](docs/oppsett.md#1-database-supabase)). Uten Supabase: `render.yaml`. Fyll inn nøklene, kjør `npm run doctor -- --online`, registrer Vipps-webhooken og følg sjekklisten i [docs/drift.md](docs/drift.md).
7. **Google og Apple:** Google-innlogging er gratis. Apple-innlogging krever Apple Developer Program og er påkrevd for iOS-appen når Google tilbys. Stripe for kort er valgfritt.
   - **iOS-appen:** Apple Developer (organisasjon), App ID med *Sign in with Apple* og *Associated Domains*, `APPLE_BUNDLE_IDS` på serveren, deretter `npm run ios` på Macen, TestFlight og innsending etter [docs/app-store/](docs/app-store/README.md).
   - **Lommebok (valgfritt):** Pass Type ID-sertifikat fra Apple (`APPLE_WALLET_CERT`, `APPLE_WALLET_KEY`) og en utstederkonto i Google Pay & Wallet Console (`GOOGLE_WALLET_*`). Steg for steg i [docs/oppsett.md §9](docs/oppsett.md#9-lommebok-apple-wallet-og-google-wallet).
8. **Juridisk og regnskap.** Fyll inn adresse og support-e-post i `docs/juridisk/`, og få kjøpsvilkår og personvern gjennomgått av en rådgiver. Lag en arrangøravtale, godta databehandleravtalene hos Render og Resend, og avklar MVA på servicegebyret med regnskapsfører.
9. **Første ekte test.** Gjør kjøp, refusjon, overføring, videresalg og innsjekk med ekte Vipps før dere åpner salget.

`OPERATOR_NAME` og `OPERATOR_ORG_NUMBER` står allerede i Blueprintene (Din Russetid AS, 936 491 243). Endre dem der hvis et annet selskap skal stå som formidler.

## Kjente begrensninger (bevisst utsatt)

- iOS-appen har ikke push-varsler ennå. Det er neste steg hvis Apple mener appen har for lite native funksjonalitet (4.2). Se [docs/ios.md](docs/ios.md#neste-steg).
- Lommebok-kort har en fast QR-kode, så et skjermbilde av kortet slipper inn den som kommer først. Kortene oppdateres ikke når tid eller sted endres, og blir bare ugyldige i døra (ikke i lommeboken) ved overføring eller refusjon.
- Demobildene fra Higgsfield må lastes ned på en maskin med vanlig internett (`npm run demo:images`).

- Grensen for antall forespørsler holdes i minnet per server-instans.
- Betalingsjobber som gir opp etter ti forsøk vises i loggen og i admin-loggen (`payment_job.failed`), men har ennå ingen egen side i admin.
- E-post som feiler prøves på nytt i minnet. En omstart midt i forsøkene kan miste den e-posten (billetten ligger uansett i appen).
- En betaling som kommer inn etter at reservasjonen gikk ut, kan bruke en rabattkode én gang mer enn maks. Kunden har da allerede betalt rabattert pris.
- Køen blir ikke nullstilt hvis salgsstarten flyttes *etter* at køen har åpnet. Plassene står, og slippet starter på det nye tidspunktet.
