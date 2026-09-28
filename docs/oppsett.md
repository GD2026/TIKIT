# Oppsett av innlogging, betaling og e-post

Alt settes med miljøvariabler (se `.env.example`). Under utvikling simuleres en tjeneste uten nøkler når `DEMO_MODE=true`, så du kan koble på én og én. **I produksjon er demomodus alt eller ingenting:** serveren starter ikke med `DEMO_MODE=true` og ekte nøkler samtidig. Etter endringer: start serveren på nytt og sjekk loggen – den skriver hvilke innlogginger og betalingsmåter som er aktive, og hva som eventuelt mangler.

I eksemplene er domenet `tikit.no`. Bytt til ditt eget. `PUBLIC_URL` må være nøyaktig samme adresse som brukerne ser (https, uten skråstrek på slutten).

---

## 1. Vipps MobilePay (innlogging + betaling)

Samme salgsenhet og samme nøkler brukes både til «Logg inn med Vipps» og til betaling (ePayment API).

1. Søk om Vipps MobilePay for nettbetaling på vippsmobilepay.com og få tilgang til **portal.vippsmobilepay.com**.
2. Aktiver **Logg inn med Vipps** for salgsenheten.
3. Finn nøklene under *For utviklere* → *API-nøkler* for salgsenheten. Testmiljøet har egne nøkler.
   - `VIPPS_CLIENT_ID`, `VIPPS_CLIENT_SECRET`, `VIPPS_SUBSCRIPTION_KEY` (Ocp-Apim-Subscription-Key) og `VIPPS_MSN` (Merchant Serial Number)
   - `VIPPS_ENV=test` for testmiljøet, `VIPPS_ENV=production` for ekte penger
4. Legg inn tilbakekoblings-adressen (redirect URI) for innlogging i portalen:
   - `https://tikit.no/api/auth/callback/vipps`
   - for lokal utvikling i testmiljøet: `http://localhost:5173/api/auth/callback/vipps`
5. Registrer webhooken som bekrefter betalinger (må kjøres mot en offentlig https-adresse):
   ```bash
   npm run vipps:webhook
   ```
   Skriptet skriver ut `VIPPS_WEBHOOK_SECRET=...`. Legg den inn og start serveren på nytt. **I produksjon er webhooken påkrevd** – serveren starter ikke uten den når Vipps-betaling er på. (Under utvikling bekreftes betalinger også når kjøperen kommer tilbake til appen og ved jevnlig kontroll.)
6. Test i testmiljøet med Vipps sin test-app og testbrukerne fra portalen.

Hva TIKIT henter fra Vipps: navn, e-post, mobilnummer og fødselsdato. Navn og fødselsdato kommer fra Folkeregisteret, så alderen regnes som bekreftet – den brukes for aldersgrenser ved kjøp og i døra.

Betalingen reserveres i Vipps og trekkes med én gang billettene er utstedt. Refusjoner går tilbake til samme betalingsmåte.

## 2. Google

1. Gå til **console.cloud.google.com**, lag et prosjekt og sett opp **Google Auth Platform** (samtykkeskjerm): appnavn TIKIT, støtte-e-post, autorisert domene `tikit.no`. Omfang: `openid`, `email`, `profile`. Publiser appen.
2. *Clients* → *Create client* → *Web application*.
3. **Authorized redirect URIs:**
   - `https://tikit.no/api/auth/callback/google`
   - `http://localhost:5173/api/auth/callback/google` (utvikling)
4. Legg inn `GOOGLE_CLIENT_ID` og `GOOGLE_CLIENT_SECRET`.

## 3. Sign in with Apple

Krever medlemskap i Apple Developer Program. Apple godtar bare https-adresser, så innlogging med Apple kan ikke testes på `localhost` (bruk en tunnel, f.eks. Cloudflare Tunnel, eller test på serveren).

1. **developer.apple.com** → *Certificates, Identifiers & Profiles* → *Identifiers*:
   - Lag en **App ID** (eksplisitt) og kryss av for *Sign in with Apple*.
   - Lag en **Services ID**, f.eks. `no.tikit.web`. Kryss av for *Sign in with Apple* → *Configure*: velg App ID-en over, legg inn domenet `tikit.no` og returadressen `https://tikit.no/api/auth/callback/apple`.
2. *Keys* → ny nøkkel med *Sign in with Apple* (knyttet til App ID-en). Last ned `AuthKey_XXXXXXXXXX.p8` – den kan bare lastes ned én gang.
3. Miljøvariabler:
   - `APPLE_CLIENT_ID` = Services ID (`no.tikit.web`)
   - `APPLE_TEAM_ID` = Team ID (står under *Membership details*)
   - `APPLE_KEY_ID` = nøkkelens ID
   - `APPLE_PRIVATE_KEY` = innholdet i `.p8`-filen, med linjeskift skrevet som `\n`
4. **E-post til skjulte Apple-adresser:** brukere som skjuler e-posten får en `@privaterelay.appleid.com`-adresse. For at kvitteringer skal komme fram, må avsenderdomenet ditt registreres under *Sign in with Apple for Email Communication* i Apple Developer (samme domene som i `MAIL_FROM`, med SPF).

Apple sender navnet til brukeren bare første gang de logger inn. TIKIT lagrer det da; senere innlogginger bruker det lagrede navnet.

## 4. Kortbetaling (Stripe)

1. **dashboard.stripe.com** → *Developers* → *API keys*: legg inn den hemmelige nøkkelen som `STRIPE_SECRET_KEY` (`sk_live_…`, eller `sk_test_…` for testing).
2. *Developers* → *Webhooks* → *Add endpoint*: `https://tikit.no/api/webhooks/stripe` med hendelsene
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`.
   Legg signeringshemmeligheten (`whsec_…`) inn som `STRIPE_WEBHOOK_SECRET` – påkrevd i produksjon.
3. Kjøperen betaler på Stripe sin sikre betalingsside (Stripe Checkout). TIKIT ser aldri kortnumre.

## 5. E-post (Resend)

1. **resend.com** → *Domains* → legg til domenet ditt og DNS-postene Resend viser (SPF og DKIM). Vent til domenet er verifisert.
2. Lag en API-nøkkel og sett `RESEND_API_KEY`.
3. `MAIL_FROM="TIKIT <billetter@tikit.no>"` (må bruke det verifiserte domenet). Valgfritt: `MAIL_REPLY_TO` – ellers brukes `SUPPORT_EMAIL`.

I produksjon er Resend påkrevd (kvitteringer og billettoverføringer til folk uten konto går på e-post). Under utvikling og i demoen lagres e-postene bare i databasen. Sendingen holder aldri igjen et kjøp: e-post sendes i bakgrunnen og prøves på nytt noen ganger hvis Resend svarer med feil.

## 6. Database

- Bruk Postgres 14 eller nyere, f.eks. Neon, Supabase eller Render Postgres. Sett `DATABASE_URL` (med `?sslmode=require` hvis leverandøren krever det, eller `DATABASE_SSL=require`).
- Tabellene lages automatisk ved oppstart. Ingen egne migreringskommandoer.
- Uten `DATABASE_URL` bruker serveren innebygd PGlite i `DATA_DIR`. Det er fint for utvikling og demo, men i produksjon nekter serveren å starte uten `DATABASE_URL` (med mindre `ALLOW_EMBEDDED_DB=true`, som bare er ment for en ren demo).

## 7. Administratorer og selskapsinfo

- `ADMIN_EMAILS=deg@tikit.no` – den som logger inn med denne (bekreftede) e-posten blir plattformadmin.
- `OPERATOR_NAME`, `OPERATOR_ORG_NUMBER`, `SUPPORT_EMAIL` vises i kjøpsvilkår, kvitteringer og hjelpesidene.
- `SESSION_SECRET`: minst 32 tilfeldige tegn (`openssl rand -base64 48`). Bytter du den, blir alle logget ut.
