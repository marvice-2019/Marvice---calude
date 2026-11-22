#!/usr/bin/env bash
# Connects Claude Code on this machine to the private Obscura browser at browser.marvice.tech.
# Claude Code gets browser tools (navigate, click, type, snapshot, screenshot, ...) through the
# Playwright MCP server, which drives Obscura over CDP via the Obscura gateway, so every session
# also appears in the live view at https://live.browser.marvice.tech.
#
# Usage (macOS or Linux, needs Node 18+ and Claude Code):
#   OBSCURA_CDP_TOKEN=... bash setup-obscura-mcp.sh     # or run it and paste the token when asked
# The token is in Coolify -> project obscura -> obscura-live-gateway -> Environment Variables.
set -euo pipefail

ENDPOINT="wss://browser.marvice.tech/devtools/browser"
CONFIG_DIR="${HOME}/.config/obscura-mcp"
CONFIG_FILE="${CONFIG_DIR}/config.json"
OUTPUT_DIR="${CONFIG_DIR}/output"

command -v claude >/dev/null || { echo "Claude Code (the 'claude' command) is not installed." >&2; exit 1; }
command -v npx >/dev/null || { echo "Node.js (npx) is not installed." >&2; exit 1; }

TOKEN="${OBSCURA_CDP_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  read -r -s -p "Paste the Obscura CDP token: " TOKEN
  echo
fi
if [ "${#TOKEN}" -lt 32 ]; then
  echo "That token is too short (expected at least 32 characters)." >&2
  exit 1
fi

# Check the token before writing or registering anything.
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${TOKEN}" https://browser.marvice.tech/json/version || true)
if [ "$CODE" != "200" ]; then
  echo "browser.marvice.tech answered ${CODE} for this token (expected 200). Check the token and try again." >&2
  exit 1
fi
echo "Token accepted by browser.marvice.tech."

# The config file holds the token, so only this user may read it.
mkdir -p "$OUTPUT_DIR"
chmod 700 "$CONFIG_DIR"
umask 077
TOKEN="$TOKEN" ENDPOINT="$ENDPOINT" OUTPUT_DIR="$OUTPUT_DIR" node -e '
  const fs = require("fs");
  const config = {
    browser: {
      cdpEndpoint: process.env.ENDPOINT,
      cdpHeaders: { Authorization: `Bearer ${process.env.TOKEN}` },
      cdpTimeout: 30000,
    },
    outputDir: process.env.OUTPUT_DIR,
  };
  fs.writeFileSync(process.argv[1], JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
' "$CONFIG_FILE"
echo "Wrote ${CONFIG_FILE} (readable only by you)."

# Register for every project on this machine (user scope). Re-running replaces the old entry.
claude mcp remove obscura --scope user >/dev/null 2>&1 || true
claude mcp add obscura --scope user -- npx -y @playwright/mcp@latest --config "$CONFIG_FILE"

echo
echo "Done. Start a new Claude Code session and run /mcp: 'obscura' should be listed as connected."
echo "Try: \"Use the obscura browser to open example.com and tell me the page title.\""
echo "Watch it live at https://live.browser.marvice.tech"
