#!/bin/bash
# Installs npm dependencies when a Claude Code on the web session starts,
# so typecheck, lint and tests work right away. Does nothing locally.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# Playwright browsers are preinstalled in the web container; don't download them.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# npm install (not npm ci) so the cached container state is reused between sessions.
npm install --no-audit --no-fund --loglevel=error
