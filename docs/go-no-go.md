# TIKIT – sikkerhet, samsvar og go/no-go

*Rapport 24.–27. september 2026. Tre roller: sikkerhetsarkitekt, compliance og utrullingskontroll.*

## Konklusjon

| | Anbefaling |
| --- | --- |
| **Demo / testmiljø** (simulert innlogging og betaling) | **GO** |
| **Ekte salg** | **NO-GO** inntil de sju blokkerne under er løst. Ingen av dem er feil i koden – de er avtaler, nøkler og kontroller som bare eieren kan gjøre. |

## Agent 1 – sikkerhetsarkitekt

To runder:
1. Fire uavhengige gjennomganger fant 47 feil, som alle er rettet.
2. Denne runden testet det promptens kategorier dekket utover første runde, mot en kjørende produksjonsbygg.

**Testet og i orden**

| Område | Resultat |
| --- | --- |
| Avhengigheter | `npm audit`: 0 kjente sårbarheter (produksjon og utvikling) |
| Sikkerhetsheadere | CSP (`script-src 'self'`, `frame-ancestors 'none'`), HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP/CORP |
| Økt / cookie | `HttpOnly; Secure; SameSite=Lax`, tilfeldig token lagret som hash, 30 dager uten bruk |
| CSRF | Endrende forespørsler uten `X-Tikit`-header og riktig Origin avvises |
| Brute force / rate limiting | Innlogging: 30 per minutt per klient-IP (Cloudflare-header), deretter 429; andre klienter påvirkes ikke. Skannerkoder: 10 forsøk per 10 min. |
| Store forespørsler | 5 MB avvises med 413 før noe leses inn |
| Path traversal | `..%2f`, `%2e%2e` og lignende gir appens forside eller 404 – aldri filer utenfor `dist/web` |
| Kildekart | `.map` gir 404 i produksjon |
| Feilmeldinger | Ingen stack traces; generisk melding med referanse (`requestId`) |
| SQL-injeksjon | Parametriserte spørringer og hviteliste for feltnavn |
| XSS | Ingen `dangerouslySetInnerHTML`; e-post escapes; CSP blokkerer inline-skript |
| Kommandoinjeksjon, XXE, deserialisering | Ikke relevant: ingen skall-kall, ingen XML, bare JSON |
| Hemmeligheter | Ingen i repoet eller i nettleserkoden; `.env` er ignorert; `SESSION_SECRET`/`CRON_SECRET` lages av Render |
| OAuth | State, nonce og PKCE i signert, kortlivet cookie; e-post må være bekreftet for kobling og admin |
| Demo-admin i produksjon | Avvist (403) |

**Nye funn i denne runden – rettet**

| # | Alvorlighet | Funn | Rettet |
| --- | --- | --- | --- |
| 1 | Middels | Ingen automatisk sletting av personopplysninger (lagringsbegrensning, GDPR art. 5) | Daglig jobb sletter/anonymiserer etter lagringstidene i personvernerklæringen (`retention.ts`, med test) |
| 2 | Lav | Valideringsfeil ble vist på engelsk | Norske standardmeldinger (`z.locales.no`) |
| 3 | Lav | Mottakerens e-post i feillogg for e-post | Fjernet |

**Kjente, aksepterte begrensninger**

| Alvorlighet | Begrensning | Når den bør tas |
| --- | --- | --- |
| Middels | Rate limiting holdes i minnet per server-instans | Før dere kjører flere instanser (bruk da Redis eller Render sin lastbalanserer) |
| Lav | Betalingsjobber som gir opp etter 10 forsøk vises bare i logg og revisjonslogg | Egen admin-side etter lansering |
| Lav | E-post som feiler prøves på nytt i minnet og kan gå tapt ved omstart | Utboks i databasen senere |
| Info | Kryptering av databasen på disk er ikke bekreftet i Renders dokumentasjon | Spør Render support før ekte salg |

## Agent 2 – compliance

**Dokumenter (i `docs/juridisk/`)**

| Dokument | Norsk | Engelsk | I appen |
| --- | --- | --- | --- |
| Personvernerklæring | `personvernerklaering.md` | `privacy-policy.en.md` | `/personvernerklaering` (oppdatert) |
| Kjøpsvilkår, med angrerett og refusjon | `kjopsvilkar.md` | `terms-of-service.en.md` | `/vilkar` (oppdatert) |
| Informasjonskapsler | `informasjonskapsler.md` | `cookie-policy.en.md` | Kort versjon i personvernerklæringen |
| Lagringstider | Tabell i personvernerklæringen | Tabell i privacy policy | Håndheves av daglig jobb |
| Protokoll, leverandøravtaler og avviksrutine | `protokoll.md` (internt) | – | – |

**Rettsgrunnlag som er sjekket**
- **Angrerett:** billetter til arrangementer på en bestemt dato er unntatt, jf. angrerettloven § 22 bokstav m.
- **Videresalg:** lov om forbud mot prispåslag ved videresalg av billetter til kultur- og idrettsarrangementer (LOV-2007-06-29-86) forbyr videresalg over pålydende. TIKIT tillater aldri mer enn kjøperen betalte.
- **Bokføring:** regnskapsmateriale oppbevares i 5 år etter regnskapsårets slutt (bokføringsloven § 13). Bestillinger anonymiseres deretter.
- **Informasjonskapsler:** ny ekomlov § 3-15 fra 1.1.2025, med tilsyn fra Datatilsynet og Nkom. TIKIT bruker bare strengt nødvendig lagring, så det trengs ikke samtykkebanner.
- **Brukerrettigheter:**
  - Innsyn og dataportabilitet (nedlasting) og sletting finnes i appen.
  - Retting og andre henvendelser går via support.
  - Klage kan sendes til Datatilsynet.

**App Store / Google Play**

TIKIT er en PWA og trenger ikke butikkene. Hvis den senere pakkes som app:
- **Apple 3.1.3(e):** billetter til arrangementer som brukes utenfor appen, skal betales utenom Apples kjøp i app. Vipps og kort er altså riktig.
- **Apple 4.8:** med Google-innlogging kreves et personvernvennlig alternativ. Sign in with Apple oppfyller det.
- **Apple 5.1.1(v):** sletting av konto må kunne gjøres i appen. Det finnes allerede.
- **Google Play:** kjøp av fysiske tjenester som billetter er unntatt fra Play Billing.

**Mangler**
1. Feltene i [hakeparenteser] må fylles inn: adresse og support-e-post. I appen settes `SUPPORT_EMAIL`.
2. **Arrangøravtale** (B2B) finnes ikke. Den bør dekke gebyr, utbetaling, refusjon ved avlysning, ansvar for arrangementet og personvern for deltakerlister.
3. Databehandleravtaler må godtas hos Render og Resend.
4. En rådgiver må lese gjennom vilkår og personvern, og MVA på servicegebyret må avklares med regnskapsfører.

## Agent 3 – utrullingskontroll

| Punkt | Status | Grunnlag |
| --- | --- | --- |
| Alle sårbarheter fra agent 1 rettet | ✅ | 47 + 3 rettet og testet; kjente begrensninger er dokumentert |
| Sikkerhetsheadere | ✅ | Testet mot kjørende produksjonsbygg |
| Hemmeligheter sikret | ✅ | Ingen i repo eller klientkode; genereres av Render |
| Rate limiting aktiv | ✅ | 429 etter grensen, per klient-IP |
| Inputvalidering | ✅ | Zod på alle innganger + størrelsesgrense |
| Sensitive data ikke logget | ✅ | E-post og telefon fjernet fra logger |
| HTTPS påtvunget | ✅ | HSTS; serveren nekter å starte uten https-adresse i produksjon |
| Avhengigheter revidert | ✅ | `npm audit` 0 funn (24.09.2026) |
| Sikker feilhåndtering | ✅ | Ingen stack traces |
| Database kryptert | ⚠️ | Bare intern tilgang og kryptert transport; kryptering på disk må bekreftes med Render |
| Sikkerhetskopi | ⚠️ | Krever betalt plan: tilbakespoling 3 dager (Hobby) / 7 dager (Pro), logiske kopier i 7 dager. Gratisplanen har ingen. |
| Overvåking og varsling | ⚠️ | Helsesjekk, JSON-logg og loggmeldinger å følge med på er på plass. Varsler i Render må slås på. |
| Personvernerklæring lenket i appen | ✅ | Innloggingsark, Hjelp |
| Vilkår lenket i appen | ✅ | Kassen (må godtas), innloggingsark, Hjelp |
| Tillatelser begrunnet | ✅ | Bare kamera, og bare i dørskanneren. Alt annet er slått av i Permissions-Policy. |
| GDPR-funksjoner | ⚠️ | Eksport, sletting, automatisk sletting og protokoll er på plass. Databehandleravtaler og arrangøravtale mangler. |
| Analyse GDPR-vennlig | ✅ | Ingen analyse eller sporing i appen |

**13 av 17 punkter grønne, 4 delvis, 0 røde.**

Tester per 27.09.2026:
- 82 enhets- og API-tester
- 10 regresjonstester for rettelsene (minnelager og PGlite)
- 29 SQL-tester mot PGlite og ekte Postgres 16
- 18 av 18 ende-til-ende-tester (iPhone lys og mørk, PC)

## Prioritert handlingsplan (master)

**Blokkerer ekte salg:**
1. **Legg koden på GitHub og publiser på Render.** Bruk `render.yaml` med betalt plan, slik at du får database med sikkerhetskopi.
2. **Vipps MobilePay-avtale** for Din Russetid AS (BankID). Legg inn produksjonsnøklene og registrer webhook.
3. **Domene og Resend** (verifisert avsenderdomene), og sett `SUPPORT_EMAIL` og `ADMIN_EMAILS`.
4. **Fyll inn og få gjennomgått** vilkår og personvern, og avklar MVA.
5. **Arrangøravtale** før første eksterne arrangør.
6. **Godta databehandleravtaler** (Render, Resend), og spør Render om kryptering på disk.
7. **Testkjøp med ekte Vipps:** kjøp, refusjon, overføring, videresalg og innsjekk.

**Rett etter lansering:**
8. Slå på varsler i Render, og følg med på loggmeldingene i `docs/drift.md`.
9. Admin-side for betalingsjobber som har gitt opp.
10. Enkel risikovurdering (DPIA) for bekreftet alder og unge brukere.

## Sammendrag (JSON)

```json
{
  "security_issues": [
    {"vulnerability": "Billettnummer alene slapp folk inn (også etter videresalg)", "severity": "critical", "fix": "Nummer bare ved manuell inntasting med ID-sjekk; nytt nummer ved eierskifte", "priority": 1, "status": "fixed"},
    {"vulnerability": "Bygget feilet på Render (devDependencies hoppet over)", "severity": "critical", "fix": "npm ci --include=dev", "priority": 1, "status": "fixed"},
    {"vulnerability": "Alle besøkende delte samme rate limit bak Render", "severity": "critical", "fix": "CLIENT_IP_HEADER=cf-connecting-ip", "priority": 1, "status": "fixed"},
    {"vulnerability": "Refusjon kunne betales ut to ganger; feilede utbetalinger ble aldri prøvd igjen", "severity": "high", "fix": "Refusjon under ordrelås + betalingsjobber med retry og idempotensnøkkel", "priority": 2, "status": "fixed"},
    {"vulnerability": "Dørvakter kunne eksportere andres deltakerlister (IDOR)", "severity": "high", "fix": "Arrangementet må tilhøre arrangøren i URL-en", "priority": 2, "status": "fixed"},
    {"vulnerability": "Vipps-bekreftet alder kunne flyttes til en annen person", "severity": "high", "fix": "Navn låses til Vipps-navnet; bekreftelsen fjernes ved frakobling", "priority": 2, "status": "fixed"},
    {"vulnerability": "DEMO_MODE i produksjon ga gratis billetter og admin", "severity": "high", "fix": "Serveren starter ikke med demo + ekte nøkler; demo-admin stengt", "priority": 2, "status": "fixed"},
    {"vulnerability": "Ingen automatisk sletting av personopplysninger", "severity": "medium", "fix": "Daglig lagringstidsjobb", "priority": 3, "status": "fixed"},
    {"vulnerability": "Rate limiting per instans i minnet", "severity": "medium", "fix": "Delt lager (Redis) før flere instanser", "priority": 4, "status": "accepted"},
    {"vulnerability": "Kryptering på disk ikke bekreftet hos Render", "severity": "info", "fix": "Bekreft med Render", "priority": 4, "status": "open"}
  ],
  "compliance_docs": {
    "privacy_policy": "✓ ferdig (norsk + engelsk, i appen) – adresse/e-post må fylles inn og gjennomgås",
    "terms_of_service": "✓ ferdig (norsk + engelsk, i appen) – samme",
    "cookie_policy": "✓ ferdig (norsk + engelsk)",
    "data_retention": "✓ ferdig (i personvernerklæringen, håndheves automatisk)",
    "records_of_processing": "✓ ferdig (intern protokoll)",
    "organizer_agreement": "✗ mangler",
    "app_store_assets": "ikke relevant (PWA)"
  },
  "deployment_checklist": {"passed": 13, "partial": 4, "failed": 0, "total": 17},
  "go_live_recommendation": {"demo": "YES", "real_sales": "NO – 7 blokkere, se handlingsplanen"}
}
```

## Kilder

- [Lov om forbud mot prispåslag ved videresalg av billetter (Lovdata)](https://lovdata.no/lov/2007-06-29-86)
- [Angrerettloven § 22 bokstav m – forklaring (paragrafer.no)](https://www.paragrafer.no/angrerett/nar-har-man-angrerett/)
- [Redusert oppbevaringstid for regnskapsmateriale (Skatteetaten)](https://www.skatteetaten.no/en/rettskilder/type/kunngjoringer/redusert-oppbevaringstid-for-regnskapsmateriale/)
- [Informasjonskapsler (Nkom)](https://nkom.no/internett/informasjonskapsler-cookies)
- [Render Postgres: sikkerhetskopi og gjenoppretting](https://render.com/docs/postgresql-backups)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play: Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en)

## Oppdatering 28. september 2026: iOS-app og App Store

TIKIT har nå en iOS-app (Capacitor, `ios/`) i tillegg til nettappen. Den er gjennomgått punkt for punkt mot Apples retningslinjer fra 8. juni 2026 (safaiyeh/app-store-review-skill). Rapporten står i [app-store/README.md](app-store/README.md).

| | Status |
| --- | --- |
| 1.2 Brukerskapt innhold (rapportering, blokkering, fjerning) | ✅ bygget og testet |
| 2.1 Innlogging for App Review | ✅ tilgangskode (av som standard) |
| 3.1.3(e) Betaling utenfor kjøp i appen | ✅ Vipps og kort, riktig for fysiske arrangementer |
| 4.8 Sign in with Apple | ✅ innebygd i appen |
| 5.1.1(v) Sletting av konto, med tilbakekalling hos Apple | ✅ |
| 5.1.2 Personvernmanifest og App Privacy | ✅ ingen sporing |
| 4.2 Minimum funksjonalitet | ⚠️ hybridapp. Push-varsler er neste steg hvis Apple avviser. |
| Kompilert i Xcode | ⚠️ ikke ennå (krever Mac) |

**Anbefaling for iOS:** GO for TestFlight når Xcode-bygget er gjort og testet på en ekte iPhone. GO for innsending når punktene i [app-store/README.md → Før du sender inn](app-store/README.md#før-du-sender-inn) er gjort.
