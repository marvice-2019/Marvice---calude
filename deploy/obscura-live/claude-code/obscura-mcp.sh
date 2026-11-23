#!/usr/bin/env bash
# Starts the browser MCP server for Claude Code against the private Obscura browser.
# Used by the "obscura" entry in the repo's .mcp.json, so it works in two places:
#  - Cloud sessions: reads OBSCURA_CDP_TOKEN from the environment (set it in the cloud environment's settings).
#  - Our own machines: if the variable is not set, uses ~/.config/obscura-mcp/config.json written by
#    setup-obscura-mcp.sh.
# stdout is the MCP protocol channel, so every message here goes to stderr.
set -euo pipefail

ENDPOINT="wss://browser.marvice.tech/devtools/browser"
LOCAL_CONFIG="${HOME}/.config/obscura-mcp/config.json"

if [ -n "${OBSCURA_CDP_TOKEN:-}" ]; then
  if [ "${#OBSCURA_CDP_TOKEN}" -lt 32 ]; then
    echo "obscura-mcp: OBSCURA_CDP_TOKEN is too short (expected at least 32 characters)." >&2
    exit 1
  fi
  RUN_DIR="$(mktemp -d "${TMPDIR:-/tmp}/obscura-mcp.XXXXXX")"
  chmod 700 "$RUN_DIR"
  # The generated config holds the token: remove it however this wrapper ends.
  trap 'rm -rf "$RUN_DIR"' EXIT
  trap 'exit 143' TERM
  trap 'exit 130' INT
  CONFIG="${RUN_DIR}/config.json"
  mkdir -p "${RUN_DIR}/output"
  ENDPOINT="$ENDPOINT" OUTPUT_DIR="${RUN_DIR}/output" node -e '
    const fs = require("fs");
    const config = {
      browser: {
        cdpEndpoint: process.env.ENDPOINT,
        cdpHeaders: { Authorization: `Bearer ${process.env.OBSCURA_CDP_TOKEN}` },
        cdpTimeout: 30000,
      },
      outputDir: process.env.OUTPUT_DIR,
    };
    fs.writeFileSync(process.argv[1], JSON.stringify(config), { mode: 0o600 });
  ' "$CONFIG"
elif [ -f "$LOCAL_CONFIG" ]; then
  CONFIG="$LOCAL_CONFIG"
else
  echo "obscura-mcp: no token. Set OBSCURA_CDP_TOKEN (cloud environment settings) or run" >&2
  echo "  bash deploy/obscura-live/claude-code/setup-obscura-mcp.sh   (on your own machine)" >&2
  exit 1
fi

# Not exec: the wrapper stays alive so its EXIT trap can delete the generated config.
npx -y @playwright/mcp@latest --config "$CONFIG"
