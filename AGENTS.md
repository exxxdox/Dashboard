# Dashboard — contributor notes

`CLAUDE.md` = `AGENTS.md`, byte-identical. Claude Code read first, other agents second. Edit both in one commit; never pointer to other.

Self-host dashboard. Run shell/PowerShell script on remote Linux host over SSH. Live + history output. Keep AAAA record pointed at host public IPv6.

## Commands

```bash
pnpm install
pnpm --filter @dashboard/shared build   # MUST run before typechecking anything
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm dev                                       # shared build, then API :8080 + Vite :5173 in parallel

# API alone, without the built UI
DATA_DIR=./data SCRIPT_ROOT_CONTAINER=./workspace SERVE_WEB=false pnpm --filter @dashboard/server dev

# Container
docker compose up -d --build                   # one service, host networking, port from DASHBOARD_PORT
```

`packages/shared` emit `dist/`; both consumer import by package name, so stale `dist` give type error pointing at correct code. Type look wrong: rebuild it first.

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
  lib/              crypto (credential encryption), paths, ids, errors, logger,
                    mutex (FIFO lock), http (fetch deadline + failure flattening)
  transport/        Transport interface; ssh-transport is the only implementation
  runner/           queue (concurrency) and runner (one plan, one transport)
  services/         targets, sources+git, scan, executions — all DB logic
  services/dns/     the IPv6 console: settings, checks, providers, probe,
                    scheduler, and the service that is the only orchestration point
  services/model-relay/  MCP image capabilities, Ollama routing, independent compatible SQLite
  services/notifications/  the app-wide notification settings row, the Gotify client,
                    and the one way to send a message
  routes/           targets, sources+scripts+overview, executions+websocket, dns,
                    settings
  ws/hub.ts         in-process pub/sub for live execution events
apps/web/src
  api/  components/  pages/  lib/
  model-relay/       the migrated capability console; scoped styles, shared session/locale
  api/query-client.ts  the cache, and the mutation feedback that hangs off it
  lib/i18n/         the English/Chinese dictionary, one file per area
  lib/toast.ts      the feedback stack: lifetimes, not rendering
  lib/pointer-effects.ts  the pointer-driven light, one delegated listener
```

## Architecture, and why it is this way

**Execution = `Transport` interface.** `SshTransport` only impl. Callers assume one thing: run command string on machine owning scripts, stream output, stop it. Host agent avoiding sshd = new branch in `createTransportForTarget` (`services/targets.ts`); runner, queue, routes untouched. No SSH assumption leak up.

**Container own script; host run it.** Clone in container into bind-mounted dir; scan = filesystem work. Run uploads script to staging dir on host, runs with target `workDir` as cwd, deletes it. No path mean same thing both sides; old `mappingOk` nonce check gone with the requirement it verified. Replacement = readiness check: working dir enterable, staging dir creatable + removable.

Two consequences: only entry script uploaded (`source` sibling fail unless live in `workDir`); all runs on target share one workDir, per-target concurrency 2, two runs writing same output clash.

**Local source dir created, not required.** Mount exist so files outlive container, not so host prepare first. `createSource`, `updateSource` (path move only), `syncSource` all call `ensureLocalDirectory`: create if missing. GitHub source already did before first clone. Sync = repair point: dir can vanish on host without row change; failure there = path genuinely unusable (read-only mount, file where dir must go) = `ValidationError`, not 500. Metadata edit never delete old dir, so source move leave previous behind.

**Run param bounded by name, not header.** `validateParams` forward any valid shell identifier, so script declaring nothing still runnable; declared value overridable once. Guard = env namespace: `RUN_ENV_NAMES` (`shared/run-env.ts`) list what runner inject; `executions.ts` type env `Record<RunEnvName, string>`, so drift fail typecheck. Param on such name refused with message (runner else spreads its vars over it). Not deny-list: submitter already hold target creds + can run any script, so `PATH`/`LD_PRELOAD` = operator's business. `MAX_PARAM_COUNT` + `MAX_PARAM_NAME_LENGTH` bound request body.

**Two channels: named params + positional args.** `params` = env map script read; `argv` = ordered `$1`, `$2` …. Separate columns (`param_values_json`, `argv_json`) because history must say which channel carried value. Validated differently: env name = POSIX identifier; argv no name, UI label free text (why `起始端口` ok for `argv`, rejected for `env`). `buildCommand` already took `args`; missing = whole gap between request and it.

**Form remembers itself; history not its memory.** `scripts.run_draft_json` = form content; execution rows = what ran. Prefill: draft, then that script's last run, then declared defaults; `services/run-draft.ts` owns all three steps, client never know. Empty draft stored `'{}'` because of middle step: else untouched form shadow last run forever. Last-run fallback reclassify: env values undeclared become custom rows; args lose names but keep order. Timeout not recovered: execution stores resolved limit, box text recorded nowhere. `hasContent` shared; `parseDraft` through `runDraftSchema` not cast, so `'{}'` get defaults and unparseable column = "no draft", not failing page.

**Sign-in = one env password; session = signed cookie.** No user table: `lib/auth.ts` derive HMAC key from `AUTH_PASSWORD` via scrypt, session verifiable without store; changing password kills all sessions (wanted; why key derived, not random). Cookie `HttpOnly; SameSite=Strict`; `Secure` only over https — Secure cookie on plain http dropped silently, sign-in never work. `onRequest` guard on `/api` except auth routes + `/api/health`; static shell public so login form render. Not HTTP Basic: resends password each request, cannot sign out. Unset creds = open dashboard + boot warning, not refusal (local dev + tests depend); `loadConfig` still refuse one-of-two.

**Command assembly in `shared/shell.ts`, not server.** Pure string work with injection risk, unit-testable without DB or SSH. All user input quoted; env names validated — `A; rm -rf /` would escape assignment.

**Cancel need process group.** SSH give channel, not process handle. Run under `setsid`, pid printed on stderr before `exec`; runner later `kill -TERM -<pgid>`. `setsid` probed at runtime, not assumed — host without util-linux would fail every script with command-not-found. Fallback still publish pid: cancel degrade to process alone.

**`TargetCheckResult.workDirOk` + `stagingOk` = load-bearing check.** Target answering SSH but unable to `cd` into workDir or create staging dir look healthy until first run. One probe establish both; writes under staging root, never inside `workDir`, so check can't litter data. Failed check does not block execution: `last_check_ok` = cached fact, host recover without button.

**Delivery = `ExecOptions.stdin` payload.** `Transport` gained `stdin` + `cleanupCommand`, not file transfer: "pipe bytes to command" = general form, future transports get it free from `spawn` stdio. `writeStdin` must run concurrent with output reading — awaiting it first deadlock against channel window remote end not draining — and stop once exec settle, else cancelled run hang on `drain`.

**Live logs uncapped; stored output capped.** Watcher of runaway script must still see it. Only persistence bounded by `MAX_LOG_BYTES`.

**Script schedules own invocation snapshots.** The independent `#/schedules` page lists plans and selects scripts; the scripts page contains only manual execution. `RunPanel` shares parameter controls across modes, but schedule mode seeds its own saved input and never reads or writes the manual run draft. `services/script-schedules.ts` uses Croner to calculate five-field Cron times in an explicit time zone; `script_schedules` stores independent named plans (multiple per script), separately from the editable run draft. A trigger calls `executions.submit`, so validation, concurrency, logs and notifications share the manual path. Save resolves parameter defaults and timeout; editing the draft does not alter scheduled runs. Restart recomputes future triggers after interrupted runs are reconciled; missed times are skipped. A previous scheduled run still queued/running skips the new trigger. Stop the scheduler before closing the database. Target/script deletion cascades to the plan; soft-deleted scripts never submit. Migration v11 preserves existing plans; execution origin is inserted atomically with the queued row. Per-plan `retentionDays` overrides the global default for associated completed runs (0 = forever); hourly pruning uses completion time. Plan deletion snapshots its latest policy into surviving executions. See `docs/script-schedules.md`.

**Queue in-process.** Global limit (SSH connections) + per-target (one busy host can't consume all slots). Restart loses queued + running, so `markInterrupted()` at boot: non-terminal rows from dead process reconciled, not shown running.

**Script ids soft-deleted.** Resync missing file set `deleted_at`, not row removal: history stays readable, returning file recognised. `syncScripts` rewrite metadata only on content-hash change, so display-name edits survive.

**Failed DNS query never read as "no record".** `services/dns/service.ts` order: validate, detect, query, write, notify, record; query failure abort before any write. Cloudflare "no record" mean "create one", so misread duplicate record = worst outcome here; why query not folded into write. Second invariant: address not moved = no write request, no trace in provider audit log.

**Public-address rule in `packages/shared`.** `parsePublicIpv6` decide if address may be written; browser render same outcome, second copy = second answer. Stricter than CPython `is_global`, which accept deprecated `fec0::/10`, NAT64 `64:ff9b::/96`, Teredo `2001::/32`: start global unicast, subtract, unlisted special range fail closed. Refuse too much = write nothing; accept too much = public name points at unreachable address.

**IPv6 probe never through proxy, by doing nothing.** Node `fetch` use undici default agent, honour neither `HTTP_PROXY` nor `NO_PROXY` (Python version: `session.trust_env = False`). Adding `EnvHttpProxyAgent` or `--use-env-proxy` would write proxy's address into record. `services/dns/ipv6.test.ts` assert no dispatcher.

**DNS uses Cloudflare only.** API never returns the token; blank = keep, explicit clear is rejected while required. Token ciphertext uses a nullable column (`NULL` = not stored). Migration v8 removes retired provider credentials, preserves Cloudflare settings, and disables schedules previously using the retired provider; its historical checks remain with an unknown provider.

**DNS page show state, hide config.** Inline: last look, last run result, newest five history rows. Settings + full history behind buttons: page opened to ask "record right?" not mostly form + table. Two consequences: settings summary in `PageHeader` `hints` slot, so config not invisible once off page; `DnsHistoryTable` paging navigate hash, re-render `DnsPage` without unmount, dialog stays open across pages — key or own route would close it each click.

**Modal = `<dialog>`, not `div`.** `components/Modal.tsx` call `showModal()`: buys focus trap, Esc, inert background, top layer — each a reimplementation waiting to be subtly wrong; top layer cannot be faked by z-index. `onCancel` mapped to same call close button make, so `open` sole owner of dialog state.

**`DnsConsistency` three states; third = point.** `consistent`, `moved`, `unknown`; `unknown` = real answer, not gap: compared addresses live in DNS service memory, lost on restart; nothing to compare until check run. Unearned green light worse than admitting it — whole value = trusting the word. Comparing known address against unasked question would read `moved` on probably-fine record; why missing half short-circuits.

**Every settled mutation reports itself; report lives on query client.** `api/query-client.ts` one `MutationCache`: `onSuccess` read key from `mutation.meta`, `onError` build message from server words. Alternative — `pushToast` per hook — = toast written twenty times; later mutations forgotten. `success` optional: mutation whose result page already show = noise; absent key = decision, not omission. Failures announced even when page renders banner, because banner sit inside panel or dialog already left. `quiet` for self-repeating background write (debounced draft save), where toast per failed batch worse than failure.

**Toast rules outside React; pixels inside.** `lib/toast.ts` owns lifetime: retire on timer, hold while pointer on row, resume with time left, drop oldest past four. `components/Toaster.tsx` = `useSyncExternalStore`, no state — why testable with fake timers, no renderer, no `@testing-library/react`. Stack `pointer-events: none`, row re-enable for itself, so message never blocks control behind. Progress bar = CSS animation paused by same `data-paused` flag, bar + timer stop together.

**Accent = pair; light from pointer.** Cyan `--accent` + violet `--accent-2`: one accent on dark = highlight, two = light source; atmosphere, gradients, focus states all mixed from pair. `lib/pointer-effects.ts` = one delegated `pointermove` writing custom properties: `--pointer-x/-y` on root (ambient aura), `--mx/--my` on `[data-glow]` under pointer; one write per frame. Pointer move must not re-render app; custom property write doesn't. No `(hover: hover)` guard: browser reporting no hover silently lose effect; guard would save one rAF-throttled write while finger drag.

**Atmosphere = fixed layer; nothing in tree may be opaque.** `body` no background; gradients `body::before`, measurement grid `body::after`, aura fixed element in `App`. All behind content: opaque panel above hides them — why shell root has no `bg-base`, rail `bg-base/80`. Grid masked to viewport top, never under table of numbers.

**Wordmark replaced software description.** Rail read "script" grey beside "dashboard": two things named at once, a sentence reader must finish. `components/Wordmark.tsx` = one word, gradient + gauge mark whose arc = product shape. Two sizes; endonym rule apply in spirit: drawn, not written, so nothing per-language.

**Scripts page = one grid, four cells; first row shared.** Source picker + script identity bar (`ScriptIdentityBar`, `pages/ScriptDetail.tsx`) siblings in grid, so tree + detail panels below start same height; alignment is grid's, not matched by hand. Detail column with own `PageHeader` put first panel ~25px lower (title block taller than select). Hence: sync status + button in tree panel header, not row above; two columns only at `xl`, below they stack (at 1024px second column left ~350px for source). Tree no root row: panel header already name source; row would repeat it + spend indent level.

**Script facts, metadata + run form = dialogs; actions in identity bar.** Source = page subject, so three panels sharing its column — code in 360px pane on page whose subject is code — became buttons in first row opening over it (`ScriptDialogs`, `pages/ScriptDialogs.tsx`). Bar = same reason sync button lives there: the row grid share with picker. Stay mounted open or not: `Modal` render into `<dialog>`, `showModal()` shows it, so run form keep state + pending draft save while closed; closing cannot lose debounced edit.

**Green button run saved settings; draft = "saved".** `RunNowButton` reads `run_draft_json` through same `formFromDraft` dialog seeds with, submits through same `toRunInput` its button uses: one answer to what run carry, not two drifting. Target = first host picker default, stated in `title`: one-click run must not guess machine. Settings validation refusal doesn't become doomed request — open run dialog with fields visible + fixable; `validateValues` moved to `lib/run-params.ts` for that.

**DNS schedule = re-arming timer; `configure` idempotent.** One `setTimeout` re-armed after each run, not fixed cadence: run longer than interval can't overlap; tick during in-flight skipped. `configure` no-op when `(enabled, intervalMinutes)` unchanged, so page visit (state request) can't push next run forward.

**Notification config = dashboard setting, not DNS console's.** Only Settings renders notification controls; DNS does not fetch or render them. `OutgoingNotification.kind` is required (`script_result` or `dns_change`); `NotificationService.send` gates each kind before decrypting credentials. Migration v10 defaults both event flags on to preserve existing delivery; partial saves retain flags and token ciphertext. Explicit test messages bypass event flags. Address + token used to live on `dns_settings` (console first + only sender). Now `app_settings` row (`services/notifications/`) = "how this dashboard reach me". DNS service no longer read credential: `sendNotification` injected like `createProvider` + `detectIpv6`; console asks message, never learns destination. `send` short-circuit when unconfigured rather than defer judgement to transport: "not configured" = settings property; transport asked to POST to empty address rightly call it bug. v6 migration moves two columns + drops them in one transaction: second source of truth = day-two disagreement waiting; `created_at`/`updated_at` unchanged — they record when credential written, not when moved.

**Server names message; client chooses words.** `AppError` optional `i18n: { key, params }` beside English `message`; `app.ts` puts it in error body. English = log record + client with no wording; key = lookup for client that has one. Coverage partial: errors person hits have keys (`NotFoundError` derives from entity, `validate()` names missing credential fields by identifier, auth + notifier refusals), rest fall through to server sentence. Client key for unsent message = dead code; adding one = two-sided change. `params` names, not values = identifiers — DNS sends `['cloudflareZoneId', …]`, not labels — client resolve via `error.field.<id>`; only convention `lib/i18n/index.tsx` interpolation know.

**Two languages, one dictionary per area.** `lib/i18n/areas/*.ts` export `{ en, zh }`: `en` literal, `zh` typed `Record<keyof typeof en, string>` — missing key fails typecheck. `MessageKey` = union of all areas, so `dns.titel` = compile error, not screen text. Locale in `localStorage`, default `navigator.language`, mirrored to `document.documentElement.lang`. Dates + relative times take locale (`formatDateTime(iso, locale)`, `formatRelative(iso, t)`): field order belongs to language, why `lib/format.ts` takes translator instead of reaching for one. Endonyms literal on purpose: non-Chinese reader still recognise 简体中文.

**Model Relay shares listener + sign-in; keeps protocol boundary.** `routes/model-relay.ts` owns `/api/model-relay` (dashboard session) and `/mcp` (own Bearer key + socket-peer network check). Domain services under `services/model-relay`; `DATA_DIR/model-ext-mcp.sqlite` preserves standalone data format. Lazy open, close with Fastify: unrelated request never create it. No credential logging, no old admin token. Node 24 for `node:sqlite`; tsup keeps `node:` prefixes (prefix-only builtin). Image body limits only on `/mcp`. UI inside main shell, uses its locale, toast, native modal.

## Conventions

- TypeScript strict, `types` over `interfaces`, no `any`.
- Agents here commit directly to `main`; no feature branch per change.
- Comments: why, never what. Restating next line → delete.
- User-facing errors carry HTTP status: `AppError` subclasses from `lib/errors.ts`. `app.ts` handler = only place building error response. Plain errors from `packages/shared` validators re-wrap at service boundary, else user typo = 500.
- zod at boundaries: request bodies + query strings in routes, env in `config.ts`.
- Never return secrets. `TargetSummary` no credential field by construction; only `createTransportForTarget` decrypt.
- Tests: `createFakeTransport` + `openDatabase(':memory:')` cover runner + queue without SSH or real DB.
- Command from `packages/shared/src/shell.ts` parsed only by remote shell; shape assertion can't prove valid — `apps/server/src/runner/remote-command.test.ts` runs real `sh -n`.

## Limitations

Moved here from README: user-facing defect list. README now only describe what product do, not what it cannot.

- Single instance. SQLite WAL + in-process queue mean API cannot scale out.
- **Login off by default.** No `AUTH_USERNAME`/`AUTH_PASSWORD` = open access (boot warning). Only one of the two set = refuse boot.
- Even with login on, traffic plain HTTP unless TLS reverse proxy front. Anyone sniffing LAN can take session cookie.
- **SSH host key not verified.** Connection trust whatever key peer present.
- **Public GitHub repo only.** Clone over anonymous HTTPS.
- **Entry script only uploaded.** `source ./lib.sh`, `cd "$(dirname "$0")"`, sibling `.psm1` all broken — resolve relative to staged file in `/tmp`, not workDir.
- **All runs on one target share one workDir**, two may run concurrently, so two script writing same output file overwrite each other.
- **Restart interrupt** queued + running task (script keep running on host, marked `interrupted` after).
- **Cancel depend on `setsid`**; host without it can only kill script process, not children.
- Stored output bounded by `MAX_LOG_BYTES`, over = marked truncated.
- **One password open both halves.** Sign-in can run script + rewrite AAAA record. API deliberately carry no provider credential — price of single sign-on.
- **DNS link depend on host own IPv6 egress** (see compose notes), container use host network.
- **DNS credential + SSH credential share `data/secret.key`**: key lost = re-enter both.
- DB migration forward only, no rollback — back up `data/` before upgrade.
- `.ps1` need `pwsh` on target.
- Image not slim: ship server prod dep tree, `git` + `ca-certificates`. `WITH_GIT=false` drop git + its deps (119MB → 110MB), cost = GitHub source cannot clone, `local` unaffected.

## Gotchas

Build and image traps live in [BUILD.md](BUILD.md). Read it before touching `Dockerfile`, `compose.yaml`, `pnpm-workspace.yaml`, or `scripts/prune-runtime-deps.mjs`.
