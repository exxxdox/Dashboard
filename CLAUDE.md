# Dashboard — contributor notes

`CLAUDE.md` and `AGENTS.md` = same document, kept identical. Claude Code read the first, other agents read the second. Edit both in same commit; never replace one with pointer to the other.

Self-host dashboard. Run shell/PowerShell script on remote Linux host over SSH. Live + history execution output. Keep AAAA record point at host public IPv6.

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

`packages/shared` emit `dist/`; both consumer import by package name, so stale `dist` give type error pointing at correct code. Type look wrong → rebuild it first.

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

**Execution go through `Transport` interface.** `SshTransport` only impl. Everything above interface assume only "run this command string on machine that own scripts, stream its output, stop it". Host agent avoiding need for sshd = one new branch in `createTransportForTarget` (`services/targets.ts`), not change to runner, queue, routes. No SSH-specific assumption leak upward.

**Container own script; host only run it.** Repo clone inside container into bind-mounted dir; scanning = plain filesystem work. Run upload script to staging dir on host, run with target `workDir` as cwd, delete it. So no path must mean same thing both sides — old `mappingOk` nonce check gone with requirement it existed to verify. Replacement = readiness check: can working dir be entered, can staging dir be created + removed.

Two consequence worth knowing before touch this: only entry script uploaded (script that `source`s sibling not find it unless already live in `workDir`), and every run on target share one working dir while per-target concurrency = 2, so two runs writing same output file clash.

**Local source dir created, not required.** Bind mount exist so files outlive container, not so host prepare first, so `createSource`, `updateSource` (only when path move) and `syncSource` all call `ensureLocalDirectory` — create if missing. That what GitHub source already did before first clone. Sync = repair point: dir can be deleted on host without row change, and failure there now mean path genuinely unusable (read-only mount, or file where dir must go) = `ValidationError`, not 500. Metadata edit still never delete old dir, so moving source leave previous behind exactly as before.

**Run param bounded by name, not declaration.** `validateParams` forward anything caller send that valid shell identifier, so script whose header declare nothing still runnable; declared value overridable for single run. Guard = env var namespace instead: `RUN_ENV_NAMES` in `shared/run-env.ts` list what runner inject, and `executions.ts` type own env object as `Record<RunEnvName, string>` so two cannot drift — name on one side only fail typecheck. Param taking one of those names silently discarded (runner spread its vars after params), so refused with message instead. Deliberately *not* deny-list of dangerous vars: whoever can submit run already hold target creds + can run any script in repo, so `PATH` or `LD_PRELOAD` = operator's own business. `MAX_PARAM_COUNT` + `MAX_PARAM_NAME_LENGTH` bound what request body may ask for.

**Run carry two channel: named params + positional args.** `params` = map script read from env; `argv` = ordered list read as `$1`, `$2` …. Separate columns (`param_values_json`, `argv_json`) because run history must say which channel value went down; validated differently: env var need POSIX identifier as name, positional arg no name at all — UI name field = free-text label there, why `起始端口` accepted for `argv` and rejected for `env`. `buildCommand` already took `args`; missing = everything between request and it.

**Run form remember itself; history not its memory.** `scripts.run_draft_json` hold what form contained; execution rows hold what actually ran. Prefill order = draft, then last execution of that script, then declared defaults — `services/run-draft.ts` own all three step so client never know them. Draft with nothing in it stored as `'{}'` *because* of middle step: else form someone opened + left alone shadow last run forever. Last-run fallback reclassify: env values header not declare become custom rows again; args no names to restore so come back bare + in order. Timeout deliberately not recovered: execution store resolved limit, box text recorded nowhere. `hasContent` shared by both; `parseDraft` read through `runDraftSchema` not cast, so `'{}'` default get missing keys filled and unparseable column degrade to "no draft" instead of failing page.

**Sign-in = one password in env; session = signed cookie.** No user table: `lib/auth.ts` derive HMAC key from `AUTH_PASSWORD` with scrypt, so session verifiable with no store — and changing password invalidate every session, wanted behaviour + reason key derived not random. Cookie `HttpOnly; SameSite=Strict`, `Secure` only when request arrive over https, because Secure cookie over plain http dropped silently and sign-in never work. Guard = `onRequest` hook covering everything under `/api` except auth routes + `/api/health`; static shell stays public so login form render. Not HTTP Basic: would resend password every request, could not sign out. Unset creds = open dashboard + boot warning, not refusal — local dev + whole test suite depend on that, and `loadConfig` still refuse one-and-not-the-other case.

**Command assembly in `shared/shell.ts`, not server.** Pure string work with real injection risk, so live where unit-testable without database or SSH connection. Everything user-influenced quoted; env var *names* validated, because name like `A; rm -rf /` would else escape its assignment.

**Cancellation need process group.** SSH give channel, not process handle. Remote command run under `setsid` + print its pid on stderr before `exec`, so runner can later `kill -TERM -<pgid>`. `setsid` probed at run time, not assumed — unconditional `setsid` would turn host without util-linux into command-not-found failure for every script. Fallback still publish pid, so cancellation degrade to killing process alone.

**`TargetCheckResult.workDirOk` + `stagingOk` = load-bearing check.** Target that answer SSH but cannot `cd` into working dir, or cannot create staging dir, look perfectly healthy until first run. One probe establish both — deliberately write under staging root, never inside `workDir`, so check cannot litter user data dir. Failed check does **not** block execution: `last_check_ok` = cached fact, hosts recover without anyone pressing button.

**Script delivery = `ExecOptions.stdin` payload.** `Transport` gained `stdin` + `cleanupCommand` rather than file-transfer method, because "pipe these bytes to this command" = general form of same thing and any future transport get it from `spawn` stdio free. `writeStdin` must run *concurrently* with reading output — awaiting write first deadlock against channel window remote end not started draining — and must stop as soon as exec settle, else cancelled run hang on `drain` never arrive.

**Logs streamed no limit, stored with one.** Live delivery deliberately uncapped — someone watching runaway script should still see it. Only persistence bounded by `MAX_LOG_BYTES`, because that what would else grow without bound.

**Queue in-process.** Two limits: global (bound SSH connections) + per-target (stop one busy host consuming every slot). Restart therefore lose queued + running work, why `markInterrupted()` run at boot — rows left non-terminal by dead process must be reconciled, not shown as running.

**Script ids soft-deleted.** Resync no longer finding file set `deleted_at` rather than removing row, so execution history stays readable and returning file recognisable as same script. `syncScripts` also only rewrite metadata when content hash changed, so user edits to display name survive syncs of unchanged files.

**Failed DNS query must never be read as "no record".** `services/dns/service.ts` run validate, detect, query, write, notify, record, in that order; query that fail abort before anything written. Cloudflare "no record" mean "create one", so misreading duplicate record -- worst outcome this feature has, reason query step not simply folded into write. Second invariant beside it: run whose address not moved issue no write request at all, so check changing nothing leave no trace in provider audit log.

**Public-address rule live in `packages/shared`.** `parsePublicIpv6` decide whether address may be written into record; browser render same outcome, so second copy would be second answer. Stricter than CPython `is_global` Python version used, which accept deprecated site-local `fec0::/10`, NAT64 `64:ff9b::/96` + Teredo `2001::/32`: start from global unicast + subtract, so unlisted special range fail closed. Refusing too much cost run writing nothing; accepting too much point public name at address nothing can reach.

**Nothing reach IPv6 probe through proxy, enforced by doing nothing.** Node global `fetch` use undici default agent, which honour neither `HTTP_PROXY` nor `NO_PROXY` -- same guarantee Python version got from `session.trust_env = False`. Risk run other way: adding `EnvHttpProxyAgent` dispatcher, or running node with `--use-env-proxy`, would quietly write *proxy's* address into record. `services/dns/ipv6.test.ts` assert no dispatcher passed for exactly that reason.

**DNS credential absent, blank, or replaced -- only third or explicit flag change it.** API never return one, so form have nothing to send back; blank mean "keep"; delete = own `clear*` flag. Clearing *active* provider required credential refused by validation with field named, not second rule in merge. Row store each credential in own nullable column (`NULL` = only spelling of "not stored"), so replace or clear one cannot disturb others.

**DNS page show state, hide config.** Render inline = what check found + decided: last look, result of last run, newest five history rows. Settings + full history behind buttons, because page someone open to ask "record right?" should not be mostly form + table. Two consequence load-bearing: settings summary moved into `PageHeader`'s `hints` slot, what stop config becoming invisible now it not on page; and `DnsHistoryTable` paging navigate hash, which re-render `DnsPage` without unmounting it, so dialog stay open across page change -- wrapping it in key or own route would close it every click.

**Modal = `<dialog>`, not `div`.** `components/Modal.tsx` call `showModal()`: that what buy focus trap, Esc key, inert background + top layer. Every one of those = reimplementation waiting to be subtly wrong, and top layer in particular cannot be faked by z-index at all. `onCancel` turned into same call close button make, so `open` stays single owner of dialog state instead of drifting from element's.

**`DnsConsistency` have three state; third one = point.** `consistent`, `moved`, or `unknown`; `unknown` = real answer not gap: two address it compare live in DNS service memory, lost on restart, so until check run there nothing to compare. Green light nobody earned worse than saying so, because whole value of feature = trusting that word. Comparing known address against unasked question would read `moved` for record probably fine; why missing half short-circuit rather than fall through.

**Every settled mutation report itself; report live on query client.** `api/query-client.ts` install one `MutationCache` whose `onSuccess` read key off `mutation.meta` and whose `onError` build message from server's own words. Alternative — `pushToast` call in each hook `onSuccess` — = same toast written twenty times, and mutations added later exactly ones forgotten. `success` optional because mutation whose result page already show = only noise; missing key = decision, not omission. Failures other way: announced whether or not page also render banner, because banner sit inside panel or dialog person may already have left. `quiet` for one background write repeating on own — run form debounced draft save — where toast per failed keystroke-batch worse than failure.

**Toast rules outside React; only pixels inside.** `lib/toast.ts` own lifetime — retire on timer, hold while pointer on row, hand back time left when it leave, drop oldest past four — and `components/Toaster.tsx` = `useSyncExternalStore` over it owning no state at all. That split make part worth testing testable with fake timers + no renderer, and why no `@testing-library/react` in repo. Two detail load-bearing: stack `pointer-events: none`, each row turn them back on for itself, so message never block control behind it; and progress bar = CSS animation paused by same `data-paused` flag store set, so bar + timer stop together rather than drifting.

**Accent = pair; light come from pointer.** Cyan `--accent` with violet `--accent-2` beside it: one accent on dark surface read as highlight, two read as light source, and page atmosphere, gradients, focus states all mixed from pair. `lib/pointer-effects.ts` = one delegated `pointermove` listener writing CSS custom properties — `--pointer-x/-y` on root for ambient aura, `--mx/--my` on whichever `[data-glow]` element under pointer — throttled to one write per frame. Moving pointer must not re-render app; writing custom property does not. Deliberately no `(hover: hover)` guard: browser reporting no hover silently lose effect, and cost guard would save = one rAF-throttled style write while finger dragging.

**Atmosphere painted by fixed layer, so nothing in tree may be opaque.** `body` no background of own; gradients = `body::before`, measurement grid = `body::after`, aura = fixed element in `App`. All three behind content, so opaque panel anywhere above hide them — why shell root carry no `bg-base` and why rail is `bg-base/80`. Grid masked to top of viewport so never run under table of numbers.

**Wordmark replaced description of software.** Rail used to read "script" in grey beside "dashboard", naming two things at once + reading as sentence reader had to finish. `components/Wordmark.tsx` = one word with gradient + gauge mark whose arc = shape product is about. Two sizes; endonym rule from i18n apply in spirit: mark drawn, not written, so nothing about it per-language.

**Scripts page = one grid with four cell; first row shared.** Source picker + selected script identity bar (`ScriptIdentityBar`, in `pages/ScriptDetail.tsx`) = siblings in grid, what make tree panel + detail panels below start at same height -- alignment is grid's, not height anyone matched by hand. Handing detail column own `PageHeader` instead put its first panel ~25px lower than tree, because title block taller than select. Two consequence follow: sync status + its button live in tree panel header rather than row above it, same reason; and two columns only start at `xl`: below that they stack, handing detail full width source need -- at 1024px second column left it about 350px. Tree draw no root row for same kind of reason: panel header already name source, so row would repeat it + spend level of indent saying it.

**Script facts, metadata + run form = dialogs; actions live in identity bar.** Source = what someone open page to read, so three panels that used to share detail column with it -- leaving code in 360px pane on page whose subject is code -- became buttons in first row instead, each opening over it (`ScriptDialogs`, `pages/ScriptDialogs.tsx`). Bar = where they belong for same reason sync button does: it the row grid share with source picker. Stay mounted whether open or not, because `Modal` render children into `<dialog>` and `showModal()` = what show it -- so run form keep its state + pending draft save while dialog closed, and closing one cannot lose last edit of debounced write.

**Green button run saved settings; draft = what "saved" mean.** `RunNowButton` read script's `run_draft_json` back through same `formFromDraft` dialog seed itself with, + submit through same `toRunInput` dialog own button use, so one answer to what run carry rather than two that drift. Target first host = picker default, says so in `title`: one-click run must not be guess about which machine it land on. Settings form itself would refuse do not become doomed request -- click open run dialog, where they visible + fixable. `validateValues` moved from form into `lib/run-params.ts` for exactly that reason.

**DNS schedule = re-arming timer; `configure` idempotent.** One `setTimeout` re-armed after each run rather than fixed cadence, so run longer than interval cannot overlap itself; tick landing while one in flight skipped. `configure` do nothing when `(enabled, intervalMinutes)` pair unchanged, what stop page -- which ask for state every visit -- from pushing next run forward each time someone open it.

**Where notification go = dashboard setting, not DNS console's.** Address + token used to live on `dns_settings`, because that console first + only thing sending one. Now `app_settings` row (`services/notifications/`), because thing configured = "how this dashboard reach me". DNS service no longer read credential: `sendNotification` injected into it like `createProvider` + `detectIpv6`, so console ask for message to be sent + never learn where it land. `send` short-circuit when nothing configured rather than delegating that judgement to transport -- "not configured" = property of settings, and transport asked to POST to empty address would be right to call that bug rather than skip. v6 migration move two columns + drop them in same transaction: second source of truth for one credential = bug waiting for day two disagree, and `created_at`/`updated_at` come across unchanged because they truth about when credential written, not when it moved.

**Server name message; client choose words.** `AppError` carry optional `i18n: { key, params }` beside English `message`, and `app.ts` put it in error body. English = what log record + what client with no wording of own show; key = what client that has one look up. Coverage deliberately partial: errors person actually hit have keys (`NotFoundError` derive own from entity, `validate()` build one naming missing credential fields by identifier, auth + notifier refusals carry theirs), rest fall through to server sentence. Client-side key for message nothing send = dead code, so adding one = two-sided change. `params` values that are names rather than values = identifiers -- DNS problem send `['cloudflareZoneId', …]`, not English labels -- and client resolve each through `error.field.<id>`; this one convention interpolation in `lib/i18n/index.tsx` know about.

**Web client two language live in one dictionary per area.** `lib/i18n/areas/*.ts` each export `{ en, zh }` with `en` literal + `zh` a `Record<keyof typeof en, string>`, = whole enforcement: key added to one language not other fail typecheck. `MessageKey` = union of every area, so misspelled key = compile error rather than screen with `dns.titel` printed on it. Locale remembered in `localStorage`, defaults from `navigator.language`, mirrors to `document.documentElement.lang`. Dates + relative times take it too (`formatDateTime(iso, locale)`, `formatRelative(iso, t)`) because order of date's fields belong to language -- why `lib/format.ts` take translator rather than reaching for one. Language *endonyms* = deliberate exception, stay literal: someone who cannot read Chinese still recognise 简体中文.

**Model Relay shares the listener and sign-in, keeps its protocol boundary.** `routes/model-relay.ts` owns `/api/model-relay` (dashboard session) and `/mcp` (independent Bearer key + socket-peer network check). Domain services remain under `services/model-relay`; `DATA_DIR/model-ext-mcp.sqlite` preserves the standalone data format. Open lazily and close with Fastify, so unrelated requests never create it. Do not log credentials or expose the old admin token. Node 24 is required for `node:sqlite`; tsup must keep `node:` prefixes because SQLite is a prefix-only builtin. Image body limits belong only to `/mcp`, not the dashboard's other routes. The feature's UI lives inside the main shell and uses its locale, toast and native modal.

## Conventions

- TypeScript strict, `types` over `interfaces`, no `any`.
- Agents working in this repo commit directly to `main`; do not open a feature branch per change.
- Comments explain *why*, never *what*. Comment restating next line → delete.
- Errors user should see carry HTTP status: throw `AppError` subclasses from `lib/errors.ts`. Handler in `app.ts` = only place building error response. Plain errors thrown by `packages/shared` validators must re-wrap at service boundary, else user typo become 500.
- Validate at boundaries with zod: request bodies + query strings in routes, environment in `config.ts`.
- Never return secret material. `TargetSummary` no credential field by construction; only `createTransportForTarget` decrypt.
- Tests use `createFakeTransport` + `openDatabase(':memory:')`, so runner + queue behaviour covered without SSH or real database.
- Command string from `packages/shared/src/shell.ts` only ever parsed by *remote* shell, so assertion about its shape cannot prove valid — `apps/server/src/runner/remote-command.test.ts` run it through real `sh -n` for that reason.

## Limitations

Moved here from README: user-facing defect list. README now only describe what product do, not what it cannot.

- Single instance. SQLite WAL + in-process queue mean API cannot scale out.
- **Login off by default.** No `AUTH_USERNAME`/`AUTH_PASSWORD` = open access (boot warning). Only one of the two set = refuse to boot.
- Even with login on, **traffic plain HTTP** unless TLS reverse proxy front. Anyone sniffing LAN can take session cookie.
- **SSH host key not verified.** Connection trust whatever key peer present.
- **Public GitHub repo only.** Clone over anonymous HTTPS.
- **Entry script only uploaded.** `source ./lib.sh`, `cd "$(dirname "$0")"`, sibling `.psm1` all broken — resolve relative to staged file in `/tmp`, not workDir.
- **All runs on one target share one workDir**, two may run concurrently, so two script writing same output file overwrite each other.
- **Restart interrupt** queued + running task (script itself keep running on host, marked `interrupted` after).
- **Cancel depend on `setsid`**; host without it can only kill script process itself, not its children.
- Stored output bounded by `MAX_LOG_BYTES`, over = marked truncated.
- **One password open both halves.** Who can sign in can run script + rewrite AAAA record. API deliberately carry no provider credential — that the price of single sign-on.
- **DNS link depend on host own IPv6 egress** (see compose notes), container use host network.
- **DNS credential + SSH credential share `data/secret.key`**: key lost = re-enter both.
- DB migration **forward only, no rollback** — back up `data/` before upgrade.
- `.ps1` need `pwsh` installed on target.
- Image not slim: ship server prod dep tree, `git` + `ca-certificates`. Build with `WITH_GIT=false` drop git + its own deps (119MB → 110MB), cost = GitHub source cannot clone, `local` source unaffected.

## Gotchas

Build and image traps live in [BUILD.md](BUILD.md). Read it before touching
`Dockerfile`, `compose.yaml`, `pnpm-workspace.yaml`, or
`scripts/prune-runtime-deps.mjs`.
