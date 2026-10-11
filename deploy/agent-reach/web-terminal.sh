#!/usr/bin/env bash
# Browser terminal for the Agent Reach user at https://agent.marvice.tech.
# Run as root AFTER install.sh:  sudo bash deploy/agent-reach/web-terminal.sh
#
# ttyd serves a tmux session as the non-root agent user, bound to the docker0
# gateway only. Coolify's Traefik publishes it with Let's Encrypt, basic auth
# and a rate limit. Safe to re-run.
set -euo pipefail

DOMAIN="${DOMAIN:-agent.marvice.tech}"
AGENT_USER="${AGENT_USER:-agent}"
TTYD_PORT="${TTYD_PORT:-7681}"
TTYD_VERSION="${TTYD_VERSION:-1.7.7}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-admin}"
ALLOW_IPS="${ALLOW_IPS:-}"                  # optional, e.g. "203.0.113.4/32,198.51.100.0/24"
COOLIFY_PROXY_DIR="${COOLIFY_PROXY_DIR:-/data/coolify/proxy}"
HTPASSWD_FILE=/etc/agent-reach/htpasswd
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

die() { printf '\033[1;31m[fail] %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (sudo)."
id "$AGENT_USER" >/dev/null 2>&1 || die "User '$AGENT_USER' not found. Run install.sh first."
docker ps --format '{{.Names}}' 2>/dev/null | grep -qx coolify-proxy && \
  docker inspect coolify-proxy --format '{{.Config.Image}}' | grep -qi traefik || \
  die "Coolify's Traefik proxy (coolify-proxy) is not running. This script only supports Coolify servers."

echo "==> Packages"
apt-get update -qq
apt-get install -y -qq tmux apache2-utils curl ca-certificates >/dev/null

echo "==> ttyd $TTYD_VERSION"
case "$(uname -m)" in
  x86_64)  ARCH=x86_64 ;;
  aarch64) ARCH=aarch64 ;;
  *) die "Unsupported CPU: $(uname -m)" ;;
esac
if ! /usr/local/bin/ttyd --version 2>/dev/null | grep -q "$TTYD_VERSION"; then
  BASE="https://github.com/tsl0922/ttyd/releases/download/$TTYD_VERSION"
  TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
  curl -fsSL -o "$TMP/ttyd.$ARCH" "$BASE/ttyd.$ARCH"
  if curl -fsSL -o "$TMP/SHA256SUMS" "$BASE/SHA256SUMS"; then
    (cd "$TMP" && grep " ttyd.$ARCH\$" SHA256SUMS | sha256sum -c -) || die "ttyd checksum mismatch."
  else
    echo "  [warn] no SHA256SUMS published for $TTYD_VERSION; skipping checksum check"
  fi
  install -m 755 "$TMP/ttyd.$ARCH" /usr/local/bin/ttyd
fi
/usr/local/bin/ttyd --version

echo "==> Basic auth"
mkdir -p "$(dirname "$HTPASSWD_FILE")"
if [ ! -s "$HTPASSWD_FILE" ]; then
  echo "Set a strong password (16+ characters) for web terminal user '$BASIC_AUTH_USER':"
  htpasswd -cB "$HTPASSWD_FILE" "$BASIC_AUTH_USER"
fi
chmod 600 "$HTPASSWD_FILE"

# Traefik runs in Docker and reaches the host via host.docker.internal (the docker0
# gateway). Binding there keeps ttyd off the public interface.
BIND_HOST="$(ip -4 addr show docker0 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1)"
BIND_HOST="${BIND_HOST:-172.17.0.1}"
AGENT_HOME="$(getent passwd "$AGENT_USER" | cut -d: -f6)"

echo "==> systemd service agent-terminal ($BIND_HOST:$TTYD_PORT)"
sed -e "s#@AGENT_USER@#$AGENT_USER#g" -e "s#@AGENT_HOME@#$AGENT_HOME#g" \
    -e "s#@HOST@#$BIND_HOST#g" -e "s#@PORT@#$TTYD_PORT#g" -e "s#@DOMAIN@#$DOMAIN#g" \
  "$HERE/ttyd.service" > /etc/systemd/system/agent-terminal.service
systemctl daemon-reload
systemctl enable -q agent-terminal
systemctl restart agent-terminal

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow from 172.16.0.0/12 to any port "$TTYD_PORT" proto tcp comment agent-terminal >/dev/null
  ufw allow from 10.0.0.0/8 to any port "$TTYD_PORT" proto tcp comment agent-terminal >/dev/null
fi

echo "==> Coolify Traefik route for $DOMAIN"
docker inspect coolify-proxy --format '{{range .HostConfig.ExtraHosts}}{{.}} {{end}}' | grep -q host.docker.internal || \
  echo "  [warn] coolify-proxy has no host.docker.internal mapping; the route may 502."
USERS=""
while IFS= read -r line; do [ -n "$line" ] && USERS="$USERS          - \"$line\""$'\n'; done < "$HTPASSWD_FILE"
MIDDLEWARES="agent-terminal-ratelimit, agent-terminal-auth"
IPALLOW=""
if [ -n "$ALLOW_IPS" ]; then
  MIDDLEWARES="agent-terminal-ipallow, $MIDDLEWARES"
  IPALLOW="    agent-terminal-ipallow:
      ipAllowList:
        sourceRange:"$'\n'
  IFS=',' read -ra RANGES <<< "$ALLOW_IPS"
  for r in "${RANGES[@]}"; do IPALLOW="$IPALLOW          - \"${r// /}\""$'\n'; done
fi
mkdir -p "$COOLIFY_PROXY_DIR/dynamic"
cat > "$COOLIFY_PROXY_DIR/dynamic/agent-terminal.yaml" <<YAML
http:
  routers:
    agent-terminal-http:
      rule: Host(\`$DOMAIN\`)
      entryPoints: [http]
      middlewares: [agent-terminal-https]
      service: agent-terminal
    agent-terminal:
      rule: Host(\`$DOMAIN\`)
      entryPoints: [https]
      middlewares: [$MIDDLEWARES]
      service: agent-terminal
      tls:
        certResolver: letsencrypt
  middlewares:
    agent-terminal-https:
      redirectScheme:
        scheme: https
    agent-terminal-ratelimit:
      rateLimit:
        average: 10
        burst: 20
$IPALLOW    agent-terminal-auth:
      basicAuth:
        users:
$USERS  services:
    agent-terminal:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:$TTYD_PORT"
YAML
chmod 600 "$COOLIFY_PROXY_DIR/dynamic/agent-terminal.yaml"
echo "  Wrote $COOLIFY_PROXY_DIR/dynamic/agent-terminal.yaml (Traefik reloads it automatically)"

sleep 2
systemctl is-active -q agent-terminal || die "agent-terminal failed to start: journalctl -u agent-terminal -n 50"

echo
echo "Done."
echo "  Open:  https://$DOMAIN   (user: $BASIC_AUTH_USER)"
echo "  Needs: DNS A record $DOMAIN -> this server's IP"
echo "  The terminal runs as '$AGENT_USER' (no sudo) in tmux session 'main';"
echo "  closing the browser keeps it running, reopening reattaches."
echo "  Change password: htpasswd -B $HTPASSWD_FILE $BASIC_AUTH_USER, then re-run this script."
echo "  Turn off:        systemctl disable --now agent-terminal && rm $COOLIFY_PROXY_DIR/dynamic/agent-terminal.yaml"
