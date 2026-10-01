# Oppsett: database, innlogging, betaling og e-post

Alt settes med miljøvariabler: i `.env` lokalt, og under *Environment* hos Render i drift. Alle variablene er forklart i [`.env.example`](../.env.example).

**Slik sjekker du hva som mangler:**

```bash
npm run doctor              # hva som er koblet til, hva som mangler, og adressene du skal registrere hvor
npm run doctor -- --online  # prøver også hver nøkkel mot tjenesten (endrer ingenting)
```

Uten nøkler kjører appen i **demomodus**: innlogging og betaling simuleres, så du kan koble på én tjeneste av gangen. **I produksjon er demomodus alt eller ingenting.** Serveren starter ikke med `DEMO_MODE=true` og ekte nøkler samtidig, og den sier fra i loggen om alt som mangler.

I eksemplene er domenet `tikit.no`. Bytt til ditt eget. `PUBLIC_URL` må være nøyaktig adressen brukerne ser (https, uten skråstrek på slutten). iOS-appen bruker samme adresse.

**Rekkefølge som fungerer:** 1) database, 2) Vipps, Google og Apple, 3) betaling, 4) e-post, 5) iOS-appen ([ios.md](ios.md)), 6) lommebok (valgfritt).

| Tjeneste | Påkrevd i drift? | Nøkler |
| --- | --- | --- |
| [Database (Supabase)](#1-database-supabase) | Ja | `DATABASE_URL` |
| [Vipps MobilePay](#2-vipps-mobilepay-innlogging--betaling) | Minst én innlogging | `VIPPS_*` |
| [Google](#3-google) | – | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| [Apple](#4-sign-in-with-apple) | Påkrevd for iOS-appen hvis Google tilbys (Apple 4.8) | `APPLE_*` |
| [Stripe](#5-kortbetaling-stripe) | Valgfritt | `STRIPE_*` |
| [Resend](#6-e-post-resend) | Ja | `RESEND_API_KEY`, `MAIL_FROM` |
| [Selskap og admin](#7-selskap-og-administratorer) | Ja | `OPERATOR_*`, `SUPPORT_EMAIL`, `ADMIN_EMAILS` |
| [Lommebok](#9-lommebok-apple-wallet-og-google-wallet) | Valgfritt | `APPLE_WALLET_CERT`, `APPLE_WALLET_KEY`, `GOOGLE_WALLET_*` |

---

## 1. Database (Supabase)

TIKIT bruker vanlig Postgres, og Supabase fungerer rett ut av boksen. Tabellene (`tikit_*`) lages automatisk ved første oppstart. Du trenger ingen egne migreringskommandoer.

1. Lag et prosjekt på [supabase.com](https://supabase.com) i region **Frankfurt (eu-central-1)**, nærmest Render og innenfor EØS. Ta vare på databasepassordet.
2. Trykk **Connect** øverst i prosjektet → **Session pooler** → kopier URI-en:
   ```
   postgresql://postgres.<prosjekt-ref>:<passord>@aws-0-eu-central-1.pooler.supabase.com:5432/postgres
   ```
3. Legg den i `DATABASE_URL`. Hos Render bruker du Blueprinten **`render.supabase.yaml`**, som spør etter den.
4. Valgfritt, men anbefalt: under *Project Settings → Database → SSL Configuration* laster du ned CA-sertifikatet og legger innholdet i `DATABASE_CA_CERT` (linjeskift som `\n`). Da sjekkes også sertifikatet, ikke bare krypteringen.
5. Kjør `npm run doctor -- --online`. Den skal vise «Database: Postgres 17…».

**Viktig å vite:**

- Bruk **Session pooler**, ikke *Direct connection*. Den direkte adressen (`db.<ref>.supabase.co`) har bare IPv6, og Render når den ikke. `npm run doctor` advarer om det.
- *Transaction pooler* (port 6543) virker også. TIKIT slår da av prepared statements selv.
- **Supabase sitt REST-API** kan normalt lese alle tabeller i `public`. TIKIT slår på **row level security** på alle tabellene sine, uten regler, slik at REST-API-et ikke får se noe. Serveren kobler til som eier av tabellene og påvirkes ikke. Ikke skru RLS av, og ikke bruk `anon`- eller `service_role`-nøkkelen i appen. TIKIT trenger dem ikke.
- **Sikkerhetskopi:** gratisplanen har ingen, og prosjektet settes på pause etter en uke uten trafikk. Bruk **Pro** i drift (daglig backup, 7 dager tilbake).
- **Databehandleravtale:** godta Supabase sin DPA (supabase.com/legal/dpa) og legg Supabase inn i protokollen (`docs/juridisk/protokoll.md`).
- Bilder (arrangørbilder) lagres i databasen, maks 1,5 MB hver. Blir det mange, kan de flyttes til Supabase Storage senere.

**Andre valg:** Render Postgres (Blueprinten `render.yaml` lager databasen for deg), Neon eller en hvilken som helst Postgres 14+. Uten `DATABASE_URL` bruker serveren innebygd PGlite i `DATA_DIR`. Det er fint for utvikling, men serveren nekter å starte slik i produksjon.

## 2. Vipps MobilePay (innlogging + betaling)

Samme salgsenhet og samme nøkler brukes både til «Logg inn med Vipps» og til betaling (ePayment API).

1. Søk om Vipps MobilePay for nettbetaling på vippsmobilepay.com og få tilgang til **portal.vippsmobilepay.com**. Du signerer med BankID for selskapet.
2. Aktiver **Logg inn med Vipps** for salgsenheten.
3. Finn nøklene under *For utviklere* → *API-nøkler* for salgsenheten. Testmiljøet har egne nøkler.
   - `VIPPS_CLIENT_ID`, `VIPPS_CLIENT_SECRET`, `VIPPS_SUBSCRIPTION_KEY` (Ocp-Apim-Subscription-Key) og `VIPPS_MSN` (Merchant Serial Number)
   - `VIPPS_ENV=test` for testmiljøet, `VIPPS_ENV=production` for ekte penger
4. Legg inn tilbakekoblings-adressen (redirect URI) for innlogging i portalen:
   - `https://tikit.no/api/auth/callback/vipps` (gjelder også iOS-appen)
   - for lokal utvikling i testmiljøet: `http://localhost:5173/api/auth/callback/vipps`
5. Registrer webhooken som bekrefter betalinger (må kjøres mot en offentlig https-adresse):
   ```bash
   npm run vipps:webhook
   ```
   Skriptet skriver ut `VIPPS_WEBHOOK_SECRET=...`. Legg den inn og start serveren på nytt. **I produksjon er webhooken påkrevd.** Serveren starter ikke uten den når Vipps-betaling er på.
6. Test i testmiljøet med Vipps sin test-app og testbrukerne fra portalen.

Hva TIKIT henter fra Vipps: navn, e-post, mobilnummer og fødselsdato. Navn og fødselsdato kommer fra Folkeregisteret, så alderen regnes som bekreftet. Den brukes til aldersgrenser ved kjøp og i døra.

Betalingen reserveres i Vipps og trekkes med én gang billettene er utstedt. Refusjoner går tilbake til samme betalingsmåte. Kjøper man i iOS-appen, sender Vipps kjøperen tilbake til appen (se [ios.md](ios.md#betaling)).

## 3. Google

1. Gå til **console.cloud.google.com**, lag et prosjekt og sett opp **Google Auth Platform** (samtykkeskjerm): appnavn TIKIT, støtte-e-post, autorisert domene `tikit.no`. Omfang: `openid`, `email`, `profile`. Publiser appen.
2. *Clients* → *Create client* → *Web application*. Én klient dekker både nettsiden og iOS-appen, fordi appen logger inn via serveren.
3. **Authorized redirect URIs:**
   - `https://tikit.no/api/auth/callback/google`
   - `http://localhost:5173/api/auth/callback/google` (utvikling)
4. Legg inn `GOOGLE_CLIENT_ID` og `GOOGLE_CLIENT_SECRET`.

## 4. Sign in with Apple

Krever medlemskap i Apple Developer Program. Apple godtar bare https-adresser, så innlogging med Apple kan ikke testes på `localhost` (bruk en tunnel, for eksempel Cloudflare Tunnel, eller test på serveren).

1. **developer.apple.com** → *Certificates, Identifiers & Profiles* → *Identifiers*:
   - Lag en **App ID** (for eksempel `no.tikit.app`) med *Sign in with Apple* og *Associated Domains*. Samme App ID brukes av iOS-appen.
   - Lag en **Services ID**, for eksempel `no.tikit.web`. Kryss av for *Sign in with Apple* → *Configure*: velg App ID-en over, legg inn domenet `tikit.no` og returadressen `https://tikit.no/api/auth/callback/apple`.
2. *Keys* → ny nøkkel med *Sign in with Apple* (knyttet til App ID-en). Last ned `AuthKey_XXXXXXXXXX.p8`. Den kan bare lastes ned én gang.
3. Miljøvariabler:
   - `APPLE_CLIENT_ID` = Services ID (`no.tikit.web`), for nettsiden
   - `APPLE_TEAM_ID` = Team ID (står under *Membership details*)
   - `APPLE_KEY_ID` = nøkkelens ID
   - `APPLE_PRIVATE_KEY` = innholdet i `.p8`-filen, med linjeskift skrevet som `\n`
   - `APPLE_BUNDLE_IDS` = App ID-ens bundle ID (`no.tikit.app`), for iOS-appen: slår på innebygd «Logg på med Apple» og universal links
4. **E-post til skjulte Apple-adresser:** brukere som skjuler e-posten, får en `@privaterelay.appleid.com`-adresse. For at kvitteringer skal komme fram, må avsenderdomenet registreres under *Sign in with Apple for Email Communication* i Apple Developer (samme domene som i `MAIL_FROM`, med SPF).

Apple sender navnet bare første gang noen logger inn. TIKIT lagrer det da, og senere innlogginger bruker det lagrede navnet. Når en konto slettes, trekker TIKIT tilbake tilgangen hos Apple, slik Apple krever.

## 5. Kortbetaling (Stripe)

1. **dashboard.stripe.com** → *Developers* → *API keys*: legg inn den hemmelige nøkkelen som `STRIPE_SECRET_KEY` (`sk_live_…`, eller `sk_test_…` for testing).
2. *Developers* → *Webhooks* → *Add endpoint*: `https://tikit.no/api/webhooks/stripe` med hendelsene
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.
   Legg signeringshemmeligheten (`whsec_…`) inn som `STRIPE_WEBHOOK_SECRET`. Den er påkrevd i produksjon.
3. Kjøperen betaler på Stripe sin sikre betalingsside (Stripe Checkout). TIKIT ser aldri kortnumre.

## 6. E-post (Resend)

1. **resend.com** → *Domains* → legg til domenet ditt og DNS-postene Resend viser (SPF og DKIM). Vent til domenet er verifisert.
2. Lag en API-nøkkel og sett `RESEND_API_KEY`.
3. `MAIL_FROM="TIKIT <billetter@tikit.no>"` (må bruke det verifiserte domenet). Valgfritt: `MAIL_REPLY_TO`, ellers brukes `SUPPORT_EMAIL`.

I produksjon er Resend påkrevd, fordi kvitteringer og billettoverføringer til folk uten konto går på e-post. Under utvikling og i demoen lagres e-postene bare i databasen. Sendingen holder aldri igjen et kjøp: e-post sendes i bakgrunnen og prøves på nytt noen ganger hvis Resend svarer med feil. `npm run doctor -- --online` sjekker at domenet i `MAIL_FROM` er verifisert.

## 7. Selskap og administratorer

- `ADMIN_EMAILS=deg@tikit.no`: den som logger inn med denne (bekreftede) e-posten, blir plattformadmin.
- `OPERATOR_NAME`, `OPERATOR_ORG_NUMBER` og `SUPPORT_EMAIL` vises i kjøpsvilkår, kvitteringer og hjelpesidene. **`SUPPORT_EMAIL` får også en e-post hver gang noen rapporterer et arrangement.** Apple forventer svar innen ett døgn (behandles under Admin → Rapporter).
- `SESSION_SECRET`: minst 32 tilfeldige tegn (`openssl rand -base64 48`). Bytter du den, blir alle logget ut, og krypterte Apple-nøkler kan ikke lenger brukes til å trekke tilbake tilgang.

## 8. iOS-appen og App Review

- iOS-appen: [ios.md](ios.md). Du trenger `APPLE_BUNDLE_IDS` i tillegg til Apple-nøklene over.
- Tilgangskode for Apples anmeldere (`REVIEW_LOGIN_EMAIL`, `REVIEW_LOGIN_CODE`): [app-store/review-notes.md](app-store/review-notes.md). La den være av utenom gjennomgangen.

## 9. Lommebok (Apple Wallet og Google Wallet)

Valgfritt, men praktisk i døra. Under billetten får kjøperen en svart knapp: **«Legg til i Apple Lommebok»** på iPhone, iPad og Mac, og **«Legg til i Google Lommebok»** på Android og PC. Etterpå åpnes billetten med to trykk på sideknappen på iPhone, og den dukker opp på låseskjermen fra tre timer før dørene åpner. På mange Android-telefoner åpnes Google Lommebok med to trykk på av/på-knappen.

**Viktig å vite:** Et lommebok-kort har en **fast QR-kode** (`TK2`), fordi Wallet ikke kan bytte kode hvert 15. sekund slik den levende billetten i appen gjør. Et skjermbilde av kortet slipper derfor inn én person, nemlig den som kommer først. Kortet slutter å virke i døra når billetten overføres, selges videre eller refunderes, og kortet kan ikke deles fra Apple Lommebok. Den levende billetten i appen er fortsatt tryggest.

Kortene lages på serveren. TIKIT lagrer ingenting nytt.

### Apple Wallet

Krever medlemskap i Apple Developer Program (samme som for iOS-appen). Du trenger ikke Mac.

1. Lag en nøkkel og en sertifikatforespørsel:
   ```bash
   openssl req -new -newkey rsa:2048 -nodes -keyout wallet.key -out wallet.csr -subj "/CN=TIKIT Wallet/O=Din Russetid AS/C=NO"
   ```
2. **developer.apple.com** → *Certificates, Identifiers & Profiles* → *Identifiers* → **+** → **Pass Type IDs**. Beskrivelse: «TIKIT billett». ID: `pass.no.tikit.billett`.
3. *Certificates* → **+** → **Pass Type ID Certificate** → velg ID-en → last opp `wallet.csr` → last ned `pass.cer`.
4. Gjør sertifikatet om til PEM:
   ```bash
   openssl x509 -inform der -in pass.cer -out wallet.pem
   ```
5. Legg inn innholdet i filene. Hos Render kan du lime inn med linjeskift. I `.env` må alt stå på én linje med `\n`, og `awk 'NF {printf "%s\\n", $0}' wallet.pem` skriver det ut slik.
   - `APPLE_WALLET_CERT` = innholdet i `wallet.pem`
   - `APPLE_WALLET_KEY` = innholdet i `wallet.key` (hemmelig, aldri i git)
6. Kjør `npm run doctor`. Den skal vise «Apple Wallet: pass.no.tikit.billett · team … · gyldig til …».

Pass Type ID og Team ID leses fra sertifikatet, og Apples mellomsertifikat (WWDR G4) er bygget inn. Sertifikatet varer i ett år. `npm run doctor` og serverloggen sier fra 30 dager før det går ut. Da gjentar du steg 1–5.

Har du sertifikatet i Nøkkelring på en Mac? Eksporter det som `.p12` og hent ut filene:
```bash
openssl pkcs12 -in wallet.p12 -clcerts -nokeys -out wallet.pem
openssl pkcs12 -in wallet.p12 -nocerts -nodes -out wallet.key
```

### Google Wallet

1. **pay.google.com/business/console** → *Google Wallet API* → registrer selskapet som utsteder. Noter **Issuer ID** (et langt tall).
2. **console.cloud.google.com** (gjerne samme prosjekt som Google-innloggingen) → *APIs & Services* → aktiver **Google Wallet API**.
3. *IAM & Admin* → *Service Accounts* → **Create service account** (for eksempel `tikit-wallet`) → *Keys* → *Add key* → **JSON**. Last ned filen. Den er hemmelig.
4. Tilbake i Wallet-konsollen: *Users* → **Invite a user** → e-posten til tjenestekontoen, med rollen **Developer**.
5. Legg inn:
   - `GOOGLE_WALLET_ISSUER_ID` = Issuer ID
   - `GOOGLE_WALLET_SERVICE_ACCOUNT` = hele JSON-filen. I `.env` på én linje: `jq -c . nøkkelfil.json`
6. Kjør `npm run doctor -- --online`. Den sjekker at tjenestekontoen har tilgang til utstederen.
7. Så lenge utstederkontoen er i **testmodus**, virker kortene bare for testkontoer du legger til i konsollen. Be om publiseringstilgang (*Request publishing access*) før dere åpner salget.

Google henter logoen på kortet fra `PUBLIC_URL/icons/icon-192.png`, så den må ligge på en offentlig https-adresse.

### Før lansering

- Apple og Google har egne regler for «Legg til i Lommebok»-knapper («Add to Apple Wallet Guidelines» og Google Wallet sine «Brand guidelines»). TIKIT bruker en svart knapp med egen tekst. Sjekk den mot reglene, og bytt eventuelt til de offisielle merkene. Knappene ligger i `src/web/components/ticket/WalletButtons.tsx`.
- Kort som allerede er lagt i lommeboken, oppdateres ikke av seg selv hvis arrangøren endrer tid eller sted. Det krever Apples oppdateringstjeneste og Google Wallet API (se «Neste steg» i [ios.md](ios.md#neste-steg)).
