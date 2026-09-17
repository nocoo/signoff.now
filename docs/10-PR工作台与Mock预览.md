# 10 — PR 工作台与 Mock 预览

> 2026-09-17 · 本地 UI 预览已实现。Basalt 清理基线 `1dd22e3` 已推送；本阶段没有部署或写入远端 D1。

## 当前进度

| 工作项 | 状态 |
| --- | --- |
| Basalt 控件、主题、布局清理与独立审查 | 完成，清理版已推送 |
| Provider-neutral PR 契约与就绪判定 | 完成 |
| 本地 Wrangler D1 migration 与 Mock 数据 | 完成：4 项目、12 仓库、38 PR |
| ADO 项目增删改查、暂停 / 恢复 | 完成 |
| 跨项目 PR 队列、搜索、筛选、分页 | 完成 |
| PR 详情、评审、policy、build / stage、活动 | 完成 |
| 模拟扫描、扫描历史、15 秒自动刷新 | 完成；进度写入本地库 |
| 真实 ADO PR / policy / timeline 采集 | 下一阶段 |
| GitHub `gh` 接入 | 后续阶段 |
| issue / ADO work item 工作台 | 后续阶段 |

## 数据从哪里来，存在哪里

当前数据源为 `packages/domain/src/demo.ts` 中可重复生成的虚构场景。`scripts/seed-demo.ts` 将它们写入本地 D1；浏览器从 Worker API 读取数据库，没有把 PR 列表硬编码在 View 中。

```mermaid
flowchart LR
    Mock[Mock 场景] --> Seed[本地 seed / 模拟扫描]
    Seed --> DB[(Wrangler SQLite / D1 schema)]
    DB --> API[Worker API]
    API --> Model[统一 Model / ViewModel]
    Model --> UI[Basalt PR 工作台]
    ADO[本机 az · 待接入] -. 归一化 .-> DB
    GH[本机 gh · 待接入] -. 归一化 .-> DB
```

- 本地数据库文件：`.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`，不提交 Git。
- SQL migration：`packages/db/migrations/0011_pr_workbench.sql`，schema version 11。
- `projects`：provider、organization、project key、名称、负责人、监控开关、revision 和最近扫描信息。
- `pull_requests`：项目 / 仓库 / 外部 ID 索引与统一 PR snapshot JSON。
- `scan_runs`：扫描时间、结果、PR 数量、推进阶段数和说明。
- 删除项目会级联删除其 PR 和扫描历史；变更源 organization / project 时清除旧快照。

读模型接受 `ado | github`，项目创建 / 编辑当前只开放 `ado`。每个来源进入相同的 Project、PullRequest、Policy、Build、BuildStage、Review 结构。真实 CLI 采集及 PR ingest 尚未接通，现有 Activity ingest 接口不能直接接收这种快照。

## 本地启动

从仓库根目录执行：

```bash
bun install --frozen-lockfile
bun run build:web
bun run db:migrate:local
bun run db:seed:local
bun run dev:worker
```

另开终端执行 `bun run dev`，访问 `https://signoff.dev.hexly.ai`（已有本机 Caddy 映射），或 `http://localhost:7042`。

Worker 开发脚本固定本地 upstream，并开启 `SIGNOFF_DEMO_MODE=1`。模拟扫描同时检查本地域名、Demo 开关、项目 source 和监控开关，不能修改 CLI 来源的快照。生产不设置此开关。

再次运行 `db:seed:local` 会重置四个指定 Demo 项目及其 PR / 扫描历史，恢复完整演示场景；保留其他项目与原来的活动分析数据。该命令不接受参数，也没有远端写入选项。

## UI 与场景

首页 `/` 为 PR 工作台，`/projects` 为项目管理，原 Dashboard 位于 `/insights`。筛选与详情保存为 URL 参数：`q`、`project`、`repo`、`state`、`status`、`sort`、`page`、`pr`。

初始数据有 30 个 open PR（含 4 draft）、15 个需要处理、5 个构建中 / 排队中、6 个可合并、5 个 merged、3 个 closed。

| 项目 | 示例 PR | 可观察的情况 |
| --- | --- | --- |
| Core Platform | #4821 | Unit tests 失败、Integration 跳过，同时另一个 build 的 Windows stage 正在运行 |
| Core Platform | #4822 | 构建基本完成，Staging 等待负责人批准 |
| Core Platform | #4824 | 所有必需检查通过，但仍有 merge conflict |
| Core Platform | #4828 | 两个 advisory 检查失败，其余条件满足，仍可合并 |
| Commerce | #2165 | 构建被取消，下游 stage 未执行，需要重新运行 |
| Commerce | #2166 | 指定必需 reviewer 尚未批准 |
| Developer Experience | #907 | Unit tests 正在运行，后续 Integration 排队 |
| Developer Experience | #915 | 部分 build timeline 缺失；重扫后恢复 |
| Mobile Apps | #1530 | reviewer 请求修改，即使 build 通过也不能合并 |

表格一行展示 PR 身份、当前就绪程度、必需检查计数、全部 stage 进度、下一步、负责人和更新时间。点开 PR 查看 Overview、Checks & builds、Activity；每个 build 可展开全部 stage、时长、说明与负责人。

新增项目初始为空，第一次扫描生成 6 个示例 PR。后续每次模拟扫描会让各 build 的一个可运行阶段从 queued → running → passed，并恢复不完整的示例 timeline。草稿与终态 PR 不推进；失败、冲突、待评审和环境审批继续保留。

自动刷新只读取快照。扫描成功后才改变示例进度，关闭自动刷新也不会丢失数据库状态。

## API 与并发

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| GET | `/api/workbench` | 一次 D1 batch 读取项目、PR 与最新 20 条扫描记录，`Cache-Control: no-store` |
| POST | `/api/projects` | 创建 ADO 项目，server 决定 `source` 与初始 revision |
| PATCH | `/api/projects/:id` | 携带 revision 的部分更新，冲突返回 409 |
| DELETE | `/api/projects/:id` | JSON body `{ revision }`，级联清理项目快照 |
| POST | `/api/projects/:id/scan` | 本地 Demo 扫描，JSON body `{ revision }` |

源变更时，依赖删除使用旧 revision 守卫并在 CAS 更新前执行；扫描时每条写入使用同一旧 revision 守卫，最后更新版本。D1 batch 只因语句报错回滚，不能依赖零行更新隐式回滚。

一次 workbench 读取最多 1,000 个 PR，超过时返回 `truncated` 并在页面说明计数范围。单项目 Demo 扫描最多 40 个 PR，以控制 D1 语句预算。真实大型项目接入时需要加入服务端分页与采集任务调度。

原 machine-token 路由白名单没有增加这些管理 API。批量扫描按项目顺序执行，部分失败会继续其他项目，并明确报告成功数量与失败原因。前端拒绝重复提交，旧请求与卸载后的请求不能覆盖较新的快照。

## 验收

- [x] Domain：就绪判定、可选失败、必需评审、未知状态、模拟阶段推进与终态保护。
- [x] Worker + SQLite：项目 CRUD、大小写不敏感的源唯一性、revision 冲突、源变更回滚、扫描原子性、机器入口限制。
- [x] Web：筛选 / 排序 / 分页、URL 状态、HTTP 契约、表单校验、刷新失败、过期响应、卸载、重复提交和可见性轮询。
- [x] Chromium + 实际本地 API：新增项目 → 扫描 → 再扫描推进阶段 → 刷新确认持久化 → 编辑 → 暂停 / 恢复 → 删除。
- [x] 浏览器确认 conflict 不被全绿 checks 覆盖，advisory 失败不阻止可合并状态。
- [x] 桌面、390px 窄屏、明暗主题、导航、详情 tab、完整 stage 列表与对话框关闭后的焦点恢复。

前端当前 412 个测试通过，Model / ViewModel / lib 行覆盖率 99.8%。提交仍执行仓库原有覆盖率、Biome 与类型检查门禁。

## 下一步

首先对接 ADO CLI 的项目仓库发现、PR / reviewer / policy / build timeline，转成现有统一快照；补齐可恢复的 PR ingest 与采集状态，再连接定时扫描。之后通过 `gh` 接入 GitHub 的 PR、review 和 check runs，并保留无法确定的状态。issue / work item 页面另立阶段。
