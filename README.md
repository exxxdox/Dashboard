# Dashboard

把你服务器上现成的 shell / PowerShell 脚本搬到浏览器里跑：参数可填、输出实时可见、每次运行都留档。

English: [README.en.md](README.en.md)

---

## 目的

服务器一多，维护脚本就会变成这样：几十个 `.sh` 散在各台机器的 `/root`、`/srv`、`/opt` 里，版本对不上；跑之前先 SSH 进去，跑完输出滚走了什么都不剩；同一个脚本在两台机器上还不是同一份。

这个项目把这件事收拢到一处：

- **脚本只有一个来源。** 脚本住在你的 git 仓库或共享目录里，仪表盘负责克隆与扫描；机器上那份是运行时上传的临时副本，跑完即删 —— 两边不可能不一致。
- **不用先 SSH。** 点击即跑，参数在表单里填，输出实时推回浏览器，历史可查。
- **主机侧零依赖。** 目标只需要一个 SSH 服务和一个 POSIX shell：不装 agent、不需要 git、不需要挂载任何目录、不需要与容器共享路径。
- **参数不走命令行。** 声明式参数以**环境变量**传入，绝不当 argv，一个值不会被当成 flag 或命令；需要位置参数的脚本可显式选择 `argv` 模式（值经引用转义后拼入命令行）。
- **跑过的就是记下的。** 每次运行记录目标、参数、退出码与完整输出。

**它不是什么。** 不是编排器（没有 DAG、没有重试策略、不保证幂等），不是配置管理（不维护目标机的期望状态），不是 CI（不监听 git 事件，也不会自动跑）。它只负责把已有的脚本跑起来并留下记录。

## 快速开始

```bash
cp .env.example .env      # 至少改 SCRIPT_ROOT_HOST 与 PUID/PGID
docker compose up -d --build
```

打开 `http://<宿主地址>:50014`（或 `.env` 中的 `DASHBOARD_PORT`）。之后在界面上依次：添加 Target（SSH 目标）→ 添加 Source（脚本来源）→ 同步 → 运行。

## docker compose

仓库的 `compose.yaml` 是模板，要点就这几行：

```yaml
services:
  dashboard:
    build: .
    restart: unless-stopped
    network_mode: host                              # 见下：需要宿主原生 IPv6
    environment:
      PORT: ${DASHBOARD_PORT:-50014}                # host 网络下这就是宿主端口
    volumes:
      - ./data:/data                                 # 数据库 + 凭据加密密钥
      - ${SCRIPT_ROOT_HOST:-./workspace}:/workspace  # 脚本目录（容器读它来克隆/扫描）
    user: "0:0"
```

- **用 host 网络，不用端口映射**：DNS 那条链路必须走宿主自己的 IPv6 出口，网桥网络拿到的是另一个地址。代价是容器直接占用宿主端口，`DASHBOARD_PORT` 必须在本机空闲，且 `ports:` 与 `network_mode` 互斥、在这里根本不能写。
- **要求宿主本身具备公网 IPv6 出站能力**：探测走 `api6.ipify.org` 的 IPv6 端点，探测不到就只报错、绝不写 DNS。
- **`./data` 必须备份**：里面是 SQLite 数据库与 `secret.key`。密钥丢了，已存的 SSH 凭据与 DNS 服务商凭据就都解不开，只能重新录入。
- **`user: "0:0"` 只在启动那一瞬是 root**：绑定挂载会遮住镜像层的属主设置，入口脚本把两个挂载点 `chown` 成 `PUID:PGID` 后立刻降权，仪表盘进程从不以 root 运行。所以 `PUID`/`PGID` 要与脚本目录属主一致。
- **host 网络下服务监听宿主全部网卡**，本机可达即局域网可达。要限制来源，就设 `HOST` 绑到某个网卡地址，或放到反向代理后面。

## 环境变量

写在 `.env`，完整示例见 `.env.example`：

| 变量 | 默认 | 含义 |
|---|---|---|
| `SCRIPT_ROOT_HOST` | — | 存放脚本的宿主机目录，挂载进容器供扫描。**必填** |
| `PUID` / `PGID` | `1000` | 上述目录的属主。容器接管挂载点属主后降权到该用户 |
| `DASHBOARD_PORT` | `50014` | 监听端口。host 网络下即宿主端口，必须本机空闲 |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | 未设 | 登录凭据，**必须同时设置**；不设则开放访问（启动告警） |
| `LOG_LEVEL` | `info` | `fatal`…`trace` |
| `MAX_CONCURRENT_EXECUTIONS` | `4` | 全局同时运行的脚本数 |
| `MAX_CONCURRENT_PER_TARGET` | `2` | 单个目标同时运行的脚本数 |
| `DEFAULT_TIMEOUT_SEC` | `1800` | 脚本与本次运行都没指定超时时使用 |
| `MAX_LOG_BYTES` | `5242880` | 单次运行**存储**的输出上限，超出标记为已截断 |
| `RETENTION_DAYS` | `30` | 清理超过该天数的已结束运行；`0` 表示全留 |
| `SECRET_KEY` | 自动生成 | 32 字节随机数的 base64，用于加密 SSH 凭据 |
| `GIT_PROXY` | 无 | 克隆仓库走的代理，如 `http://192.168.1.10:7890`，仅作用于 git 传输 |
| `NPM_REGISTRY` / `ALPINE_MIRROR` | 官方源 | 构建镜像时的 npm / Alpine 镜像。`ALPINE_MIRROR` **只写主机名**，写完整 URL 会导致构建失败；镜像站的 alpine 目录须在 `/alpine` 下 |

容器内的两个路径：`DATA_DIR`（`/data`）放数据库与密钥，`SCRIPT_ROOT_CONTAINER`（`/workspace`）是挂载点。

## 写脚本

来源里任何 `.sh` / `.ps1` 都会被收录（分别用 `bash` 与 `pwsh` 运行，后者需目标机已安装）。脚本**开头**的注释块会变成界面上的表单：

```bash
# @name Deploy API
# @timeout 600
# @param ENV required Target environment
# @param REPLICAS type=number default=3 How many replicas
```

声明参数以**环境变量**传入。脚本没声明的值可以临时加：运行表单里每行选 `env`（环境变量，名字须是 shell 标识符）或 `argv`（位置参数 `$1 $2`，按行序，名字只是标签）。每个脚本的表单会记住上次填的内容。

## 缺陷

- 单实例。SQLite 的 WAL 与进程内队列决定了 API 无法横向扩展。
- **登录默认是关的。** 不设 `AUTH_USERNAME`/`AUTH_PASSWORD` 即开放访问（启动时告警）；只设一个直接启动失败。
- 即便开了登录，**流量仍是明文 HTTP**（除非前面加 TLS 反代）；能监听局域网的人可以拿走会话 cookie。
- **不校验 SSH 主机密钥**，连接信任对方出示的任何密钥。
- **只支持公开 GitHub 仓库**，克隆走匿名 HTTPS。
- **只上传入口脚本。** `source ./lib.sh`、`cd "$(dirname "$0")"`、脚本旁边的 `.psm1` 都不工作 —— 它们相对于 `/tmp` 里那份暂存文件解析，而不是你的工作目录。
- **同一目标的所有运行共用一个工作目录**，且可能并发两个，两个脚本写同一个输出文件会互相覆盖。
- **重启会中断**排队中与运行中的任务（脚本本身在宿主机上会继续跑完，之后被标记为 `interrupted`）。
- **取消依赖 `setsid`**；目标机没有它时只能杀掉脚本进程本身，不含其派生的子进程。
- 存储的输出有上限（`MAX_LOG_BYTES`），超出即标记截断。
- 数据库迁移**只往前、不回滚** —— 升级前先备份 `data/`。
- `.ps1` 需要目标机上已安装 `pwsh`。
- 镜像不算精简：带服务端生产依赖树、`git` 与 `ca-certificates`。

## License

MIT，见 [LICENSE](LICENSE)。
