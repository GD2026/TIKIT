# Arkitektur – hvor ting ligger, og hvor du endrer dem

TIKIT er **én TypeScript-kodebase** med tre deler som deler typer og regler:

```
┌──────────────── src/web ────────────────┐     ┌──────────── src/server ────────────┐     ┌──── src/node ────┐
│ React-appen: nettside (PWA),            │ ──▶ │ API-et (Hono): ruter, forretnings- │ ◀── │ Node-serveren:   │
│ iOS-appen (src/web/native) og           │ /api│ logikk, lagring. Plattformuavhengig │     │ Postgres, Vipps, │
│ nettleserdemoen (src/web/demo)          │     │ – kjører på Node OG i nettleseren   │     │ Google, Apple,   │
└─────────────────────────────────────────┘     └────────────────────────────────────┘     │ Stripe, Resend   │
                         ▲                                     ▲                           └──────────────────┘
                         └──────────── src/shared: typer, skjemaer (Zod), priser, QR, tid ──┘
```

- **`src/server` vet ikke om Node.** Alt som snakker med omverdenen (database, betaling, innlogging, e-post), kommer inn som *adaptere* i `Deps` (`src/server/context.ts`). Derfor kan hele API-et kjøre i nettleseren i demoen, med minnelager og simulerte leverandører, og testene kan kjøre det uten nettverk.
- **`src/node` kobler til de ekte tjenestene** og starter HTTP-serveren. En mappe per leverandør.
- **`src/web` er én React-app** med tre byggemåter (`vite.config.ts`): nettsiden (`vite build`), iOS-appen (`--mode native`) og nettleserdemoen (`--mode demo`).

## Filkart

```
src/
├── shared/                 Brukes av både app og server
│   ├── types.ts            Alle datatyper: lagrede dokumenter og API-svar (DTO-er)
│   ├── schemas.ts          Zod-validering av alt som kommer inn i API-et
│   ├── constants.ts        Kategorier, grenser, refusjonsregler, standardgebyr
│   ├── pricing.ts, money.ts Servicegebyr og beløp (alltid i øre)
│   ├── qr.ts               Den levende QR-koden (TOTP-lignende, fornyes hvert 15. s)
│   └── time.ts, ids.ts, encoding.ts, validation.ts, errors.ts
│
├── server/                 API-et – plattformuavhengig
│   ├── app.ts              Setter sammen middleware og ruter under /api
│   ├── context.ts          Deps (adaptere) og ServerConfig
│   ├── middleware/core.ts  Økt (cookie eller bearer), CSRF, rate limiting, feilhåndtering
│   ├── routes/             Tynne HTTP-ruter → kaller services
│   │   ├── public.ts       Arrangementer, søk, bilder, rapporter, blokkering
│   │   ├── auth.ts         Innlogging (OAuth) for nettsiden og iOS-appen
│   │   ├── nativeAuth.ts   iOS: veksle engangskode, «Logg på med Apple», App Review-kode
│   │   ├── buying.ts       Bestilling, betaling, billetter, overføring, videresalg
│   │   ├── me.ts, org.ts, checkin.ts, admin.ts, system.ts (webhooks, cron)
│   ├── services/           All forretningslogikk – her endrer du regler
│   │   ├── orders.ts       Reservasjon, betaling, utstedelse, capture
│   │   ├── tickets.ts      Billetter, overføring, videresalg
│   │   ├── refunds.ts, paymentJobs.ts  Refusjon og pengeflyt med retry
│   │   ├── events.ts       Arrangementer, lister, forsiden, publisering
│   │   ├── moderation.ts   Rapporter, admin-kø, skjule arrangement, blokkere arrangør
│   │   ├── users.ts        Konto, innlogging, sletting (med Apple-tilbakekalling)
│   │   ├── nativeAuth.ts   Engangskoder for iOS-innlogging
│   │   ├── retention.ts    Automatisk sletting etter lagringstid
│   │   └── queue.ts, waitlist.ts, checkin.ts, organizers.ts, admin.ts, …
│   ├── store/              Dokumentlager: types.ts (grensesnitt), memory.ts (tester/demo)
│   ├── adapters/           Grensesnitt for leverandører + demo-versjoner
│   └── seed.ts             Demodata (oppdiktet)
│
├── node/                   Node-serveren – kobler til ekte tjenester
│   ├── main.ts             Oppstart, logging, grasiøs nedstengning
│   ├── server.ts           Kobler Deps sammen, statiske filer, bakgrunnsjobber
│   ├── config.ts           Leser og validerer miljøvariabler (nekter usikker produksjon)
│   ├── security.ts         Sikkerhetsheadere (CSP, HSTS …)
│   ├── appLinks.ts         iOS: universal links (AASA), /app-returside, CORS
│   ├── demoImages.ts       Demobilder fra assets/demo-events/
│   ├── db/
│   │   ├── sqlStore.ts     Postgres/PGlite-lager, migrering, RLS
│   │   └── connection.ts   Supabase/Render/Neon-oppsett (SSL, pooler)
│   └── integrations/       Én mappe per leverandør
│       ├── vipps/          common.ts (tilgangsnøkkel), login.ts, payments.ts (ePayment + webhook)
│       ├── google/login.ts
│       ├── apple/          login.ts (nett), native.ts (iOS-knappen + tilbakekalling), clientSecret.ts
│       ├── stripe/payments.ts
│       ├── resend/mailer.ts
│       └── oidc.ts, shared.ts
│
└── web/                    React-appen
    ├── main.tsx            Velger transport: HTTP (nett), native (iOS) eller lokal (demo)
    ├── app/                Router, innlogging (auth.tsx), kontekst
    ├── api/                API-klient og React Query-hooks
    ├── screens/            Kjøperens skjermer (Utforsk, Arrangement, Kasse, Billetter, Profil …)
    ├── organizer/          Arrangørpanelet
    ├── admin/              Plattformadmin (inkludert Rapporter)
    ├── scanner/            Dørskanneren
    ├── components/         Delte komponenter (ui/, event/, ticket/, layout/, moderation/ …)
    ├── native/             iOS: transport med token, innlogging, betaling, dype lenker, frakoblet
    ├── demo/               Nettleserdemoen (hele API-et i nettleseren)
    ├── lib/                Hjelpere (lenker, deling, haptikk, lagring)
    └── styles/app.css      Designsystemet (Apple HIG-farger, typografi, glass)

ios/                        Xcode-prosjektet (Capacitor 8, Swift Package Manager)
└── App/App/                TikitNativePlugin.swift, Info.plist, App.entitlements, PrivacyInfo.xcprivacy
tests/
├── unit/                   Rene funksjoner, konfigurasjon, lager
├── api/                    Hele API-flyter mot minnelager (og mot SQL med npm run test:sql)
└── e2e/                    Playwright: nettsiden (iPhone lys/mørk, PC) og iOS-laget (ios-web)
scripts/                    Utvikling og drift: dev, doctor, ios, ikoner, demobilder, Vipps-webhook, deploy
docs/                       Oppsett, drift, iOS, App Store, juridisk, arkitektur (denne fila)
```

## En forespørsel fra start til slutt

Eksempel: kjøperen trykker «Betal» i kassen.

1. `src/web/screens/Checkout.tsx` kaller `api.post('/orders/:id/pay')` (`src/web/api/client.ts`).
2. Transporten sender den. På nett er det `fetch('/api/…')` med cookie. I iOS-appen er det `fetch('https://tikit.no/api/…')` med `Authorization: Bearer` (`src/web/native/transport.ts`).
3. `src/server/middleware/core.ts` finner økten, sjekker CSRF og begrenser antall forespørsler.
4. `src/server/routes/buying.ts` validerer kroppen med `orderPaySchema` (`src/shared/schemas.ts`) og kaller `payOrder`.
5. `src/server/services/orders.ts` gjør jobben i én transaksjon (`deps.store.tx`) og kaller betalingsadapteren (`deps.payments.vipps`).
6. I drift er adapteren `src/node/integrations/vipps/payments.ts`, og i demo er det `src/server/adapters/demo.ts`.
7. Svaret går tilbake som en DTO fra `src/shared/types.ts`.

## Hvor endrer jeg …?

| Jeg vil … | Fil |
| --- | --- |
| endre servicegebyret (standard) | `src/shared/constants.ts` (`DEFAULT_PLATFORM_SETTINGS`), eller i appen under Admin → Gebyrer |
| endre reservasjonstid, maks billetter og andre grenser | `src/shared/constants.ts` (`LIMITS`) |
| legge til et felt på arrangementer | `src/shared/types.ts` (`EventDoc`, `EventCard`) → `schemas.ts` → `services/events.ts` → `web/organizer/EventEditor.tsx` |
| endre en tekst i appen | skjermen i `src/web/screens/` (all tekst er norsk og står i komponentene) |
| endre farger og typografi | `src/web/styles/app.css` |
| endre e-postene | `src/server/services/emails.ts` (mal) og der e-posten sendes (`notify(...)`) |
| endre lagringstider (GDPR) | `src/server/services/retention.ts` + personvernerklæringen (`Legal.tsx` og `docs/juridisk/`) |
| endre refusjonsregler | `src/shared/constants.ts` (`REFUND_POLICIES`) + `services/refunds.ts` |
| koble til en ny betalingsleverandør | nytt `src/node/integrations/<navn>/payments.ts` som implementerer `PaymentAdapter` (`src/server/adapters/types.ts`), og koble det inn i `src/node/server.ts` |
| legge til en ny innlogging | ny `OAuthAdapter` i `src/node/integrations/`, `ProviderId` i `shared/types.ts`, og en knapp i `web/app/auth.tsx` |
| endre lommebok-kortene (Apple/Google Wallet) | innholdet: `src/node/integrations/apple/wallet.ts` (`applePassJson`) og `google/wallet.ts` (`googleWalletPayload`); dataene: ruten `/tickets/:id/wallet/:kind` i `src/server/routes/buying.ts`; knappene: `src/web/components/ticket/WalletButtons.tsx`; bildene: `npm run icons` (`public/wallet/`) |
| endre databaseoppsett (SSL, pooler) | `src/node/db/connection.ts` |
| endre tabeller og indekser | `src/node/db/sqlStore.ts` (`INDEX_FIELDS` og `UNIQUE_KEYS` i `src/server/store/types.ts`) |
| endre sikkerhetsheadere | `src/node/security.ts` (nett) og `vite.config.ts` → `nativeCsp` (iOS) |
| endre hva som åpner iOS-appen (universal links) | `src/node/appLinks.ts` (`APP_PATHS`) |
| endre moderering eller rapportgrunner | `src/server/services/moderation.ts` + `src/web/components/moderation/ReportSheet.tsx` |
| endre demodata | `src/server/seed.ts` (+ bilder i `assets/demo-events/`) |
| legge til en miljøvariabel | `src/node/config.ts` (skjema og validering) → `.env.example` → `render*.yaml` → `scripts/doctor.ts` |

## Prinsipper i koden

- **Penger er heltall i øre.** Aldri flyttall.
- **All skriving skjer i transaksjoner** (`store.tx`). Dokumenter som endres ut fra det som er lest, hentes med `{ forUpdate: true }`.
- **Pengeflyt går via betalingsjobber** (`paymentJobs.ts`) med idempotensnøkler, slik at en refusjon aldri betales ut to ganger.
- **Alt som kommer inn, valideres med Zod** (`src/shared/schemas.ts`). Feilmeldingene er på norsk.
- **Ingen hemmeligheter i klientkoden.** iOS-bygget får bare serveradressen og URL-skjemaet.
- **Samme regler overalt:** serveren håndhever alt, og appen viser bare det serveren tillater.
- **Kommentarer forklarer hvorfor**, ikke hva. Brukertekst er norsk, og kode og kommentarer er engelsk.

## Tester

| Kommando | Hva | Hvor |
| --- | --- | --- |
| `npm test` | Enhetstester + API-flyter mot minnelager | `tests/unit`, `tests/api` |
| `npm run test:sql` | API-flytene mot PGlite (eller ekte Postgres med `TIKIT_TEST_DATABASE_URL`) | `tests/api` |
| `npm run test:e2e` | Playwright mot produksjonsbygget: nettsiden på tre enheter pluss iOS-laget | `tests/e2e` |
| `./scripts/deploy.sh` | Alt over, i riktig rekkefølge | |

### Automatisk på GitHub (GitHub Actions)

| Arbeidsflyt | Når | Hva |
| --- | --- | --- |
| `.github/workflows/ci.yml` | Hver pull request og hver push til `main` | Tre jobber side om side: typer, lint og `npm test` · lageret og API-flytene mot **ekte Postgres 17** (samme driver som i drift) · produksjonsbygget og Playwright. Spor fra feilede e2e-tester lastes opp som `playwright-traces`. |
| `.github/workflows/ios.yml` | Når `ios/`, `capacitor.config.ts`, `package*.json` eller `scripts/ios.mjs` endres, eller manuelt (*Actions* → *iOS* → *Run workflow*) | Bygger web-delen, kjører `cap sync` og kompilerer iOS-appen med Xcode på macOS (Release, uten signering). |

Ingen av dem trenger hemmeligheter: alt kjører i demomodus. macOS-minutter koster ti ganger så mye som Linux-minutter på private repoer, og derfor kjører iOS-bygget bare når noe det bygges fra, endres.
