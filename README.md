<p align="center">
  <img src="assets/brand/icon-rounded.png" width="128" alt="signoff.now logo" />
</p>
<h1 align="center">SignOff</h1>
<p align="center">一眼看清每个项目的 PR 状态、卡点和下一步。</p>
<p align="center">
  <a href="https://signoff.hexly.ai">站点</a> ·
  <a href="docs/README.en.md">English</a>
</p>

## 这是什么

SignOff 为大型项目维护者提供跨项目 PR 工作台。用户添加 Azure DevOps 项目后，可以查看各仓库的 PR、必需 policy、评审、多个 build 和每个 build 的 stage，知道哪里失败、谁需要处理、下一步做什么。第一期专注 PR，issue / ADO work item 放在后续阶段。

**当前支持本地真实 ADO PR 采集**：本机 Azure CLI 提供登录令牌，采集器读取 ADO API，将统一后的 PR、policy、build 和 stage 快照写入本地 Worker / Wrangler SQLite。工作台显示采集队列、进度和登录状态。全局 Live / Sample 切换分别查看真实数据与 5 个项目、13 个仓库、46 个 PR 的示例；示例同时包含 ADO 和 GitHub。GitHub 的真实采集后续通过 `gh` 接入同一数据契约。

| 能力 | Azure DevOps | GitHub |
| --- | --- | --- |
| 项目增删改查 | 已实现 | 后续开放 |
| PR / policy / build / stage 展示 | 已接入真实数据，保留示例预览 | 已有示例预览，真实采集待接入 |
| 真实 PR 快照采集 | 本地 `az` 登录 + ADO API | 后续接入 `gh` |

仓库原有的 Activity / Score API 及 ADO 活动采集 CLI 仍然保留。它们与新 PR 工作台、成员目录和贡献统计的数据契约分开；`pulse` 已有的 GitHub 查询能力也尚未连接到工作台。

网页和外部 CLI 共用持久关注清单，通过 API 显式加入 / 移出 PR。查询只读已发布缓存，后台独立刷新关注项，确认 merged / closed 后自动停止刷新。首次启用该架构时关注清单为空，后续升级保留已有关注项与 PR 缓存；打开页面和查询均不产生源站采集，daemon 只执行已保存任务与关注刷新。详见[采集、关注清单与缓存查询架构](docs/14-collector-architecture.md)。

## 功能

- **项目管理**：添加、编辑、删除多个 organization 下的 ADO 项目，配置仓库范围，查看任务历史。
- **跨项目 PR 队列**：按 Organization → Project → Repository 筛选，默认排除 Draft，作者可多选。表头可排序，默认按项目的 Readiness 顺序将最就绪的 PR 放在前面；筛选和排序方向保存在 URL 与 localStorage，每页 20 个 PR。
- **明确合并条件**：冲突、必需检查失败、评审意见、部署审批、未知检查分别显示；可选检查失败不会误挡合并。
- **构建阶段详情**：每个 PR 可展开多个 build，逐项查看 stage 状态、时长、说明和负责人。
- **共享关注清单**：标题前独立的眼睛按钮可切换单个 PR 的关注状态；复选框支持当前页多选、批量加入 / 移出，快捷筛选已关注和未关注 PR。点击后立即反馈，后台提交，失败只回滚相应项，不阻塞其他行或整表刷新。网页与 CLI 操作同一份清单，完整身份区分 provider、组织、项目、仓库与 PR 编号；Draft 也可以关注。
- **独立后台刷新**：首次发现包含全部可访问 PR 历史与状态，后续从上次成功边界增量发现新 PR；`discover --full` 可重新核对旧历史，发现不会自动关注。daemon 只刷新 active 关注项，项目整轮结束后默认冷却 5 分钟，关闭网页仍继续。确认终态才自动淘汰；失败、登录过期或列表缺失均保留关注和旧缓存。侧栏底部、头像上方显示任务进度；收起侧栏时保留状态图标。
- **PR 阅读与操作**：描述支持 Markdown、表格和任务清单；PR 编号和真实 PR 标题旁的链接可在新标签页打开源 PR。人名前显示圆形双字母头像。
- **项目 Readiness**：从实际 Policy 和 PR 快照读取全部合并要求，拖动或用键盘箭头定义处理顺序、颜色和名称。第一个未完成要求决定主要卡点，只剩靠后条件的 PR 排在前面；PoP 无内置特例。设置保存在项目数据库中。
- **页面结构**：统一主标题、次标题和顶栏面包屑；PR 页以仓库路径作为次标题，筛选结果的状态统计集中展示。
- **成员与团队**：从 PR 作者发现并关注成员，显式关联跨组织账号，维护团队及标签，Live / Sample 完全隔离。
- **仓库与贡献统计**：Repos 汇总仓库 PR；Insights 按合并日期、成员、团队、标签和仓库筛选；仅合并时间落在所选区间的 PR 计入贡献。每个模块独立手动计算，超过 24 / 72 小时分别标黄 / 红。默认不含 Draft。详见 [成员目录与贡献统计](docs/13-成员目录与PR贡献统计.md)。

## 使用

按下方[开发](#开发)步骤启动 Worker 和 Web，在 **Projects** 添加 ADO organization、project 和可选的仓库范围，再启动本地采集器：

```bash
az login --scope 499b84ac-1321-427f-aa17-267ca6975798/.default
bun run dev:collector
```

已有有效 Azure CLI 登录时直接启动即可。先在网页点击 **Discover PRs**，再勾选候选 PR 并点击 **Add to watch list**。关注清单默认为空，添加关注后才持续拉取检查；**Refresh watched** 只对关注项入队。登录过期会先尝试静默续期；需要交互登录时，按页面或 CLI 提示重新运行 `az login`，采集器随后恢复。

同一流程也可通过 CLI 完成（示例地址和 PR 编号请替换为自己的仓库）：

```bash
bun run signoff repo add 'https://dev.azure.com/acme/Platform/_git/web-app'
bun run signoff discover --repo 'https://dev.azure.com/acme/Platform/_git/web-app'
# 等 discovery 任务完成后读取候选；查询命令不调用 ADO
bun run signoff pr list --state all --draft include --all
bun run signoff watch add 'https://dev.azure.com/acme/Platform/_git/web-app/pullrequest/123'
bun run signoff watch list --all
bun run signoff pr get 'https://dev.azure.com/acme/Platform/_git/web-app/pullrequest/123'
```

短命 CLI 无需源站认证，只连接回环地址上的本地 Worker；daemon 执行任务时才使用 `az`。两者不读取 Activity 管线的生产写入令牌。`workbench watch` 是 `daemon` 的兼容入口；`workbench sync` 只入队按需发现。外部消费者接入见 [CLI / HTTP 契约](docs/18-cli-query-contract.md)，启动和恢复见 [11 — 真实 PR 采集](docs/11-真实PR采集与本地工作台.md)。

开发期无需发布 CLI，其他 App 可直接调用 `bun /Users/nocoo/workspace/personal/signoff.now/apps/collect/src/main.ts watch list --all`。完整路径和进程调用示例见 [CLI 接入说明](docs/18-cli-query-contract.md#6-其他项目接入示例)，agent 可使用随仓库维护的 [signoff-cli skill](skills/signoff-cli/SKILL.md)。

以下运维命令用于既有 Activity / Score 管线。生产站点仍使用 Cloudflare Access；这次本地预览没有部署到线上。既有管线先建立 Developer 和 Repo 绑定，再配置 Settings，不会读取新 `projects` 表作为采集范围。

采集在本机执行。先按[开发](#开发)安装依赖，准备 Azure CLI，执行 `az login`，并确认登录账号可读取所绑定的 ADO 项目。CLI 通过 `az account get-access-token` 获取 ADO REST API 所需的访问令牌。

### 运维手册

同一时刻只运行一个 `ingest`，避免并发聚合覆盖。CLI 默认访问本地 `http://127.0.0.1:37042`；连接现有生产部署时，在已被 Git 忽略的 `.env` 中填写：

```dotenv
SIGNOFF_API_BASE=https://signoff-ingest.hexly.ai
SIGNOFF_PIPELINE_WRITE_TOKEN=<matching Worker secret>
```

`.env.example` 提供生产连接及自动化凭据模板。将 `.env` 权限设为 `600`；本地开发使用默认回环地址即可。

| 生产入口 | 用途 | 认证 |
| --- | --- | --- |
| `signoff.hexly.ai` | Web 与实体 / Settings 管理接口 | Cloudflare Access |
| `signoff-ingest.hexly.ai` | CLI bootstrap、ingest、recompute | Pipeline token |

机器入口只允许管线接口及 `live` / `me`，pipeline token 不能用于实体 CRUD；浏览器端的 Access 身份也不能调用管线接口。

#### 首次采集与全量重算

初次建档，或权重、邮箱后缀、时区等变更使分数过期后，运行全量采集。以下示例中的路径与 `repo-id` 需替换为实际值：

```bash
bun run signoff -- doctor
bun run signoff -- settings pull
bun run signoff -- collect --full
# 对 collect 输出的每一份 artifact，使用同一份 manifest 依次执行：
bun run signoff -- ingest normalized "path/to/artifact.json" --manifest "path/to/manifest.json"
```

`--full` 不能与 `--repo` 或 `--no-wi` 同用。采集可能按仓库、项目及活动数量拆成多份 artifact；只有所有所需 scope 都完整写入，CLI 才会请求清除 `scores_stale`。增量写入无法清除这一标志。

#### 日常增量与恢复

```bash
bun run signoff -- collect --repo repo-id
bun run signoff -- ingest normalized "path/to/artifact.json" --manifest "path/to/manifest.json"
```

`collect` 本身不推进游标。提示 `artifact(s) still pending` 表示当前 scope 尚未齐全；`full_rematch: scope(s) still pending` 表示其他 scope 仍未完成。继续处理 manifest 中的剩余文件即可。

若写入中断，或 Dashboard 持续提示 ingest 尚在进行，重发同一 artifact 和 manifest。已完成的 chunk 可幂等重放；尚未完成的 chunk 会继续处理。artifact 绑定采集环境的开发者和仓库 ID，不能直接跨环境重放。

`--since <date>` 可调整增量起点，但 active PR 仍全量拉取，且线程和迭代需要逐个 PR 查询；大仓库的采集时间取决于 PR 数量和 ADO 响应。

### Service Token

自动化管理实体时，创建 Cloudflare Access Service Token，并在保护 `signoff.hexly.ai` 的 Access Application 中添加包含该 token 的 **Service Auth** 策略。只创建 token、未添加策略时，请求仍可能被重定向到登录页。

将客户端凭据保存在 `.env` 的 `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`，请求携带对应的两个头：

```bash
curl -H "CF-Access-Client-Id: <id>" \
     -H "CF-Access-Client-Secret: <secret>" \
     https://signoff.hexly.ai/api/repos
```

这组凭据用于请求管理入口，不是 Worker secret。Access 验证后签发的 JWT 由 Worker 校验；服务身份通过 `common_name` 识别，并在 `/api/me` 标记为 `service: true`。

## 开发

准备 Bun（仓库 `packageManager` 与 CI 固定为 1.4.0）、Node.js 22.22.1–22.x、24.x 或 26+ 和 Git。Vite / Vitest 及 pre-commit 工具使用 Node.js，CLI 使用 Bun。

```bash
git clone https://github.com/nocoo/signoff.now.git
cd signoff.now
bun install --frozen-lockfile
bun run build:web
bun run db:migrate:local
bun run db:seed:local
bun run dev:worker
```

在另一个终端从仓库根目录运行前端：

```bash
bun run dev
```

打开 `http://localhost:7042`。Vite 将 `/api` 代理到本地 Worker `37042`。开发脚本已包含 `--local-upstream localhost` 和本地 Demo 开关。已有受信 HTTPS 反向代理时，可使用 `https://signoff.dev.hexly.ai`。

数据位于 `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`。`db:seed:local` 只重置 5 个预置 Demo 项目及其 PR / 扫描记录，保留其他项目与既有分析数据；它没有远端写入选项。表结构见 `packages/db/migrations/`；`0019_observed_pull_requests.sql` 引入共享关注清单、仓库目录、任务租约和快照版本，并取消旧页面采集任务。后续 `0020_resolved_project_scope.sql` 保留已存清单和缓存，让项目编辑按稳定仓库 ID 与 Unicode 名称别名校验范围。本地与线上 D1 使用相同的 schema，真实 PR 采集本轮只接入本地数据库。

本地回环地址与 `*.dev.hexly.ai` 使用开发认证分支，无须生产 Access 或 pipeline 凭据。`.env.example` 预填生产机器域名，只在需要连接已有部署时复制并填写。

`bun run build:web` 先做前端类型检查，再生成 `apps/web/dist`；Worker 同时提供 API 和这些 SPA 静态资源。代码检查使用 `bun run lint`、`bun run typecheck`；`bun run security` 需要已安装 `osv-scanner` 和 `gitleaks`。

| 路径 | 职责 |
| --- | --- |
| `apps/web` | React 页面、客户端 model 与 viewmodel |
| `apps/collect` | ADO 采集、文件落盘与 ingest CLI |
| `packages/domain` | 统一 PR 契约、就绪判定、Mock 场景，以及既有活动计分规则 |
| `packages/worker` / `packages/db` | Hono API、D1 写入与 SQL migrations |
| `apps/gitinfo` / `apps/pulse` | 本地 Git 与 GitHub 查询辅助工具 |

### 部署配置

当前部署约定使用 Cloudflare Workers Paid plan、D1 和 Cloudflare Access。自托管时先调整 [wrangler.toml](wrangler.toml) 的 D1 数据库 ID 与域名，按[上线文档](docs/08-真实数据上线与Dashboard统计.md)应用远端 migrations 并构建 Web。

为 Web 域名配置整域 Access Application；机器域名独立使用 pipeline token，其首个域名标签必须为 `signoff-ingest`，与当前路由识别逻辑一致。Worker 需要以下 secrets：

```bash
bunx wrangler secret put CF_ACCESS_AUD
bunx wrangler secret put CF_ACCESS_TEAM_DOMAIN
bunx wrangler secret put SIGNOFF_PIPELINE_WRITE_TOKEN
```

前两项分别来自 Access Application 的 AUD 与完整 team domain（如 `example.cloudflareaccess.com`，不含协议）。受保护 API 缺任意一项会返回 `500`；`/api/live` 和机器管线入口走各自的访问规则。`SIGNOFF_PIPELINE_READ_TOKEN` 可单独设置为只读管线凭据，未设置时读请求沿用 write token。当前配置保留 `workers.dev` 作为备用入口。

## 测试

| 层次 | 运行方法 | 前提 |
| --- | --- | --- |
| 单元与 API handler | `bun run test` | 已安装依赖；各 workspace 使用 Bun test 或 Vitest |
| 覆盖率 | `bun run test:coverage` | 同上 |
| Git 子进程集成 | `bun run --cwd apps/gitinfo test:integration` | 本机可运行 Git |
| 浏览器 + Worker + CLI E2E | `bun run test:e2e` | Chrome 或 Playwright Chromium；自动分配临时 D1、端口与 fixture，无需 Azure 登录 |
| 旧 Activity 管线 fixture | `PATH="$PWD/packages/worker/node_modules/.bin:$PATH" bash scripts/e2e-06-local.sh` | 新的默认本地 D1，且 Worker 已运行 |

PR 工作台的模型、HTTP 契约、ViewModel、CLI 认证、采集归一化和 SQLite 并发写入测试包含在上述测试中。浏览器 E2E 使用真实 Worker HTTP、独立 Wrangler D1 和 CLI 子进程，仅 provider 边界使用 fixture；不会访问 Azure 或改动日常数据库。真实数据验收见 [11 — 真实 PR 采集](docs/11-真实PR采集与本地工作台.md)，示例预览见 [10 — PR 工作台与 Mock 预览](docs/10-PR工作台与Mock预览.md)。

管线 fixture 测试请使用独立测试副本，先执行 `bun run build:web`，再在另一终端运行 `bun run --cwd packages/worker dev --local-upstream localhost`。测试命令的 PATH 让原脚本使用 workspace 已安装的 Wrangler。脚本会应用本地 migrations、种入测试实体、写入 `.data/` 并验证 ingest、热力图和时间线；它要求初始 Settings（配置版本 `1`），会改写该副本的本地数据。

## 技术栈

| 技术 | 用途 |
| --- | --- |
| ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Bun](https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white) | 应用逻辑、CLI 与 monorepo 脚本 |
| ![React](https://img.shields.io/badge/React-149ECA?logo=react&logoColor=white) ![Basalt](https://img.shields.io/badge/Basalt-222222) | 控制台页面、设计 token 与交互组件 |
| ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white) | 界面样式与主题 |
| ![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white) | 本地开发与 SPA 构建 |
| ![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white) ![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white) | API 路由、中间件与静态资源托管 |
| ![Cloudflare D1](https://img.shields.io/badge/Cloudflare_D1-F38020?logo=cloudflare&logoColor=white) | 实体、配置、PR 快照、贡献统计、活动与积分存储 |
| ![Cloudflare Access](https://img.shields.io/badge/Cloudflare_Access-F38020?logo=cloudflare&logoColor=white) | Web 入口和管理 API 身份认证 |
| ![Azure DevOps](https://img.shields.io/badge/Azure_DevOps-0078D7) | PR、评审与工作项数据来源 |
| ![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white) ![Bun test](https://img.shields.io/badge/Bun_test-000000?logo=bun&logoColor=white) | 各 workspace 测试 |

## 文档

- [文档索引](docs/README.md) · [当前关注与查询架构](docs/14-collector-architecture.md)。
- 实现契约：[网页与多选观察](docs/15-web-query-contract.md) · [刷新状态机与淘汰](docs/16-scheduler-state-machine.md) · [Query 周期](docs/17-query-cadence.md) · [CLI 对外契约](docs/18-cli-query-contract.md)。
- 当前实现：[真实 PR 工作台](docs/11-真实PR采集与本地工作台.md) · [成员与贡献统计](docs/13-成员目录与PR贡献统计.md) · [Mock 场景](docs/10-PR工作台与Mock预览.md)。
- [采集命令、落盘与游标](docs/07-CLI命令矩阵与ADO落盘.md) · [Activity 与 Score 规则](docs/06-Activity重建与Score算法.md)。
- [上线与 Dashboard 统计](docs/08-真实数据上线与Dashboard统计.md)：部署、查询和对账说明。
- [辅助 CLI](docs/cli/README.md) · [Logo 使用](docs/09-logo-usage.md) · [品牌展示](https://hexly.ai/logos/signoff-now)。

## 许可证

[MIT](LICENSE)
