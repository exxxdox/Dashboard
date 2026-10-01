# Dashboard

服务器现成 shell / PowerShell 脚本搬浏览器跑：参数可填、输出实时可见、每次运行留档。同界面还有 IPv6 DNS 控制台：保持一条 AAAA 记录指向本机公网 IPv6。

English: [README.en.md](README.en.md)

---

## 目的

把散在各台机器上的脚本收拢成一份可点击、可留档、主机侧零依赖的运行时 —— 它不是编排器、配置管理或 CI，只负责跑已有脚本并留下记录。

## 快速开始

```bash
cp .env.example .env      # 至少改 SCRIPT_ROOT_HOST
docker compose up -d --build
```

开 `http://<宿主地址>:50014`（或 `.env` 中 `DASHBOARD_PORT`）。界面依次：加 Target（SSH 目标）→ 加 Source（脚本来源）→ 同步 → 运行。

## docker compose

用 **host 网络**（不是端口映射），宿主须有**公网 IPv6 出站能力** —— DNS 链路必须走宿主自己的 IPv6 出口，网桥网络拿到的是另一个地址。其余说明见 `compose.yaml` 的文件头注释。

## 环境变量

写 `.env`。需要自己决定的只有两项，其余都有可用默认值：

| 变量 | 含义 |
|---|---|
| `SCRIPT_ROOT_HOST` | 脚本宿主机目录，挂载进容器供扫描。**必填** |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | 登录凭据，**要么都设要么都不设**；不设即开放访问（启动告警） |

端口、目录属主、并发上限、超时、日志与保留策略、`SECRET_KEY`、`GIT_PROXY`、构建镜像源等，见 `.env.example` 的逐项说明。

## 写脚本

来源里任何 `.sh` / `.ps1` 都收录（分别用 `bash` 与 `pwsh` 跑，后者需目标机已装）。脚本**开头**注释块变成界面表单：

```bash
# @name Deploy API
# @timeout 600
# @param ENV required Target environment
# @param REPLICAS type=number default=3 How many replicas
```

声明参数以**环境变量**传入。脚本未声明的值可临时加：运行表单每行选 `env`（环境变量，名须是 shell 标识符）或 `argv`（位置参数 `$1 $2`，按行序，名只是标签）。每个脚本表单记住上次填的内容。

## IPv6 DNS 控制台

「DNS」页把一条 AAAA 记录保持指向本机的公网 IPv6，服务商支持 Cloudflare 与阿里云。

## 设置页

`/#/settings` 放整个仪表盘的偏好：界面语言（English / 简体中文），以及 Gotify 通知的地址与令牌。

## License

MIT，见 [LICENSE](LICENSE)。
