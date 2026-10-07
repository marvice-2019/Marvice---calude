# Open Generative AI (https://github.com/Anil-matcha/Open-Generative-AI) for aistudio.marvice.tech.
# Builds the hosted web version (Next.js) from a pinned upstream commit, with submodules,
# plus the Marvice patches in patches/. The app is served on port 3000 behind the auth gate.
FROM node:22-bookworm-slim AS build

ARG OGAI_REPO=https://github.com/Anil-matcha/Open-Generative-AI.git
ARG OGAI_REF=00132ece7c38b6f2e428793973ae99c6953d899e

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git init -q . && git remote add origin "$OGAI_REPO" \
    && git fetch -q --depth 1 origin "$OGAI_REF" && git checkout -q FETCH_HEAD \
    && git submodule update --init --recursive --depth 1 \
    && rm -rf .git packages/*/.git *.png models_dump.json

# Marvice patch: optional server-side MuAPI key (MUAPI_API_KEY).
COPY patches /tmp/patches
RUN git apply --verbose /tmp/patches/*.patch

RUN npm ci --no-audit --no-fund
RUN npm run build:packages
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/studio').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3000"]
