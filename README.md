<p align="center">
  <img src="assets/brand/icon-rounded.png" width="128" alt="signoff.now logo" />
</p>
<h1 align="center">signoff.now</h1>
<p align="center">面向管理者的 Azure DevOps 开发活动分析控制台。</p>
<p align="center">
  <a href="https://signoff.hexly.ai">站点</a> ·
  <a href="docs/README.en.md">English</a>
</p>

## 这是什么

signoff.now 将已登记开发者在 Azure DevOps 中的 PR、评审投票和工作项活动汇总到 Web 控制台。管理者在本机运行 CLI，保留采集原始数据、标准化文件和 manifest，再通过 Worker 写入 Cloudflare D1。Web 管理人员、团队、标签、仓库和计分设置，展示按日积分与活动明细。

项目面向单实例使用，目前的主采集管线支持 Azure DevOps。积分依据可配置权重和事件折叠规则计算，适合结合具体活动了解参与情况，不能单独代表代码质量或个人产出。仓库内另有 `gitinfo` 和 `pulse` 辅助 CLI；后者的 GitHub 查询能力独立于主采集管线。

## 功能

- **维护分析范围**：管理 Developer、Team、Tag 和 Repo，支持归档与恢复；用开发者 alias 与 Settings 中的邮箱后缀匹配 ADO 身份。
- **采集并保留来源**：按仓库采集 PR、线程与迭代，按项目采集工作项和更新记录；原始数据、标准化活动和采集清单落在本机 `.data/`。
- **查看活动变化**：Dashboard 提供 7 / 28 / 92 天概览、每日趋势、活动类型分布和开发者积分列表；Activity 页面支持多人按日对比和单人分页时间线。
- **按明确规则计分**：处理 PR 与工作项的八类活动，按配置时区归日；同一开发者同日的同一 PR 作者事件、同一工作项更新按规则折叠。配置过期或相关写入未完成时，页面会提示并暂缓显示受影响的数字。
- **继续未完成的写入**：manifest 记录每份 artifact 的进度；同一 scope 全部写入后才提交采集游标，重发原文件可继续中断的 ingest。

## 使用

打开[站点](https://signoff.hexly.ai)，通过该部署的 Cloudflare Access 验证后进入控制台。先建立开发者和启用的 ADO 仓库绑定，填写仓库及项目 GUID，并在 Settings 配置邮箱后缀、时区和权重。实体也可以通过下文的 Access Service Token 管理接口建立。

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
bun run --cwd packages/worker wrangler d1 migrations apply signoff-db --config ../../wrangler.toml --local
bun run --cwd packages/worker dev --local-upstream localhost
```

在另一个终端从仓库根目录运行前端：

```bash
bun run dev
```

打开 `http://localhost:7042`。Vite 将 `/api` 代理到本地 Worker `37042`。上述命令使用 worker workspace 已安装的 Wrangler，`--local-upstream localhost` 使 Worker 保留本地主机名并进入开发认证分支。已有受信 HTTPS 反向代理时，可使用 `https://signoff.dev.hexly.ai`。

本地回环地址与 `*.dev.hexly.ai` 使用开发认证分支，无须生产 Access 或 pipeline 凭据。`.env.example` 预填生产机器域名，只在需要连接已有部署时复制并填写。

`bun run build:web` 先做前端类型检查，再生成 `apps/web/dist`；Worker 同时提供 API 和这些 SPA 静态资源。代码检查使用 `bun run lint`、`bun run typecheck`；`bun run security` 需要已安装 `osv-scanner` 和 `gitleaks`。

| 路径 | 职责 |
| --- | --- |
| `apps/web` | React 页面、客户端 model 与 viewmodel |
| `apps/collect` | ADO 采集、文件落盘与 ingest CLI |
| `packages/domain` | 身份匹配、事件转换、分块契约与计分规则 |
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
| 本地采集管线 fixture | `PATH="$PWD/packages/worker/node_modules/.bin:$PATH" bash scripts/e2e-06-local.sh` | 新的默认本地 D1，且 Worker 已运行 |

管线 fixture 测试请使用独立测试副本，先执行 `bun run build:web`，再在另一终端运行 `bun run --cwd packages/worker dev --local-upstream localhost`。测试命令的 PATH 让原脚本使用 workspace 已安装的 Wrangler。脚本会应用本地 migrations、种入测试实体、写入 `.data/` 并验证 ingest、热力图和时间线；它要求初始 Settings（配置版本 `1`），会改写该副本的本地数据。

## 技术栈

| 技术 | 用途 |
| --- | --- |
| ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Bun](https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white) | 应用逻辑、CLI 与 monorepo 脚本 |
| ![React](https://img.shields.io/badge/React-149ECA?logo=react&logoColor=white) ![Basalt](https://img.shields.io/badge/Basalt-222222) | 控制台页面、设计 token 与交互组件 |
| ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white) | 界面样式与主题 |
| ![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white) | 本地开发与 SPA 构建 |
| ![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white) ![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white) | API 路由、中间件与静态资源托管 |
| ![Cloudflare D1](https://img.shields.io/badge/Cloudflare_D1-F38020?logo=cloudflare&logoColor=white) | 实体、Settings、活动与积分存储 |
| ![Cloudflare Access](https://img.shields.io/badge/Cloudflare_Access-F38020?logo=cloudflare&logoColor=white) | Web 入口和管理 API 身份认证 |
| ![Azure DevOps](https://img.shields.io/badge/Azure_DevOps-0078D7) | PR、评审与工作项数据来源 |
| ![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white) ![Bun test](https://img.shields.io/badge/Bun_test-000000?logo=bun&logoColor=white) | 各 workspace 测试 |

## 文档

- [文档索引](docs/README.md)：产品定位、D1、Web、Settings 与管线设计。
- [采集命令、落盘与游标](docs/07-CLI命令矩阵与ADO落盘.md) · [Activity 与 Score 规则](docs/06-Activity重建与Score算法.md)。
- [上线与 Dashboard 统计](docs/08-真实数据上线与Dashboard统计.md)：部署、查询和对账说明。
- [辅助 CLI](docs/cli/README.md) · [Logo 使用](docs/09-logo-usage.md) · [品牌展示](https://hexly.ai/logos/signoff-now)。

## 许可证

[MIT](LICENSE)
