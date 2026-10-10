#!/bin/sh
# Run the hyperframes CLI against brag-output/composition with the same browser
# setup as ../entrypoint.sh: point the renderer at a local Chrome headless shell
# when one exists instead of downloading one.
#
#   ./hf.sh lint          ./hf.sh check --json      ./hf.sh render -o ../brag.mp4
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
BIN="${HYPERFRAMES_BIN:-$(command -v hyperframes || true)}"
if [ -z "$BIN" ]; then
  for c in "$HERE/node_modules/.bin/hyperframes" /tmp/claude-0/*/*/scratchpad/hf-probe/node_modules/.bin/hyperframes; do
    [ -x "$c" ] && BIN="$c" && break
  done
fi
[ -n "$BIN" ] || { echo "hyperframes CLI not found; npm install hyperframes" >&2; exit 1; }

export HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_SKIP_SKILLS=1
if [ -z "$PRODUCER_HEADLESS_SHELL_PATH" ]; then
  for root in /root/.cache/puppeteer "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"; do
    p=$(find "$root" -maxdepth 4 -type f \( -name chrome-headless-shell -o -name headless_shell \) -perm -u+x 2>/dev/null | head -1)
    [ -n "$p" ] && export PRODUCER_HEADLESS_SHELL_PATH="$p" && break
  done
fi

cmd="$1"; shift
exec "$BIN" "$cmd" "$HERE/composition" "$@"
