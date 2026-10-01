# TIKIT

Billettplattform for russetreff, fester, busslanseringer og revyer. Kjøpere logger inn med **Vipps, Google eller Apple**, betaler med **Vipps eller kort** og får en **levende QR-billett** som ikke kan skjermdumpes. Arrangører selger billetter, følger salget og sjekker inn gjester med mobilen. TIKIT tar et servicegebyr per billett.

Finnes som **nettapp (PWA)** og **iOS-app** (Capacitor, samme kode). Designet følger Apple Human Interface Guidelines (store titler, flytende fanelinje, glass-materialer, systemfarger, lys og mørk modus) og er testet mot WCAG 2.2 AA.

---

## Hva appen kan

**Kjøpere**
- Utforsk arrangementer etter by og kategori, søk, favoritter og følg arrangører
- Billettslipp med nedtelling, varsel når salget åpner, og **virtuell kø** med loddtrekning ved åpning
- Billettyper med kvote, salgsperiode, maks antall per person, skjulte billetter med **tilgangskode** og **rabattkoder**
- **Nummerert salkart** med setevalg
- Kasse med reservasjon (10 min, 20 min under betaling), navn på billettene, Vipps eller kort
- **Levende billett**: QR-koden fornyes hvert 15. sekund og regnes ut på telefonen – virker uten nett
- **Apple Lommebok og Google Lommebok**: billetten på låseskjermen og bak to trykk på sideknappen (valgfritt, se [oppsett.md §9](docs/oppsett.md#9-lommebok-apple-wallet-og-google-wallet))
- **Overføring** til venner med engangslenke (ny QR-kode og nytt billettnummer for mottakeren)
- **Videresalg** i appen til maks det du betalte (loven forbyr prispåslag)
- **Refusjon** etter arrangørens regler, og automatisk ved avlysning
- Venteliste når det er utsolgt, kvitteringer, legg i kalender, varsler, eksport og sletting av egne data

**Arrangører**
- Søknad og godkjenning, team med roller (eier, admin, dørvakt)
- Arrangementer med plakatgenerator eller eget bilde, program, aldersgrense (med Vipps-verifisert alder)
- Salgsoversikt med grafer, ordre og refusjon, deltakerliste med CSV-eksport, gjestebilletter
- Oppgjør per arrangement og utbetalinger
- **Dørskanner** i nettleseren: kamera, lyd, lommelykt, manuell innsjekk, angre, flere dører, fungerer uten nett og synkroniserer etterpå. Dørvakter kan logge inn med en 12-sifret skannerkode – uten konto.

**Plattform (admin)**
- Godkjenne og verifisere arrangører, sperre brukere, fremheve arrangementer, sette gebyrer
- **Moderering:** rapporter fra brukere, skjule arrangementer, stenge arrangører (App Store 1.2)

**Trygghet**
- «Rapporter» på alle arrangementer og arrangører, og «Skjul arrangøren for meg»
- Bare godkjente arrangører kan publisere. Innholdsregler står i vilkårene.

**iOS-appen** ([docs/ios.md](docs/ios.md))
- Innebygd «Logg på med Apple», innlogging med Vipps og Google via systemnettleseren, og økten i nøkkelringen
- Vipps-betaling som sender deg tilbake til appen, billetter uten nett, «Legg til i Apple Lommebok» med Apples eget ark, dørskanner, deleark og haptikk
- Gjennomgått mot Apples retningslinjer: [docs/app-store/](docs/app-store/README.md)

## Kom i gang (utvikling)

Krever Node 22.22 eller nyere.

```bash
npm install
npm run dev
npm run doctor   # viser hva som er koblet til, og hva du må legge inn
```

Åpne http://localhost:5173. Uten nøkler kjører appen i **demomodus**: innlogging og betaling simuleres, og databasen (innebygd PGlite i `./data`) fylles med eksempeldata. Trykk **Demo** for å bytte mellom kjøper, arrangør og admin.

Den samme appen finnes også som ren nettleserdemo (hele API-et kjører i nettleseren): `npm run build:demo`.

## Skript

| Kommando | Hva den gjør |
| --- | --- |
| `npm run dev` | API (port 8787) og webapp (port 5173) med automatisk omstart |
| `npm run build` | Bygger webappen (PWA) til `dist/web` og serveren til `dist/server` |
| `npm start` | Starter produksjonsserveren |
| `npm test` | Enhetstester, lagringstester og API-flyttester (minnelager) |
| `npm run test:sql` | API-flyttestene mot SQL-lagring (PGlite, eller Postgres med `TIKIT_TEST_DATABASE_URL`) |
| `npm run test:e2e` | Ende-til-ende i Chromium (mobil, mørk modus, PC) med tilgjengelighetssjekk (axe) |
| `npm run typecheck` / `npm run lint` | TypeScript og ESLint |
| `npm run build:demo` | Enkeltfil-demo i `dist-demo/` |
| `npm run doctor` | Viser hvilke tjenester som er koblet til, hva som mangler og hvilke adresser du registrerer hvor (`-- --online` tester nøklene) |
| `npm run vipps:webhook` | Registrerer Vipps-webhooken og skriver ut hemmeligheten |
| `npm run icons` | Lager appikoner og delingsbilde i `public/`, og App Store-ikon og oppstartsbilde i `ios/` |
| `npm run demo:images` | Laster ned Higgsfield-bildene til demoarrangementene (`assets/demo-events/`) |
| `npm run ios` | Konfigurerer Xcode-prosjektet fra `.env`, bygger iOS-appen mot `PUBLIC_URL` og åpner Xcode |
| `npm run ios:build` / `ios:configure` | Bare bygget / bare konfigurasjonen |
| `./scripts/deploy.sh` | Alle kontroller i riktig rekkefølge før utrulling |

De samme kontrollene kjører automatisk på GitHub (`.github/workflows/`) på hver pull request, og iOS-appen kompileres på macOS når `ios/` endres.

## Oppsett og drift

- **Hvor ligger hva, og hvor endrer jeg det:** [docs/arkitektur.md](docs/arkitektur.md)
- **Status og det som gjenstår før lansering:** [LAUNCH.md](LAUNCH.md)
- **iOS-appen:** [docs/ios.md](docs/ios.md) · **App Store:** [docs/app-store/](docs/app-store/README.md)
- **Sikkerhet, samsvar og go/no-go:** [docs/go-no-go.md](docs/go-no-go.md)
- **Personvern, vilkår og informasjonskapsler (norsk og engelsk):** [docs/juridisk/](docs/juridisk/)
- **Nøkler for Supabase, Vipps, Google, Apple, Stripe, e-post og lommebok:** [docs/oppsett.md](docs/oppsett.md)
- **Publisering (Render, Docker), bakgrunnsjobber, overvåking og sjekkliste før salg:** [docs/drift.md](docs/drift.md)
- **Utviklerverktøy (Claude Code, Obscura, Higgsfield, OmniRoute – appen bruker ikke AI):** [docs/utviklerverktoy.md](docs/utviklerverktoy.md)
- **Hele historikken:** [docs/samtale.md](docs/samtale.md)

Alle miljøvariabler er beskrevet i [.env.example](.env.example).

## Teknologi

React 19, React Router, TanStack Query, Tailwind CSS 4 og Motion i nettleseren. Capacitor 8 for iOS (Swift Package Manager, egen Swift-plugin). Hono-API som kjører både på Node og i nettleseren (demoen). Postgres (Supabase, Render eller PGlite) som dokumentlager med JSONB og row level security. OpenID Connect for Vipps, Google og Apple, innebygd Sign in with Apple på iOS, Vipps ePayment API, Stripe Checkout og Resend for e-post. Vitest og Playwright for testing.

## Viktig før ekte salg

- Bruk `render.supabase.yaml` (Supabase som database) eller `render.yaml` (Render Postgres), sett `DEMO_MODE=false` og legg inn produksjonsnøkler. Serveren sier fra og nekter å starte hvis noe som trengs for ekte salg mangler (se [docs/drift.md](docs/drift.md)).
- Fyll inn `OPERATOR_NAME`, `OPERATOR_ORG_NUMBER` og `SUPPORT_EMAIL`, og les gjennom kjøpsvilkårene og personvernerklæringen i appen (`/vilkar`, `/personvernerklaering`) sammen med en rådgiver. Tekstene er et godt utgangspunkt, men ikke juridisk rådgivning.
- Avklar merverdiavgift for servicegebyret og billettene med regnskapsfører.
- Gjør et testkjøp og en refusjon med ekte Vipps i produksjonsmiljøet.
