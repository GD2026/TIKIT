# Drift og publisering

TIKIT er én Node-server som leverer både webappen og API-et. I drift trenger den Postgres og en offentlig https-adresse.

## Render

Repoet har tre Blueprints:

| Fil | Bruk | Kostnad |
| --- | --- | --- |
| `render.staging.yaml` | **Demo**: én gratis web-tjeneste, ingen database, ingen nøkler. All innlogging og betaling er simulert, og eksempeldata legges inn på nytt ved hver oppstart. | Gratis |
| `render.supabase.yaml` | **Produksjon med Supabase**: web-tjeneste i Frankfurt. Databasen er Supabase (lim inn «Session pooler»-adressen, se [oppsett.md §1](oppsett.md#1-database-supabase)). | Render Starter + Supabase Pro (for backup) |
| `render.yaml` | **Produksjon med Render Postgres**: web-tjeneste + Postgres 16 i Frankfurt, databasen bare tilgjengelig internt. | Betalt (Render har ikke gratis Postgres) |

Oppsett: *New* → *Blueprint* → velg repoet. For demoen skriver du `render.staging.yaml` i feltet **Blueprint Path**.

Produksjon:

1. Opprett Blueprinten fra `render.supabase.yaml` (Supabase) eller `render.yaml` (Render Postgres). `SESSION_SECRET` og `CRON_SECRET` lages automatisk.
2. Fyll inn verdiene Render spør om – nøklene er beskrevet i [oppsett.md](oppsett.md).
3. Koble domenet under *Settings* → *Custom Domains* og sett `PUBLIC_URL=https://ditt-domene` (uten `PUBLIC_URL` brukes `https://<tjeneste>.onrender.com`).
4. Registrer Vipps-webhooken (`npm run vipps:webhook` lokalt med produksjonsnøklene) og legg inn `VIPPS_WEBHOOK_SECRET`.
5. Slå på sikkerhetskopi av databasen (Render: betalt plan; Supabase: Pro-plan).
6. Kjør `npm run doctor -- --online` lokalt med de samme verdiene, eller se loggen ved oppstart. Serveren skriver hvilke tjenester som er aktive.
7. iOS-appen: sett `APPLE_BUNDLE_IDS` og sjekk at `https://<domene>/.well-known/apple-app-site-association` svarer (se [ios.md](ios.md)).

**Rull bare ut kode som har bestått testene.** GitHub Actions kjører alle kontrollene på hver pull request og hver push til `main` (se [arkitektur.md](arkitektur.md#automatisk-på-github-github-actions)). To innstillinger gjør dem til en sperre:

- **GitHub** → *Settings* → *Branches* (eller *Rules*) → regel for `main`: krev pull request og at kontrollene «Typer, lint og tester», «API-tester mot Postgres» og «Bygg og ende-til-ende-tester» er grønne.
- **Render** → tjenesten → *Settings* → *Auto-Deploy*: velg at Render venter til GitHub-kontrollene er grønne («After CI Checks Pass»), i stedet for å rulle ut ved hver commit.

**Serveren nekter å starte i produksjon** hvis noe som trengs for ekte salg mangler, og loggen sier nøyaktig hva:

- `PUBLIC_URL` med https (eller Renders egen adresse) og `SESSION_SECRET` på minst 32 tegn
- `DATABASE_URL` – ellers ville alle data ligget på serverens lokale disk og forsvunnet ved neste utrulling (`ALLOW_EMBEDDED_DB=true` er bare for en ren demo)
- minst én innlogging (Vipps, Google eller Apple)
- `RESEND_API_KEY` og `MAIL_FROM` – kvitteringer og billettoverføringer til folk uten konto går på e-post
- `VIPPS_WEBHOOK_SECRET` når Vipps-betaling er på, og `STRIPE_WEBHOOK_SECRET` når kort er på – webhooken er det eneste som fanger opp en betaling som fullføres etter at kjøperen har lukket appen
- `DEMO_MODE=true` sammen med ekte nøkler – da kunne hvem som helst «betalt» med den simulerte metoden og fått ekte billetter

Tekniske detaljer i Blueprintene:

- Byggkommandoen er `npm ci --include=dev && npm run build`. Render setter `NODE_ENV=production` også mens den bygger, og uten `--include=dev` hopper npm over byggeverktøyene.
- `CLIENT_IP_HEADER=cf-connecting-ip`: Render ligger bak Cloudflare, og det er den headeren som har kundens ekte IP-adresse. Uten den ville alle besøkende delt samme grense for antall forespørsler.

## Docker (egen server, Fly.io, Railway o.l.)

```bash
docker build -t tikit .
docker run -p 8787:8787 --env-file .env tikit
```

Bildet kjører som vanlig bruker og har helsesjekk på `/healthz`. Sett `TRUST_PROXY=1` når en proxy eller lastbalanserer står foran, eller `CLIENT_IP_HEADER` hvis proxyen setter en egen header med klientens IP.

## Bakgrunnsjobber

Serveren kjører jobbene selv hvert 30. sekund (`CRON_INTERVAL_SECONDS`):

- utløpte reservasjoner frigis, og betalinger som står åpne kontrolleres hos Vipps og Stripe (også betalinger der svaret fra leverandøren aldri kom fram)
- reserverte Vipps-beløp trekkes på nytt hvis et forsøk feilet
- **betalingsjobber**: refusjoner, utbetalinger ved videresalg og tilbakeføring av betalinger som ikke skal beholdes (erstattet, avbrutt, utsolgt, avlyst). De lagres i databasen i samme transaksjon som endringen i TIKIT og prøves på nytt med økende pause i opptil ti forsøk, med samme idempotensnøkkel – så en refusjon blir aldri betalt ut to ganger
- varsler om billettslipp og påminnelser sendes

Kjører du flere instanser, sørger en lås i databasen for at bare én kjører jobbene om gangen. Du kan også trigge dem utenfra med `POST /api/cron` og `Authorization: Bearer <CRON_SECRET>`.

Ved utrulling får serveren `SIGTERM`: den slutter å ta imot nye forespørsler, lar de som pågår (for eksempel en kjøper midt i betalingen) bli ferdige i opptil 28 sekunder, venter på en jobb som kjører, og lukker så databasen.

## Skalering

Én instans holder lenge for et russetreff-marked. Begrensningen av forespørsler holdes i minnet per instans; med flere instanser blir grensene per instans. Databasen tåler flere instanser (radlåser og transaksjoner), og oppstarten rører ikke tabellene når skjemaet allerede er oppdatert.

## Overvåking

- `GET /healthz` svarer `{"ok":true}` når databasen svarer, ellers 503. Render bruker den som helsesjekk.
- Loggen er JSON i produksjon (én linje per hendelse). Ved uventede feil ser brukeren en referanse («ref. …») – søk etter den som `requestId` i loggen.
- Følg med på disse loggmeldingene:
  - `Betalingsjobb ga opp – må følges opp manuelt hos betalingsleverandøren` (nivå `error`): en refusjon eller tilbakeføring gikk ikke gjennom etter ti forsøk. Beløpet står i loggen og i admin-loggen (`payment_job.failed`).
  - `Betalingsjobb feilet – prøves igjen` (nivå `warn`): enkeltfeil, ordner seg vanligvis selv.
  - `Capture feilet` og `Kunne ikke hente betalingsstatus`: Vipps eller Stripe svarer ikke som de skal.
  - `E-post kunne ikke sendes etter flere forsøk`: sjekk Resend.
- Render sender e-post når en utrulling feiler eller tjenesten krasjer (*Settings* → *Notifications*).

## Sjekkliste før første ekte salg

- [ ] Produksjons-Blueprint (`render.yaml`) med betalt Postgres og sikkerhetskopi
- [ ] `DEMO_MODE=false`, `PUBLIC_URL` med ditt domene
- [ ] Vipps i produksjon (`VIPPS_ENV=production`), redirect URI lagt inn, webhook registrert
- [ ] Google og/eller Apple satt opp med produksjonsdomenet (valgfritt, men anbefalt)
- [ ] Stripe med live-nøkkel og webhook (hvis kort skal tilbys)
- [ ] Resend med verifisert domene; for Apple også registrert under «Email Communication»
- [ ] `OPERATOR_NAME`, `OPERATOR_ORG_NUMBER`, `SUPPORT_EMAIL` og `ADMIN_EMAILS`
- [ ] Kjøpsvilkår og personvernerklæring gjennomgått (sidene `/vilkar` og `/personvernerklaering`)
- [ ] Gebyrnivå satt i admin (standard 5 kr + 3,5 %, maks 49 kr per billett)
- [ ] Testkjøp med ekte Vipps, innsjekk med skanneren, overføring, videresalg og refusjon
- [ ] Første arrangør godkjent i admin
