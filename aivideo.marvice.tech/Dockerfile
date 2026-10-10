# OpenMontage (https://github.com/calesthio/OpenMontage) for aivideo.marvice.tech.
# Mirrors upstream `make setup`, then serves the Backlot board on port 4750.
FROM node:22-bookworm-slim

ARG OPENMONTAGE_REPO=https://github.com/calesthio/OpenMontage.git
ARG OPENMONTAGE_REF=9327439db69021ab4b0e2776729bf3b58fdb5a87

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git make ffmpeg python3 python3-venv python3-pip \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 libxshmfence1 \
    fonts-liberation fonts-noto-color-emoji fonts-noto-core fonts-dejavu-core fontconfig \
    && rm -rf /var/lib/apt/lists/* && fc-cache -f

# Claude Code drives OpenMontage (run `claude` from the container terminal).
RUN npm install -g @anthropic-ai/claude-code && npm cache clean --force

RUN useradd --create-home --shell /bin/bash openmontage \
    && mkdir -p /opt/OpenMontage /data/projects \
    && chown openmontage:openmontage /opt/OpenMontage /data/projects
USER openmontage
WORKDIR /opt/OpenMontage

RUN git clone "$OPENMONTAGE_REPO" . && git checkout "$OPENMONTAGE_REF"

# Same steps as upstream `make setup`
RUN python3 -m venv .venv \
    && .venv/bin/pip install --no-cache-dir -r requirements.txt \
    && (.venv/bin/pip install --no-cache-dir piper-tts || echo "piper-tts skipped; cloud TTS only") \
    && cp -n .env.example .env
RUN cd remotion-composer && npm install && npm cache clean --force
RUN npx --yes hyperframes --version || echo "HyperFrames cache-warm skipped; first render fetches it"

ENV PATH=/opt/OpenMontage/.venv/bin:$PATH \
    OPENMONTAGE_PROJECTS_DIR=/data/projects

VOLUME ["/data/projects", "/home/openmontage"]
EXPOSE 4750

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD curl -fsS http://127.0.0.1:4750/api/health >/dev/null || exit 1

# `python -m backlot serve` binds 127.0.0.1; bind all interfaces so the auth gate can reach it.
CMD ["python", "-m", "uvicorn", "backlot.server:app", "--host", "0.0.0.0", "--port", "4750", "--log-level", "warning"]
