# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Script Dashboard
#
# The container holds the API and the web client, and it owns the *files* --
# cloning repositories and scanning them happens here. It does not run the
# scripts: those execute on the SSH target through the transport layer. That
# split is why this image needs git but no SSH client, and why the shared
# script directory is a bind mount rather than an image layer.
#
# The build runs on Debian and the runtime does not. The toolchain -- TypeScript,
# Vite, esbuild and the rolldown binaries -- is well served by glibc, while the
# runtime is a `node` binary, `git` and a dependency tree, and musl delivers
# those in a fraction of the size. Nothing crosses that boundary except compiled
# JavaScript and one prebuilt SQLite binding, and the binding is chosen on the
# alpine side for exactly that reason.
# ---------------------------------------------------------------------------

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# Dependencies -- full install, including dev, because the build needs them.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
# The registry mirror, for networks where registry.npmjs.org is slow or blocked.
# It has to be written to a file: pnpm ignores npm_config_registry and
# NPM_CONFIG_REGISTRY, and the repository's own .npmrc is not copied here --
# this stage deliberately installs before any source, so it has no .npmrc yet.
# The default keeps the official registry so the image stays reproducible
# elsewhere; pass --build-arg NPM_REGISTRY=... to build against a mirror.
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    printf 'registry=%s\n' "$NPM_REGISTRY" > /app/.npmrc \
 && pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Production dependencies -- what the runtime needs, and nothing else.
#
# This is the biggest single lever on image size after the base image. `deps`
# above is a full install because the build needs TypeScript, Vite, esbuild and
# the rolldown binaries; none of that runs in the container. The filter keeps the
# install to the server and what it depends on, which also drops the web app's
# production packages -- the client is already built into static files by this
# point.
#
# `...` selects the server *and its dependencies*, which is what pulls the
# workspace `shared` package in.
#
# Installed on alpine rather than on the build's Debian on purpose:
# `better-sqlite3` selects a prebuilt binding out of its own tarball by platform
# *and* libc, and `prune-runtime-deps.mjs` then keeps precisely the one the
# runtime would load. Installing on the platform that will execute it makes that
# choice correct by construction, instead of a target name passed in by hand and
# silently wrong the day someone builds for a different libc.
# ---------------------------------------------------------------------------
FROM node:24-alpine AS alpine-toolchain
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app

FROM alpine-toolchain AS prod-deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY scripts/prune-runtime-deps.mjs scripts/
ARG NPM_REGISTRY=https://registry.npmjs.org/
RUN --mount=type=cache,id=pnpm-alpine,target=/pnpm/store \
    printf 'registry=%s\n' "$NPM_REGISTRY" > /app/.npmrc \
 && pnpm install --frozen-lockfile --prod --filter @script-dashboard/server... \
 && node scripts/prune-runtime-deps.mjs /app

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm -r build

# ---------------------------------------------------------------------------
# Runtime
#
# Not `FROM node:24-alpine`, although that would be shorter to read. That image
# also carries npm, corepack and yarn -- about 30 MB this container never
# executes -- and a later `rm -rf` cannot take them back out: a file deleted by a
# child RUN still occupies the layer its parent wrote, so the bytes stay in the
# image. That is why the npm removal this file used to have freed nothing.
#
# Neither does it copy node out of that image. Alpine builds its own `nodejs`,
# and that build is 52 MB against the official binary's 131 MB: it is linked
# against the distribution's shared ICU and libstdc++ instead of carrying them,
# which is most of the difference. It is the same major version, the same
# `NODE_MODULE_VERSION`, and it reports musl and a working ICU, so the runtime
# sees no difference -- and `apk add nodejs` brings no npm and no corepack,
# which a copy would have had to avoid by hand.
# ---------------------------------------------------------------------------
FROM alpine:3.24 AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    SCRIPT_ROOT_CONTAINER=/workspace \
    PORT=8080 \
    # The config default (/app/web) does not match the workspace layout this
    # image copies. Without this the server starts fine, reports a warning, and
    # serves the API only -- every browser route, including "/", returns 404.
    WEB_DIST_DIR=/app/apps/web/dist
# This stage is not based on a node image, so the workdir has to be set here:
# the copy destinations below are relative, and `CMD` below is relative to it.
WORKDIR /app

# git is required to clone script repositories into the shared mount, and
# ca-certificates for HTTPS clones. `setpriv` is what the entrypoint drops
# privilege with. `nodejs` brings its own libstdc++ and ICU, so neither is named
# here; the `npm` package is deliberately absent, as is `yarn`.
#
# Three of git's helpers are dropped in this same RUN, which is the only place a
# deletion actually shrinks the image. git dispatches them by name, so their
# absence is invisible to the four subcommands this app runs -- clone, fetch,
# reset and clean, all builtins. Nothing here pushes, so `git-http-push` is dead;
# the dumb HTTP walker `git-http-fetch` is unreachable because a source can only
# be a public GitHub repo, which speaks smart HTTP through `git-remote-http`; and
# `git-sh-i18n--envsubst` exists for shell-implemented subcommands, none of which
# is invoked. All four paths were exercised against a real repository before
# these were removed.
#
# The official Alpine mirror is unreachable from some networks, which hangs this
# step until the build times out. The default keeps the official source, so the
# image stays reproducible for everyone; pass `--build-arg
# ALPINE_MIRROR=mirrors.example.org` when building behind a slow or blocked one.
# Only the host is substituted, so the mirror has to carry alpine under the same
# paths the official one does.
ARG ALPINE_MIRROR=dl-cdn.alpinelinux.org
RUN if [ "$ALPINE_MIRROR" != "dl-cdn.alpinelinux.org" ]; then \
      sed -i "s|dl-cdn.alpinelinux.org|$ALPINE_MIRROR|g" /etc/apk/repositories; \
    fi \
 && apk add --no-cache nodejs git ca-certificates setpriv \
 && rm -f /usr/libexec/git-core/git-http-push \
          /usr/libexec/git-core/git-http-fetch \
          /usr/libexec/git-core/git-sh-i18n--envsubst

# Repositories are cloned into a bind-mounted directory whose owner is the host
# user, which git regards as untrusted. Without this, every git command in the
# mount fails with "detected dubious ownership".
RUN git config --system --add safe.directory '*'

# The account the app runs as, created with the host directory owner's ids so
# files cloned here are readable by the SSH target on the other side of the
# mount. `alpine` ships no `node` user to remap, so it is created outright --
# which also means the `shadow` package is not needed in order to rename one.
#
# This only affects the image's own /data: a bind mount shadows that layer, which
# is why the entrypoint re-applies the same ownership at startup.
ARG PUID=1000
ARG PGID=1000
# Also exported so the entrypoint can drop to the same uid at runtime. Compose
# overrides these from .env without needing a rebuild.
ENV PUID=${PUID} \
    PGID=${PGID}
RUN addgroup -g "$PGID" -S node \
 && adduser -u "$PUID" -S -D -G node -h /home/node -s /sbin/nologin node \
 && mkdir -p /data \
 && chown -R node:node /data /home/node

# Only the production dependency tree, the compiled output and the manifests
# that describe how to resolve them. `COPY --from=build /app ./` used to bring
# the whole workspace across, including the build's own node_modules.
#
# The tree is copied as a tree because pnpm links workspace packages by relative
# symlink (`apps/server/node_modules/@script-dashboard/shared` -> `../../../packages/shared`),
# so the target has to land at the same depth it was installed at.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=prod-deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=prod-deps /app/apps/server/package.json ./apps/server/package.json
COPY --from=prod-deps /app/packages/shared/package.json ./packages/shared/package.json

COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# /app is deliberately left owned by root. The app only ever writes to DATA_DIR,
# which is a bind mount, so nothing under here needs to be writable -- and a
# recursive chown would rewrite the ownership metadata of every copied file,
# which docker stores as a fresh copy of each one, for no gain.

USER node
EXPOSE 8080

# Compose starts this container as root so the bind mounts can be brought in line
# with PUID/PGID; the entrypoint drops back to that uid before the app starts.
# Note USER above is deliberately left unprivileged: `docker run` without compose
# stays non-root, and the entrypoint simply passes through in that case.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Only the database and the key live here; scripts live in the bind mount.
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
