#!/usr/bin/env bash
# Install Open Generative AI, branded as Marvice AI Studio, on aistudio.marvice.tech (Ubuntu/Debian, Docker).
# Run as root:  sudo DOMAIN=aistudio.marvice.tech EMAIL=you@marvice.in bash install.sh
#
# Builds the app from https://github.com/Anil-matcha/Open-Generative-AI into a Docker
# image and runs it as container "open-generative-ai". If the server runs Coolify, the
# site is published through Coolify's Traefik proxy (which owns ports 80/443);
# otherwise nginx + certbot is used. Re-running the script pulls and redeploys.
set -euo pipefail

DOMAIN="${DOMAIN:-aistudio.marvice.tech}"
EMAIL="${EMAIL:-}"
APP_DIR="${APP_DIR:-/opt/Open-Generative-AI}"
APP_REPO="${APP_REPO:-https://github.com/Anil-matcha/Open-Generative-AI.git}"
APP_REF="${APP_REF:-main}"
APP_PORT="${APP_PORT:-3001}"
IMAGE="${IMAGE:-open-generative-ai:latest}"
CONTAINER="${CONTAINER:-open-generative-ai}"
BASIC_AUTH="${BASIC_AUTH:-on}"            # on | off
BASIC_AUTH_USER="${BASIC_AUTH_USER:-admin}"
COOLIFY_PROXY_DIR="${COOLIFY_PROXY_DIR:-/data/coolify/proxy}"
HTPASSWD_FILE=/etc/open-generative-ai/htpasswd
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)."; exit 1; }

MODE=nginx
if [ -d "$COOLIFY_PROXY_DIR" ]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx coolify-proxy && \
     docker inspect coolify-proxy --format '{{.Config.Image}}' | grep -qi traefik; then
    MODE=coolify
  else
    echo "Coolify detected but its proxy is not a running Traefik container (coolify-proxy)."
    echo "Switch the proxy to Traefik in Coolify (Servers > Proxy) or publish port $APP_PORT yourself."
    exit 1
  fi
fi
echo "==> Mode: $MODE"

echo "==> System packages"
apt-get update
apt-get install -y git curl ca-certificates apache2-utils
[ "$MODE" = nginx ] && apt-get install -y nginx certbot python3-certbot-nginx
if ! command -v docker >/dev/null; then
  echo "==> Docker"
  curl -fsSL https://get.docker.com | sh
fi

echo "==> Clone / update Open Generative AI ($APP_REF, with submodules)"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$APP_REF"
  git -C "$APP_DIR" checkout -q "$APP_REF"
  git -C "$APP_DIR" pull --ff-only origin "$APP_REF"
else
  git clone --branch "$APP_REF" "$APP_REPO" "$APP_DIR"
fi
git -C "$APP_DIR" submodule update --init --recursive

echo "==> Marvice AI Studio branding"
rm -rf "$APP_DIR/.marvice-brand"
cp -r "$HERE/brand" "$APP_DIR/.marvice-brand"

echo "==> Build image $IMAGE (npm install + next build, takes a few minutes)"
docker build -f "$HERE/Dockerfile" -t "$IMAGE" "$APP_DIR"

if [ "$MODE" = coolify ]; then
  # Traefik runs in Docker and reaches the host via host.docker.internal (the docker0
  # gateway). Publish the app there only, so it is not reachable from the internet directly.
  BIND_HOST="$(ip -4 addr show docker0 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1)"
  BIND_HOST="${BIND_HOST:-172.17.0.1}"
else
  BIND_HOST=127.0.0.1
fi

echo "==> Run container $CONTAINER ($BIND_HOST:$APP_PORT)"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" --restart unless-stopped \
  -p "$BIND_HOST:$APP_PORT:3000" "$IMAGE"

if [ "$BASIC_AUTH" = on ]; then
  echo "==> Basic auth"
  mkdir -p "$(dirname "$HTPASSWD_FILE")"
  if [ ! -s "$HTPASSWD_FILE" ]; then
    echo "Set a password for user '$BASIC_AUTH_USER' on https://$DOMAIN:"
    htpasswd -cB "$HTPASSWD_FILE" "$BASIC_AUTH_USER"
  fi
  chmod 640 "$HTPASSWD_FILE"
  [ "$MODE" = nginx ] && chgrp www-data "$HTPASSWD_FILE"
fi

if [ "$MODE" = coolify ]; then
  echo "==> Coolify Traefik route for $DOMAIN"
  if ! docker inspect coolify-proxy --format '{{range .HostConfig.ExtraHosts}}{{.}} {{end}}' | grep -q host.docker.internal; then
    echo "  WARNING: coolify-proxy has no host.docker.internal mapping; the route may 502."
  fi
  if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
    ufw allow from 172.16.0.0/12 to any port "$APP_PORT" proto tcp comment open-generative-ai
    ufw allow from 10.0.0.0/8 to any port "$APP_PORT" proto tcp comment open-generative-ai
  fi
  MIDDLEWARES="[]"
  AUTH_BLOCK=""
  if [ "$BASIC_AUTH" = on ]; then
    MIDDLEWARES="[ogai-auth]"
    USERS=""
    while IFS= read -r line; do [ -n "$line" ] && USERS="$USERS          - \"$line\""$'\n'; done < "$HTPASSWD_FILE"
    AUTH_BLOCK="    ogai-auth:
      basicAuth:
        realm: Marvice AI Studio
        users:
$USERS"
  fi
  mkdir -p "$COOLIFY_PROXY_DIR/dynamic"
  cat > "$COOLIFY_PROXY_DIR/dynamic/open-generative-ai.yaml" <<YAML
http:
  routers:
    ogai-http:
      rule: Host(\`$DOMAIN\`)
      entryPoints: [http]
      middlewares: [ogai-https]
      service: ogai
    ogai:
      rule: Host(\`$DOMAIN\`)
      entryPoints: [https]
      middlewares: $MIDDLEWARES
      service: ogai
      tls:
        certResolver: letsencrypt
  middlewares:
    ogai-https:
      redirectScheme:
        scheme: https
$AUTH_BLOCK  services:
    ogai:
      loadBalancer:
        servers:
          - url: "http://host.docker.internal:$APP_PORT"
YAML
  echo "  Wrote $COOLIFY_PROXY_DIR/dynamic/open-generative-ai.yaml (Traefik reloads it automatically)"
else
  echo "==> nginx for $DOMAIN"
  AUTH=""
  [ "$BASIC_AUTH" = on ] && AUTH="    auth_basic \"Marvice AI Studio\";
    auth_basic_user_file $HTPASSWD_FILE;"
  sed -e "s#@DOMAIN@#$DOMAIN#g" -e "s#@PORT@#$APP_PORT#g" "$HERE/nginx.conf" | \
    awk -v auth="$AUTH" '{ if ($0 == "@AUTH@") print auth; else print }' \
    > /etc/nginx/sites-available/open-generative-ai
  ln -sf /etc/nginx/sites-available/open-generative-ai /etc/nginx/sites-enabled/open-generative-ai
  nginx -t && systemctl reload nginx
  if [ -n "$EMAIL" ]; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
  else
    echo "  [skip] set EMAIL=... to obtain a Let's Encrypt certificate"
  fi
fi

echo "==> Done: https://$DOMAIN  (each user enters their own Muapi.ai API key in the app)"
