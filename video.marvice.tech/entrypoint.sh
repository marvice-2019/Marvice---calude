#!/bin/sh
set -e

PROJECT="${HYPERFRAMES_PROJECT:-studio}"

SHELL_PATH=$(find /root/.cache/puppeteer -name chrome-headless-shell -type f 2>/dev/null | head -1)
[ -n "$SHELL_PATH" ] && export PRODUCER_HEADLESS_SHELL_PATH="$SHELL_PATH"

# `creator` runs the prompt-to-video service instead of Studio.
if [ "$1" = "creator" ]; then
  exec node /app/creator/server.mjs
fi

# First boot: scaffold a project in the persistent volume.
if [ ! -d "/projects/$PROJECT" ]; then
  hyperframes init "$PROJECT" --non-interactive
fi

exec hyperframes preview "/projects/$PROJECT" --port 3002 --no-open --foreground
