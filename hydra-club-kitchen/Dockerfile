# syntax=docker/dockerfile:1.7
# Hydra Club & Kitchen: production image for Coolify (single VPS).
# Three stages: deps (full install) -> build (next build + bundled ops scripts) -> runtime (standalone, non-root).

ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
# Inlined into the bundle at build time (canonical URLs, sitemap, CSRF origin). Coolify passes it as a build arg.
ARG NEXT_PUBLIC_SITE_URL
RUN test -n "$NEXT_PUBLIC_SITE_URL" || (echo "NEXT_PUBLIC_SITE_URL build arg is required" && exit 1)
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build && node scripts/bundle-scripts.mjs

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 UPLOAD_DIR=/app/uploads
# Unprivileged user; the uploads volume is owned by it.
RUN groupadd --system --gid 1001 hydra && useradd --system --uid 1001 --gid hydra --no-create-home hydra \
 && mkdir -p /app/uploads && chown hydra:hydra /app/uploads
COPY --from=build --chown=hydra:hydra /app/.next/standalone ./
COPY --from=build --chown=hydra:hydra /app/.next/static ./.next/static
COPY --from=build --chown=hydra:hydra /app/public ./public
COPY --from=build --chown=hydra:hydra /app/drizzle ./drizzle
COPY --from=build --chown=hydra:hydra /app/dist-scripts ./scripts
COPY --chown=hydra:hydra docker-entrypoint.sh ./docker-entrypoint.sh
USER hydra
EXPOSE 3000
VOLUME ["/app/uploads"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
