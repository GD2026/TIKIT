# Personvern – intern protokoll for TIKIT

*Internt dokument for Din Russetid AS (ikke for publisering). Sist oppdatert 24. september 2026.*

Dette er protokollen over behandlingsaktiviteter (GDPR art. 30), listen over leverandører det må inngås avtale med, og rutinen ved avvik. Hold den oppdatert når noe endres.

## 1. Behandlingsaktiviteter

| Behandling | Registrerte | Opplysninger | Grunnlag | Mottakere | Lagringstid |
| --- | --- | --- | --- | --- | --- |
| Konto og innlogging | Kjøpere, arrangører, dørvakter | Navn, e-post, mobil, fødselsdato (Vipps), innloggings-ID, økt | Avtale | Render, Cloudflare | Til kontoen slettes; økt 30 dager |
| Billettkjøp og betaling | Kjøpere | Bestilling, beløp, rabattkode, betalingsreferanse | Avtale; bokføringsloven | Arrangør, Vipps, Stripe | 5 år etter regnskapsåret, deretter anonymisert |
| Billetter, overføring, videresalg | Kjøpere, mottakere | Navn på billett, mottakers e-post/mobil, hilsen | Avtale | Arrangør, mottaker | Navn 1 år etter arrangement; kontaktinfo 90 dager |
| Aldersgrenser og adgang | Billettinnehavere | Fødselsdato, innsjekk (tid, inngang, dørvakt) | Avtale; arrangørens plikt | Arrangør, dørvakter | Innsjekk 1 år etter arrangement |
| Kø, venteliste, salgsvarsler | Kjøpere | Bruker-ID, køplass | Avtale | – | 30 dager etter arrangement |
| E-post (kvitteringer, overføringer, varsler) | Kjøpere, mottakere | E-post, innhold | Avtale; samtykke for tips | Resend | Ikke lagret hos TIKIT utover varsler (1 år) |
| Misbruk og sikkerhet | Alle | IP (kortvarig i minnet), logger, revisjonslogg | Berettiget interesse | Render | Revisjonslogg 5 år; serverlogg etter Renders plan |
| Arrangører og utbetaling | Arrangører | Organisasjon, team, kontonummer | Avtale | – | Så lenge arrangøren er aktiv + bokføringstid |
| Moderering (rapporter, skjulte arrangører) | Alle som rapporterer; kjøpere | Grunn, beskrivelse, bruker-ID (hvis innlogget); hvilke arrangører en person har skjult | Berettiget interesse (trygg tjeneste); avtale | Plattformadmin, support-e-post | Rapporter 1 år etter behandling; skjulte arrangører til de vises igjen eller kontoen slettes |
| iOS-appen | Brukere av appen | Innloggingsøkt i nøkkelringen på enheten, frakoblede billetter i appen | Avtale | – (bare på enheten) | Til utlogging |
| Lommebok-kort (Apple/Google Wallet) | Kjøpere som legger billetten i lommeboken | Navn på billett, billettnummer, arrangement, fast QR-kode | Avtale (kjøperen ber om kortet) | Google (bare ved Google Lommebok); Apple-kort lagres bare på enheten | TIKIT lagrer ingenting nytt; kortet utløper 6 timer etter arrangementet |
| Apple-innlogging (tilbakekalling) | Brukere som logger inn med Apple | Kryptert tilgangsnøkkel fra Apple | Rettslig/avtale (Apples krav om tilbakekalling ved sletting) | Apple (ved sletting) | Til kontoen slettes |

Slettingen i tabellen skjer automatisk hver dag (`src/server/services/retention.ts`). Endrer du en periode, må du også endre personvernerklæringen.

## 2. Leverandører: avtaler som må være på plass før ekte salg

| Leverandør | Rolle | Hva de får | Må gjøres |
| --- | --- | --- | --- |
| Render (USA, servere i Frankfurt) | Databehandler | Alle data (drift) | Godta Renders databehandleravtale (DPA) |
| Cloudflare (via Render) | Underleverandør hos Render | Trafikk, IP | Dekkes av Renders DPA – kontroller underleverandørlisten |
| Supabase (hvis den brukes som database; servere i Frankfurt) | Databehandler | Alle data (database) | Godta Supabase sin DPA (supabase.com/legal/dpa); sjekk underleverandører og overføringsgrunnlag |
| Apple (App Store) | Selvstendig ansvarlig | Nedlasting av appen, App Store-statistikk | Apple Developer Program-avtalen |
| Resend (USA) | Databehandler | E-postadresser og e-postinnhold | Godta Resends DPA; sjekk overføringsgrunnlaget (DPF/SCC) |
| Vipps MobilePay | Selvstendig ansvarlig | Innlogging og betaling | Avtale om nettbetaling og innlogging |
| Stripe (hvis kort) | Selvstendig ansvarlig for betalingsdata | Kortbetaling | Stripe-avtale |
| Google, Apple | Selvstendig ansvarlige | Innlogging | Følg deres vilkår for innlogging |
| Google (Google Wallet API, hvis den brukes) | Selvstendig ansvarlig for kortet i brukerens Google-konto | Navn, billettnummer, arrangement og QR-kode når kjøperen velger Google Lommebok | Godta vilkårene for Google Pay & Wallet Console og API-et |
| Arrangører | Selvstendig ansvarlige for egne deltakere | Deltakerlister | **Arrangøravtale** med personvernklausul – mangler, må lages |

## 3. Vurderinger

- **Personvernombud:** trolig ikke påkrevd. Kjernevirksomheten er ikke stor-skala overvåking eller særlige kategorier, men vurder på nytt hvis volumet blir stort.
- **DPIA:** tjenesten brukes av mange unge og behandler bekreftet alder. En enkel risikovurdering (DPIA-lignende) anbefales før lansering.
- **Særlige kategorier:** ingen.

## 4. Rutine ved avvik (brudd på personopplysningssikkerheten)

1. Stopp lekkasjen: roter nøkler (`SESSION_SECRET` logger ut alle), steng tilgang, slå av funksjonen.
2. Finn ut hva som skjedde, hvilke data og hvor mange som er rammet. Loggen og revisjonsloggen (`audit`) er utgangspunktet.
3. Meld til Datatilsynet innen 72 timer hvis det ikke er usannsynlig at bruddet gir risiko for de registrerte (Altinn-skjema).
4. Varsle de berørte uten ugrunnet opphold hvis det er sannsynlig høy risiko.
5. Dokumenter bruddet internt, også de som ikke meldes.

## 5. Forespørsler fra brukere

- **Innsyn og dataportabilitet:** brukeren laster ned selv (Profil → Personvern og data).
- **Sletting:** brukeren sletter selv. Bestillinger anonymiseres, og salgsdokumentasjonen beholdes.
- **Retting av Vipps-bekreftet navn eller fødselsdato:** skjer via Vipps/Folkeregisteret.
- **Andre henvendelser:** til support-e-posten. Svarfrist én måned.
