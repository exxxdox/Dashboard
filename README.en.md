# Dashboard

Run the shell and PowerShell scripts you already have on your servers from a browser: fill in parameters, watch the output live, and keep a record of every run.

中文: [README.md](README.md)

---

## Purpose

Once you have more than a couple of servers, script maintenance turns into this: dozens of `.sh` files scattered across `/root`, `/srv` and `/opt` on each machine, no two versions matching; you SSH in before every run, and when the output scrolls away nothing is left behind; and the same script is not even the same file on two hosts.

This project pulls that back into one place:

- **A script has exactly one source.** Your scripts live in a git repository or a shared directory, and the dashboard clones and scans them. The copy on the machine is a temporary upload for the duration of a run and is deleted afterwards — the two sides cannot disagree.
- **No SSH first.** One click runs it, parameters go into a form, output is pushed back to the browser live, and past runs stay searchable.
- **Zero dependencies on the host.** A target needs an SSH service and a POSIX shell: no agent to install, no git, no directory to mount, no path shared with the container.
- **Parameters never pass through the command line.** Declared parameters arrive as **environment variables**, never as argv, so a value can never be taken for a flag or a command. A script that reads positional arguments can choose `argv` mode explicitly, where values are quoted and escaped into the command line.
- **What ran is what is recorded.** Every run records its target, parameters, exit code and full output.

**What it is not.** Not an orchestrator (no DAG, no retry policy, no idempotence guarantee), not configuration management (it does not maintain a desired state on the targets), not CI (it does not watch git events and never runs anything by itself). It runs scripts you already have and keeps a record of it.

## Quick start

```bash
cp .env.example .env      # change SCRIPT_ROOT_HOST and PUID/PGID at least
docker compose up -d --build
```

Open `http://<host address>:50014` (or whatever `DASHBOARD_PORT` says in `.env`). Then, in the UI: add a Target (the SSH host) → add a Source (where the scripts come from) → sync → run.

## docker compose

The repository's `compose.yaml` is the template; the parts that matter are these:

```yaml
services:
  dashboard:
    build: .
    restart: unless-stopped
    network_mode: host                              # see below: needs the host's own IPv6
    environment:
      PORT: ${DASHBOARD_PORT:-50014}                # under host networking this is the host port
    volumes:
      - ./data:/data                                 # database + credential encryption key
      - ${SCRIPT_ROOT_HOST:-./workspace}:/workspace  # script directory (read for clone/scan)
    user: "0:0"
```

- **Host networking, not published ports.** The DNS check has to leave through the host's own IPv6 egress; a bridge network would report a different address. The cost is that the container takes a port on the machine itself, so `DASHBOARD_PORT` has to be free there, and `ports:` cannot be used at all — it is mutually exclusive with `network_mode`.
- **The host itself must have working public IPv6 egress.** The probe asks `api6.ipify.org` over IPv6; if it cannot be reached the run fails with an error and writes nothing to DNS.
- **Back up `./data`.** It holds the SQLite database and `secret.key`. Lose the key and the stored SSH credentials *and* the stored DNS provider credentials cannot be decrypted — you would have to enter them again.
- **`user: "0:0"` is root for the first instant only.** A bind mount shadows the ownership set in the image, so the entrypoint `chown`s both mounts to `PUID:PGID` and then drops the privilege — the dashboard process never runs as root. That is why `PUID`/`PGID` must match the owner of the script directory.
- **Under host networking the app listens on every interface of the host**, so anything that can reach the machine can reach the dashboard. To restrict that, set `HOST` to a specific address or put a reverse proxy in front.

## Environment variables

Set in `.env`; the full example is `.env.example`:

| Variable | Default | Meaning |
|---|---|---|
| `SCRIPT_ROOT_HOST` | — | Host directory holding the scripts, mounted in for scanning. **Required** |
| `PUID` / `PGID` | `1000` | Owner of that directory. The container takes ownership of the mounts, then drops to this user |
| `DASHBOARD_PORT` | `50014` | Listen port. Under host networking this is the host port, so it must be free on the machine |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | unset | Sign-in credentials, **set both or neither**; unset runs open (with a boot warning) |
| `LOG_LEVEL` | `info` | `fatal`…`trace` |
| `MAX_CONCURRENT_EXECUTIONS` | `4` | Scripts running at once, across all targets |
| `MAX_CONCURRENT_PER_TARGET` | `2` | Scripts running at once on one target |
| `DEFAULT_TIMEOUT_SEC` | `1800` | Used when neither the script nor the run sets a timeout |
| `MAX_LOG_BYTES` | `5242880` | **Stored** output per run before it is marked truncated |
| `RETENTION_DAYS` | `30` | Delete finished runs older than this; `0` keeps everything |
| `SECRET_KEY` | generated | Base64 of 32 random bytes, used to encrypt SSH credentials |
| `GIT_PROXY` | none | Proxy for cloning repositories, e.g. `http://192.168.1.10:7890`; git transport only |
| `NPM_REGISTRY` / `ALPINE_MIRROR` | official | npm / Alpine mirror for the image build. `ALPINE_MIRROR` takes a **host name only** — a full URL breaks the build, and the mirror must serve alpine under `/alpine` |

Two paths inside the container: `DATA_DIR` (`/data`) holds the database and key, `SCRIPT_ROOT_CONTAINER` (`/workspace`) is the mount point.

## Writing scripts

Any `.sh` / `.ps1` file in a source is picked up (run with `bash` and `pwsh` respectively; `pwsh` must be installed on the target). The **leading** comment block becomes a form in the UI:

```bash
# @name Deploy API
# @timeout 600
# @param ENV required Target environment
# @param REPLICAS type=number default=3 How many replicas
```

Declared parameters arrive as **environment variables**. Values the header does not declare can be added in the run form, one row at a time: `env` (an environment variable, whose name must be a shell identifier) or `argv` (positional arguments `$1`, `$2` …, in row order, where the name is only a label). Each script's form remembers what was last typed into it.

## IPv6 DNS console

The "DNS" page keeps one AAAA record pointed at this host's public IPv6. Cloudflare and Alibaba Cloud are supported; the settings live in the database (**there are no environment variables for them**), and so does the history, capped at 500 rows.

A "Check and update" run follows one order: read the settings, detect the public address, query the provider, write, notify, record. Three rules are worth stating on their own:

- **A failed query writes nothing, and is never read as "there is no record".** For Cloudflare that misreading creates a second record for the same name.
- **An address that has not moved writes nothing at all.** No request, and no trace in the provider's audit log.
- **Alibaba Cloud never creates a record.** It updates by record id, and the host record and type it sends come from the API's own answer rather than from the form -- a wrong value cannot rename a live record -- and a record that does not exist is refused outright.

The probe asks `https://api6.ipify.org` and accepts only a public address: private, link-local, NAT64 and Teredo ranges are refused, and a refusal writes nothing. The probe **never uses a proxy**, so no `HTTP_PROXY` is needed and a proxy's egress address can never end up in a DNS record.

A Gotify notification is sent only when the record actually changed; a notification that fails does not change the run's outcome and is reported separately. The address and token are an **application setting** rather than part of this console -- see [Settings](#settings) -- so the console no longer holds a notification credential, and the next feature that wants to notify you does not have to borrow one.

The page shows what a check found and what it decided. The settings and the whole history are behind buttons rather than laid out on it: **Settings** opens the provider form, and the history panel shows the newest five with **View all** opening the paginated table. The overview page carries the same verdict as a one-line tile -- whether the record still points at this host, or that nobody has compared the two yet.

## Settings

`/#/settings` holds what belongs to the dashboard rather than to a feature:

- **Language.** English or 简体中文, remembered in the browser so it survives a reload. It changes the interface only; the log lines a script produces are not translated. The first visit follows `navigator.language`.
- **Notifications.** A Gotify address and application token, plus a button that sends a test message using whatever is in the boxes -- saved or not. Nothing is required: an address with no token is a notifier that is not set up yet, and the card says which of its three states applies.

Credentials are write-only: the API never returns one, so an empty box means "keep what is stored" and deleting is its own button. The same rule covers a target's ssh secret and the DNS provider tokens.

## Limitations

- One instance. SQLite in WAL mode and an in-process queue mean the API is not horizontally scalable.
- **Sign-in is off by default.** Without `AUTH_USERNAME`/`AUTH_PASSWORD` the dashboard runs open (it says so at boot); setting only one is a startup error.
- Even with sign-in on, the traffic is **plain HTTP** unless a TLS proxy sits in front; anyone who can watch the LAN can lift the session cookie.
- **SSH host keys are not verified** — the connection trusts whatever key the host presents.
- **Public GitHub repositories only**; cloning is unauthenticated HTTPS.
- **Only the entry script is uploaded.** `source ./lib.sh`, `cd "$(dirname "$0")"` and a `.psm1` beside the script do not work: they resolve relative to the staged file in `/tmp`, not to your working directory.
- **Every run on a target shares one working directory**, and two may run at once, so two scripts writing the same output file overwrite each other.
- **A restart interrupts** queued and running work (the scripts themselves keep running on the host and are then reported as `interrupted`).
- **Cancelling depends on `setsid`**; where it is missing, only the script process is killed, not the children it spawned.
- Stored output is capped by `MAX_LOG_BYTES`; past that the run is marked truncated.
- **One password opens both halves.** Whoever can sign in can run a script *and* repoint the domain's AAAA record — the API deliberately holds no provider credentials of its own, which is the price of a single sign-in.
- **The DNS half depends on the host's own IPv6 egress** (see above), which is why the container uses host networking.
- **The DNS credentials share `data/secret.key` with the SSH ones**: lose that file and both have to be entered again.
- Database migrations are **forward-only** — back up `data/` before upgrading.
- `.ps1` scripts need `pwsh` installed on the target.
- The image is not minimal: it carries the server's production dependency tree, `git` and `ca-certificates`. Building with `WITH_GIT=false` drops git and the libraries only it needs (119 MB → 110 MB), at the cost of GitHub sources; `local` ones are unaffected.

## License

MIT — see [LICENSE](LICENSE).
