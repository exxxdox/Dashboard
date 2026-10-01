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

Run it on **host networking** (not published ports), and the host needs **working public IPv6 egress** -- the DNS check must leave through the host's own IPv6; a bridge network reports a different address. Everything else is in the header comments of `compose.yaml`.

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

## IPv6 DNS console

"DNS" page keep one AAAA record pointed at this host public IPv6, on Cloudflare or Alibaba Cloud.

## Settings

`/#/settings` hold the preferences that belong to the whole dashboard: interface language (English / 简体中文), and the Gotify address and token notifications go to.

## License

MIT — see [LICENSE](LICENSE).
