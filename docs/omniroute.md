# OmniRoute (AI-verktøy under utvikling)

**Kort sagt:** TIKIT-appen selv bruker ingen AI. Ingen del av serveren eller webappen kaller en språkmodell, så OmniRoute skal **ikke** kjøres sammen med appen på Render og trenger ingen nøkler i `render.yaml`.

OmniRoute er nyttig for **deg som utvikler** TIKIT: det er en gratis, åpen AI-gateway ([github.com/diegosouzapw/OmniRoute](https://github.com/diegosouzapw/OmniRoute)) som lar Claude Code, Cursor, Cline og lignende verktøy bruke mange modell-leverandører gjennom ett endepunkt, med automatisk reserve når en leverandør er nede eller kvoten er brukt opp.

## Oppsett på egen maskin

```bash
npm install -g omniroute
omniroute
```

- Dashbord og API på `http://localhost:20128` – OpenAI-kompatibelt endepunkt: `http://localhost:20128/v1`
- Alt settes opp i dashbordet: **Providers** (koble til leverandører med innlogging eller API-nøkkel) og **Endpoints** (lag en API-nøkkel som verktøyene dine bruker mot OmniRoute).
- Claude Code: `omniroute setup-claude` konfigurerer en profil automatisk. Andre verktøy: `omniroute setup-codex`, `setup-opencode`, `setup-continue`, `setup-aider`, eller bruk base-URL `http://localhost:20128/v1` + nøkkelen fra Endpoints.

## Sikkerhet

- Kjør OmniRoute lokalt (localhost). Ikke eksponer det mot internett uten innlogging foran.
- Legg aldri leverandørnøkler i TIKIT-repoet. De hører hjemme i OmniRoute-dashbordet på maskinen din.

## Hvis TIKIT en dag får AI-funksjoner

Da bør serveren kalle modellen via en egen, serverside-klient med nøkkel i en miljøvariabel, tidsavbrudd og en tydelig reserve når AI ikke svarer – aldri fra nettleseren. OmniRoute kan da stå mellom, men bare bak innlogging og ikke som en offentlig tjeneste.
