#!/bin/sh
set -e
: "${BASIC_AUTH_USER:?set BASIC_AUTH_USER}"
: "${BASIC_AUTH_PASSWORD:?set BASIC_AUTH_PASSWORD}"
BASIC_AUTH_HASH=$(caddy hash-password --plaintext "$BASIC_AUTH_PASSWORD")
export BASIC_AUTH_HASH
unset BASIC_AUTH_PASSWORD
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
