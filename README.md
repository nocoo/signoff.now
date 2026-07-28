# signoff.now

围绕**开发者**与 **Git 仓库**的数据可视化与分析平台。

管理者在本机采集 Azure DevOps 数据，写入 Cloudflare D1；Web 配置实体与 Settings，**只读**展示 Activity / Score（管线写入）。

## 文档

| 文档 | 说明 |
|:-----|:-----|
| **[docs/01-项目定位.md](./docs/01-项目定位.md)** | 产品定位（**从这里读起**） |
| **[docs/02-数据结构与D1.md](./docs/02-数据结构与D1.md)** | D1 schema |
| **[docs/03-Web模块模板.md](./docs/03-Web模块模板.md)** | Web basalt 模板 + Worker/Access |
| **[docs/04-Settings设计.md](./docs/04-Settings设计.md)** | Settings CRUD 与 CLI 读路径 |
| **[docs/05-管线铺垫与Ingest实现.md](./docs/05-管线铺垫与Ingest实现.md)** | 06 开工前置契约（Ingest / 域包 / CLI 骨架） |
| **[docs/06-Activity重建与Score算法.md](./docs/06-Activity重建与Score算法.md)** | Activity 写入、折叠规则与计分 |
| **[docs/07-CLI命令矩阵与ADO落盘.md](./docs/07-CLI命令矩阵与ADO落盘.md)** | 真实 ADO 采集：命令矩阵、落盘、游标 |
| **[docs/08-真实数据上线与Dashboard统计.md](./docs/08-真实数据上线与Dashboard统计.md)** | 上线顺序、Dashboard 统计 API、运维手册 |

## 部署前提

- **Cloudflare Workers Paid plan**（05 起冻结）。Ingest 一次请求最坏 ≈ 71 D1 statement，超过 Free tier 每 invocation 50 的上限。详见 [docs/05 §5.2](./docs/05-管线铺垫与Ingest实现.md)。

## 本地运行（Dashboard + Settings CRUD）

```bash
# 0. 依赖
bun install

# 1. 本地 D1 migrations
bun run db:migrate:local

# 2. 同时起 Vite (:7042) + Worker (:37042, local D1)
bun run dev:all

# 或分开：
# bun run dev:worker   # 终端 1
# bun run dev          # 终端 2

# 3. 浏览器
#    https://signoff.dev.hexly.ai   （Caddy TLS，推荐）
#    或 http://localhost:7042
```

生产 Worker 静态资源：`bun run build:web` 产出 `apps/web/dist`，由 `wrangler.toml` `[assets]` 挂载（SPA fallback）。deploy / dry-run 前必须先 build web。

`POST /api/pipeline/ingest` **已实装**（06）：分块写 Activity、二次读回、聚合 Score、finalize。
单写者约定 —— 同一时刻只跑一个 ingest（06 §5.7）。

本地鉴权：Worker 对 `localhost` / `127.0.0.1` / `*.dev.hexly.ai` 跳过 Access（与 bat 一致）。侧栏显示 **Dev (anonymous)**。生产需配置 `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`。

| 端口 | 用途 |
|-----:|:-----|
| 7042 | Vite SPA |
| 37042 | Worker + local D1 |

## 包

| 包 | 说明 |
|:---|:-----|
| `apps/web` | Dashboard SPA |
| `packages/worker` | Hono API（settings + 实体 CRUD） |
| `packages/db` | D1 migrations |
| `apps/gitinfo` / `apps/pulse` | 质量标杆 CLI |

## 常用命令

```bash
bun run test:coverage
bun run lint
bun run typecheck
bun run security
```

## 运维手册

单写者约定：**同一时刻只跑一个 `ingest`**（06 §5.7）。并发 ingest 会用旧的
聚合覆盖新的。

### 指向生产

CLI 默认打本地 `127.0.0.1:37042`。要对生产采集，把这两项放进 `.env`
（已 gitignore）：

```bash
SIGNOFF_API_BASE=https://signoff-ingest.hexly.ai
SIGNOFF_PIPELINE_WRITE_TOKEN=<Worker 上同名 secret 的值>
```

**机器域名不能拿来开 Web**：它绕过 Access 是为了让 CLI 带 token 写入，
人要看 Dashboard 请走 `signoff.hexly.ai`。

**生产的第一批实体必须由人建**。`MACHINE_ROUTES`
（`middleware/entry-control.ts`）只放行 bootstrap / ingest /
recompute / live / me —— **CRUD 对机器一律 403**，机器不该能凭 token
凭空造出开发者或仓库绑定。所以新环境的顺序是：人登录
`signoff.hexly.ai` → 建 Developer / Repo → CLI 才有可采的 scope。

### 一次增量采集

```bash
bun run signoff -- doctor                     # az 登录、.data 可写、bootstrap 可达
bun run signoff -- settings pull               # 刷新本地 bootstrap 缓存
bun run signoff -- collect --repo <repoId>     # 采集 → .data/normalized/ + manifest
bun run signoff -- ingest normalized <artifact> --manifest <manifest>
```

`collect` **不会**推进游标 —— 它无从知道数据是否真的入库。游标由 `ingest`
在整个 scope 落地后提交（07 §7.1.2）。

耗时预期：`--since` 只收窄 `completed`/`abandoned`，**`active` 是全量拉取**，
而 threads/iterations 是 per-PR 调用。大仓首次采集以十分钟计（07 §8）。

### 配置变更后的全量重算

改 Settings（权重 / 后缀 / 时区）会 bump `pipeline_config_version` 并置
`scores_stale`。**增量 ingest 清不掉 stale**，必须走全量：

```bash
bun run signoff -- collect --full              # 不可与 --repo / --no-wi 同用
# collect 会打印 EVERY artifact —— 每个 repo scope 一个、每个 project scope 一个，
# 超过 5000 条活动的再拆分。**逐个** ingest，一个都不能漏：
bun run signoff -- ingest normalized <artifact-1> --manifest <manifest>
bun run signoff -- ingest normalized <artifact-2> --manifest <manifest>
# …直到最后一个
```

`scores_stale` 只在 manifest 里**所有** scope 都落地后才清除。少 ingest 一个
artifact，stale 就一直挂着 —— 这不是故障，是它在如实报告「还没算完」。
`ingest` 的输出会告诉你还差多少，分两种：

- `N artifact(s) still pending, cursor NOT advanced` —— 这个 **scope** 还有
  artifact 没进（大 scope 会被拆成多份），游标不动；
- `full_rematch: N scope(s) still pending` —— 该 scope 齐了，但**别的** scope
  还没齐，所以 stale 不清。

两句都不是错误，是它在如实报告进度。

`--full` 与 `--repo` / `--no-wi` 同用会被直接拒绝：`scores_stale` 是**全局**
标志，部分重算后清掉它，等于把没重算的仓也宣称为新鲜。

### 卡住的 ingest

Dashboard 显示「an ingest is in progress; numbers are still settling (run …)」
且长时间不消失时，说明有 chunk 停在 `prepared`（Phase 1 已写活动、Phase 3
的分数没算完）。**重发同一个 chunk 即可**——artifact 与 chunk 都是幂等的：

```bash
bun run signoff -- ingest normalized <同一个 artifact> --manifest <同一个 manifest>
```

这期间该 run 涉及的日期会被扣住不发布；不涉及的日期照常显示。

### 生产环境 Access

生产的受保护接口需要 `CF_ACCESS_TEAM_DOMAIN` 与 `CF_ACCESS_AUD`。
**未配置时 Worker 返回 500 而不是放行**（03 §8，fail-closed），所以线上首次
部署后接口不通是预期行为，不是故障。
（例外：`/api/live` 与 pipeline 机器端点走各自的鉴权，不经 Access。）

### Service Token（自动化访问管理接口）

CLI 的 pipeline token 只能走 ingest 那五条路由。要让脚本调用 **CRUD**
（建 Developer / Repo 等），得让它以 Access 身份进来 —— 用 Service Token，
而不是共享某个人的浏览器会话：

1. Zero Trust → Access → **Service Auth** → 建 Service Token，
   记下 `Client ID` 和 `Client Secret`（Secret 只显示一次）；
2. 打开保护 `signoff.hexly.ai` 的那个 Access Application → Policies →
   新增一条 **Service Auth** 策略，Include 选 `Service Token` → 选中刚建的那个。
   （不加这条策略，Token 会被拒。）

调用时带两个头：

```bash
curl -H "CF-Access-Client-Id: <id>" \
     -H "CF-Access-Client-Secret: <secret>" \
     https://signoff.hexly.ai/api/repos
```

Worker 侧不需要额外配置：Access 验证通过后签发的 JWT 走同一条 JWKS 校验。
但**身份形状不同** —— Service Token 的 JWT **没有 `email`**、`sub` 是空串，
唯一标识是 `common_name`（即 Client ID）。`principalFromPayload` 认这个字段并
把 `service: true` 透到 `/api/me`，否则审计里会出现一个没有名字的调用者。

**两个生产域名，一个 Worker，两条鉴权路径**：

| 域名 | 谁用 | 鉴权 |
|:---|:---|:---|
| `signoff.hexly.ai` | 人（浏览器） | Cloudflare Access（未登录 → 302 跳登录页） |
| `signoff-ingest.hexly.ai` | CLI | pipeline token，**不经 Access** |

拆开不是为了好看：`isMachineEndpoint`（`middleware/entry-control.ts`）
认 `signoff-ingest` 前缀并让该主机跳过 Access，机器才能在没有浏览器会话的
情况下写入。合成一个域名就意味着主域名上存在一条 Access 看不见的写入路径。

1. Cloudflare Zero Trust → Access → Applications 建一个应用，指向
   `signoff.hexly.ai`（**只保护它，不要包含 ingest 域名**；
   `workers.dev` 保留为退路）；
2. 复制该应用的 **AUD**，与 team domain（形如 `<team>.cloudflareaccess.com`）
   一起配成 Worker secret：

```bash
bunx wrangler secret put CF_ACCESS_AUD
bunx wrangler secret put CF_ACCESS_TEAM_DOMAIN
```

**两个都配齐再部署**。只配一个，`access-auth` 仍走
「未配置 → 500」那条分支（`middleware/access-auth.ts:47`），
线上会从「没配」变成「配了一半」，症状完全一样但更难查。

## 状态

Web dashboard（含活跃度统计）+ Settings / Developers / Teams / Tags / Repos CRUD 可本地运行；
pipeline bootstrap / ingest / complete 全部可用；`signoff collect` 可对真实 ADO 采集。
生产环境的 `/api/*` 需要先配好 Access（见「运维手册」末条）。
