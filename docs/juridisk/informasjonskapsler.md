# Informasjonskapsler og lokal lagring i TIKIT

*Sist oppdatert 24. september 2026.*

TIKIT bruker bare lagring som er **strengt nødvendig** for å levere tjenesten du selv ber om: innlogging, kjøp, billetter som virker uten nett, og skanneren i døra. Det er unntatt fra samtykkekravet i ekomloven § 3-15, og derfor viser vi ikke et samtykkebanner. Vi bruker ingen sporing, statistikk eller annonser, og ingen tredjepartskapsler.

## Informasjonskapsler

| Navn | Hva den gjør | Varighet |
| --- | --- | --- |
| `tikit_sid` | Holder deg innlogget. Kan ikke leses av JavaScript, sendes bare over HTTPS. | 30 dager uten bruk |
| `tikit_oauth` | Beskytter innloggingen mens du er innom Vipps, Google eller Apple. | 10 minutter |

## Lagring i nettleseren (localStorage og sessionStorage)

| Nøkkel | Hva den gjør |
| --- | --- |
| `tikit-city` | Byen du har valgt |
| `tikit-unlock` | Tilgangskoder du har skrevet inn for skjulte billetter |
| `tikit-clock-offset` | Forskjellen mellom klokka på telefonen og serveren, slik at QR-koden blir riktig |
| `tikit.lastUser` | Hvem som sist var innlogget, slik at lagrede billetter fjernes hvis en annen logger inn på samme telefon |
| `tikit-gate`, `tikit-scan-sound` | Innstillinger i dørskanneren (inngang og lyd) |
| `tikit.scanQueue.*` | Innsjekk gjort uten nett i skanneren. Slettes når fanen lukkes eller når de er synkronisert. |

## Frakoblet lagring (service worker)

| Lager | Hva det inneholder | Varighet |
| --- | --- | --- |
| Appfilene | Selve appen, så den åpner raskt og virker uten nett | Til neste versjon |
| `tikit-images` | Plakatbilder for arrangementer | 30 dager |
| `tikit-tickets` | Billettene dine og hvem som er innlogget, så billetten kan vises i døra uten nett | 14 dager. Slettes når du logger ut eller en annen logger inn. |

Du kan slette alt dette i nettleserens innstillinger (nettstedsdata). Da blir du logget ut, og billetter som er lagret for bruk uten nett, forsvinner til du åpner appen med nett igjen.
