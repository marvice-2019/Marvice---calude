#!/usr/bin/env bash
# Install OpenMontage on aivideo.marvice.tech (Ubuntu/Debian).
# Run as root:  sudo DOMAIN=aivideo.marvice.tech EMAIL=you@marvice.in bash install.sh
set -euo pipefail

DOMAIN="${DOMAIN:-aivideo.marvice.tech}"
EMAIL="${EMAIL:-}"
OM_USER="${OM_USER:-openmontage}"
OM_DIR="${OM_DIR:-/opt/OpenMontage}"
OM_REPO="${OM_REPO:-https://github.com/calesthio/OpenMontage.git}"
BACKLOT_PORT="${BACKLOT_PORT:-4750}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-admin}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)."; exit 1; }

echo "==> System packages"
apt-get update
apt-get install -y git make ffmpeg python3 python3-venv python3-pip curl ca-certificates \
  nginx apache2-utils certbot python3-certbot-nginx

if ! command -v node >/dev/null || [ "$(node -v | sed 's/v\([0-9]*\).*/\1/')" -lt 18 ]; then
  echo "==> Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
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

echo "==> Backlot systemd service (127.0.0.1:$BACKLOT_PORT)"
sed -e "s#@OM_USER@#$OM_USER#g" -e "s#@OM_DIR@#$OM_DIR#g" -e "s#@PORT@#$BACKLOT_PORT#g" \
  "$HERE/backlot.service" > /etc/systemd/system/openmontage-backlot.service
systemctl daemon-reload
systemctl enable --now openmontage-backlot

echo "==> nginx + basic auth for $DOMAIN"
if [ ! -f /etc/nginx/.htpasswd-openmontage ]; then
  echo "Set a password for Backlot user '$BASIC_AUTH_USER':"
  htpasswd -c /etc/nginx/.htpasswd-openmontage "$BASIC_AUTH_USER"
fi
sed -e "s#@DOMAIN@#$DOMAIN#g" -e "s#@PORT@#$BACKLOT_PORT#g" \
  "$HERE/nginx.conf" > /etc/nginx/sites-available/openmontage
ln -sf /etc/nginx/sites-available/openmontage /etc/nginx/sites-enabled/openmontage
nginx -t && systemctl reload nginx

echo "==> TLS"
if [ -n "$EMAIL" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect
else
  echo "  [skip] set EMAIL=... to obtain a Let's Encrypt certificate (DNS must point here)"
fi

echo
echo "Done."
echo "  Code:     $OM_DIR   (add API keys to $OM_DIR/.env — all optional)"
echo "  Backlot:  https://$DOMAIN   (user: $BASIC_AUTH_USER)"
echo "  Make a video: sudo -iu $OM_USER, cd $OM_DIR, run 'claude' and describe the video."
