# OpenMontage + Backlot board, deployable on Coolify (or any Docker host).
ARG BASE_IMAGE=python:3.12-slim-bookworm
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS node

FROM ${BASE_IMAGE}

ARG OPENMONTAGE_REPO=https://github.com/calesthio/OpenMontage.git
ARG OPENMONTAGE_REF=main

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    BACKLOT_PORT=4750

# Node.js 22 from the official image
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && node --version && npm --version

# FFmpeg, git and the Chromium libs Remotion/HyperFrames need for headless rendering
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl git make ffmpeg \
        libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 \
        libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone --depth 1 --branch "$OPENMONTAGE_REF" "$OPENMONTAGE_REPO" /app

RUN pip install -r requirements.txt \
    && (pip install piper-tts || echo "piper-tts unavailable; cloud TTS only") \
    && cd remotion-composer && npm install && npm cache clean --force \
    && (npx --yes hyperframes --version || true) \
    && npm install -g @anthropic-ai/claude-code \
    && cp -n /app/.env.example /app/.env

COPY auth_app.py /app/auth_app.py

VOLUME ["/app/projects"]
EXPOSE 4750
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD curl -fsS "http://127.0.0.1:${BACKLOT_PORT}/api/health" || exit 1

CMD ["sh", "-c", "exec uvicorn auth_app:app --host 0.0.0.0 --port ${BACKLOT_PORT} --log-level warning"]
