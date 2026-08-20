# syntax=docker/dockerfile:1.7
# =============================================================================
# Bahn Project Manager — production image
#
# Multi-stage so the runtime image carries no toolchain, no sources and no dev
# dependencies. Node 22 to match the version the project is developed and
# type-checked against (see package.json "engines"); pnpm pinned via corepack
# so a build here resolves the same tree as `pnpm install` on a workstation.
# =============================================================================

ARG NODE_VERSION=22.14.0
ARG PNPM_VERSION=10.15.1

# ---------------------------------------------------------------- deps ------
# Separate stage, and only the two manifests are copied, so the (slow) install
# layer is cached until a dependency actually changes — editing a .tsx file
# does not reinstall 1,200 packages.
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# --------------------------------------------------------------- build ------
FROM deps AS build
WORKDIR /app
COPY . .
# Type-check before bundling. A container that builds but does not compile is
# worse than a build failure, because it fails in production instead of in CI.
RUN pnpm run check
RUN NODE_ENV=production pnpm run build:client
RUN NODE_ENV=production pnpm run build:server

# --------------------------------------------------------- prod-deps --------
FROM deps AS prod-deps
WORKDIR /app
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm prune --prod

# ------------------------------------------------------------- runtime ------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

# Run as the unprivileged `node` user that the base image already provides.
# Nothing in this image needs to write outside /tmp.
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build     --chown=node:node /app/dist         ./dist
COPY --from=build     --chown=node:node /app/package.json ./package.json

USER node
EXPOSE 3000

# The server's own health route. `--spider`-style check with plain node so the
# image needs neither curl nor wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Direct node, no npm wrapper: npm swallows SIGTERM, which would make every
# container stop take the full 10s kill timeout instead of shutting down.
CMD ["node", "dist/index.js"]
