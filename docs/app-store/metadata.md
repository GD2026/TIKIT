# Metadata til App Store Connect

*Utkast. Følger 2.3 (nøyaktig metadata): ingen priser i navn eller undertittel, ingen andre plattformer, ingen varemerker vi ikke eier.*

## Grunninfo

| Felt | Forslag |
| --- | --- |
| Navn (maks 30) | `TIKIT – billetter` |
| Undertittel (maks 30) | `Russetreff, fester og revyer` |
| Primærkategori | Entertainment |
| Sekundærkategori | Lifestyle |
| Bundle ID | `no.tikit.app` (samme som `APPLE_BUNDLE_IDS`) |
| SKU | `tikit-ios-1` |
| Språk | Norsk bokmål (primær) |
| Pris | Gratis |
| Tilgjengelighet | Norge (Vipps og innholdet er norsk) |
| Support URL | `https://<domene>/hjelp` |
| Marketing URL | `https://<domene>` |
| Privacy Policy URL | `https://<domene>/personvernerklaering` |
| Copyright | `2026 Din Russetid AS` |

## Beskrivelse

```
TIKIT er billettappen for russetreff, fester, busslanseringer og revyer.

KJØP PÅ SEKUNDER
Finn arrangementer i byen din, kjøp med Vipps eller kort, og ha billetten klar i appen med en gang. Ved store billettslipp står du i en rettferdig digital kø.

LEVENDE BILLETT
QR-koden fornyes hvert 15. sekund og lages på telefonen – et skjermbilde virker ikke, men billetten virker uten nett i køen.

GI BORT ELLER SELG VIDERE
Send billetten til en venn med en lenke, eller legg den ut for videresalg i TIKIT – aldri over det du betalte.

TRYGT
Bare godkjente arrangører kan selge billetter. Alder bekreftes med Vipps. Du kan rapportere et arrangement og skjule arrangører du ikke vil se.

FOR ARRANGØRER
Lag arrangementet, sett opp billettyper, følg salget og sjekk inn gjestene med kameraet i døra – også uten nett.
```

**Nøkkelord (maks 100 tegn):** `billett,russ,russetreff,fest,revy,busslansering,konsert,arrangement,kø,billettslipp`

**Hva er nytt (versjon 1.0):** `Første versjon av TIKIT for iPhone og iPad.`

## Skjermbilder

Apple krever bilder av appen i bruk (2.3.3), ikke bare tittelbilder:

- 6,9" iPhone (1320 × 2868) – påkrevd
- 13" iPad (2064 × 2752) – påkrevd siden appen støtter iPad

Forslag til rekkefølge: 1) Utforsk, 2) Arrangementsside, 3) Levende billett, 4) Kø ved billettslipp, 5) Overføring, 6) Dørskanner.

Ta dem i simulatoren med demodata (`DEMO_MODE=true` på en testserver, og `npm run demo:images` for bildene), eller med Playwright mot `npm run dev` i riktig størrelse. Bruk bare fiktive personer (2.3.9). Demopersonene «Emma Hansen» og andre er oppdiktet.

## Aldersgrense

Svar ærlig i spørreskjemaet (2.3.6). Forslag, ut fra det appen faktisk viser:

| Spørsmål | Svar | Hvorfor |
| --- | --- | --- |
| Alkohol, tobakk og narkotika – referanser | *Infrequent/Mild* | Arrangørers beskrivelser av fester kan nevne det. Appen viser eller oppfordrer ikke. |
| Seksuelt innhold, vold, banning | None | Forbudt i vilkårene og modereres |
| Brukerskapt innhold | Yes | Arrangementer fra arrangører (forhåndsgodkjent og moderert) |
| Meldinger og chat | No | – |
| **Sosiale medier** (påkrevd fra september 2026) | **No** | Ingen feed der brukere deler, forsterker eller samhandler med andres innhold. Arrangementslisten er kuratert, og å følge en arrangør gir bare varsler om nye arrangementer. |
| Ubegrenset nettilgang | No | Lenker åpnes i Safari-ark |
| Gambling / konkurranser | No | Loddtrekningen i køen er ikke gambling (se [review-notes.md](review-notes.md)) |

Det gir sannsynligvis **13+** (eller 16+, avhengig av hvordan Apple vekter alkoholreferanser). Mange arrangementer har 18-årsgrense, men den håndheves per arrangement i appen, ikke av aldersgrensen i App Store.
