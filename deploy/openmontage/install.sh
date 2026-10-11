#!/usr/bin/env bash
# Install OpenMontage on aivideo.marvice.tech (Ubuntu/Debian).
# Run as root:  sudo DOMAIN=aivideo.marvice.tech EMAIL=you@marvice.in bash install.sh
#
# If the server runs Coolify, the Backlot board is published through Coolify's
# Traefik proxy (which owns ports 80/443). Otherwise nginx + certbot is used.
set -euo pipefail

DOMAIN="${DOMAIN:-aivideo.marvice.tech}"
EMAIL="${EMAIL:-}"
OM_USER="${OM_USER:-openmontage}"
OM_DIR="${OM_DIR:-/opt/OpenMontage}"
OM_REPO="${OM_REPO:-https://github.com/calesthio/OpenMontage.git}"
BACKLOT_PORT="${BACKLOT_PORT:-4750}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-admin}"
COOLIFY_PROXY_DIR="${COOLIFY_PROXY_DIR:-/data/coolify/proxy}"
HTPASSWD_FILE=/etc/openmontage/htpasswd
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)."; exit 1; }

MODE=nginx
if [ -d "$COOLIFY_PROXY_DIR" ]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx coolify-proxy && \
     docker inspect coolify-proxy --format '{{.Config.Image}}' | grep -qi traefik; then
    MODE=coolify
  else
    echo "Coolify detected but its proxy is not a running Traefik container (coolify-proxy)."
    echo "Switch the proxy to Traefik in Coolify (Servers > Proxy) or publish port $BACKLOT_PORT yourself."
    exit 1
  fi
fi
echo "==> Mode: $MODE"

echo "==> System packages"
apt-get update
apt-get install -y git make ffmpeg python3 python3-venv python3-pip curl ca-certificates apache2-utils
[ "$MODE" = nginx ] && apt-get install -y nginx certbot python3-certbot-nginx

if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 22 ]; then
  echo "==> Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Chromium libs needed by Remotion / HyperFrames headless rendering
apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 || \
apt-get install -y libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
  libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64

echo "==> Service user"
id "$OM_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$OM_USER"

echo "==> Clone / update OpenMontage"
if [ -d "$OM_DIR/.git" ]; then
  sudo -u "$OM_USER" git -C "$OM_DIR" pull --ff-only
else
  mkdir -p "$OM_DIR" && chown "$OM_USER:$OM_USER" "$OM_DIR"
  sudo -u "$OM_USER" git clone "$OM_REPO" "$OM_DIR"
fi

echo "==> make setup (Python venv, Remotion, Piper TTS, HyperFrames)"
sudo -u "$OM_USER" -H bash -c "cd '$OM_DIR' && make setup"

echo "==> Basic auth"
mkdir -p "$(dirname "$HTPASSWD_FILE")"
if [ ! -s "$HTPASSWD_FILE" ]; then
  echo "Set a password for Backlot user '$BASIC_AUTH_USER':"
  htpasswd -cB "$HTPASSWD_FILE" "$BASIC_AUTH_USER"
fi
chmod 640 "$HTPASSWD_FILE"
[ "$MODE" = nginx ] && chgrp www-data "$HTPASSWD_FILE"

if [ "$MODE" = coolify ]; then
  # Traefik runs in Docker and reaches the host via host.docker.internal (the docker0
  # gateway). Bind Backlot there only, so it is not reachable from the internet directly.
  BIND_HOST="$(ip -4 addr show docker0 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1)"
  BIND_HOST="${BIND_HOST:-172.17.0.1}"
else
  BIND_HOST=127.0.0.1
fi

echo "==> Backlot systemd service ($BIND_HOST:$BACKLOT_PORT)"
sed -e "s#@OM_USER@#$OM_USER#g" -e "s#@OM_DIR@#$OM_DIR#g" \
    -e "s#@HOST@#$BIND_HOST#g" -e "s#@PORT@#$BACKLOT_PORT#g" \
  "$HERE/backlot.service" > /etc/systemd/system/openmontage-backlot.service
systemctl daemon-reload
systemctl enable openmontage-backlot
systemctl restart openmontage-backlot

if [ "$MODE" = coolify ]; then
  echo "==> Coolify Traefik route for $DOMAIN"
  if ! docker inspect coolify-proxy --format '{{range .HostConfig.ExtraHosts}}{{.}} {{end}}' | grep -q host.docker.internal; then
    echo "  WARNING: coolify-proxy has no host.docker.internal mapping; the route may 502."
  fi
  USERS=""
  while IFS= read -r line; do [ -n "$line" ] && USERS="$USERS          - \"$line\""$'\n'; done < "$HTPASSWD_FILE"
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow from 172.16.0.0/12 to any port "$BACKLOT_PORT" proto tcp comment openmontage-backlot
    ufw allow from 10.0.0.0/8 to any port "$BACKLOT_PORT" proto tcp comment openmontage-backlot
  fi
  mkdir -p "$COOLIFY_PROXY_DIR/dynamic"
  cat > "$COOLIFY_PROXY_DIR/dynamic/openmontage.yaml" <<YAML
http:
  routers:
    openmontage-http:
      rule: Host(\`$DOMAIN\`)
      entryPoints: [http]
      middlewares: [openmontage-https]
      service: openmontage
    openmontage:
      rule: Host(\`$DOMAIN\`)
      entryPoints: [https]
      middlewares: [openmontage-auth]
      service: openmontage
      tls:
        certResolver: letsencrypt
  middlewares:
    openmontage-https:
      redirectScheme:
        scheme: https
    openmontage-auth:
      basicAuth:
        users:
$USERS  services:
    openmontage:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:$BACKLOT_PORT"
YAML
  echo "  Wrote $COOLIFY_PROXY_DIR/dynamic/openmontage.yaml (Traefik reloads it automatically)"
else
  echo "==> nginx for $DOMAIN"
  sed -e "s#@DOMAIN@#$DOMAIN#g" -e "s#@PORT@#$BACKLOT_PORT#g" -e "s#@HTPASSWD@#$HTPASSWD_FILE#g" \
    "$HERE/nginx.conf" > /etc/nginx/sites-available/openmontage
  ln -sf /etc/nginx/sites-available/openmontage /etc/nginx/sites-enabled/openmontage
  nginx -t && systemctl reload nginx
  if [ -n "$EMAIL" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
  else
    echo "  [skip] set EMAIL=... to obtain a Let's Encrypt certificate"
  fi
fi

echo
echo "Done."
echo "  Code:     $OM_DIR   (add API keys to $OM_DIR/.env — all optional)"
echo "  Backlot:  https://$DOMAIN   (user: $BASIC_AUTH_USER)"
echo "  Make a video: sudo -iu $OM_USER, cd $OM_DIR, run 'claude' and describe the video."
