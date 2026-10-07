# HyperFrames Studio (https://github.com/heygen-com/hyperframes) for video.marvice.tech.
# Based on upstream packages/cli/src/docker/Dockerfile.render, plus the Studio preview server.
FROM node:22-bookworm-slim

ARG HYPERFRAMES_VERSION=0.8.140

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip ffmpeg chromium git \
    libgbm1 libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 \
    libxdamage1 libxrandr2 libcups2 libasound2 libpangocairo-1.0-0 \
    libxshmfence1 libgtk-3-0 \
    fonts-liberation fonts-noto-color-emoji fonts-noto-cjk fonts-noto-core \
    fonts-noto-extra fonts-noto-ui-core fonts-freefont-ttf fonts-dejavu-core \
    fontconfig \
    && rm -rf /var/lib/apt/lists/* && fc-cache -f

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CONTAINER=true \
    HYPERFRAMES_SKIP_SKILLS=1 \
    HYPERFRAMES_NO_TELEMETRY=1 \
    # The Studio server binds 127.0.0.1 by default; open it inside the container
    # so the Coolify proxy can reach it. Access control is done by the proxy.
    HYPERFRAMES_PREVIEW_HOST=0.0.0.0

# chrome-headless-shell enables deterministic BeginFrame rendering (amd64 VPS).
RUN npx --yes @puppeteer/browsers install chrome-headless-shell@stable --path /root/.cache/puppeteer \
    && npm install -g hyperframes@${HYPERFRAMES_VERSION} \
    && npm cache clean --force

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

WORKDIR /projects
VOLUME ["/projects"]
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD curl -fsS http://127.0.0.1:3002/ >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
