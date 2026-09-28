# App Privacy – svar i App Store Connect

*Må stemme med [`ios/App/App/PrivacyInfo.xcprivacy`](../../ios/App/App/PrivacyInfo.xcprivacy) og personvernerklæringen ([docs/juridisk/personvernerklaering.md](../juridisk/personvernerklaering.md)). Endrer du én av dem, endrer du alle tre.*

**Do you or your third-party partners collect data from this app?** Yes

**Tracking:** No. TIKIT kobler ikke data med andre selskapers data for reklame, og deler ikke data med datameglere. Derfor finnes det ingen ATT-dialog og ingen `NSUserTrackingUsageDescription`.

## Datatyper

Alle typene under er **Linked to the user**, **not used for tracking**, og har formålet **App Functionality**. Ingen brukes til Analytics, Advertising eller Product Personalization.

| Kategori i App Store Connect | Type | Hvorfor TIKIT har den |
| --- | --- | --- |
| Contact Info | Name | Navn på konto og billetter. Arrangøren får det. |
| Contact Info | Email Address | Innlogging, kvitteringer og overføringer |
| Contact Info | Phone Number | Fra Vipps og til Vipps-betaling |
| Contact Info | Other User Contact Info | Mottakerens e-post eller mobilnummer når en billett overføres |
| Identifiers | User ID | Konto-ID-en |
| Purchases | Purchase History | Bestillinger og kvitteringer (bokføringsloven) |
| User Content | Photos or Videos | Bilder arrangører laster opp til arrangementer |
| User Content | Other User Content | Rapporter om innhold, hilsen ved overføring |
| Sensitive Info | – | **Ikke kryss av.** Fødselsdato er ikke «sensitive» etter Apples definisjon. Den føres under Other Data. |
| Other Data | Other Data Types | Fødselsdato fra Vipps (aldersgrenser) |

**Ikke samlet inn:** Health & Fitness, Financial Info (kortnumre håndteres av Stripe og Vipps og kommer aldri til TIKIT), Location, Contacts, Browsing History, Search History, Usage Data, Diagnostics, Other Identifiers (IDFA).

> **Legger dere til Sentry, Firebase eller lignende senere**, kommer det nye typer (Crash Data, Performance Data, Product Interaction). Da må både manifestet, App Store Connect og personvernerklæringen oppdateres.

## Andre felt

- **Privacy Policy URL:** `https://<domene>/personvernerklaering`
- **User Privacy Choices URL** (valgfritt): `https://<domene>/profil/personvern`
