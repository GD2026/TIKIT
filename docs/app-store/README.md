# TIKIT i App Store – gjennomgang mot Apples retningslinjer

*28. september 2026. Gjennomgått mot [safaiyeh/app-store-review-skill](https://github.com/safaiyeh/app-store-review-skill) v1.3.2, som dekker Apples App Review Guidelines fra 8. juni 2026 (kontrollert som gjeldende 29. august 2026). Skillen ligger også i repoet under [`.claude/skills/app-store-review/`](../../.claude/skills/app-store-review/SKILL.md), så Claude Code bruker den automatisk ved neste gjennomgang.*

## Kort fortalt

| | |
| --- | --- |
| **Klar for innsending** | Koden: ja. Alt som kunne løses i koden, er løst og testet. |
| **Gjenstår før innsending** | Bare ting du må gjøre i Apple Developer og App Store Connect – se [Før du sender inn](#før-du-sender-inn). |
| **Største risiko** | 4.2 (minimum funksjonalitet): appen er en hybridapp (React i WKWebView). Den har ekte native funksjoner, men anmeldere kan være strenge. Se [4.2](#42-minimum-funksjonalitet). |
| **Ikke testet** | Selve iOS-bygget i Xcode. Swift-koden er skrevet og gjennomgått, men kan ikke kompileres på Linux der dette ble laget. Første bygg på en Mac kan gi små kompileringsfeil. Se [docs/ios.md](../ios.md). |

**Forutsetning:** Før dette var TIKIT bare en nettapp (PWA). Nå finnes det også en iOS-app i `ios/`, bygget med Capacitor 8. Det er samme React-kode som på nettsiden, men pakket inn i appen, og med egen Swift-kode for innlogging, nøkkelring og «Logg på med Apple». Appen laster **ikke** nettsiden. Alle skjermene ligger i appen, og den henter bare data fra serveren.

## Hva som ble endret for å oppfylle kravene

| Retningslinje | Problem før | Løsning | Hvor |
| --- | --- | --- | --- |
| 1.2 Brukerskapt innhold | Arrangører publiserer innhold, men ingen kunne rapportere eller blokkere | «Rapporter» på arrangement og arrangør, «Skjul arrangøren for meg», admin-kø med «Skjul arrangementet» og «Steng arrangøren», e-post til `SUPPORT_EMAIL` ved hver rapport, revisjonslogg | `src/server/services/moderation.ts`, `src/web/components/moderation/`, `src/web/admin/Reports.tsx` |
| 1.2 Vilkår | Ingen regler for innhold | Innholdsregler i kjøpsvilkårene og i Hjelp → Trygghet | `src/web/screens/Legal.tsx`, `Help.tsx`, `docs/juridisk/` |
| 2.1 Demokonto | Bare innlogging med Vipps, Google eller Apple, uten passord | Tilgangskode for App Review (`REVIEW_LOGIN_*`). Vises bare mens den er slått på, er aldri admin og blir logget i revisjonsloggen | `src/server/routes/nativeAuth.ts` |
| 2.3.10 Andre plattformer | Hjelp nevnte Android og «Installer app» | Skjult i iOS-appen. Google Wallet er skjult i appen. | `Help.tsx`, `TicketDetail.tsx` |
| 2.5.2 Egen kode | – | Appen har all kode i bundlen, uten nedlasting av kode og uten fjern-URL | `vite.config.ts` (mode `native`), `capacitor.config.ts` |
| 3.1.3(e) Betaling | – | Billetter er tjenester som brukes utenfor appen, så de skal betales med Vipps eller kort, ikke med kjøp i appen. Vipps åpnes i Vipps-appen, kort i Safari-ark | `src/web/native/payments.ts` |
| 4.8 Innlogging | Apple fantes bare som nettinnlogging | Innebygd «Logg på med Apple» (AuthenticationServices), like synlig som Google | `ios/App/App/TikitNativePlugin.swift`, `src/node/integrations/apple/native.ts` |
| 4.8 / Google | Google avviser innlogging i appens egen web view | Innlogging i `ASWebAuthenticationSession`, med engangskode tilbake til appen | `src/web/native/auth.ts`, `src/server/services/nativeAuth.ts` |
| 5.1.1(i) Personvern | Erklæringen dekket ikke appen | Oppdatert: nøkkelring, kamera, rapporter, Apple-nøkkel, Supabase | `Legal.tsx`, `docs/juridisk/` |
| 5.1.1(ii) Tillatelser | – | Én tillatelse: kamera, med konkret forklaring på norsk | `ios/App/App/Info.plist` |
| 5.1.1(v) Sletting av konto | Fantes, men uten tilbakekalling hos Apple | Apple-tilgangen trekkes tilbake ved sletting (Apples REST API) | `src/server/services/users.ts` |
| 5.1.2 / personvernmanifest | – | `PrivacyInfo.xcprivacy`: ingen sporing, datatyper og API-grunner (UserDefaults CA92.1, filtidspunkter C617.1) | `ios/App/App/PrivacyInfo.xcprivacy` |
| 1.6 Datasikkerhet | – | Økten ligger i nøkkelringen (bare denne enheten). Apple-nøkkelen er kryptert i databasen. Ingen hemmeligheter i appen. | `TikitNativePlugin.swift`, `src/server/services/sealed.ts` |

## Seksjon for seksjon

Tegn: ✅ oppfylt · ⚠️ krever noe av deg · ➖ gjelder ikke TIKIT

### 1. Sikkerhet

| Punkt | Status | Vurdering |
| --- | --- | --- |
| 1.1 Støtende innhold | ✅ | Bare godkjente arrangører kan publisere. Innholdsregler står i vilkårene, og admin kan fjerne innhold. |
| 1.2 Brukerskapt innhold | ✅ ⚠️ | Filtrering skjer ved at arrangører godkjennes på forhånd. Rapportering, blokkering, kontaktinfo og fjerning er på plass. **Du må:** sette `SUPPORT_EMAIL` og faktisk behandle rapporter innen 24 timer (Admin → Rapporter). |
| 1.2.1(a) Aldersgrenser | ✅ | Arrangementer har aldersgrense, og alder kan bekreftes med Vipps (Folkeregisteret). |
| 1.3 Barnekategori | ➖ | Ikke i Kids-kategorien. |
| 1.4.3 Rusmidler | ✅ | Appen oppfordrer ikke til alkohol. Vilkårene forbyr innhold som oppfordrer til skadelig bruk. Demobildene viser ingen alkohol. |
| 1.5 Utviklerinfo | ⚠️ | Kontakt står i Hjelp. **Du må:** legge inn Support URL (for eksempel `https://tikit.no/hjelp`) i App Store Connect. |
| 1.6 Datasikkerhet | ✅ | HTTPS, nøkkelring, hash-lagrede økter, ingen nøkler i appen. |

### 2. Ytelse

| Punkt | Status | Vurdering |
| --- | --- | --- |
| 2.1 Ferdig app | ✅ ⚠️ | Ingen plassholdertekst, og demopanelet vises bare i demomodus. **Du må:** ha produksjonsserveren oppe og slå på App Review-tilgangen under gjennomgangen (se [review-notes.md](review-notes.md)). |
| 2.1(b) Kjøp i appen | ➖ | Ingen kjøp i appen. |
| 2.2 Beta | ⚠️ | Test med TestFlight før innsending. |
| 2.3 Metadata | ⚠️ | Utkast i [metadata.md](metadata.md). Skjermbildene må vise appen i bruk (lag dem i simulatoren). |
| 2.3.6 Aldersgrense og sosiale medier | ⚠️ | Svarene står i [metadata.md](metadata.md#aldersgrense). TIKIT har ingen sosial feed, så svaret på spørsmålet om sosiale medier er «nei». |
| 2.3.10 Andre plattformer | ✅ | Android og Google Wallet er skjult i appen. «Google» står bare som innloggingsvalg. |
| 2.4.1 iPad | ⚠️ | Appen kjører på iPad (`TARGETED_DEVICE_FAMILY = 1,2`) og tilpasser seg bredden. **Du må:** teste på iPad-simulator. App Review tester på iPad Air 11" og iPhone 17 Pro Max. |
| 2.5.1 Offentlige API-er | ✅ | Bare Capacitor, AuthenticationServices, Security og CryptoKit. |
| 2.5.2 Kode i bundlen | ✅ | Ingen fjern-URL i web view og ingen OTA-oppdateringer. Nye versjoner går gjennom App Review. |
| 2.5.4 Bakgrunnsmoduser | ✅ | Ingen. |
| 2.5.5 IPv6 | ✅ | Bare vertsnavn. |
| 2.5.6 WebKit | ✅ | WKWebView og ASWebAuthenticationSession. |
| 2.5.14 Opptak | ✅ | Kameraet brukes bare synlig i dørskanneren og når man tar bilde til et arrangement. |

### 3. Forretning

| Punkt | Status | Vurdering |
| --- | --- | --- |
| 3.1.1 Kjøp i appen | ✅ | Ikke påkrevd, og skal heller ikke brukes (se 3.1.3(e)). |
| 3.1.3(e) Varer og tjenester utenfor appen | ✅ | Billetter til fysiske arrangementer, servicegebyr, videresalg og refusjon betales med Vipps eller kort. Det er riktig etter Apples regler. |
| 3.2.2(x) Tvungne vurderinger | ✅ | Appen ber aldri om vurdering. |

### 4. Design

| Punkt | Status | Vurdering |
| --- | --- | --- |
| 4.1 Kopier | ✅ | Egen merkevare, eget navn og ikon. Designet følger HIG uten å kopiere Apples apper. |
| 4.2 Minimum funksjonalitet | ⚠️ | Se under. |
| 4.2.3 Selvstendig | ✅ | Virker uten Vipps-appen (da åpnes Vipps i Safari). |
| 4.5.4 Push-varsler | ➖ | Ikke i versjon 1. |
| 4.8 Innloggingstjenester | ✅ | Innebygd «Logg på med Apple» ved siden av Google og Vipps. |
| 4.9 Apple Pay | ➖ | Ikke direkte (Stripe kan vise Apple Pay på sin egen side). |

#### 4.2 Minimum funksjonalitet

Dette er den reelle risikoen for en hybridapp. Det som taler for TIKIT:

- Alle skjermene ligger i appen. Appen er ikke en innpakket nettside.
- Billetten virker uten nett: den levende QR-koden lages på telefonen, og billettene lagres i appen.
- Dørskanner med kamera, lyd og lommelykt. Den virker uten nett og synkroniserer etterpå.
- Innebygd «Logg på med Apple», innloggingen i nøkkelringen og haptisk respons.
- Deleark, kalender via delearket og universal links for arrangementer og overføringer.
- En tjeneste med verdi over tid: kjøp, overføring, videresalg, refusjon og kø.

**Hvis Apple likevel avviser for 4.2:** legg til push-varsler for billettslipp og påminnelser, som er det vanligste neste steget for en billettapp, og/eller Apple Wallet-kort. Begge er beskrevet som neste steg i [docs/ios.md](../ios.md#neste-steg). Svar i Resolution Center med listen over.

### 5. Juss

| Punkt | Status | Vurdering |
| --- | --- | --- |
| 5.1.1(i) Personvernerklæring | ✅ ⚠️ | Den ligger i appen (`/personvernerklaering`) og dekker appen. **Du må:** legge inn Privacy Policy URL i App Store Connect og fylle inn [hakeparentesene] i `docs/juridisk/`. |
| 5.1.1(ii) Samtykke og formålstekster | ✅ | Bare kameraet, og teksten er konkret. |
| 5.1.1(v) Sletting av konto | ✅ | Profil → Personvern og data → Slett kontoen. Apple-tilgangen trekkes tilbake. *Merk:* sletting stoppes hvis man har gyldige billetter til kommende arrangementer. Billettene kan da overføres eller refunderes i appen først. Dette er forklart i review-notatene. |
| 5.1.1(ix) Regulerte felt | ✅ ⚠️ | Ikke et regulert felt, men appen samler inn fødselsdato. **Anbefaling:** publiser under en organisasjonskonto (Din Russetid AS, D-U-N-S-nummer), ikke en personlig konto. |
| 5.1.2 Deling av data og ATT | ✅ | Ingen sporing, ingen annonser og ingen analyse, og derfor ingen ATT-dialog. Svarene til App Privacy står i [app-privacy.md](app-privacy.md). |
| 5.2 Opphavsrett | ✅ ⚠️ | Egne ikoner og egne bilder (Higgsfield). Knappene for Vipps, Google og Apple følger merkevarereglene. Sjekk Vipps-knappen mot Vipps' designretningslinjer. |
| 5.3 Spill og lotteri | ✅ | Loddtrekningen i køen er gratis rekkefølge, uten innsats og uten premie. Det er ikke lotteri. Forklart i review-notatene. |
| 5.6.1 Vurderinger | ✅ | Ingen egne vurderingsdialoger. |

## Før du sender inn

1. **Apple Developer Program** som organisasjon (Din Russetid AS).
2. **App ID** `no.tikit.app` (eller din egen) med *Sign in with Apple* og *Associated Domains*. Legg bundle ID-en i `APPLE_BUNDLE_IDS`.
3. **Serveren i produksjon** med `PUBLIC_URL`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` og `APPLE_BUNDLE_IDS`. Sjekk at `https://<domene>/.well-known/apple-app-site-association` svarer.
4. `npm run ios:configure` og `npm run ios`. Bygg, test på iPhone og iPad, og last opp til TestFlight. Se [docs/ios.md](../ios.md).
5. **App Store Connect:** metadata, skjermbilder, aldersgrense og App Privacy etter [metadata.md](metadata.md) og [app-privacy.md](app-privacy.md). Privacy Policy URL og Support URL.
6. **App Review-tilgang:** sett `REVIEW_LOGIN_EMAIL` og `REVIEW_LOGIN_CODE`, gjør kontoen klar (se [review-notes.md](review-notes.md)), og lim inn notatene.
7. Etter godkjenning: tøm `REVIEW_LOGIN_CODE`.
