# iOS-appen

TIKIT for iPhone og iPad. Det er **samme React-app som nettsiden**, pakket i et native skall med [Capacitor 8](https://capacitorjs.com). All kode ligger i appen, som bare henter data fra serveren (`PUBLIC_URL`). Det iOS-spesifikke ligger to steder:

| Mappe | Hva |
| --- | --- |
| `ios/` | Xcode-prosjektet. Egen Swift-kode: `ios/App/App/TikitNativePlugin.swift` (innlogging, «Logg på med Apple», nøkkelring) og `TikitBridgeViewController.swift` |
| `src/web/native/` | TypeScript-laget: API med token, innlogging, betaling, dype lenker, frakoblede billetter, haptikk, delingsark |

> **Status:** Appen **kompilerer uten feil og advarsler** med Xcode 26.6 (Release, iOS-enhet, uten signering). Det sjekker GitHub Actions (`.github/workflows/ios.yml`) hver gang `ios/` eller pakkene endres. Web-laget er testet i Chromium (`tests/e2e/ios-app.spec.ts`). Det som gjenstår, er å kjøre appen på en ekte iPhone med signering (sjekklisten i §4).

## Det du trenger

- En Mac med **Xcode 26** (eller nyere) og Node 22.22+.
- **Apple Developer Program** (99 USD i året), helst som organisasjon (Din Russetid AS), se [app-store/README.md](app-store/README.md).
- Serveren i drift på et domene med https (for eksempel `https://tikit.no`). Appen snakker med den.

## 1. Apple Developer: identifikatorer og nøkkel

På [developer.apple.com](https://developer.apple.com/account/resources/identifiers/list) → *Certificates, Identifiers & Profiles*:

1. **App ID** (type App): bundle ID `no.tikit.app` (eller ditt eget). Kryss av for:
   - **Sign in with Apple**
   - **Associated Domains**
2. **Services ID** for nettsiden (hvis ikke allerede laget, se [oppsett.md §3](oppsett.md#3-sign-in-with-apple)): `no.tikit.web`, knyttet til App ID-en over.
3. **Key** med *Sign in with Apple* (samme nøkkel som nettsiden bruker). Last ned `.p8`-filen.

## 2. Serveren

Legg inn hos Render (eller i `.env`):

```
APPLE_TEAM_ID=ABCDE12345          # Membership details
APPLE_KEY_ID=XXXXXXXXXX           # nøkkelen over
APPLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----
APPLE_BUNDLE_IDS=no.tikit.app     # slår på universal links og innebygd Apple-innlogging
```

Sjekk:

```bash
npm run doctor                     # «iOS-app: ABCDE12345.no.tikit.app»
curl https://tikit.no/.well-known/apple-app-site-association
```

Den siste skal svare med JSON som inneholder `ABCDE12345.no.tikit.app`. Apple henter fila når appen installeres.

**Tilbakekoblingsadressene er de samme som for nettsiden.** Appen logger inn via serveren, så det trengs ingen nye redirect-URI-er hos Vipps, Google eller Apple.

## 3. Bygg og åpne i Xcode

```bash
npm install
npm run ios:configure   # domene, bundle ID, team og URL-skjema fra .env inn i Xcode-prosjektet
npm run ios             # bygger appen mot PUBLIC_URL, kopierer inn i ios/ og åpner Xcode
```

- Appen bygges mot `PUBLIC_URL` i `.env`. Vil du bygge mot en annen server, for eksempel staging: `TIKIT_API_ORIGIN=https://staging.tikit.no npm run ios`.
- Mot en lokal server i simulatoren: start API-et med `PUBLIC_URL=http://localhost:8787 npm run dev:api` og bygg appen med `TIKIT_API_ORIGIN=http://localhost:8787 npm run ios`. Demoinnlogging og demobetaling virker da i simulatoren. Ekte innlogging krever https.
- Prøv iOS-bygget i en vanlig nettleser: `npx playwright test --project=ios-web`, eller se `scripts/e2e-native.mjs`. Nøkkelringen erstattes da av `sessionStorage` (`src/web/native/plugin.web.ts`).

I Xcode:

1. Velg prosjektet **App** → target **App** → *Signing & Capabilities*.
2. Velg teamet ditt (hvis `APPLE_TEAM_ID` ikke var satt).
3. Sjekk at **Sign in with Apple** og **Associated Domains** (`applinks:tikit.no`) står der. De kommer fra `App.entitlements`.
4. Velg en iPhone-simulator eller din egen iPhone, og trykk ▶︎.

Swift-pakkene (Capacitor og pluginene) hentes automatisk første gang (Swift Package Manager). Det tar et par minutter.

## 4. Test på telefonen

Gå gjennom dette på en ekte iPhone. Simulatoren har verken Vipps-appen eller kamera.

- [ ] Innlogging med **Apple** (innebygd ark), **Google** og **Vipps** (systemnettleseren åpnes, og du kommer tilbake til appen innlogget).
- [ ] Lukk appen helt og åpne den igjen: du er fortsatt innlogget (nøkkelringen).
- [ ] Kjøp med **Vipps**: Vipps-appen åpnes og sender deg tilbake til TIKIT med billettene.
- [ ] Kjøp med **kort**: Stripe åpnes i et ark som lukker seg selv når betalingen er gjennom.
- [ ] Flymodus: billetten vises fortsatt med levende QR-kode.
- [ ] Del et arrangement: lenken er `https://tikit.no/e/…`. Trykk på den i Meldinger, og appen åpnes.
- [ ] Dørskanneren: kameraet spør om tilgang med TIKITs egen tekst.
- [ ] «Legg i kalenderen»: delearket åpnes, og du kan velge Kalender.
- [ ] Slett kontoen (testkonto): du logges ut og kan logge inn på nytt som ny bruker.
- [ ] iPad: alt fungerer både stående og liggende.

## 5. TestFlight og App Store

1. Xcode → *Product* → *Archive* → *Distribute App* → *App Store Connect*.
2. I App Store Connect: legg til testere i TestFlight og test igjen.
3. Fyll inn metadata, skjermbilder, App Privacy og aldersgrense etter [app-store/](app-store/README.md).
4. Slå på App Review-tilgangen, fyll inn notatene ([review-notes.md](app-store/review-notes.md)) og send inn.

Nye versjoner: øk `MARKETING_VERSION` (for eksempel 1.1) og `CURRENT_PROJECT_VERSION` (bygg 2, 3 …) i Xcode, og kjør `npm run ios` før du arkiverer.

## Slik virker det

### Innlogging

```
App                                   Server                           Vipps / Google / Apple
 │ verifier (tilfeldig, blir i appen)
 │ challenge = SHA256(verifier)
 │── ASWebAuthenticationSession ──────▶ /api/auth/login/google?native=<challenge>
 │                                     │──────────── vanlig OpenID Connect ────────▶
 │                                     │◀─────────── /api/auth/callback/google ─────
 │◀── tikit://auth/callback?code=… ───│ engangskode (2 min, bundet til challenge)
 │── POST /api/auth/native/exchange {code, verifier} ▶ │
 │◀── { token } ─────────────────────│ ny økt
 │ token → nøkkelringen
```

- Google tillater ikke innlogging i appens egen web view. Derfor brukes systemnettleseren (`ASWebAuthenticationSession`), som Google, Vipps og Apple godtar.
- Koden kan bare veksles av appen som startet innloggingen, fordi bare den har verifier-en (samme prinsipp som PKCE).
- **Logg på med Apple** bruker Apples innebygde ark. Serveren sjekker Apple-tokenet mot Apples nøkler og mot en nonce den har laget selv (`src/node/integrations/apple/native.ts`).
- API-kallene fra appen går med `Authorization: Bearer <token>` til `PUBLIC_URL`. Serveren tillater opprinnelsen `capacitor://localhost` (CORS, `APP_CORS_ORIGINS`).

### Betaling

- **Vipps:** betalingslenken åpnes av iOS, som starter Vipps-appen direkte (universal link). Etterpå sender Vipps kjøperen til `https://tikit.no/app/ordre/<id>`. Det er en universal link som åpner TIKIT igjen. Er ikke appen koblet til domenet, viser nettsiden en «Åpne TIKIT»-knapp (`tikit://open/…`).
- **Kort:** Stripe Checkout åpnes i et Safari-ark. Appen sjekker bestillingen hvert 3. sekund og lukker arket når den er betalt.
- Billetter er tjenester som brukes utenfor appen, så de skal **ikke** betales med kjøp i appen (Apple 3.1.3(e)).

### Uten nett

Nettsiden bruker en service worker til frakoblede billetter. Appen har ingen, så `src/web/native/offline.ts` tar vare på siste svar for `/me` og `/tickets` i appen, i opptil 14 dager. Alt slettes ved utlogging og når en annen logger inn.

## Endre ting

| Vil du … | Endre |
| --- | --- |
| bytte bundle ID, team eller domene | `.env` → `npm run ios:configure` |
| bytte appnavn på hjemskjermen | `CFBundleDisplayName` i `ios/App/App/Info.plist` |
| bytte ikon eller oppstartsbilde | `scripts/generate-icons.mjs` → `npm run icons` |
| endre kameratekst | `NSCameraUsageDescription` i `Info.plist` |
| legge til en Capacitor-plugin | `npm i -D @capacitor/…` → `npx cap sync ios`, og oppdater `PrivacyInfo.xcprivacy` hvis pluginen bruker API-er som krever begrunnelse |
| legge til egen native funksjon | `TikitNativePlugin.swift` + `src/web/native/plugin.ts` (+ `plugin.web.ts` for nettleseren) |

## Neste steg

- **Push-varsler** for billettslipp og påminnelser: `@capacitor/push-notifications`, APNs-nøkkel (samme type `.p8`), lagring av enhetstokener og utsending fra serveren i `runCron`. Dette er det beste svaret hvis Apple mener appen har for lite native funksjonalitet (4.2).
- **Apple Wallet-kort**: krever et Pass Type ID-sertifikat. Merk at et Wallet-kort har fast strekkode, mens TIKITs levende QR-kode er det som stopper skjermbilde-svindel.
- **Vipps app-til-app-innlogging** (`requested_flow=app_to_app`): gir automatisk retur fra Vipps-appen til innloggingsarket. Uten det bytter brukeren selv tilbake til TIKIT etter å ha godkjent i Vipps, og innloggingen fortsetter av seg selv.
