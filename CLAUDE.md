# TIKIT – instruks for Claude Code

Billettplattform for russetreff, fester, busslanseringer og revyer. Nettapp (PWA) og iOS-app (Capacitor) fra én TypeScript-kodebase. Eieren snakker norsk: svar på norsk, skriv brukertekst på norsk (bokmål). Kode, kommentarer og commit-meldinger skrives på engelsk.

## Kommandoer

```bash
npm install                 # Node 22.22+
npm run dev                 # API (8787) + webapp (5173), demomodus uten nøkler
npm run doctor              # hva som er koblet til / mangler (--online tester nøklene)
npm run typecheck && npm run lint && npm test   # raske kontroller – kjør før hver commit
npm run test:sql            # API-testene mot PGlite (tar ~3 min)
npm run build && npm run test:e2e               # Playwright (nettsiden på 3 enheter + iOS-laget)
npm run ios                 # iOS: konfigurer Xcode fra .env, bygg mot PUBLIC_URL, åpne Xcode (bare på Mac)
./scripts/deploy.sh         # alt i riktig rekkefølge
```

GitHub Actions: `.github/workflows/ci.yml` kjører typer, lint, tester, API-flytene mot ekte Postgres og Playwright på hver pull request. `ios.yml` kompilerer iOS-appen på macOS når `ios/` eller pakkene endres. Grønn CI er kravet før fletting.

## Kart

- `src/shared/` – typer (`types.ts`), Zod-skjemaer (`schemas.ts`), konstanter, priser, QR. Brukes av alt.
- `src/server/` – API-et (Hono), plattformuavhengig: `routes/` er tynne, all logikk ligger i `services/`. Leverandører kommer inn som adaptere i `Deps` (`context.ts`).
- `src/node/` – Node-serveren: `config.ts` (miljøvariabler), `server.ts` (kobler alt), `db/` (Postgres/Supabase), `integrations/<leverandør>/` (Vipps, Google, Apple, Stripe, Resend), `appLinks.ts` (iOS).
- `src/web/` – React-appen. `native/` er iOS-laget, `demo/` er nettleserdemoen, `screens/`, `organizer/`, `admin/` og `scanner/` er skjermene.
- `ios/` – Xcode-prosjektet. Egen Swift-kode i `ios/App/App/TikitNativePlugin.swift`.
- `docs/` – [arkitektur.md](docs/arkitektur.md) (hvor du endrer hva), [oppsett.md](docs/oppsett.md) (nøkler), [ios.md](docs/ios.md), [app-store/](docs/app-store/README.md), [drift.md](docs/drift.md), [juridisk/](docs/juridisk/), [samtale.md](docs/samtale.md) (historikken).

## Regler

- **Penger i øre** (heltall). Pengeflyt går via `paymentJobs.ts` med idempotensnøkler.
- **All skriving i `store.tx`**, og dokumenter som endres ut fra det som er lest, hentes med `{ forUpdate: true }`.
- **Valider alt som kommer inn** med et Zod-skjema i `src/shared/schemas.ts`.
- **Ny miljøvariabel:** `src/node/config.ts` → `.env.example` → `render*.yaml` → `scripts/doctor.ts`.
- **Personvern:** endrer du hva som lagres eller hvor lenge, oppdater `services/retention.ts`, `web/screens/Legal.tsx`, `docs/juridisk/` og for iOS `ios/App/App/PrivacyInfo.xcprivacy` + `docs/app-store/app-privacy.md`.
- **iOS-koden skal aldri havne i nettbygget.** Bruk `import.meta.env.MODE === 'native'` direkte rundt `import('../native/…')`, ikke en importert konstant. Da fjerner Vite koden.
- **App Store:** ingen kjøp i appen for billetter (3.1.3(e)). Ingen Android- eller Google Play-tekst i iOS-appen (`isNativeApp`). Nye tillatelser trenger konkret formålstekst. Kjør App Store-skillen (`.claude/skills/app-store-review/`) før innsending.
- **Ingen hemmeligheter i klientkoden eller i repoet.** `.env` er ignorert.
- **Demomodus** (`DEMO_MODE`) kan aldri kombineres med ekte nøkler i produksjon. `config.ts` nekter det.
- Tester skal være grønne før push. En ny funksjon får en API-test i `tests/api/`, og en ny skjerm kommer med i tilgjengelighetssjekken i `tests/e2e/`.

## Status

Se [LAUNCH.md](LAUNCH.md) for hva som gjenstår før ekte salg, og [docs/samtale.md](docs/samtale.md) for hva som er gjort og hvorfor. Skriv `/fortsett` for å ta opp tråden.
