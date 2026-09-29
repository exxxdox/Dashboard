# Script Dashboard — contributor notes

Self-hosted dashboard that runs shell/PowerShell scripts on remote Linux hosts over SSH, with live and historical execution output.

## Commands

```bash
pnpm install
pnpm --filter @script-dashboard/shared build   # MUST run before typechecking anything
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm dev                                       # shared build, then API :8080 + Vite :5173 in parallel

# API alone, without the built UI
DATA_DIR=./data SCRIPT_ROOT_CONTAINER=./workspace SERVE_WEB=false pnpm --filter @script-dashboard/server dev

# Container
docker compose up -d --build
```

`packages/shared` emits `dist/` and both consumers import from the package name, so a stale `dist` produces type errors that point at correct code. Rebuild it first whenever a type looks wrong.

## Layout

```
packages/shared/src
  schemas.ts        zod contracts + response types (the API/UI boundary)
  script-meta.ts    @param header parser and parameter validation
  shell.ts          POSIX quoting, env prefix, interpreter choice, command assembly
  github.ts         public-repo URL and branch validation
apps/server/src
  index.ts          composition root: builds the whole object graph
  app.ts            Fastify assembly, error contract, static hosting
  context.ts        AppContext passed to every route module
  config.ts         env parsing, validated at boot
  db/               schema + migrations, connection, pragmas
  lib/              crypto (credential encryption), paths, ids, errors, logger
  transport/        Transport interface; ssh-transport is the only implementation
  runner/           queue (concurrency) and runner (one plan, one transport)
  services/         targets, sources+git, scan, executions — all DB logic
  routes/           targets, sources+scripts+overview, executions+websocket
  ws/hub.ts         in-process pub/sub for live execution events
apps/web/src
  api/  components/  pages/  lib/
```

## Architecture, and why it is this way

**Execution goes through a `Transport` interface.** `SshTransport` is the only implementation. Everything above the interface assumes only "run this command string on the machine that owns the scripts, stream its output, stop it". A host agent that avoids needing sshd would be one new branch in `transport/index.ts`, not a change to the runner, queue, or routes. Do not let SSH-specific assumptions leak upward.

**The container owns the script; the host only runs it.** Repositories are cloned inside the container into the bind-mounted directory, and scanning is plain filesystem work. A run then uploads the script to a staging directory on the host, runs it with the target's `workDir` as cwd, and deletes it. So there is no path that has to mean the same thing on both sides — the old `mappingOk` nonce check is gone with the requirement it existed to verify. What replaced it is a readiness check: can the working directory be entered, and can a staging directory be created and removed.

Two consequences worth knowing before touching this: only the entry script is uploaded (a script that `source`s a sibling will not find it unless it already lives in `workDir`), and every run on a target shares one working directory while per-target concurrency is 2, so two runs writing the same output file will clash.

**Command assembly is in `shared/shell.ts`, not the server.** It is pure string work with real injection risk, so it lives where it can be unit-tested without a database or an SSH connection. Everything user-influenced is quoted; environment variable *names* are validated, because a name like `A; rm -rf /` would otherwise escape its assignment.

**Cancellation needs a process group.** SSH gives a channel, not a process handle. The remote command runs under `setsid` and prints its pid on stderr before `exec`, so the runner can later `kill -TERM -<pgid>`. `setsid` is probed at run time rather than assumed — an unconditional `setsid` would turn a host without util-linux into a command-not-found failure for every script. The fallback still publishes the pid, so cancellation degrades to killing the process alone.

**`TargetCheckResult.workDirOk` and `stagingOk` are the load-bearing checks.** A target that answers SSH but cannot `cd` into its working directory, or cannot create a staging directory, looks perfectly healthy until the first run. One probe establishes both — and it deliberately writes under the staging root, never inside `workDir`, so a check cannot litter a user's data directory. A failed check does **not** block execution: `last_check_ok` is a cached fact, and hosts recover without anyone pressing the button.

**Script delivery is an `ExecOptions.stdin` payload.** The `Transport` interface gained `stdin` and `cleanupCommand` rather than a file-transfer method, because "pipe these bytes to this command" is the general form of the same thing and any future transport gets it from `spawn` stdio for free. `writeStdin` must run *concurrently* with reading output — awaiting the write first deadlocks against a channel window the remote end has not started draining — and must stop as soon as the exec settles, or a cancelled run hangs on a `drain` that will never arrive.

**Logs are streamed without limit and stored with one.** Live delivery is deliberately uncapped — someone watching a runaway script should still see it. Only persistence is bounded by `MAX_LOG_BYTES`, because that is what would otherwise grow without bound.

**The queue is in-process.** Two limits: a global one (bounds SSH connections) and a per-target one (stops one busy host consuming every slot). A restart therefore loses queued and running work, which is why `markInterrupted()` runs at boot — rows left non-terminal by a dead process must be reconciled, not shown as running.

**Script ids are soft-deleted.** A resync that no longer finds a file sets `deleted_at` rather than removing the row, so execution history stays readable and a file that returns is recognisable as the same script. `syncScripts` also only rewrites metadata when the content hash changed, so user edits to a display name survive syncs of unchanged files.

## Conventions

- TypeScript strict, `types` over `interfaces`, no `any`.
- Comments explain *why*, never *what*. A comment restating the next line should be deleted.
- Errors that a user should see carry an HTTP status: throw `AppError` subclasses from `lib/errors.ts`. The handler in `app.ts` is the only place that builds an error response. Plain errors thrown by `packages/shared` validators must be re-wrapped at the service boundary, or a user's typo becomes a 500.
- Validate at boundaries with zod: request bodies and query strings in routes, environment in `config.ts`.
- Never return secret material. `TargetSummary` has no credential field by construction; only `createTransportForTarget` decrypts.
- Tests use `createFakeTransport` and `openDatabase(':memory:')`, so runner and queue behaviour is covered without SSH or a real database.
- The command string from `packages/shared/src/shell.ts` is only ever parsed by a *remote* shell, so assertions about its shape cannot prove it is valid — `apps/server/src/runner/remote-command.test.ts` runs it through a real `sh -n` for that reason.

## Gotchas

- **`pnpm` 11 uses `allowBuilds`** in `pnpm-workspace.yaml`, not `onlyBuiltDependencies`. List every gated package as `true` or `false`: an omitted key leaves the decision *pending*, so `pnpm install` exits 1 with `ERR_PNPM_IGNORED_BUILDS` and the Docker build stops. Only `esbuild` is approved.
- **Approving a build for a package that ships a `binding.gyp` makes pnpm run `node-gyp rebuild`** even when that package declares `"gypfile": false`. `better-sqlite3` needs no build at all — its prebuilds ship inside the published tarball — so approving it produced no binary and broke the image build with `Could not find any Python installation to use`. `cpu-features` fails the same way, and `ssh2`'s native binding is a pure performance extra. All three are `false`.
- **`better-sqlite3` 13 has no `build/Release`**; `lib/binding.js` loads `prebuilds/<platform>-<arch>.node` from the tarball. Checking the old path makes a working install look broken.
- **`@fastify/websocket` augments Fastify's route options via declaration merging**, which only applies in files that import it. `routes/executions.ts` imports it for that reason alone.
- **Passing a pino `Logger` to `loggerInstance` makes Fastify infer an instance type** parameterised by pino's logger, which then no longer matches the plain `FastifyInstance` the route modules are written against. `app.ts` widens it to `FastifyBaseLogger` first.
- **`z.coerce.boolean()` turns `"false"` into `true`.** Use the `booleanFromEnv` helper in `config.ts`.
- **A bind mount shadows the image's `/data`.** The Dockerfile's `chown /data` only reaches the image layer, so the directory the app actually writes to is the host's, owned by whoever created it — root, when Docker creates it on the first `docker compose up`. Compose therefore starts the container as `user: "0:0"` and `docker-entrypoint.sh` chowns the two mounts to `PUID:PGID` before dropping privilege with `setpriv`. The image's `USER` stays unprivileged, so a bare `docker run` is not root.
- **SQLite WAL wants a local filesystem.** Do not point `DATA_DIR` at a network share.
- **`git clean -fdx` runs on every sync** of a GitHub source. That directory is ours to manage; users edit scripts in their own repositories, not in the checkout.
- **`.npmrc` pins the npm registry to a mirror, and that file does not reach the image.** `pnpm` ignores `npm_config_registry` and `NPM_CONFIG_REGISTRY`, so a file is the only way to set it locally; the Dockerfile's `deps` stage installs before any source is copied, so it writes `/app/.npmrc` from the `NPM_REGISTRY` build arg instead. A cold `pnpm install` dominates build time on a distant network, so that arg is the biggest lever. The mirror has to carry alpine under `/alpine`, which is the same path the official CDN uses, so the Dockerfile substitutes the host and nothing else. `mirrors.cloud.tencent.com` serves both alpine and npm from one host, which is why `dbuild` and `.env.example` name it for both.
- **The runtime stage is neither derived from `base` nor based on a node image.** It starts from bare `alpine:3.24` and copies `/usr/local/bin/node` out of `node:24-alpine`. `FROM node:24-alpine` reads better and is ~30 MB heavier, because that image also carries npm, corepack and yarn — and a `rm -rf` in a later layer cannot take them back out: **a file a child `RUN` deletes still occupies the layer its parent wrote**. That is why the npm removal the Dockerfile used to have freed nothing. Two consequences of not inheriting: `WORKDIR /app` and the pnpm `ENV`s are gone, so a copy destination added to that stage lands relative to `/`, the build succeeds, and the container dies at startup looking for `/app`; and `libstdc++` has to be installed by hand, because alpine ships only musl and the copied binary links against it.
- **The build runs on Debian and the runtime on alpine.** The toolchain (TypeScript, Vite, esbuild, the rolldown binaries) is left on glibc deliberately — nothing native crosses the boundary except compiled JavaScript and one prebuilt SQLite binding. `prod-deps` is the exception and is based on `node:24-alpine` on purpose: `better-sqlite3` picks its prebuild by platform *and* libc, so installing on the platform that will execute it is what makes the prune keep the right one instead of depending on a target name passed in by hand.
- **`apk add` is the runtime's entire OS surface**: `git ca-certificates libstdc++ setpriv`. The Debian version installed `git` with apt, which pulls `liberror-perl` and with it a whole perl (about 55 MB of the old image); alpine's git has no such dependency. `setpriv` is its own package there, and it is what the entrypoint drops privilege with. `PUID`/`PGID` are applied with busybox `addgroup`/`adduser` at build time rather than by renaming a built-in `node` user, which also means no `shadow` package.
- **The image ships production dependencies only.** `prod-deps` installs with `--filter @script-dashboard/server...`, which leaves out the web client's packages — its build output is copied in as static files instead. So a dependency reachable only through `apps/web` is absent at runtime: if the server ever imports one, the image still builds and then dies on first use. Server and `packages/shared` are the two manifests the runtime tree is built from.
- **`scripts/prune-runtime-deps.mjs` strips build-only weight from the installed tree**, all of it inside `prod-deps`: the `better-sqlite3` prebuilds for other platforms, keeping the one matching the build machine *including its libc* (the script reads the same signal the package reads, so an alpine install keeps `linuxmusl-*`, not `linux-*`); the SQLite amalgamation it would only need in order to compile from source; a short named list of packages that are unreachable or required inside a bare `try`; and every `*.map`. A native dependency added later that ships prebuilds needs the same treatment, or the image quietly carries every platform it supports.
- **`GIT_PROXY` reaches git as `-c http.proxy=…`, prepended inside `runGit`** in `services/sources.ts` — the override has to precede the subcommand, so no call site builds its own argv. It is deliberately not validated as a URL: git accepts a bare `host:port`, and `http.proxy` covers `https://` as well as `http://`.
