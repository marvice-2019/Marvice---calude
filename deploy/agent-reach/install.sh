#!/usr/bin/env bash
# Agent Reach + Claude Code installer for an Ubuntu/Debian Coolify VPS.
# Run as root:  bash deploy/agent-reach/install.sh
# Safe to re-run: every step checks before it changes anything.
set -euo pipefail

AGENT_USER="${AGENT_USER:-agent}"           # dedicated non-root user
RUN_SYSTEM="${RUN_SYSTEM:-yes}"             # "no" = only check, don't let Agent Reach install its deps/skill
AGENT_REACH_SRC="https://github.com/Panniantong/agent-reach/archive/main.zip"

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[fail] %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo -i first)."
command -v apt-get >/dev/null || die "This script supports Ubuntu/Debian (apt) only."

log "1/6 System packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip git curl ca-certificates >/dev/null
apt-get install -y -qq gh >/dev/null 2>&1 || warn "gh CLI not in apt repos; Agent Reach GitHub channel will report it missing."

python3 - <<'PY' || die "Python 3.10+ required; this server has an older python3."
import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)
PY

node_major=0
command -v node >/dev/null && node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 18 )); then
  log "Installing Node.js 22 (found major version: ${node_major})"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "python $(python3 -V | cut -d' ' -f2), node $(node -v)"

log "2/6 Dedicated user: ${AGENT_USER}"
if id "$AGENT_USER" >/dev/null 2>&1; then
  echo "User exists, reusing it."
else
  adduser --disabled-password --gecos "" "$AGENT_USER" >/dev/null
  echo "Created ${AGENT_USER} (no password, no sudo)."
fi

log "3-6/6 Installing as ${AGENT_USER}"
su - "$AGENT_USER" -s /bin/bash -c "SRC='$AGENT_REACH_SRC' RUN_SYSTEM='$RUN_SYSTEM' bash -s" <<'AS_AGENT'
set -euo pipefail
VENV="$HOME/.agent-reach-venv"

echo "--> 3/6 Agent Reach into $VENV"
[[ -d "$VENV" ]] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q --upgrade "$SRC"
grep -qF "$VENV/bin/activate" "$HOME/.bashrc" || echo "source $VENV/bin/activate" >> "$HOME/.bashrc"
grep -qF '.local/bin' "$HOME/.bashrc" || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
export PATH="$VENV/bin:$HOME/.local/bin:$PATH"

echo "--> 4/6 Claude Code (official installer, user-level)"
if command -v claude >/dev/null; then
  echo "Already installed: $(claude --version 2>/dev/null || echo unknown version)"
else
  curl -fsSL https://claude.ai/install.sh | bash
fi

echo "--> 5/6 Agent Reach setup"
agent-reach install --env=auto --dry-run
if [[ "$RUN_SYSTEM" == "yes" ]]; then
  agent-reach install --env=auto --system
else
  agent-reach install --env=auto
  echo "RUN_SYSTEM=no: skipped dependency + skill install."
fi

echo "--> 6/6 Locking down credentials file"
mkdir -p "$HOME/.agent-reach" && chmod 700 "$HOME/.agent-reach"
[[ -f "$HOME/.agent-reach/config.yaml" ]] && chmod 600 "$HOME/.agent-reach/config.yaml"

echo
echo "=================== agent-reach doctor ==================="
agent-reach doctor || true   # red channels are expected until cookies/proxy are added
AS_AGENT

log "Done"
cat <<EOF
Next:
  su - ${AGENT_USER}
  claude                         # sign in to Claude Code once
  agent-reach configure proxy    # recommended on a VPS (datacenter IPs get blocked)
  agent-reach doctor             # paste this output back for a fix list
EOF
