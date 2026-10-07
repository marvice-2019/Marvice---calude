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
COOLIFY_NETWORK="${COOLIFY_NETWORK:-coolify}"
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

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

if [ "$MODE" = coolify ]; then
  # Publish the way Coolify publishes its own apps: the container joins Coolify's
  # network and carries Traefik labels, which Coolify's proxy picks up from Docker.
  # (A route file in $COOLIFY_PROXY_DIR/dynamic was not picked up on marvice.tech.)
  docker network inspect "$COOLIFY_NETWORK" >/dev/null 2>&1 || {
    echo "Docker network '$COOLIFY_NETWORK' not found; set COOLIFY_NETWORK to Coolify's proxy network."
    exit 1
  }
  RESOLVER="$(docker inspect coolify-proxy --format '{{join .Config.Cmd " "}} {{join .Args " "}}' 2>/dev/null | \
    grep -o 'certificatesresolvers\.[A-Za-z0-9_-]*' | head -1 | cut -d. -f2)"
  RESOLVER="${RESOLVER:-letsencrypt}"
  rm -f "$COOLIFY_PROXY_DIR/dynamic/open-generative-ai.yaml"   # left by earlier versions of this script

  LABELS=(
    --label "traefik.enable=true"
    --label "traefik.docker.network=$COOLIFY_NETWORK"
    --label "traefik.http.services.ogai.loadbalancer.server.port=3000"
    --label "traefik.http.middlewares.ogai-https.redirectscheme.scheme=https"
    --label "traefik.http.routers.ogai-http.rule=Host(\`$DOMAIN\`)"
    --label "traefik.http.routers.ogai-http.entrypoints=http"
    --label "traefik.http.routers.ogai-http.middlewares=ogai-https"
    --label "traefik.http.routers.ogai-http.service=ogai"
    --label "traefik.http.routers.ogai.rule=Host(\`$DOMAIN\`)"
    --label "traefik.http.routers.ogai.entrypoints=https"
    --label "traefik.http.routers.ogai.tls=true"
    --label "traefik.http.routers.ogai.tls.certresolver=$RESOLVER"
    --label "traefik.http.routers.ogai.service=ogai"
  )
  if [ "$BASIC_AUTH" = on ]; then
    USERS="$(grep -v '^$' "$HTPASSWD_FILE" | paste -sd, -)"
    LABELS+=(
      --label "traefik.http.middlewares.ogai-auth.basicauth.users=$USERS"
      --label "traefik.http.middlewares.ogai-auth.basicauth.realm=Marvice AI Studio"
      --label "traefik.http.routers.ogai.middlewares=ogai-auth"
    )
  fi

  echo "==> Run container $CONTAINER on network $COOLIFY_NETWORK (cert resolver: $RESOLVER)"
  docker run -d --name "$CONTAINER" --restart unless-stopped \
    --network "$COOLIFY_NETWORK" "${LABELS[@]}" "$IMAGE"

  echo "==> Checking the route"
  CODE=000
  for _ in $(seq 1 30); do
    CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $DOMAIN" http://127.0.0.1/ || true)"
    case "$CODE" in 301|302|307|308) break ;; esac
    sleep 2
  done
  case "$CODE" in
    301|302|307|308) echo "  Coolify proxy routes $DOMAIN (HTTP $CODE -> https)" ;;
    *) echo "  WARNING: Coolify proxy answered HTTP $CODE for $DOMAIN, expected a redirect to https."
       echo "  Check: docker logs --tail 50 coolify-proxy" ;;
  esac
else
  echo "==> Run container $CONTAINER (127.0.0.1:$APP_PORT)"
  docker run -d --name "$CONTAINER" --restart unless-stopped \
    -p "127.0.0.1:$APP_PORT:3000" "$IMAGE"

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
