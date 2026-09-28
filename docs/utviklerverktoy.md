# Utviklerverktøy (Claude Code og MCP)

TIKIT bruker ingen AI i selve appen. Disse verktøyene er for deg som utvikler.

## Claude Code i dette repoet

- **`CLAUDE.md`** (i roten) leses automatisk: kommandoer, arkitektur og regler.
- **`/fortsett`** (`.claude/commands/fortsett.md`): leser status, kjører kontrollene og foreslår neste steg.
- **App Store-skillen** (`.claude/skills/app-store-review/`): Apples App Review Guidelines, brukt til gjennomgangen i [app-store/README.md](app-store/README.md). Be Claude om «gå gjennom appen mot App Store-reglene» før hver innsending.
- **Oppstartshook** (`.claude/hooks/session-start.sh`, registrert i `.claude/settings.json`): kjører `npm install` når en Claude Code-økt starter på nett, slik at typecheck, lint og tester virker med en gang. Lokalt gjør den ingenting. Den virker for nye økter når den er flettet inn i standardgrenen.

## Obscura (hodeløs nettleser som MCP)

[Obscura](https://agentpedia.codes/blog/obscura-headless-browser-guide) er en hodeløs nettleser skrevet i Rust, med innebygd MCP-server. Claude kan bruke den til å lese nettsider, fylle ut skjemaer og ta skjermbilder, for eksempel for å sjekke Vipps-, Apple- eller Supabase-dokumentasjon, eller for å prøve TIKIT i drift.

1. Last ned Obscura (release for macOS) og legg binærfila et fast sted, for eksempel `~/bin/obscura`.
2. Legg den til i Claude Code (én gang per maskin):
   ```bash
   claude mcp add obscura ~/bin/obscura mcp
   ```
3. Start Claude Code på nytt i mappen og sjekk med `/mcp` at `obscura` er tilkoblet.

> Dette kan ikke gjøres fra Claude Code på nettet: der går all trafikk gjennom en proxy som bare slipper til godkjente domener, og MCP-servere kan ikke startes på maskinen din derfra.

## Higgsfield (bilder og video)

Demobildene til arrangementene er laget med Higgsfield (`z_image`), i prosjektet **«TIKIT – demobilder»** på kontoen din. Lenkene står i [`assets/demo-events/manifest.json`](../assets/demo-events/manifest.json).

```bash
npm run demo:images      # laster ned bildene til assets/demo-events/*.jpg (én gang, på din maskin)
rm -rf data && npm run dev   # demodataene lages på nytt med bildene
```

Legg bildene i git når de er lastet ned (`git add assets/demo-events/*.jpg`). Da får Render-demoen dem også.

Nye bilder lager du ved å be Claude med Higgsfield-tilkoblingen om det, og legge lenken inn i manifestet med arrangementets `slug`. Gratisplanen hos Higgsfield har bare noen modeller (for eksempel `z_image`). `gpt_image_2_5` og video krever betalt plan.

**Om App Store:** skjermbilder og forhåndsvisningsvideoer i App Store må vise **selve appen** (retningslinje 2.3.3 og 2.3.4), ikke AI-genererte scener. Higgsfield passer til demodata, sosiale medier og markedsføring utenfor App Store.

## OmniRoute

AI-gateway for egne utviklerverktøy: [omniroute.md](omniroute.md).
