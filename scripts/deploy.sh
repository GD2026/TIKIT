#!/usr/bin/env bash
# Sjekker at alt er klart før utrulling: samme kontroller som CI, i riktig rekkefølge.
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }

command -v node >/dev/null || { echo "Node.js mangler (https://nodejs.org)"; exit 1; }
echo "Node $(node -v) · npm $(npm -v)"

step "Installerer avhengigheter (npm ci)"
npm ci --no-audit --no-fund

step "Typer"
npm run typecheck

step "Lint"
npm run lint

step "Enhets- og API-tester (minnelager)"
npm test

step "API-tester mot SQL-lageret (PGlite)"
npm run test:sql

step "Bygger"
npm run build

step "Ende-til-ende-tester (Playwright, mot bygget over)"
npx playwright install chromium >/dev/null
npm run test:e2e

printf '\n\033[1;32m✓ Alt grønt.\033[0m Push til main – Render bygger og ruller ut automatisk.\n'
echo "Oppsett og nøkler: docs/oppsett.md · Drift: docs/drift.md"
