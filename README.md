# TIKIT

Billettplattform for russetreff, fester, busslanseringer og revyer. Kjøpere logger inn med **Vipps, Google eller Apple**, betaler med **Vipps eller kort** og får en **levende QR-billett** som ikke kan skjermdumpes. Arrangører selger billetter, følger salget og sjekker inn gjester med mobilen. TIKIT tar et servicegebyr per billett.

Designet følger Apple Human Interface Guidelines (store titler, flytende fanelinje, glass-materialer, systemfarger, lys og mørk modus) og er testet mot WCAG 2.2 AA.

---

## Hva appen kan

**Kjøpere**
- Utforsk arrangementer etter by og kategori, søk, favoritter og følg arrangører
- Billettslipp med nedtelling, varsel når salget åpner, og **virtuell kø** med loddtrekning ved åpning
- Billettyper med kvote, salgsperiode, maks antall per person, skjulte billetter med **tilgangskode** og **rabattkoder**
- **Nummerert salkart** med setevalg
- Kasse med reservasjon (10 min, 20 min under betaling), navn på billettene, Vipps eller kort
- **Levende billett**: QR-koden fornyes hvert 15. sekund og regnes ut på telefonen – virker uten nett
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

## Kom i gang (utvikling)

Krever Node 22.

```bash
npm install
npm run dev
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
| `npm run vipps:webhook` | Registrerer Vipps-webhooken og skriver ut hemmeligheten |
| `npm run icons` | Lager appikoner og delingsbilde i `public/` |
| `./scripts/deploy.sh` | Alle kontroller i riktig rekkefølge før utrulling |

## Oppsett og drift

- **Status og det som gjenstår før lansering:** [LAUNCH.md](LAUNCH.md)
- **Sikkerhet, samsvar og go/no-go:** [docs/go-no-go.md](docs/go-no-go.md)
- **Personvern, vilkår og informasjonskapsler (norsk og engelsk):** [docs/juridisk/](docs/juridisk/)
- **Nøkler for Vipps, Google, Apple, Stripe og e-post:** [docs/oppsett.md](docs/oppsett.md)
- **Publisering (Render, Docker), bakgrunnsjobber, overvåking og sjekkliste før salg:** [docs/drift.md](docs/drift.md)
- **OmniRoute (AI-verktøy for utviklere – appen bruker ikke AI):** [docs/omniroute.md](docs/omniroute.md)

Alle miljøvariabler er beskrevet i [.env.example](.env.example).

## Teknologi

React 19, React Router, TanStack Query, Tailwind CSS 4 og Motion i nettleseren. Hono-API som kjører både på Node og i nettleseren (demoen). Postgres (eller PGlite) som dokumentlager med JSONB. OpenID Connect for Vipps, Google og Apple, Vipps ePayment API, Stripe Checkout og Resend for e-post. Vitest og Playwright for testing.

## Viktig før ekte salg

- Bruk `render.yaml` (betalt Postgres), sett `DEMO_MODE=false` og legg inn produksjonsnøkler. Serveren sier fra og nekter å starte hvis noe som trengs for ekte salg mangler (se [docs/drift.md](docs/drift.md)).
- Fyll inn `OPERATOR_NAME`, `OPERATOR_ORG_NUMBER` og `SUPPORT_EMAIL`, og les gjennom kjøpsvilkårene og personvernerklæringen i appen (`/vilkar`, `/personvernerklaering`) sammen med en rådgiver. Tekstene er et godt utgangspunkt, men ikke juridisk rådgivning.
- Avklar merverdiavgift for servicegebyret og billettene med regnskapsfører.
- Gjør et testkjøp og en refusjon med ekte Vipps i produksjonsmiljøet.
