# App Review – tilgang og notater

Apple må kunne logge inn og prøve appen. TIKIT har ikke passord, og en anmelder i USA kan ikke bruke Vipps. Derfor finnes det en **tilgangskode** som logger inn på én bestemt testkonto. Den er av som standard.

## 1. Gjør testkontoen klar (én gang, før innsending)

1. Lag en kode: `openssl rand -hex 12`.
2. Sett på serveren (Render → Environment):
   - `REVIEW_LOGIN_EMAIL=appreview@ditt-domene.no` (en adresse dere eier, men ikke en admin-adresse)
   - `REVIEW_LOGIN_CODE=<koden>`
3. Logg inn med koden én gang selv, i appen eller på nettsiden («Logg inn med tilgangskode» nederst i innloggingen). Da opprettes kontoen «App Review».
4. Gi kontoen noe å se på, med funksjonene som allerede finnes:
   - **Billetter:** Som arrangør: åpne et arrangement → Deltakere → **Gjestebilletter** → send 2 billetter til `appreview@…`.
   - **Arrangørverktøy og dørskanner:** Arrangørpanelet → **Team** → inviter `appreview@…` som *Dørvakt/ansatt* (eller *Administrator* hvis Apple skal se salgstall).
   - **Gratis arrangement** (valgfritt): da kan anmelderen gå gjennom hele kjøpsflyten uten å betale.
5. Kjør `npm run doctor`. Den viser «App Review-tilgang: PÅ».

**Etter godkjenning:** tøm `REVIEW_LOGIN_CODE` på serveren. Kontoen blir liggende, men ingen kan logge inn på den.

Sikkerhet: koden logger bare inn på denne ene kontoen. Kontoen kan aldri være plattformadmin (serveren avviser det). Forsøkene er begrenset til 5 per 10 minutter, og hver innlogging skrives i revisjonsloggen.

## 2. Tekst til «App Review Information» i App Store Connect

**Sign-in required:** Yes
**User name:** `appreview@ditt-domene.no`
**Password:** `<koden>` *(skriv i notatene at det er en tilgangskode, ikke et passord)*

**Notes** – lim inn og fyll inn:

```
TIKIT is a ticketing app for student ("russ") events in Norway: buyers find events, buy tickets and show a live QR ticket at the door; organizers sell tickets and check guests in with the phone camera.

HOW TO SIGN IN
Real users sign in with Vipps (Norway's national payment/ID app), Sign in with Apple or Google. For review, tap "Profil" → "Logg inn med tilgangskode" (bottom of the sign-in sheet) and enter this code: <CODE>. This signs in to a test account that already has tickets and access to an organizer account. Sign in with Apple also works and creates a new, empty account.

WHAT TO LOOK AT
- Billetter (Tickets): the live ticket. The QR code is generated on the device and changes every 15 seconds; it works offline.
- Profil → the organizer ("Arrangør") → Skanner: the door scanner uses the camera to check tickets in.
- Any event page → "Rapporter arrangementet" (report); organizer page → "Skjul arrangøren for meg" (block). Reports go to our moderation queue and support e-mail; we handle them within 24 hours (Guideline 1.2).
- Profil → Personvern og data → Slett kontoen (account deletion, 5.1.1(v)). If the account holds valid tickets for upcoming events, the app asks the user to transfer or refund them first – they are paid goods for a real-world event. Everything else is deleted immediately, and Sign in with Apple tokens are revoked.

PAYMENTS (3.1.3(e))
Tickets are for real-world events and are paid with Vipps or card (Stripe Checkout), not In-App Purchase. Vipps opens the Vipps app; cards open in a Safari sheet. A reviewer outside Norway cannot complete a Vipps payment; please use a free event, or the tickets already on the test account.

QUEUE DRAW (5.3)
For big ticket drops, people who join the queue before sales open get a random place in line. It is free, has no stake and no prize – only the order in the queue.

PERMISSIONS
Camera only, when the door scanner is opened or when an organizer takes a picture for an event. No tracking, no ads, no analytics.
```

## 3. Hvis Apple avviser

| Begrunnelse | Svar / tiltak |
| --- | --- |
| 4.2 «web wrapper» | Vis til listen i [README.md → 4.2](README.md#42-minimum-funksjonalitet). Hvis det ikke holder: push-varsler for billettslipp (se [docs/ios.md](../ios.md#neste-steg)). |
| 2.1 «kunne ikke logge inn» | Sjekk at `REVIEW_LOGIN_CODE` er satt og at serveren er oppe (`/healthz`). Koden må limes inn uten mellomrom. |
| 5.1.1(v) «sletting krever ekstra steg» | Forklar at billettene er betalte tjenester for et fysisk arrangement og kan overføres eller refunderes i appen. Alternativt: la sletting kansellere gjenværende billetter (endring i `deleteAccount` i `src/server/services/users.ts`). |
| 3.1.1 «bruk kjøp i appen» | Vis til 3.1.3(e): billetter til fysiske arrangementer skal ikke selges med kjøp i appen. |
