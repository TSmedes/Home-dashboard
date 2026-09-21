# syntax=docker/dockerfile:1
#
# Multi-arch by construction: the only storage engine is Node's built-in
# node:sqlite, so there is nothing to compile and an arm64 build needs no
# toolchain. Build for a Pi and an x86 server with the same command:
#   docker buildx build --platform linux/amd64,linux/arm64 -t home-dash .

FROM node:24-bookworm-slim AS builder
WORKDIR /app

# Manifests first, so a source-only change reuses the cached install layer.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build


FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/

# Only the server's runtime dependencies: no React, no build tooling.
RUN npm ci --omit=dev --ignore-scripts \
      --workspace=@home-dash/server --include-workspace-root \
 && npm cache clean --force

COPY --from=builder /app/packages/shared/dist packages/shared/dist
COPY --from=builder /app/apps/server/dist apps/server/dist
COPY --from=builder /app/apps/web/dist apps/web/dist
COPY config/config.example.yaml config/config.example.yaml
COPY docker-entrypoint.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /app/config /app/data \
 && chown -R node:node /app

USER node
EXPOSE 8080
VOLUME ["/app/config", "/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "apps/server/dist/index.js"]
