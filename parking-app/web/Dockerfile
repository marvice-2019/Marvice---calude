# syntax=docker/dockerfile:1.7
# Bayline web: Next.js standalone server. Multi-stage, non-root, health-checked.
ARG NODE_IMAGE=node:22.23.3-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca npm_config_cafile=/run/secrets/ca; fi; \
    npm ci --no-audit --no-fund

FROM deps AS build
# Build-time values: static pages bake these in. Staging builds with DEV_FAKE_PAY=1 (demo banner); production never.
ARG APP_ENV=production
ARG DEV_FAKE_PAY=0
ARG SITE_URL=http://localhost:3001
ENV APP_ENV=${APP_ENV} DEV_FAKE_PAY=${DEV_FAKE_PAY} SITE_URL=${SITE_URL} NEXT_TELEMETRY_DISABLED=1
COPY . .
# next/font downloads Google Fonts at build time and self-hosts them, so the running site makes no font requests.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm run build

FROM ${NODE_IMAGE} AS run
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
