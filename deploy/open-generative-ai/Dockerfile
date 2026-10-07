# Build context: a checkout of Open-Generative-AI with submodules
# (git clone --recurse-submodules https://github.com/Anil-matcha/Open-Generative-AI.git).
# Differs from the upstream Dockerfile in one way: the runner keeps the whole
# built tree, because node_modules/{studio,ai-agent,...} are workspace symlinks
# into packages/ and break if only node_modules is copied.
FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN npm install && npm run build:packages && npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=builder /app /app
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
