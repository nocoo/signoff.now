# 05 — 本机采集管线铺垫与 Ingest 契约

> 状态：设计稿（**冻结契约 + 前置条件**，不是实施计划）
> 依赖：[01-项目定位](./01-项目定位.md)、[02-数据结构与D1](./02-数据结构与D1.md)、[03-Web模块模板](./03-Web模块模板.md)、[04-Settings设计](./04-Settings设计.md)
> 范围：把仓库从「Web/Settings 已完成、`/api/pipeline/ingest` 仍 501」推进到「06 可以直接用本机 CLI 实现真实采集与写入」的**全部前置条件**与**冻结契约**
> **不在本文（属 06 / 07）**：Activity/Score 真实写入、计分算法定稿、fixture 首次落库、真实 ADO REST 调用、raw JSON 逐字段 schema、Web 数据读回的真实实现
> **05 完成后**：`/api/pipeline/ingest` **仍返回 501**；`packages/domain` 只有 DTO/常量;CLI 能 doctor/settings-pull/dry-run，但**不写 D1**

## 边界一句话

**05 只交付"06 开工前所有基础设施与契约"；真正插入 Activity/Score 是 06 的事。**

- ✅ 05 做：Schema 补齐、bootstrap 补齐、domain 契约包、CLI 骨架、Ingest **契约冻结**、本地闭环
- ❌ 05 不做：Activity/Score 写入、计分算法实现、fixture 落库、Web 数据读回、真实 ADO 拉取

---

## 1. 为什么需要这份文档

01–04 定义了产品形态、Schema、Web 与 Settings。**当前实际进度**：

| 层 | 完成度 |
|:---|:-------|
| D1 三个 migration | ✅ 已应用（0001+0002+0003） |
| Worker 中间件（entry / Access / Pipeline auth） | ✅ |
| Web CRUD 页 + Settings CAS PUT | ✅ |
| `/api/pipeline/bootstrap` | ✅（返 settings + devs + repos） |
| `/api/pipeline/ingest` | ❌ **返 501**，从未写过 Activity/Score |
| `/api/pipeline/recompute/complete` | ✅（仅清 stale） |
| 身份匹配 / day_key / external_ref 生成 | ❌ 无实现 |
| Score 聚合（权重 + 日折叠） | ❌ 无实现 |
| Web Activity 只读接口与页面 | ❌ 页面为占位 |
| ADO 采集 CLI | ❌ 未起 app（仅 `gitinfo`/`pulse` 质量标杆） |

如果 06 直接开始写 CLI，会在**没有基础设施、没有契约、没有共享 domain 类型**的情况下摸黑写。**05 的职责就是把 06 需要的所有底盘和契约都准备好**，让 06 开工时只需实现"业务逻辑"三件事：**identity/dayKey/externalRef 匹配、Score 聚合、Worker 真实写库**。

### 05 vs 06 分工

| 事项 | 05 | 06 |
|:-----|:---|:---|
| D1 Schema（含 project GUID 补齐） | ✅ 定 + migration | 用现成 schema |
| bootstrap 契约（返完整 project GUID） | ✅ 冻结 | 调用 |
| `@signoff/domain` 包结构 + DTO/常量/zod | ✅ 建包 + 契约 | 实现 matchDeveloper/dayKey/buildExternalRef/aggregateScores |
| CLI 骨架（doctor/settings pull/dry-run） | ✅ 全部落地 | 加 `collect` 真拉 ADO、`ingest` 真提交 |
| `/api/pipeline/ingest` 契约 | ✅ 定死 body/响应/错误码/幂等/D1 预算 | 按契约实现真写库 |
| `/api/pipeline/ingest` 实现 | ❌ **仍返 501** | ✅ 替换 501，写 Activity/Score/Unmatched/IngestRun |
| Score 聚合算法 | ⚠️ 只列输入输出与待决清单 | ✅ 定稿并实现 |
| Web 只读 API（heatmap/timeline） | ⚠️ 只冻结 DTO | ✅ 真实实现 + 前端接线 |
| fixture 首次落库 | ❌（fixture 文件格式定义即可） | ✅ 第一条 E2E |
| 真实 ADO 拉取 | ❌ | ✅ + 07 展开命令矩阵 |

---

## 2. 完整链路（目标状态一次成功采集）

图中标注 **【05】** 表示 05 交付的基础设施/契约，**【06】** 表示 06 实现的业务逻辑。

```
本机 az 登录  【06】
  │
  ├─(1) signoff settings pull ──HTTPS──► GET /api/pipeline/bootstrap  【05 骨架 + 契约】
  │                                     └─► .data/cache/bootstrap.json (含 pipelineConfigVersion + projectGuid)
  │
  ├─(2) signoff collect ──az── ADO REST                                【06】
  │     ├─ enabled repos → PRs / PR threads / PR iterations
  │     └─ distinct projects → WorkItems / WI updates
  │             │
  │             └─► .data/raw/ado/{org}/{project}/... (JSON + schemaVersion)  【06；05 冻结目录约定】
  │
  ├─(3) validate raw（zod）                                             【06；05 冻结 schemaVersion 常量位置】
  │
  ├─(4) transform: raw + settings + devs → Activity[]                   【06】
  │       ├─ 身份匹配（alias@suffix ≡ uniqueName）                       【06 实现，05 只出 DTO+签名】
  │       ├─ external_ref 拼接（02 §5.2）                                【06 实现，05 只出 DTO+签名】
  │       └─ day_key（IANA 时区）                                        【06 实现，05 只出 DTO+签名】
  │
  ├─(5) POST /api/pipeline/ingest ──Bearer──► Worker                   【05 冻结契约；06 实装写库】
  │       body = { pipelineConfigVersion, runId, chunk, activities[], unmatchedIdentities[] }
  │       05 仍返 501；06 替换为真写入：
  │             ├─ CAS pipelineConfigVersion（多阶段流程，非单 batch 原子）
  │             ├─ UPSERT activities (ON CONFLICT external_ref DO UPDATE)
  │             ├─ 二次查询受影响 dev-day 现存 Activity
  │             ├─ 域包 aggregateScores → UPSERT scores
  │             ├─ UPSERT unmatched_identities（幂等 seen_count）
  │             └─ 更新 ingest_runs 状态机
  │
  └─(6) POST /api/pipeline/recompute/complete（full rematch finalize）  【06 完善；05 骨架已在】
```

**05 覆盖**：(1) bootstrap 契约扩展、(5) Ingest 契约冻结、以及 (2)–(4)(6) 所需的**目录约定 / DTO 契约 / CLI 骨架 / 本地闭环**。
**05 不覆盖**：任何"数据真正进 D1"的步骤。

---

## 3. Gap 全表（05 交付 vs 06 使用）

**读表方式**：每一行是一个 gap；**05 交付**列写 05 落地的产物，**06 使用**列写 06 拿它做什么。

### 3.1 Schema & Bootstrap

| Gap | 05 交付 | 06 使用 |
|:----|:--------|:--------|
| **project GUID** 不在 D1 | 新 migration `0004_repo_project_guid.sql`：在 `repos` 表加 `project_external_id TEXT`（可空，允许后续回填）；Web CRUD 与 bootstrap 契约同步更新，不新建 `projects` 表 | 构造 `wi.*` 的 `external_ref = ado:wi:{projectGuid}:{wiId}:...` |
| bootstrap 返回不完整 | `GET /api/pipeline/bootstrap` 响应 `repos[].projectExternalId`；null 表示未回填（06 允许跳过该 project 的 WI） | CLI 缓存到 `.data/cache/bootstrap.json`；skip 无 GUID 的 project |
| Repo CRUD 无 project GUID 字段 | Web repos 页 + `POST/PUT /api/repos` 支持 `projectExternalId`；同 org/project 下应保持一致（Web 校验软提示，非硬约束） | 采集前用户回填一次 |

### 3.2 Domain 契约包

| Gap | 05 交付 | 06 使用 |
|:----|:--------|:--------|
| CLI/Worker 类型不共享 | 新包 `packages/domain`：只有 **DTO/常量/zod schema/函数签名**，无业务实现（§6） | 06 在此包内实装 `matchDeveloper`/`dayKey`/`buildExternalRef`/`aggregateScores`/`parseUniqueName` |
| Activity 结构无 SoT | 导出 `activitySchema` / `ingestBodySchema` / `ActivityType` / `ACTIVITY_TYPES` / `DEFAULT_WEIGHTS`（对齐 01 §6.3、02 §5.2） | Worker ingest 与 CLI transform 双边 import |
| 权重数值类型不明 | 定 `weight: z.number().int().nonnegative()`，与 D1 `scores.total INTEGER` 一致；`activityWeights` Settings 校验同步收紧为非负整数 | aggregateScores 输出 `total: number` 直接落 INTEGER |

### 3.3 CLI 基础设施

新 app `apps/collect`（临时名，06 或 07 定 final 名）：

| Gap | 05 交付 | 06 使用 |
|:----|:--------|:--------|
| 无 CLI app | commander 入口 + logger + 环境变量（`SIGNOFF_API_BASE` / `SIGNOFF_PIPELINE_WRITE_TOKEN`） | 加 collect / ingest 命令 |
| 无 doctor | `signoff doctor` 校验：`az` 已登录、`.data` 可写、bootstrap 可达、Pipeline Token 已配置（不真调 ADO） | 每次 collect 前自动跑 |
| 无 HTTP client | `pipelineClient.bootstrap()` / `.ingest(body)` / `.recomputeComplete(body)`；mock 网络覆盖 401/403/409/501 | 06 换成真调用 + 200 分支 |
| 无 settings 缓存 | `.data/cache/bootstrap.json` 读写；含 `pipelineConfigVersion` 与 `fetchedAt`；过期检查 | collect 前必须 pull |
| 无 raw/normalized 目录约定 | `packages/domain/paths.ts` 导出 `rawPath(...)` / `normalizedPath(...)`，代码化 01 §7.2 | 06 落盘时使用 |
| 无命令 | `settings pull` / `settings show` / `doctor` / `collect --dry-run`（打印计划、**不调 ADO**） / `ingest fixture <file>` **stub**（打印将要 POST 的 body，不真发） | 06 补 `collect` 真拉、`ingest fixture` 改真 POST |

### 3.4 Ingest 契约（05 冻结，06 实装）

**服务端仍返 501**，但契约本身必须定死，06 无需再改：

| Gap | 05 交付 | 06 使用 |
|:----|:--------|:--------|
| body/响应/错误码 | §5.1 定死 | 按契约实装 |
| D1 查询预算 | §5.2：Free 50 / Paid 1000 stmt 上限；`activities.length ≤ 500`（保守，为二次查询与 score upsert 留余量）；payload ≤ 512 KB；meta_json ≤ 4 KB | 06 分批循环调用 |
| 多阶段流程 | §5.3：不承诺单 batch 原子；拆 Activity write → 查询 → Score upsert → finalize；每阶段独立 CAS | 06 按阶段实装 |
| runId/chunk/finalize 状态机 | §5.4：run 生命周期 `pending → chunked → finalized/failed`；chunk 幂等 by `(runId, chunkIndex)` | 06 实装状态转换 |
| 服务端反污染 | §5.5：dayKey/identity/externalRef 服务端重算并比对，客户端不可提供 `id` / `config_version` | 06 实装校验 |
| 鉴权契约 | §5.6：浏览器 Access **禁止** pipeline write；同步修 03 与 `pipeline-auth.ts` | 06 若发现代码路径不一致需修正 |

### 3.5 本地开发闭环

| Gap | 05 交付 | 06 使用 |
|:----|:--------|:--------|
| `dev:all` 未实测 D1 | 文档化启动流程；实测 `bun run dev:all` 起 web + worker + wrangler local D1，migrations apply | 06 直接用 |
| loopback 鉴权路径未测 | E2E 用例：CLI `http://127.0.0.1:37042/api/pipeline/bootstrap` 不带 token 应 200 | 06 依赖 |
| fixture 文件格式无定义 | §10 冻结 fixture JSON 格式与 seed 前置条件 | 06 用这个格式做首次 E2E |

### 3.6 后续文档

| Gap | 05 交付 | 06 使用 |
|:----|:--------|:--------|
| 06 骨架 | 05 完成时 06 应至少有大纲：`docs/06-Activity重建与Score算法.md`，含 §7 待决清单转过去 | 06 定稿 |
| 07 骨架 | 05 完成时 07 应至少有大纲：`docs/07-CLI命令矩阵与ADO落盘.md` | 07 定稿 |

---

## 4. 阶段划分与验收（05 内部）

**05 内部分 5 步**，每步独立 PR / commit 组，任何一步没验收前不进下一步。

| Step | 内容 | 完成信号 |
|:-----|:-----|:---------|
| **S1** Schema & bootstrap | 3.1 全表 | `0004_repo_project_guid.sql` 应用；`GET /bootstrap` 返 `projectExternalId`；Repo CRUD 可编辑该字段；worker 测试通过 |
| **S2** Domain 契约包 | 3.2 全表 | `packages/domain` 建包；导出 DTO/zod/常量/函数签名；被 worker 与 web 单测 import 不报错；`bun test` 通过（函数签名允许 `unimplemented` 抛错，只测类型/zod） |
| **S3** CLI 骨架 | 3.3 全表 | `signoff doctor` / `settings pull` / `settings show` / `collect --dry-run` 全部可跑；`ingest fixture` 打印 body 但不发送；单测 ≥95% |
| **S4** Ingest 契约冻结 | 3.4 全表 + 同步修 03 鉴权表述 | §5 全部小节写完；`pipeline-auth.ts` 若与新契约冲突则同步修正测试（Access 浏览器打 pipeline write → 403） |
| **S5** 本地闭环实测 | 3.5 全表 | 手动跑通：`bun run dev:all` → `signoff doctor` 全绿 → `signoff settings pull` 写 cache → `signoff ingest fixture ./fixture.json` 打印 body 且回收到 worker 的 501 响应 |

**05 完成 = S1..S5 全绿**。任何"Activity/Score 在 D1 出现"都不是 05 验收信号——**留给 06**。

---

## 5. Ingest 契约（05 冻结，06 实装）

> **本节是 06 的冻结契约**。05 完成时 `/api/pipeline/ingest` **仍返 501**；06 按本节实装真写入，不允许再改协议。
>
> **不承诺**：单个 `env.DB.batch()` 内完成 Activity 写 + 查询 + Score 聚合 + finalize 的原子性——D1 无此语义（见 §5.3）。

### 5.1 `POST /api/pipeline/ingest` — 请求 / 响应 / 错误码

**鉴权**：见 §5.6。**Content-Type**：`application/json`。**幂等键**：`(runId, chunkIndex)`（见 §5.4）。

**Body**：

```json
{
  "pipelineConfigVersion": 3,
  "runId": "01J7XZ8K3N4Y5W2P6Q9R1STVWX",
  "chunkIndex": 0,
  "isFinalChunk": false,
  "runMeta": {
    "startedAt": 1720000000,
    "source": "ado",
    "windowFrom": "2026-06-01",
    "windowTo": "2026-07-01",
    "mode": "incremental"
  },
  "activities": [
    {
      "type": "pr.merged",
      "occurredAt": 1720000123,
      "provider": "ado",
      "org": "acme",
      "project": "Alpha",
      "repoId": "01J...",
      "developerId": "01J...",
      "matchedUniqueName": "ada@example.com",
      "sourceIds": {
        "prRepoGuid": "11111111-1111-1111-1111-111111111111",
        "prId": 1234
      },
      "meta": { "title": "Refactor auth" }
    }
  ],
  "unmatchedIdentities": [
    { "uniqueName": "bot@acme.example", "sampleOrg": "acme", "sampleProject": "Alpha", "sampleContext": "pr.vote:1234" }
  ]
}
```

**关键字段口径**：

| 字段 | 说明 |
|:-----|:-----|
| `runId` | ULID / UUID；一次逻辑运行的全局 ID；CLI 生成 |
| `chunkIndex` | 该 run 内的分片序号，从 0 起单调递增；同 `(runId, chunkIndex)` 重复请求应幂等（见 §5.4） |
| `isFinalChunk` | true 表示该 run 最后一块；服务端据此驱动状态机到 `finalized` |
| `runMeta.mode` | `incremental` \| `full_rematch` |
| `activities[].sourceIds` | **服务端据此重算 externalRef**（§5.5）；客户端**不得**提供 `externalRef` |
| `activities[].occurredAt` | UTC unix 秒；服务端据此**重算 dayKey**（§5.5）；客户端**不得**提供 `dayKey` |
| 禁止字段 | `id`、`config_version`、`externalRef`、`dayKey`（服务端一律拒绝） |

**成功响应 200**（每一 chunk 都返回；`isFinalChunk=true` 时额外含 `finalized: true`）：

```json
{
  "runId": "01J...",
  "chunkIndex": 0,
  "pipelineConfigVersion": 3,
  "activities": { "received": 250, "upserted": 250, "rejected": 0 },
  "scores": { "affectedDevDays": 88, "recomputed": 88 },
  "unmatched": { "upserted": 3 },
  "finalized": false
}
```

**错误码**：

| HTTP | 场景 |
|:-----|:-----|
| 400 | body 校验失败（缺字段、格式错、包含禁止字段、`activities.length` 超上限） |
| 401 | Pipeline Token 缺失 |
| 403 | 白名单/host 不通过、Read Token 打 write route、Access 浏览器打 pipeline write |
| 409 | `pipelineConfigVersion` 与当前不等；或 `(runId, chunkIndex)` 已存在但请求体哈希不同 |
| 413 | payload 字节超上限 |
| 422 | 引用完整性：`developerId`/`repoId` 归档、`repoId` 与 type 组合非法、`sourceIds` 缺项 |
| 500 | 意外错误 |
| 501 | **05 阶段服务端一律返 501**；06 上线后本码退役 |

### 5.2 D1 查询预算与 payload 上限（硬约束）

D1 官方限制（截至 2026-07；实施前**必须**用 workers-best-practices skill 再核验一次）：

| 项 | Free | Paid | 05/06 侧策略 |
|:---|:-----|:-----|:-------------|
| 每次 Worker invocation 可执行 SQL statement 数 | **50** | **1000** | 06 部署目标 = **Paid**；文档同时给 Free 与 Paid 的降级方案 |
| 单 statement 参数上限 | 100 | 100 | 06 用多行 `VALUES (..),(..),..` 时按 100 参数拆 |
| Worker 请求体 | — | 100 MB | 我方硬上限 **512 KB / 请求**（远小于 D1 阈值，避免误传） |

**05 冻结的应用层预算**（写进 zod）：

| 项 | 值 | 理由 |
|:---|:---|:-----|
| `activities.length` | ≤ **500** / chunk | Paid 环境预留：500 条 Activity UPSERT + ≤500 dev-day 二次查询 + ≤500 Score UPSERT + finalize ≈ ≤ 1000 stmt（贴近 Paid 上限） |
| `unmatchedIdentities.length` | ≤ 200 / chunk | 与 activities 一并落 |
| `activities[].meta` 序列化后 | ≤ **4 KB** / 条 | 大 meta 用 chunk-external 存储 |
| `payload bytes` | ≤ **512 KB** | 服务端读 body 前用 `Content-Length` 卡；超则 413 |
| Free 环境降级 | `activities.length` ≤ **20** / chunk | 06 若跑 Free 需切此档；否则 stmt budget 会爆 |

**06 的分片策略**：

- CLI 端把待写 Activity 按 500 一段切成 N 个 chunk；顺序发送。
- 若某 chunk 返回 409（版本冲突），CLI 应**中止后续 chunk**，`settings pull` 后**放弃当前 runId**、开新 runId 重头。
- 若某 chunk 返回 5xx，CLI 可重试**同一** `(runId, chunkIndex)`——服务端幂等保障（§5.4）。

### 5.3 多阶段流程（06 实装形态）

**明确不使用**：单 batch 完成 write+read+aggregate+finalize。**明确采用**：可重试的多阶段流程。

对于一次 `POST /pipeline/ingest`（一个 chunk），06 服务端顺序执行：

```
┌─ Phase 1  Activity + Unmatched 写入 ────────────────────────┐
│  一次 batch：                                                │
│    UPSERT activities (ON CONFLICT external_ref DO UPDATE)   │
│    UPSERT unmatched_identities                               │
│    UPSERT ingest_runs (状态 running / chunked)              │
│  失败：整 batch 回滚；返回 5xx；CLI 可重试同 chunkIndex     │
└─────────────────────────────────────────────────────────────┘
        │
        ▼  查询受影响 dev-day
┌─ Phase 2  查询本 chunk 涉及的 (dev, day_key) 现存 Activity ─┐
│  SELECT ... FROM activities                                  │
│  WHERE (developer_id, day_key) IN (...)                      │
│    AND config_version = ?  -- 必须绑定当前版本              │
│  domain.aggregateScores(rows, weights)                       │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ Phase 3  Score UPSERT ─────────────────────────────────────┐
│  一次 batch：                                                │
│    UPSERT scores (ON CONFLICT (developer_id, day_key)       │
│                   DO UPDATE)                                 │
│    UPDATE ingest_runs 累积 stats                            │
│  失败：Phase 1 已提交、Phase 3 未提交 → CLI 重试将从         │
│  Phase 1 幂等重放（Activity UPSERT 无副作用累积）→ Phase 3   │
│  再次尝试，直到成功                                          │
└─────────────────────────────────────────────────────────────┘
        │
        ▼ 仅 isFinalChunk=true 时执行
┌─ Phase 4  finalize（可选） ─────────────────────────────────┐
│  UPDATE ingest_runs SET status='finalized' WHERE id=runId   │
│    AND status IN ('running','chunked')                       │
│    AND config_version = ?   -- 版本 CAS                     │
│  若 mode=full_rematch：调用 §5.7 相同 CAS 清 stale           │
│  changes=0 → 409（run 已被别的进程 finalize，或版本变）      │
└─────────────────────────────────────────────────────────────┘
```

**关键约束**：

1. **不跨 phase 承诺原子性**。D1 无跨 batch 事务；把风险明说，靠 Phase 1/3 各自幂等 + CLI 重试兜底。
2. **Phase 2 的 SELECT 必须 `WHERE config_version = <current>`**。改 timezone/weights 后旧行不参与聚合。
3. **Phase 3 不能只聚合本 chunk 的 activity**——必须查全库该 dev-day 的现存 Activity（否则同日已存在的 Activity 会丢分）。
4. `changes = 0` **不会**让 batch 回滚。任何 CAS 保护都必须写进 `WHERE`，并**读**返回的 `meta.changes`，服务端据此返 200 / 409。

### 5.4 runId / chunk / finalize 状态机

**`ingest_runs` 表新增列**（06 提交时通过 `0005_*` migration）：

| 列 | 类型 | 说明 |
|:---|:-----|:-----|
| `id` | TEXT PK | = `runId`（ULID） |
| `status` | TEXT | `running` / `chunked` / `finalized` / `failed` |
| `config_version` | INTEGER | 该 run 绑定的 pipelineConfigVersion |
| `mode` | TEXT | `incremental` / `full_rematch` |
| `last_chunk_index` | INTEGER | 最新已成功 Phase 1 的 chunkIndex；用于顺序校验 |
| `chunk_digests_json` | TEXT | `{ "0": "sha256:...", "1": "sha256:..." }`；每 chunk body 的 SHA-256，用于幂等去重 |

**幂等 & 顺序规则**：

| 请求 | 服务端行为 |
|:-----|:-----------|
| 新 `runId`，`chunkIndex=0` | 建 run 行；执行 Phase 1..3；`last_chunk_index=0`；chunk_digest 记 sha256 |
| 已知 `runId`，`chunkIndex = last + 1` | 正常执行 Phase 1..3；更新 `last_chunk_index`、`chunk_digests` |
| 已知 `runId`，`chunkIndex ≤ last` 且 digest **相同** | 幂等 no-op：直接返 200，`activities.upserted=0` |
| 已知 `runId`，`chunkIndex ≤ last` 且 digest **不同** | **409** — 同 chunkIndex 请求体已变，客户端 bug |
| 已知 `runId`，`chunkIndex > last + 1` | **400** — 跳号；CLI 顺序错乱 |
| 已知 `runId`，`config_version` 与 run 记录不等 | **409** — 中途 version 变化，本 run 作废 |
| `isFinalChunk=true` 到达 | 执行 Phase 4；status → `finalized` |
| 已 `finalized` 的 run 再收 chunk | **409** — 不接受追加 |

**unmatched_identities 幂等**（消除 seen_count 重复累加）：

- 使用 chunk digest 去重：同一 `(runId, chunkIndex)` 只**首次**执行时对 `seen_count += 1`；重放不累加。
- 实现：Phase 1 的 UPSERT unmatched 前先检查 digest；若已存在则跳过。

### 5.5 服务端反污染 / 反注入

服务端**不信任** CLI 的以下派生字段，必须重新计算并比对：

| 字段 | 服务端行为 |
|:-----|:-----------|
| `externalRef` | 用 `activities[].sourceIds` + `activities[].type` 走域包 `buildExternalRef` 重算；写库用重算值；客户端提供 `externalRef` → **400** |
| `dayKey` | 用 `occurredAt` + 当前 Settings.timezone 走域包 `dayKey` 重算；客户端提供 → **400** |
| `matchedUniqueName` | 用 `activities[].developerId` 查 Developer.alias × 当前 email_suffixes，比对客户端提供值；不一致 → **422** |
| `config_version` | 服务端写当前 `pipelineConfigVersion`；客户端提供 → **400** |
| `id` | 服务端生成（若 UPSERT 命中现有 external_ref 则复用旧 id）；客户端提供 → **400** |

**引用完整性**（**422**）：

- `developerId` 必须在 `developers` 且 `archived_at IS NULL`
- `repoId` 若非 null 必须在 `repos` 且 `archived_at IS NULL` 且 `enabled=1`
- `type ∈ pr.*` ⇒ `repoId` 必填
- `type ∈ wi.*` ⇒ `repoId` 必须 null；`sourceIds` 必须含 `projectGuid` 与 `wiId`
- `sourceIds` 结构按 type 校验：`pr.vote` 必须有 `voterIdentityId`+`threadId`+`commentId`；`pr.active` 必须有 `iterationId`；`wi.updated` 必须有 `revisionId` 等（06 逐条落）

### 5.6 鉴权契约（同步修 03 与 `pipeline-auth.ts`）

**05 明确**（替代 03 §8 与当前 `pipeline-auth.ts` 中"Access 浏览器可打 pipeline write"的旧表述）：

| 通道 | Pipeline write（`/api/pipeline/ingest`、`/pipeline/recompute/*`） | Pipeline read（`/api/pipeline/bootstrap`） | 管理 API（`/api/settings`、entity CRUD） |
|:-----|:------|:------|:------|
| **浏览器 + Access JWT** | ❌ **403** — Access 用户禁止 pipeline write | ⚠️ 可选：允许（诊断用），但不推荐 | ✅ |
| **Machine host + Bearer Write Token** | ✅ | ✅ | ❌ 403（machine host 不做管理写） |
| **Machine host + Bearer Read Token** | ❌ 403 | ✅ | ❌ 403 |
| **loopback (127.0.0.1 / *.dev.hexly.ai)** | ✅（本地开发） | ✅ | ✅ |
| **Pipeline Token 出现在浏览器 bundle** | 硬禁止（gitleaks 规则可考虑加） | — | — |

**05 对代码的影响**：

- `packages/worker/src/middleware/pipeline-auth.ts:44-47`：**移除** `if (browser && accessAuthenticated) { return next(); }` 对 pipeline write 路径的放行；改为仅对 `/api/settings` 等管理 API 放行。
- 新增测试：Access JWT 打 `/api/pipeline/ingest` → 403。
- `docs/03-Web模块模板.md` §8 表格同步修订（05 收尾时改，与本节表格严格对齐）。

### 5.7 recompute complete 契约收紧

`POST /api/pipeline/recompute/complete` 已在 04 §6.7 定义；05 补：

- Body 增加 `runId` 字段；服务端校验该 run **必须已 `finalized`** 且 `mode='full_rematch'`；否则 409。
- 清 stale 的 CAS 保持 04 语义（`WHERE (SELECT value FROM settings WHERE key='pipeline_config_version') = <expected>`）。
- 一次成功清理后 `run.status` 不变（仍是 `finalized`）；stale 标志转为 false。

### 5.8 `/api/pipeline/ingest` 在 05 期间的行为

05 完成时服务端**必须**：

- 保留 501 响应体（04 已定的 `Not Implemented` 格式）。
- **允许** body 校验先跑（zod 通过后再返 501），以便 CLI 骨架能验证 body 结构。
- 400/401/403/409/413/422 分支**可选**是否在 05 阶段生效；若不生效，05 的 CLI mock 测试直接期待 501。
- **禁止**返回任何"已写入 N 条 Activity"的成功响应体——避免 CLI 误信。

---

## 6. 域包 `packages/domain` 设计（05 只出契约，06 实装函数）

### 6.1 05 交付范围

**05 只落**：包结构、导出、DTO、常量、zod schema、函数**签名**。函数体一律 `throw new Error("unimplemented — see docs/06")`，测试只覆盖类型/zod/常量。

**06 实装**：`matchDeveloper` / `dayKey` / `buildExternalRef` / `aggregateScores` / `parseUniqueName` 的函数体、边界样例测试、95% 覆盖率。

### 6.2 目录

```
packages/domain/
├── package.json                # name: @signoff/domain, private
├── tsconfig.json
├── bunfig.toml                 # bun coverage thresholds — 05 阶段 domain 只覆盖常量/zod/paths
└── src/
    ├── index.ts                # 只 re-export
    ├── constants.ts            # ACTIVITY_TYPES, DEFAULT_WEIGHTS   ← 05 落
    ├── activity.ts             # activitySchema, sourceIdsSchemas   ← 05 落
    ├── ingest.ts               # ingestBodySchema, chunk/run 类型   ← 05 落
    ├── paths.ts                # rawPath(), normalizedPath(), cachePath()  ← 05 落
    ├── identity.ts             # matchDeveloper() 签名               ← 05 签名，06 实装
    ├── day-key.ts              # dayKey() 签名                        ← 05 签名，06 实装
    ├── external-ref.ts         # buildExternalRef() 签名              ← 05 签名，06 实装
    ├── score.ts                # aggregateScores() 签名               ← 05 签名，06 实装
    └── *.test.ts               # 05 只测已落项（常量/zod/paths）
```

### 6.3 硬约束

| 项 | 规则 |
|:---|:-----|
| 零副作用 | 不引入 React / fetch / fs / D1 类型 |
| Bun 原生测试 | `bun test --coverage`；05 阈值先设 90%（因函数体未实装），06 恢复到 ≥95% |
| Import boundary | Worker/Web/CLI 都通过 `@signoff/domain` import；禁止跨包相对路径 |

### 6.4 关键契约（05 落地）

**常量**：

```ts
// packages/domain/src/constants.ts
export const ACTIVITY_TYPES = [
  "pr.merged", "pr.closed", "pr.created", "pr.vote", "pr.active",
  "wi.created", "wi.updated", "wi.closed",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

// 对齐 01 §6.3；权重统一为非负整数（对齐 D1 scores.total INTEGER）
export const DEFAULT_WEIGHTS: Readonly<Record<ActivityType, number>> = {
  "pr.merged": 10, "pr.closed": 2, "pr.created": 2,
  "pr.vote": 3, "pr.active": 2,
  "wi.created": 3, "wi.updated": 1, "wi.closed": 5,
};
```

**Activity + sourceIds**（服务端据此重算 externalRef）：

```ts
// packages/domain/src/activity.ts
import { z } from "zod";
import { ACTIVITY_TYPES } from "./constants.js";

const prSourceIds = z.object({
  prRepoGuid: z.string().uuid(),
  prId: z.number().int().positive(),
});
const prVoteSourceIds = prSourceIds.extend({
  voterIdentityId: z.string().min(1),
  threadId: z.number().int().positive(),
  commentId: z.number().int().nonnegative(),
});
const prActiveSourceIds = prSourceIds.extend({
  iterationId: z.number().int().positive(),
});
const wiSourceIds = z.object({
  projectGuid: z.string().uuid(),
  wiId: z.number().int().positive(),
});
const wiUpdateSourceIds = wiSourceIds.extend({
  revisionId: z.number().int().positive(),
});

export const activitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  occurredAt: z.number().int().positive(),
  provider: z.literal("ado"),
  org: z.string().min(1),
  project: z.string().min(1),
  repoId: z.string().nullable(),
  developerId: z.string().min(1),
  matchedUniqueName: z.string().min(1),
  sourceIds: z.union([prSourceIds, prVoteSourceIds, prActiveSourceIds, wiSourceIds, wiUpdateSourceIds]),
  meta: z.record(z.unknown()).optional(),
  // 禁止字段：id / externalRef / dayKey / config_version（zod .strict()）
}).strict();

export type Activity = z.infer<typeof activitySchema>;
```

**Ingest body**（含 chunk/run 状态）：

```ts
// packages/domain/src/ingest.ts
export const ingestBodySchema = z.object({
  pipelineConfigVersion: z.number().int().positive(),
  runId: z.string().min(20),                    // ULID / UUID
  chunkIndex: z.number().int().nonnegative(),
  isFinalChunk: z.boolean(),
  runMeta: z.object({
    startedAt: z.number().int().positive(),
    source: z.enum(["ado", "fixture"]),
    windowFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    windowTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mode: z.enum(["incremental", "full_rematch"]),
  }),
  activities: z.array(activitySchema).max(500), // §5.2 硬上限
  unmatchedIdentities: z.array(z.object({
    uniqueName: z.string().min(1),
    sampleOrg: z.string().optional(),
    sampleProject: z.string().optional(),
    sampleContext: z.string().optional(),
  })).max(200),
}).strict();
```

**函数签名（05 落，06 实装）**：

```ts
// packages/domain/src/identity.ts
export function matchDeveloper(
  uniqueName: string,
  developers: readonly { id: string; alias: string }[],
  suffixes: readonly string[],
): { id: string } | null {
  throw new Error("unimplemented — see docs/06");
}

// packages/domain/src/day-key.ts
export function dayKey(occurredAtSec: number, timeZone: string): string {
  throw new Error("unimplemented — see docs/06");
}

// packages/domain/src/external-ref.ts
export function buildExternalRef(type: ActivityType, sourceIds: unknown): string {
  throw new Error("unimplemented — see docs/06");
}

// packages/domain/src/score.ts
export type ScoreRow = {
  developerId: string; dayKey: string;
  total: number; breakdown: Partial<Record<ActivityType, number>>;
  activityCount: number;
};
export function aggregateScores(
  activities: readonly Activity[],
  weights: Readonly<Record<ActivityType, number>>,
): ScoreRow[] {
  throw new Error("unimplemented — see docs/06");
}
```

> **`parseUniqueName` 剥前缀被删除**。01 明确「人类身份的 `uniqueName` 几乎全是邮箱」+ 精确匹配；无必要预先剥 `vsts:` 之类前缀（会引入猜测）。若 06 遇到真实 ADO 格式必须规范化，届时基于实测数据再加，并写进 06 与本节。

### 6.5 05 测试范围

| 已落项 | 测试 |
|:-------|:-----|
| 常量 | 键完整性（全部 8 种 type、DEFAULT_WEIGHTS 有全部键） |
| activitySchema | 拒绝 `id`/`externalRef`/`dayKey`/`config_version`；type 不在枚举；sourceIds 与 type 不匹配 |
| ingestBodySchema | `activities.length > 500` 拒绝；`runId` 长度、`windowFrom` 格式 |
| paths | `rawPath("ado", "acme", "Alpha", "repos/foo", "prs/1234")` 生成正确 |

**未落函数**的测试：只测「调用时抛 `unimplemented`」，作为 06 落地的"红灯"。

---

## 7. Score 输入 / 输出契约（算法定稿见 06）

**05 只冻结签名与约束**；算法（终态优先、日折叠、activityCount 定义、breakdown 结构）由 06 定稿。

### 7.1 输入

| 项 | 类型 | 约束 |
|:---|:-----|:-----|
| `activities` | `readonly Activity[]` | 属于同一 `pipelineConfigVersion`；可跨 developer、跨日 |
| `weights` | `Readonly<Record<ActivityType, number>>` | 值为**非负整数**（与 D1 INTEGER 一致；小数留给二期） |

### 7.2 输出

`ScoreRow[]`（见 §6.4）；每 `(developerId, dayKey)` 组合最多一条。

### 7.3 硬约束（05 冻结）

1. **纯函数**：同输入 → 同输出；不读 clock、不读文件。
2. **合并顺序无关**：`aggregate(a ++ b) == aggregate(b ++ a)`（相同 dev-day 结果一致）。
3. **数值溢出保护**：`total` 使用 JS number（安全整数范围 2^53）；单 dev 单日单 type 权重上限约 100 × 100_000 事件 = 10^7，安全。
4. `breakdown` 只出现 **出现在输入中**的 type key。

### 7.4 06 待决清单（05 明确不定）

- [ ] `pr.vote` 是否折叠（默认候选：不折叠）
- [ ] `pr.active` 同 PR 同日折叠策略（默认候选：折叠为一次；仅计一份权重）
- [ ] `wi.updated` 同 WI 同日折叠策略（同上）
- [ ] 同 PR 同日 `pr.merged` + `pr.created` + `pr.active` 时，作者侧终态优先规则
- [ ] `activityCount` 定义：**折叠前**还是**折叠后**（默认候选：折叠前，用于审计）
- [ ] `pr.merged` 与 `pr.closed` 是否互斥（同 PR 不应同时出现）
- [ ] 边界样例全表（06 §X）

**任何 06 决策不允许覆盖 §7.3 硬约束。**

---

## 8. Web 只读读回（05 只冻结 DTO 契约；实现在 06）

**05 不实现** heatmap / timeline 路由与前端接线；05 只出下面这些 DTO 契约，让 06 与 Web 前端能对齐。

### 8.1 `GET /api/activity/heatmap` — 契约冻结

**Query**（zod）：

| 参数 | 类型 | 约束 |
|:-----|:-----|:-----|
| `devs` | 逗号分隔 dev id | 1..20 个 |
| `from` | `YYYY-MM-DD` | 必填 |
| `to` | `YYYY-MM-DD` | ≥ from；跨度 ≤ 366 天 |

**Response 200**：

```json
{
  "pipelineConfigVersion": 3,
  "scoresStale": false,
  "staleReason": null,
  "rows": [
    { "developerId": "01J...", "dayKey": "2026-07-01", "total": 10, "activityCount": 1 }
  ]
}
```

**stale 语义（**必须由 05 定死**）**：

| 状态 | 行为 |
|:-----|:-----|
| `scoresStale = false` 且存在 `config_version = pipeline_config_version` 的 rows | 正常返回 rows |
| `scoresStale = true`（配置刚变，未 recompute） | **仍返回 200，rows 用旧 config_version 的最近 finalized 数据**；`scoresStale=true` 与 `staleReason` 让前端渲染横幅（03 §5.3 已定语义） |
| 无任何 finalized 数据 | 返回 200，`rows=[]`，`scoresStale=false` |

**SQL 骨架（06 实装）**：

```sql
SELECT developer_id, day_key, total, activity_count
FROM scores
WHERE developer_id IN (?, ?, ...)
  AND day_key BETWEEN ? AND ?
  AND config_version = (
    -- stale=false: 当前版本；stale=true: 最新已 finalized 的 run.config_version
    SELECT ... FROM ingest_runs WHERE status='finalized' ORDER BY finished_at DESC LIMIT 1
  );
```

### 8.2 `GET /api/activity/timeline` — 契约冻结

**Query**（keyset cursor）：

| 参数 | 说明 |
|:-----|:-----|
| `dev` | 单个 dev id |
| `from` / `to` | 时间窗（跨度 ≤ 90 天） |
| `limit` | 1..200，默认 100 |
| `cursor` | opaque base64，编码 `(occurredAt, id)`；首次省略 |

**排序**：`ORDER BY occurred_at DESC, id DESC`（稳定 keyset）。

**Response 200**：

```json
{
  "items": [
    { "id": "01J...", "type": "pr.merged", "occurredAt": 1720000123, "dayKey": "2026-07-03",
      "org": "acme", "project": "Alpha", "repoId": "01J...", "meta": {} }
  ],
  "nextCursor": "eyJvIjoxNzIwMDAwMDAwLCJpIjoiMDFKLi4uIn0="
}
```

**stale 语义**：同 8.1；活动列表本身不受 stale 影响（activity 与 config_version 独立索引），但 UI 可用 8.1 横幅提示"分数可能过期"。

### 8.3 前端 MVVM 落点（06 实装）

| 层 | 路径 |
|:---|:-----|
| Model | `apps/web/src/models/activity.ts`（DTO parse + heatmap 色阶映射） |
| ViewModel | `apps/web/src/viewmodels/useActivityHeatmapViewModel.ts` |
| View | `apps/web/src/views/activity/*` |

heatmap 色阶：**复用 basalt tokens `--heatmap-*`**，不硬编码 hex。

---

## 9. CLI 骨架（05 核心交付；无真 ADO）

新 app **`apps/collect`**（临时名）；final 名与 monorepo 位置由 07 确定。

### 9.1 目录

```
apps/collect/
├── package.json                 # 依赖: @signoff/domain, commander, zod
├── tsconfig.json
├── vitest.config.ts             # coverage ≥95%
└── src/
    ├── main.ts                  # commander 入口
    ├── logger.ts                # gitinfo/pulse 风格
    ├── config/env.ts            # SIGNOFF_API_BASE / SIGNOFF_PIPELINE_WRITE_TOKEN 读取
    ├── config/env.test.ts
    ├── doctor/index.ts          # 汇总各项检查
    ├── doctor/az.ts             # exec az account show; 未登录返 fail
    ├── doctor/az.test.ts        # mock exec
    ├── doctor/http.ts           # 试探 bootstrap；带 timeout
    ├── doctor/index.test.ts
    ├── pipeline/client.ts       # bootstrap / ingest / recompute-complete
    ├── pipeline/client.test.ts  # mock fetch 覆盖 200/401/403/409/413/501
    ├── cache/bootstrap.ts       # .data/cache/bootstrap.json 读写 + 版本校验
    ├── cache/bootstrap.test.ts
    ├── commands/settings-pull.ts
    ├── commands/settings-pull.test.ts
    ├── commands/settings-show.ts
    ├── commands/collect-dry-run.ts  # 打印将要拉的 org/project/repo；不调 ADO
    ├── commands/collect-dry-run.test.ts
    ├── commands/ingest-fixture.ts   # STUB: 读文件，zod 校验，打印 body，不真发
    └── commands/ingest-fixture.test.ts
```

### 9.2 命令表（05 全部落地）

| 命令 | 05 行为 | 06 追加 |
|:-----|:--------|:--------|
| `signoff doctor` | ✅ 校验 az / .data / bootstrap 可达 / token 存在 | 加 ADO 网络探测 |
| `signoff settings pull` | ✅ 04 §6.4；写 `.data/cache/bootstrap.json` | — |
| `signoff settings show` | ✅ 读缓存或 `--remote` 刷新 | — |
| `signoff collect --dry-run` | ✅ 打印将要拉哪些 repo/project；**不**调 ADO | 加真 collect 主路径 |
| `signoff collect` | ⚠️ stub：打印 "not implemented (see docs/06)" 后 exit 1 | ✅ 真 ADO 拉取 + transform + ingest |
| `signoff ingest fixture <file>` | ⚠️ **STUB**：读 JSON、`ingestBodySchema.parse`、**打印** body 摘要（前 3 条 activity + 总数）、退出 0 **不真发** | ✅ 真 POST /pipeline/ingest；处理 200/409/501 |

### 9.3 质量门

对齐 gitinfo/pulse：

| 项 | 阈值 |
|:---|:-----|
| Coverage stmts/branches/funcs/lines | ≥ 95% |
| Biome | 0 warning |
| Typecheck | 0 error |
| 网络测试 | mock 强制；无真实网络 |

### 9.4 exit code

| Code | 场景 |
|:-----|:-----|
| 0 | 成功 |
| 1 | 通用运行时失败 |
| 2 | 环境不满足（az 未登录、token 缺失） |
| 3 | 契约错误（cache 版本不一致、bootstrap 拒绝） |
| 4 | 服务端 5xx |

---

## 10. Fixture 定义（05 只定格式；06 首次落库）

`fixtures/activities.sample.json`（放 `packages/domain/fixtures/` 或 `apps/collect/fixtures/`）——**05 定格式**，**06 首次真正 POST 到 ingest 并落库**。

### 10.1 JSON 格式

必须能通过 `ingestBodySchema.parse`：

```json
{
  "pipelineConfigVersion": 1,
  "runId": "fixture-01JAAAAAAAAAAAAAAAAA",
  "chunkIndex": 0,
  "isFinalChunk": true,
  "runMeta": {
    "startedAt": 1720000000,
    "source": "fixture",
    "windowFrom": "2026-06-01",
    "windowTo": "2026-07-01",
    "mode": "full_rematch"
  },
  "activities": [
    {
      "type": "pr.merged",
      "occurredAt": 1720000123,
      "provider": "ado",
      "org": "acme", "project": "Alpha",
      "repoId": "<seeded-repo-id>",
      "developerId": "<seeded-dev-id>",
      "matchedUniqueName": "ada@example.com",
      "sourceIds": {
        "prRepoGuid": "11111111-1111-1111-1111-111111111111",
        "prId": 1001
      },
      "meta": { "title": "Fixture PR" }
    }
  ],
  "unmatchedIdentities": []
}
```

### 10.2 Seed 前置条件（05 定；06 或手动执行）

- `scripts/seed-fixture.ts`：通过 `wrangler d1 execute --local` 插入若干 developers / repos / project_external_id，让 fixture 里的 id 有效。
- Repo 的 `project_external_id` 必须与 fixture `activities[].sourceIds.projectGuid`（wi.*）或 `prRepoGuid`（pr.*）互相自洽。

### 10.3 05 的用途

- 用来验证 `ingestBodySchema` 能通过（05 单测跑）。
- 用来验证 `signoff ingest fixture ./fixtures/activities.sample.json` **stub** 能读入、校验、打印。

### 10.4 06 的用途

- 用来做首次真正 POST /pipeline/ingest 的 E2E：D1 出现 activity / score 行 → Web heatmap 可见。

---

## 11. 与 04 / 06 / 07 的边界

| 文档 | 关系 |
|:-----|:-----|
| **01** | 定义 Activity type、默认权重、身份匹配规则（本文所有契约必须遵守） |
| **02** | Schema、external_ref 模板、config_version 语义（本文写入路径的 sourceIds 与之一一对应） |
| **03** | Web 模板与 MVVM；**§5.6 收紧鉴权表述后需同步修 03 §8** |
| **04** | Settings CAS PUT、bootstrap 契约（本文 §3.1 扩展 bootstrap 返回；本文 §5 CAS 语义与 04 一致） |
| **05（本文）** | 06 开工前的**基础设施 + 冻结契约** |
| **06** | Activity/Score 真实写入、算法定稿、fixture 首次落库、Web 数据读回、真实 ADO 拉取入门 |
| **07** | CLI 命令矩阵、raw JSON 逐字段 schema、az 调用与错误分类 |

**05 定"契约"；06 定"算法与实装"；07 定"外部数据源与命令表"。**

---

## 12. 05 验收清单

### S1 Schema & Bootstrap
- [ ] `packages/db/migrations/0004_repo_project_guid.sql` 落地并 remote apply
- [ ] `repos` 表新增 `project_external_id TEXT`；索引若需要（06 可能加）留 TODO 注释
- [ ] `GET /api/pipeline/bootstrap` 响应 `repos[].projectExternalId`
- [ ] Web repos 页新增 project GUID 编辑字段；`POST/PUT /api/repos` 支持该字段
- [ ] Worker 与 Web 单测通过

### S2 Domain 契约包
- [ ] `packages/domain` 建包 + tsconfig + bunfig
- [ ] 导出 `ACTIVITY_TYPES` / `DEFAULT_WEIGHTS` / `activitySchema` / `ingestBodySchema` / `paths` 帮手
- [ ] `matchDeveloper` / `dayKey` / `buildExternalRef` / `aggregateScores` 有签名 + `unimplemented` 抛错
- [ ] `parseUniqueName` **不存在**（明确删除，避免猜测剥前缀）
- [ ] `bun test` 通过；已落项覆盖率 ≥90%
- [ ] Worker 与 Web import `@signoff/domain` 无循环

### S3 CLI 骨架
- [ ] `apps/collect` 建 app + vitest
- [ ] `signoff doctor` 检 az / .data / bootstrap / token；每一项 pass/fail 打印
- [ ] `signoff settings pull` 打通 bootstrap → 写 cache（含 `pipelineConfigVersion` + `fetchedAt`）
- [ ] `signoff settings show` 读 cache 或 `--remote` 刷新
- [ ] `signoff collect --dry-run` 打印计划（org/project/repo × PR/WI），**不调 ADO**
- [ ] `signoff ingest fixture <file>` 读 JSON → `ingestBodySchema.parse` → 打印 body 摘要 → 退出 0，**不发 HTTP**
- [ ] Pipeline client mock 测试覆盖 200/401/403/409/413/501
- [ ] exit code 语义（§9.4）落地
- [ ] Coverage ≥95%

### S4 Ingest 契约冻结
- [ ] §5 全部小节写完并 review 通过
- [ ] `packages/worker/src/middleware/pipeline-auth.ts` 移除 `browser + Access → skip token` 对 pipeline write 的放行
- [ ] 新测试：Access JWT + `POST /api/pipeline/ingest` → 403
- [ ] `packages/worker/src/routes/pipeline.ts` 的 501 分支保留；body zod 校验先跑（可选）
- [ ] `docs/03-Web模块模板.md` §8 鉴权表格与本文 §5.6 完全一致

### S5 本地闭环
- [ ] `bun run dev:all` 起 web + worker + wrangler local D1，migrations apply
- [ ] loopback 用例：`curl http://127.0.0.1:37042/api/pipeline/bootstrap` 无 token 应 200
- [ ] loopback 用例：`curl http://127.0.0.1:37042/api/pipeline/ingest -X POST ...` 应返 501（未来 401 由 06 决定）
- [ ] `signoff doctor` 全绿
- [ ] `signoff settings pull` 写出 `.data/cache/bootstrap.json` 且 `pipelineConfigVersion` 与 Web 一致
- [ ] `signoff ingest fixture ./fixtures/activities.sample.json` 打印 body 摘要，退出 0

### 全阶段横切
- [ ] 所有新增文件 Biome 0 warning
- [ ] `.data/` 已在 `.gitignore`；本地 token 不进仓库
- [ ] `docs/README.md` 索引指向 05；06 / 07 骨架已建（可为 stub）

**任何"D1 里出现 Activity/Score 行"都不是 05 验收信号 —— 那是 06。**

---

## 13. 后续文档

| 编号 | 内容 | 触发时机 |
|:-----|:-----|:---------|
| 06 | Activity 重建算法与 Score（§7.4 待决清单定稿；ingest 真实写入实装；Web 读回 UI；fixture 首次落库；ADO 采集初步） | 05 完成 S1..S5 后立即开工 |
| 07 | CLI 命令矩阵与 ADO 落盘（raw JSON 逐字段 schema、az 调用、错误分类、增量游标） | 06 中 ADO 采集初步完成后展开 |
| 08 | Ingest 鉴权与运维（Pipeline Token 轮换、machine 白名单、ingest_runs 观察面） | 06 上线后按需 |

---

**文档结束（05）**
