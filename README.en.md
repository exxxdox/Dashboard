# Dashboard

Run shell + PowerShell scripts already on servers from browser: fill params, watch output live, keep record of every run.

中文: [README.md](README.md)

---

## Purpose

Pull the scripts scattered across your machines into one place you can click, that keeps a record, and that needs nothing on the target -- not an orchestrator, not config management, not CI; it runs scripts you already have and keeps the record of having run them.

## Quick start

```bash
cp .env.example .env      # configure sign-in credentials as needed
docker compose up -d --build
```

Open `http://<host address>:50014` (or what `DASHBOARD_PORT` say in `.env`). Then in UI: add Target (SSH host) → add Source (where scripts come from) → sync → run.

## docker compose

Run it on **host networking** (not published ports), and the host needs a **public IPv6 address**. Local detection reads the host interfaces; ipify detection also requires public IPv6 egress. A bridge network exposes the container's own interfaces instead. Everything else is in the header comments of `compose.yaml`.

Scripts now live in `./data/scripts`, persisted together with the database and keys through the single `/data` mount. The target host working directory is configured separately in the UI.

## Environment variables

Set in `.env`. Storage paths have working defaults; configure sign-in credentials as needed:

| Variable | Meaning |
|---|---|
| `DATA_DIR_HOST` | Host root for data, keys and scripts; defaults to `./data` |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | Sign-in creds, **set both or neither**; unset = run open (boot warning) |

Port, directory ownership, concurrency caps, timeout, log and retention limits, `SECRET_KEY`, `GIT_PROXY`, build mirrors: see the per-setting notes in `.env.example`.

## Migrating the old script directory

Stop the service and back up data before upgrading. Copy the **contents** of the old `SCRIPT_ROOT_HOST` (default `./workspace`) into `DATA_DIR_HOST/scripts` (default `./data/scripts`), including hidden files and the original directory structure. Check conflicting files before copying and give the runtime user read/write access. Sources store relative paths, so no database rewrite is needed.

Remove `SCRIPT_ROOT_HOST` from the old `.env` and any custom `/workspace` mount. Remove an explicit `SCRIPT_ROOT_CONTAINER` override to use the new default. Rebuild and start, verify local files and GitHub sync, then test execution. Keep the old directory and backup until verified; restore the old configuration and directory to revert.

## Interactive runs

Enable **Interactive terminal** in the manual run settings to type into the run detail page, use arrow-key menus, answer password prompts, and send Ctrl+C / Ctrl+D. Closing the page leaves the task running; reopen it to reconnect. One page controls a run at a time while others can watch. Cancellation and timeouts still apply; scheduled runs remain non-interactive.

Input is not stored separately, but anything the script echoes becomes captured output. Truncated logs and terminal resizing can prevent exact screen restoration.

## Writing scripts

Local sources support creating, viewing, editing and deleting scripts in the browser, including paths in subdirectories. Saving refreshes parameter declarations immediately. GitHub script files remain read-only; edit them in the repository and sync. Deleting a local script removes its file, preserves execution history and disables its schedules. Conflicting edits are rejected, and closing an editor with unsaved changes asks for confirmation. See [local script management](docs/script-editing.md).

Any `.sh` / `.ps1` file in source picked up (run with `bash` / `pwsh`; `pwsh` must be installed on target). **Leading** comment block become form in UI:

```bash
# @name Deploy API
# @timeout 600
# @param ENV required Target environment
# @param REPLICAS type=number default=3 How many replicas
```

Declared params arrive as **environment variables**. Values header not declare can be added in run form, one row at a time: `env` (env var, name must be shell identifier) or `argv` (positional args `$1`, `$2` …, in row order, name only a label). Each script form remember last typed values.

## Model Relay (MCP)

Model Relay gives agents an Ollama image-understanding tool. Add Ollama endpoints, refresh their model lists, then configure models and priority fallback routes under Capabilities. Test endpoints or run a real capability test using the built-in sample, inspect each route attempt, and copy the MCP client configuration. JPEG, PNG and WebP Base64 images are supported; clients cannot choose upstream URLs or models.

Settings let you view/rotate the MCP API key, adjust image size and concurrency limits, and restrict MCP network access. Management uses the dashboard sign-in; MCP uses its own Bearer key. Configure dashboard credentials before exposing management. Connect clients to `http://<host>:<DASHBOARD_PORT>/mcp`, replacing the old standalone port. Credentials are never printed to logs.

Configuration stays in `DATA_DIR/model-ext-mcp.sqlite`. To migrate an existing deployment, stop the old service, back up its data, and move a consistent database snapshot into this directory without replacing dashboard's own database or key. The old `/api/v1` management API moves to `/api/model-relay` and uses dashboard sessions. Local development requires Node.js 24 or later.

With MCP network access disabled, only TCP peers on loopback or local interface subnets are accepted; forwarded headers are ignored. Default host networking includes the host LAN in those subnets. A local reverse proxy counts as local, so restrict the proxy or firewall as needed.

## Scheduled scripts

The Scheduled runs page manages named plans with a script, five-field Cron expression, time zone, target and saved run parameters. Multiple plans can use the same script. Each has its own execution history and log links, with configurable retention in days (0 keeps records forever). Schedules persist across restarts and use the normal run history and logs. Missed triggers during downtime are skipped, as are triggers while the preceding scheduled run is still queued or running.

## IPv6 DNS console

The DNS page keeps one AAAA record pointed at this host’s public IPv6, using Cloudflare.

- Open Settings from the page header to configure the provider, credentials, IPv6 detection source, check interval in a dialog. Credentials can be collapsed.
- Use the header actions to detect public IPv6, query the record and check/update manually. Results remain visible until the next action or leaving the page.
- The status card shows addresses, the DNS record, the next scheduled check and the last scheduled result. Choose View all in the history preview to open statistics and paginated details.
- Status columns adapt to screen width. The page supports English and Chinese.

Choose ipify (the default) or local interfaces as the IPv6 source. Once saved, address detection, manual updates and scheduled updates all use that source. ipify requires public IPv6 egress; with Fake-IP DNS such as Clash/Mihomo, configure `api6.ipify.org` to resolve to real addresses and connect directly. Local detection reads stable public IPv6 addresses from Linux interfaces and excludes private, temporary, deprecated and unready addresses. Optionally specify an interface name such as `enp1s0`; leave it blank for automatic detection. It stops updates when there are no candidates or multiple candidates, without switching sources. Containers need host networking to read host interface addresses. Local detection needs no ipify connection, but DNS updates still require access to the provider API. The last scheduled result resets on service restart; check history is retained.

Gotify is configured only in Settings. Test messages can use unsaved form values and bypass automatic event switches.

## Settings

`/#/settings` hold the preferences that belong to the whole dashboard: interface language (English / 简体中文), and the Gotify address, token, Script result notifications and DNS update notifications switches.

After saving a Gotify address and token and enabling Script result notifications, manual and scheduled scripts notify on success, failure, timeout or cancellation after starting. Messages include the script, target, result, duration and run ID, without parameters, logs or raw errors. Unconfigured notifications are skipped; delivery failures are logged without changing execution results. Queued cancellations and restart interruptions do not notify. Notifications are not retried or replayed. Messages include both English and Chinese. DNS update notifications independently control messages after AAAA creation or an address change.

## License

MIT — see [LICENSE](LICENSE).
