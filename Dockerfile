# syntax=docker/dockerfile:1.7
# Hochstapler — one container serves REST API, WebSocket and the built client (see docs/DESIGN.md #25).

# Pinned by minor version AND digest (reproducible, no surprise base-image changes).
# Update: docker pull node:26-bookworm-slim && docker inspect --format '{{index .RepoDigests 0}}' node:26-bookworm-slim
ARG NODE_IMAGE=node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe

# ---- build: install everything, build the client bundle ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
COPY packages/engine packages/engine
COPY packages/client packages/client
# a new image = a new build id: set by `docker build --build-arg BUILD_ID=...`, derived from the build time otherwise
# (vite.config.ts); the client bakes it in and writes dist/version.json, which the server reports in `welcome`
ARG BUILD_ID=""
ENV BUILD_ID=${BUILD_ID}
RUN npm run build -w @poly/client

# ---- deps: production dependencies of server + engine only ----
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --ignore-scripts -w @poly/server -w @poly/engine

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
# npm keeps packages with (optional) peer dependencies, here altcha-lib (DESIGN #70), next to their workspace
COPY --from=deps /app/packages/server/node_modules packages/server/node_modules
COPY package.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/tsconfig.json packages/engine/
COPY packages/engine/src packages/engine/src
COPY packages/server/package.json packages/server/tsconfig.json packages/server/
COPY packages/server/src packages/server/src
COPY --from=build /app/packages/client/dist packages/client/dist
# Debian security fixes newer than the pinned base image (trivy flags them otherwise); the apt lists are removed again
# hadolint ignore=DL3005,DL3008
RUN apt-get update \
 && apt-get -y --no-install-recommends upgrade \
 && rm -rf /var/lib/apt/lists/*
# the runtime never installs anything: drop npm/npx/corepack (their bundled deps are the usual CVE noise, and a
# shell-less package manager is one less tool for an attacker)
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
 && mkdir -p /data && chown 1000:1000 /data
# numeric uid:gid of the image's `node` user (explicit, so orchestrators can verify non-root)
USER 1000:1000
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/themes').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
WORKDIR /app/packages/server
CMD ["node", "--import", "tsx", "src/main.ts"]
