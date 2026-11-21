#!/usr/bin/env bash
# Prints a self-contained Dockerfile (source embedded as heredocs) for Coolify's
# "Dockerfile" build pack, which builds without access to this repository.
# Usage: bash build-inline-dockerfile.sh > /tmp/Dockerfile.inline
set -euo pipefail
cd "$(dirname "$0")"

for f in package.json server.mjs; do
  if grep -qx 'OBSCURA_EOF' "$f"; then echo "$f contains the heredoc delimiter" >&2; exit 1; fi
done

cat <<'HEADER'
# syntax=docker/dockerfile:1
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
HEADER
echo "COPY <<'OBSCURA_EOF' /app/package.json"
cat package.json
echo "OBSCURA_EOF"
cat <<'MID'
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
MID
echo "COPY <<'OBSCURA_EOF' /app/server.mjs"
cat server.mjs
echo "OBSCURA_EOF"
cat <<'FOOTER'
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server.mjs"]
FOOTER
