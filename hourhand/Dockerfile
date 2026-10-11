# Hourhand production image for Coolify (build pack: Dockerfile, base directory: /hourhand).
# One container runs the web server and the background jobs (emails, calendar sync, payment checks).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Migrations run on every deploy before the server starts; re-running applies nothing. A failed migration stops the deploy.
CMD ["sh", "-c", "node scripts/migrate.ts && exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT}"]
