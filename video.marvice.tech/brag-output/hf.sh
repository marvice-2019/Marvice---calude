#!/bin/sh
# Run the hyperframes CLI against brag-output/composition with the same browser
# setup as ../entrypoint.sh: point the renderer at a local Chrome headless shell
# when one exists instead of downloading one.
#
#   ./hf.sh lint          ./hf.sh check --json      ./hf.sh render -o ../brag.mp4
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
# Resolve the CLI: $HYPERFRAMES_BIN, a local install next to this script, a global
# install, else npx with the version this video was rendered with.
BIN="${HYPERFRAMES_BIN:-}"
[ -n "$BIN" ] || { [ -x "$HERE/node_modules/.bin/hyperframes" ] && BIN="$HERE/node_modules/.bin/hyperframes"; }
[ -n "$BIN" ] || BIN="$(command -v hyperframes || true)"
[ -n "$BIN" ] || BIN="npx --yes hyperframes@0.8.145"

export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_SKIP_SKILLS=1
if [ -z "$PRODUCER_HEADLESS_SHELL_PATH" ]; then
  for root in /root/.cache/puppeteer "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"; do
    p=$(find "$root" -maxdepth 4 -type f \( -name chrome-headless-shell -o -name headless_shell \) -perm -u+x 2>/dev/null | head -1)
    [ -n "$p" ] && export PRODUCER_HEADLESS_SHELL_PATH="$p" && break
  done
fi

cmd="$1"; shift
exec $BIN "$cmd" "$HERE/composition" "$@"
