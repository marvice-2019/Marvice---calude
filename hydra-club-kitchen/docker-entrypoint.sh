#!/bin/sh
# Container start: apply migrations, seed (idempotent, never overwrites staff edits), then run the server.
# A failed migration stops the container, so Coolify keeps the previous version serving traffic.
set -eu
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${AUTH_SECRET:?AUTH_SECRET is required}"
node scripts/migrate.mjs
node scripts/seed.mjs
exec node server.js
