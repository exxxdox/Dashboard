# Dashboard

Run shell + PowerShell scripts already on servers from browser: fill params, watch output live, keep record of every run.

中文: [README.md](README.md)

---

## Purpose

Pull the scripts scattered across your machines into one place you can click, that keeps a record, and that needs nothing on the target -- not an orchestrator, not config management, not CI; it runs scripts you already have and keeps the record of having run them.

## Quick start

```bash
cp .env.example .env      # change SCRIPT_ROOT_HOST at least
docker compose up -d --build
```

Open `http://<host address>:50014` (or what `DASHBOARD_PORT` say in `.env`). Then in UI: add Target (SSH host) → add Source (where scripts come from) → sync → run.

## docker compose

Run it on **host networking** (not published ports), and the host needs a **public IPv6 address**. Local detection reads the host interfaces; ipify detection also requires public IPv6 egress. A bridge network exposes the container's own interfaces instead. Everything else is in the header comments of `compose.yaml`.

## Environment variables

Set in `.env`. Two need a decision; everything else ships a working default:

| Variable | Meaning |
|---|---|
| `SCRIPT_ROOT_HOST` | Host dir holding scripts, mounted in for scan. **Required** |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | Sign-in creds, **set both or neither**; unset = run open (boot warning) |

Port, directory ownership, concurrency caps, timeout, log and retention limits, `SECRET_KEY`, `GIT_PROXY`, build mirrors: see the per-setting notes in `.env.example`.

## Writing scripts

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

## IPv6 DNS console

The DNS page keeps one AAAA record pointed at this host’s public IPv6, using Cloudflare or Alibaba Cloud.

- Open Settings from the page header to configure the provider, credentials, IPv6 detection source, check interval and Gotify notifications in a dialog. Credentials and notifications can be collapsed.
- Use the header actions to detect public IPv6, query the record and check/update manually. Results remain visible until the next action or leaving the page.
- The status card shows addresses, the DNS record, the next scheduled check and the last scheduled result. Choose View all in the history preview to open statistics and paginated details.
- Status columns adapt to screen width. The page supports English and Chinese.

Choose ipify (the default) or local interfaces as the IPv6 source. Once saved, address detection, manual updates and scheduled updates all use that source. ipify requires public IPv6 egress; with Fake-IP DNS such as Clash/Mihomo, configure `api6.ipify.org` to resolve to real addresses and connect directly. Local detection reads stable public IPv6 addresses from Linux interfaces and excludes private, temporary, deprecated and unready addresses. Optionally specify an interface name such as `enp1s0`; leave it blank for automatic detection. It stops updates when there are no candidates or multiple candidates, without switching sources. Containers need host networking to read host interface addresses. Local detection needs no ipify connection, but DNS updates still require access to the provider API. The last scheduled result resets on service restart; check history is retained.

DNS and Settings share the same Gotify configuration. Test messages can use unsaved form values.

## Settings

`/#/settings` hold the preferences that belong to the whole dashboard: interface language (English / 简体中文), and the Gotify address and token notifications go to.

After saving a Gotify address and token, scripts automatically notify on success, failure, timeout or cancellation after starting. Messages include the script, target, result, duration and run ID, without parameters, logs or raw errors. Unconfigured notifications are skipped; delivery failures are logged without changing execution results. Queued cancellations and restart interruptions do not notify. Notifications are not retried or replayed. Messages include both English and Chinese.

## License

MIT — see [LICENSE](LICENSE).
