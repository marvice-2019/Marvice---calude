# OpenMotion (https://github.com/nexu-io/openmotion) for motion.marvice.tech.
# OpenMotion only answers on 127.0.0.1 with a localhost Host header, so socat
# exposes it inside the compose network and the auth gate rewrites Host/Origin.
FROM node:22-bookworm-slim

# Pinned upstream commit; bump to upgrade.
ARG OPENMOTION_REF=7f6397d56f8f5fed0644bc85229a54c075d27fc8

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git socat ffmpeg chromium \
    fonts-liberation fonts-noto-color-emoji fonts-noto-cjk fonts-noto-core fontconfig \
    && rm -rf /var/lib/apt/lists/* && fc-cache -f

WORKDIR /app
RUN git init -q . && git remote add origin https://github.com/nexu-io/openmotion.git \
    && git fetch -q --depth 1 origin "$OPENMOTION_REF" && git checkout -q FETCH_HEAD \
    && rm -rf .git && npm ci

# Rebrand as "Marvice | Motion" and make English the only UI language, then build the UI.
COPY openmotion/brand.mjs creator/public/marvice-logo.svg creator/public/marvice-mark.svg /brand/
RUN node /brand/brand.mjs /app /brand && npm run build:studio && npm cache clean --force

ENV NODE_ENV=production \
    PORT=4173 \
    MOTION_DATA_DIR=/data \
    MOTION_BROWSER_PATH=/usr/bin/chromium \
    HYPERFRAMES_BROWSER_PATH=/usr/bin/chromium \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CONTAINER=true \
    HYPERFRAMES_NO_TELEMETRY=1 \
    OPENMOTION_TELEMETRY=0 \
    DO_NOT_TRACK=1

COPY openmotion/entrypoint.sh /usr/local/bin/openmotion-entrypoint.sh
RUN chmod +x /usr/local/bin/openmotion-entrypoint.sh

VOLUME ["/data"]
EXPOSE 4180

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s \
  CMD curl -fsS -H "Host: localhost:4173" http://127.0.0.1:4173/ >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/openmotion-entrypoint.sh"]
