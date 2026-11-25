# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
# Public values are compiled into the browser bundle, so they are build arguments.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_NAME=Converse
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3100 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3100/login >/dev/null || exit 1
CMD ["node", "server.js"]
