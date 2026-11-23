#!/usr/bin/env bash
# Prints a self-contained Dockerfile (source embedded as heredocs) for Coolify's
# "Dockerfile" build pack, which builds without access to this repository.
# It mirrors ./Dockerfile; keep the two in step.
# Usage: bash build-inline-dockerfile.sh > /tmp/Dockerfile.inline
set -euo pipefail
cd "$(dirname "$0")"

FILES=(package.json package-lock.json server.mjs)
for f in "${FILES[@]}"; do
  if grep -qx 'OBSCURA_EOF' "$f"; then echo "$f contains the heredoc delimiter" >&2; exit 1; fi
done

embed() {
  echo "COPY <<'OBSCURA_EOF' /app/$1"
  cat "$1"
  echo "OBSCURA_EOF"
}

cat <<'HEADER'
# syntax=docker/dockerfile:1
FROM node:22-alpine@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a
WORKDIR /app
ENV NODE_ENV=production
HEADER
embed package.json
embed package-lock.json
echo "RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force"
embed server.mjs
cat <<'FOOTER'
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.mjs"]
FOOTER
