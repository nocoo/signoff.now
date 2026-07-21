# 05 — 本机采集管线铺垫与 Ingest 契约

> 状态：**已实施**（S1–S5 完成；ingest 仍 501，真写库属 06）
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
| CLI 骨架（doctor/settings pull/dry-run） | ✅ 全部落地 | 加 `collect` 真拉 ADO（**07 交付**）、`ingest` 真提交（**06 交付**） |
| `/api/pipeline/ingest` 契约 | ✅ 定死 body/响应/错误码/幂等/D1 预算 | 按契约实现真写库 |
| `/api/pipeline/ingest` 实现 | ❌ **仍返 501** | ✅ 替换 501，写 Activity/Score/Unmatched/IngestRun |
| Score 聚合算法 | ⚠️ 只列输入输出与待决清单 | ✅ 定稿并实现 |
| Web 只读 API（heatmap/timeline） | ⚠️ 只冻结 DTO | ✅ 真实实现 + 前端接线 |
| fixture 首次落库 | ❌（fixture 文件格式定义即可） | ✅ 第一条 E2E |
| 真实 ADO 拉取 | ❌ | ✅ + 07 展开命令矩阵 |

---

## 2. 完整链路（目标状态一次成功采集）

图中标注 **【05】** 表示 05 交付的基础设施/契约，**【06】** 表示 06 实现的业务逻辑（fixture → Worker/D1 真实写入），**【07】** 表示 07 实现的真实 ADO 拉取。

```
本机 az 登录  【07】
  │
  ├─(1) signoff settings pull ──HTTPS──► GET /api/pipeline/bootstrap  【05 骨架 + 契约】
  │                                     └─► .data/cache/bootstrap.json (含 pipelineConfigVersion + projectGuid)
  │
  ├─(2) signoff collect ──az── ADO REST                                【07】
  │     ├─ enabled repos → PRs / PR threads / PR iterations
  │     └─ distinct projects → WorkItems / WI updates
  │             │
  │             └─► .data/raw/ado/{org}/{project}/... (JSON + schemaVersion)  【07；05 冻结目录约定】
  │
  ├─(3) validate raw（zod）                                             【07；05 冻结 schemaVersion 常量位置】
  │
  ├─(4) transform: raw + settings + devs → Activity[]                   【07（真 ADO 路径）／06（fixture 路径）】
  │       ├─ 身份匹配（alias@suffix ≡ uniqueName）                       【06 实现，05 只出 DTO+签名】
  │       ├─ external_ref 拼接（02 §5.2）                                【06 实现，05 只出 DTO+签名】
  │       └─ day_key（IANA 时区）                                        【06 实现，05 只出 DTO+签名】
  │
  ├─(5) POST /api/pipeline/ingest ──Bearer──► Worker                   【05 冻结契约；06 实装写库】
  │       body = { pipelineConfigVersion, runId, chunkIndex, isFinalChunk, activities[], unmatchedIdentities[] }
  │       05 仍返 501；06 替换为真写入：
  │             ├─ CAS pipelineConfigVersion（多阶段流程，非单 batch 原子）
  │             ├─ UPSERT activities (ON CONFLICT external_ref DO UPDATE)
  │             ├─ 二次查询受影响 dev-day 现存 Activity
  │             ├─ 域包 aggregateScores → UPSERT / DELETE scores
  │             ├─ UPSERT unmatched_identities（幂等 seen_count）
  │             └─ 更新 ingest_runs + ingest_chunks 状态机
  │
  └─(6) POST /api/pipeline/recompute/complete（full rematch finalize）  【06 完善；05 已定契约】
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
| Repo CRUD 无 project GUID 字段 | Web repos 页 + `POST/PUT /api/repos` 支持 `projectExternalId`；**服务端硬拒绝**同 `(provider, org, project)` 下不一致的非空 GUID（返 409），保证同项目下所有 repo 的 project GUID 单调一致；无需新建 `projects` 表 | 采集前用户回填一次 |

### 3.2 Domain 契约包

| Gap | 05 交付 | 06 使用 |
|:----|:--------|:--------|
| CLI/Worker 类型不共享 | 新包 `packages/domain`：只有 **DTO/常量/zod schema/函数类型别名**，无业务实现（§6） | 06 在此包内实装 `matchDeveloper` / `dayKey` / `buildExternalRef` / `aggregateScores` |
| Activity 结构无 SoT | 导出 `activitySchema` / `ingestBodySchema` / `ActivityType` / `ACTIVITY_TYPES` / `DEFAULT_WEIGHTS`（对齐 01 §6.3、02 §5.2） | Worker ingest 与 CLI transform 双边 import |
| 权重数值类型不明 | 定 `weight: z.number().int().nonnegative()`，与 D1 `scores.total INTEGER` 一致；`activityWeights` Settings 校验同步收紧为非负整数 | aggregateScores 输出 `total: number` 直接落 INTEGER |

### 3.3 CLI 基础设施

新 app `apps/collect`（临时名，06 或 07 定 final 名）：

| Gap | 05 交付 | 06 使用 |
|:----|:--------|:--------|
| 无 CLI app | commander 入口 + logger + 环境变量（`SIGNOFF_API_BASE` / `SIGNOFF_PIPELINE_WRITE_TOKEN`） | 加 collect / ingest 命令 |
| 无 doctor | `signoff doctor` 校验：`az` 已登录、`.data` 可写、bootstrap 可达、Pipeline Token 已配置（**仅当** `SIGNOFF_API_BASE` 非 loopback 时检查 token；loopback 场景按 §5.6 始终跳过 token）（不真调 ADO） | 每次 collect 前自动跑 |
| 无 HTTP client | `pipelineClient.bootstrap()` / `.ingest(body)` / `.recomputeComplete(body)`；mock 网络覆盖 401/403/409/501 | 06 换成真调用 + 200 分支 |
| 无 settings 缓存 | `.data/cache/bootstrap.json` 读写；含 `pipelineConfigVersion` 与 `fetchedAt`；过期检查 | collect 前必须 pull |
| 无 raw/normalized 目录约定 | `packages/domain/paths.ts` 导出 `rawPath(...)` / `normalizedPath(...)`，代码化 01 §7.2 | 06 落盘时使用 |
| 无命令 | `settings pull` / `settings show` / `doctor` / `collect --dry-run`（打印计划、**不调 ADO**） / `ingest fixture <file>` **stub**（打印将要 POST 的 body，不真发） | 06 补 `collect` 真拉、`ingest fixture` 改真 POST |

### 3.4 Ingest 契约（05 冻结，06 实装）

**服务端仍返 501**，但契约本身必须定死，06 无需再改：

| Gap | 05 交付 | 06 使用 |
|:----|:--------|:--------|
| body/响应/错误码 | §5.1 定死 | 按契约实装 |
| D1 查询预算 | §5.2：D1 Paid 1000 stmt 上限（**05 明确只支持 Paid**）；`activities.length ≤ 10` + `unmatched ≤ 10`（最坏 stmt ≈ 71，见 §5.2 明细）；payload ≤ 512 KB；meta_json ≤ 4 KB | 06 分批循环调用 + query-count 断言测试 |
| 多阶段流程 | §5.3：不承诺单 batch 原子；拆 Activity write → 查询 → Score upsert → finalize；每阶段独立 CAS | 06 按阶段实装 |
| runId/chunk/finalize 状态机 | §5.4：run 生命周期 `chunked → finalized`（失败时 `failed`）；chunk 幂等 by `(runId, chunkIndex)` | 06 实装状态转换 |
| 服务端反污染 | §5.5：dayKey/identity/externalRef 服务端重算并比对，客户端不可提供 `id` / `config_version` | 06 实装校验 |
| 鉴权契约 | §5.6：浏览器 Access **禁止** pipeline write；同步修 03 §8 与 04 §8；`pipeline-auth.ts` | 06 若发现代码路径不一致需修正 |

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
| **S2** Domain 契约包 | 3.2 全表 | `packages/domain` 建包；导出 DTO/zod/常量/**函数类型别名**（不含 impl 文件）；被 worker 与 web 单测 import 不报错；`bun test` 覆盖率 ≥95%（仅测常量/zod/paths） |
| **S3** CLI 骨架 | 3.3 全表 | `signoff doctor` / `settings pull` / `settings show` / `collect --dry-run` 全部可跑；`ingest fixture` 打印 body 但不发送；单测 ≥95% |
| **S4** Ingest 契约冻结 | 3.4 全表 + 同步修 03 §8 与 04 §8 鉴权表述 | §5 全部小节写完；`pipeline-auth.ts` 若与新契约冲突则同步修正测试（Access 浏览器打 pipeline write → 403） |
| **S5** 本地闭环实测 | 3.5 全表 | 手动跑通：`bun run dev:all` → `signoff doctor` 全绿 → `signoff settings pull` 写 cache → `signoff ingest fixture ./fixture.json` 打印 body 摘要并退出 0（**不发 HTTP**）；另用 `curl -X POST http://127.0.0.1:37042/api/pipeline/ingest -d '{}'` 独立验证 worker 返 501 |

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
  "activities": { "received": 10, "upserted": 10, "rejected": 0 },
  "scores": { "affectedDevDays": 18, "recomputed": 18 },
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
| 每次 Worker invocation 可执行 SQL statement 数 | 50 | **1000** | **06 部署目标只支持 Paid**;05 不再承诺兼容 Free(stmt 预算无法安全覆盖多阶段) |
| 单 statement 参数上限 | 100 | 100 | 06 用多行 `VALUES (..),(..),..` 时按 100 参数拆 |
| Worker 请求体 | — | 100 MB | 我方硬上限 **512 KB / 请求**（远小于 D1 阈值，避免误传） |

**05 冻结的应用层预算**（写进 zod）：

| 项 | 值 | 理由 |
|:---|:---|:-----|
| `activities.length` | ≤ **10** / chunk | **一期硬上限**(Paid)。最坏 stmt 清点见下方"stmt 明细";10 条为保守值,06 若切多行 `VALUES` / JSON 参数后**实测**再提议放大 |
| `unmatchedIdentities.length` | ≤ **10** / chunk | 与 activities 同数量级 |
| `activities[].meta` 序列化后 | ≤ **4 KB** / 条 | 超上限直接 400 拒绝；一期不做外部存储 |
| `payload bytes` | ≤ **512 KB** | 服务端**必须校验实际读取字节数**（`Content-Length` 可缺失或伪造），流式读到阈值即拒 413 |
| 单 statement 参数绑定 | ≤ **100** | D1 硬限制;06 若切多行 `VALUES` 须按 100 参数拆 |

**最坏 stmt 明细**（一 chunk,`activities=10` `unmatched=10`,final chunk 场景;每行 = 一次 D1 statement 或 batch statement）：

| Phase | 项 | 数量 |
|:------|:---|-----:|
| Phase 0 | SELECT 当前 Settings.pipeline_config_version | 1 |
| Phase 0 | SELECT ingest_runs 状态 | 1 |
| Phase 0 | SELECT ingest_chunks 状态 | 1 |
| Phase 0 | SELECT 旧 activities by external_ref | 1 |
| Phase 0 | 引用完整性 SELECT (developers + repos ≤ 10 × 2) | ≤ 20 |
| Phase 1 batch | UPSERT activities × 10 | 10 |
| Phase 1 batch | UPSERT unmatched_identities × 10 | 10 |
| Phase 1 batch | UPSERT ingest_runs | 1 |
| Phase 1 batch | INSERT ingest_chunks | 1 |
| Phase 2 | SELECT activities 聚合(受影响 ≤ 20 dev-day) | 1 |
| Phase 3 | SELECT current Settings version 重读(§5.3 约束 8) | 1 |
| Phase 3 batch | UPSERT scores 或 DELETE scores(每 dev-day 二选一,合计 ≤ 20) | ≤ 20 |
| Phase 3 batch | UPDATE ingest_runs stats | 1 |
| Phase 3 batch | UPDATE ingest_chunks status | 1 |
| Phase 4 batch | UPDATE ingest_runs finalize + finished_at | 1 |
| **合计上限** | | **≤ 71** |

Paid 上限 1000,单 chunk 71 有 14 倍余量;若 06 用 batch 多行 `VALUES` 优化 UPSERT 可再降。Free 上限 50 无法承载 Phase 0 完整校验(仅引用完整性就可能到 20),故**05 起明确"仅 Paid"**。

**05 不冻结**：JSON 参数化、多行 `VALUES`、引用完整性 SELECT 合并 等 SQL 优化路径——由 06 在实测 D1 stmt/bind 消耗后再提议放大 `activities.length` 上限,同步补 05 §5.2。

**06 的分片策略**：

- CLI 端把待写 Activity 按 10 一段切成 N 个 chunk；顺序发送。
- 若某 chunk 返回 409（版本冲突），CLI 应**中止后续 chunk**，`settings pull` 后**放弃当前 runId**、开新 runId 重头。
- 若某 chunk 返回 5xx，CLI 可重试**同一** `(runId, chunkIndex)`——服务端幂等保障（§5.4）。
- 06 服务端应加 **query-count 断言测试**:一次 ingest chunk 全流程 stmt 数 ≤ 80 upper bound(§5.2 明细算得 71,留少量余量),回归时自动失败。

### 5.3 多阶段流程（06 实装形态）

**明确不使用**：单 batch 完成 write+read+aggregate+finalize。**明确采用**：可重试的多阶段流程 + 内部 chunk 状态推进。

对于一次 `POST /api/pipeline/ingest`（一个 chunk），06 服务端顺序执行：

```
┌─ Phase 0  Chunk 预检 + 旧 dev-day 查询 + JS 算并集 ─────────┐
│  1. SELECT run + chunk_state by (runId, chunkIndex)         │
│     参照 §5.4 表格分派:                                     │
│       新 chunk / prepared 续跑 / completed / 冲突 / 跳号   │
│  2. 若"新 chunk"分支:                                       │
│       SELECT developer_id, day_key FROM activities          │
│         WHERE external_ref IN (<本 chunk 全部 externalRef>) │
│         -- **不过滤 config_version**:rematch 场景中旧行     │
│         -- 属前一版本,若过滤当前版本会漏掉,§5.3 约束 5     │
│         -- 详述                                              │
│       -- D1 read; 结果送回 JS                              │
│     JS: dev_day_union = set(旧 (dev,day))                   │
│         ∪ set(新 (dev,day) from 本 chunk activities)        │
│     (这一 SELECT + JS 计算与 Phase 1 batch **分开一次**     │
│      D1 请求发出;D1 batch() 无法消费前一条 SELECT 结果      │
│      来构造后一条 statement,所以并集必须 JS 侧算好再传入)   │
│  3. 若"prepared 续跑"分支:                                  │
│       跳过 SELECT,从 ingest_chunks 读回 dev_day_union_json │
│       进入 Phase 2                                          │
│  4. 若"completed"分支:                                      │
│       走 §5.4 finalize 幂等规则(见该节完整表)              │
└─────────────────────────────────────────────────────────────┘
        │ 新 chunk 或 prepared 续跑
        ▼
┌─ Phase 1  Activity + Unmatched 写入 + chunk 转 prepared ────┐
│  一次 batch(新 chunk):                                       │
│    UPSERT activities (ON CONFLICT external_ref DO UPDATE)   │
│    UPSERT unmatched_identities(首次执行才 seen_count += 1)  │
│    UPSERT ingest_runs (status='chunked')                    │
│    INSERT ingest_chunks (runId, chunkIndex, status='prepared',│
│                          digest, dev_day_union_json)         │
│      -- dev_day_union_json 来自 Phase 0 计算结果            │
│  失败:整 batch 回滚;返回 5xx;CLI 重试同 chunkIndex(将从    │
│    Phase 0 重新执行,并集重算,输出相同结果)                  │
│  prepared 续跑:跳过整个 batch,直接从 Phase 0 读回的         │
│    dev_day_union_json 进入 Phase 2                          │
└─────────────────────────────────────────────────────────────┘
        │
        ▼  查询受影响 dev-day
┌─ Phase 2  查询本 chunk 涉及的 (dev, day_key) 现存 Activity ─┐
│  受影响集合 = Phase 0/1 记录的 dev_day_union_json             │
│    = 旧 (dev, day_key)（本 chunk 覆盖前的值）                │
│    ∪ 新 (dev, day_key)（本 chunk 写入后的值）                │
│  SELECT ... FROM activities                                  │
│  WHERE (developer_id, day_key) IN (...)                      │
│    AND config_version = ?  -- 必须绑定当前版本              │
│  domain.aggregateScores(rows, weights)                       │
└─────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ Phase 3  Score UPSERT + DELETE 空聚合 + chunk 转 completed ┐
│  一次 batch：                                                │
│    UPSERT scores (ON CONFLICT (developer_id, day_key)       │
│                   DO UPDATE)  -- 对**有**聚合结果的 dev-day │
│    -- UPSERT 的 config_version 写为 <expected>              │
│    DELETE FROM scores                                        │
│      WHERE (developer_id, day_key) IN (受影响集合 - 聚合结果)│
│        AND config_version = <expected>                       │
│      -- 见约束 7:聚合为空表示该 dev-day 已无当前版本 Activity│
│      -- 显式绑 config_version 防止误删其他版本残留(若有)    │
│    UPDATE ingest_runs 累积 stats                            │
│    UPDATE ingest_chunks SET status='completed'              │
│      WHERE runId=? AND chunkIndex=? AND status='prepared'   │
│  失败:Phase 1 已提交、Phase 3 未提交 → CLI 重试将进入        │
│  prepared 续跑分支,直接从 Phase 2 开始(不重放 Phase 1)      │
└─────────────────────────────────────────────────────────────┘
        │
        ▼ 仅 isFinalChunk=true 且本 chunk 走到 completed 且 run 尚未 finalized
┌─ Phase 4  finalize run(不清 stale) ────────────────────────┐
│  UPDATE ingest_runs                                          │
│    SET status='finalized',                                    │
│        finished_at=<unix seconds>                             │
│    WHERE id=runId AND status='chunked'                       │
│    AND config_version = ?   -- 版本 CAS                     │
│  changes=0 → 409(run 已被别的进程 finalize,或版本变)        │
│  ★ 不在此清 stale;stale 由 CLI 随后单独调用                 │
│    POST /api/pipeline/recompute/complete 处理(§5.7)         │
└─────────────────────────────────────────────────────────────┘
```

**关键约束**：

1. **不跨 phase 承诺原子性**。D1 无跨 batch 事务；把风险明说，靠 Phase 1/3 各自幂等 + chunk 状态推进 + CLI 重试兜底。
2. **Phase 2 的 SELECT 必须 `WHERE config_version = <current>`**。改 timezone/weights 后旧行不参与聚合。
3. **Phase 3 不能只聚合本 chunk 的 activity**——必须查全库该 dev-day 的现存 Activity（否则同日已存在的 Activity 会丢分）。
4. `changes = 0` **不会**让 batch 回滚。任何 CAS 保护都必须写进 `WHERE`，并**读**返回的 `meta.changes`，服务端据此返 200 / 409。
5. **同一 `external_ref` 被 rematch 移动 developer 或 day_key**（例：改了 alias 或 timezone 后重放）：**Phase 0** 必须先 SELECT 旧的 `(developer_id, day_key)`（不放进 Phase 1 batch），JS 侧算好并集后随 Phase 1 batch 一次性写入 `ingest_chunks.dev_day_union_json`；**该 Phase 0 SELECT 不能过滤 `config_version`**——bump 后旧 Activity 属**前一版本**，若绑当前版本会漏掉,导致旧 dev-day 的 Score 无法参与 Phase 3 重算。Phase 2 聚合 Activity 时才过滤当前版本(§5.3 约束 2)。
6. **同一版本下跨 developer 的 `external_ref` 冲突**（不同 developer_id 命中同一 external_ref）：视为客户端 bug，Phase 1 拒绝，返回 **422**；不允许静默用新 developer 覆盖。
7. **Score DELETE 补齐**：受影响 dev-day 集合中，若 Phase 2 聚合结果**为空**（该 dev-day 的当前版本已无 Activity——比如 rematch 后所有 Activity 移到新 dev），Phase 3 必须对这些 dev-day 执行 `DELETE FROM scores`；否则旧 Score 会残留。
8. **三重 version 校验**：每次 mutation 都必须验证 `request.pipelineConfigVersion === run.config_version === current Settings.pipeline_config_version`。三者任一不等 → 409。特别是 Phase 3 UPSERT scores 前须重取当前 Settings 版本，避免 Settings 已变但旧版本 Score 覆盖新状态。

### 5.4 runId / chunk / finalize 状态机

**表变更**（06 提交时通过 `0006_ingest_run_states.sql`；05 只冻结契约。**注意**：`0005` 保留给 §12 S1a 的一次性 `activity_weights` 兼容 fix migration；06 用下一个可用编号）：

**重建 `ingest_runs`**（**不能只加列**）：

0001 里 `ingest_runs.status` 有 `CHECK (status IN ('running','success','failed','partial'))` 硬约束(见 `packages/db/migrations/0001_initial.sql`);新状态 `chunked` / `finalized` 会被 CHECK 拒绝。06 的 migration 必须走 SQLite 标准迁移路径:

0. **前置断言**:`SELECT COUNT(*) FROM ingest_runs = 0`。因 Ingest 一直返 501,当前该表**必为空**;若非空 migration **立即中止**要求人工处理(旧表无 `config_version` / `mode` 列,无法安全反向填充)。
1. 建 `ingest_runs_new` 含新 CHECK + 新列 `config_version NOT NULL` / `mode` / `finished_at`
2. 因 step 0 保证空表,无需 `INSERT ... SELECT` 迁移旧行
3. 修改 FK 引用 / 索引(若有)
4. `DROP TABLE ingest_runs; ALTER TABLE ingest_runs_new RENAME TO ingest_runs`

新 `ingest_runs`：

| 列 | 类型 | 说明 |
|:---|:-----|:-----|
| `id` | TEXT PK | = `runId`（ULID） |
| `status` | TEXT CHECK (status IN ('chunked','finalized','failed')) | 新状态集 |
| `config_version` | INTEGER NOT NULL | 该 run 绑定的 pipelineConfigVersion |
| `mode` | TEXT CHECK (mode IN ('incremental','full_rematch')) | |
| `started_at` | INTEGER | 保留原列 |
| `finished_at` | INTEGER NULL | **Phase 4** 写入 unix seconds;`chunked` 状态为 NULL |
| `stats_json` | TEXT | 保留原列 |
| `error_message` | TEXT | 保留原列 |

**新增 `ingest_chunks`**：

| 列 | 类型 | 说明 |
|:---|:-----|:-----|
| `run_id` | TEXT NOT NULL | FK ingest_runs.id |
| `chunk_index` | INTEGER NOT NULL | 序号，从 0 起 |
| PK | `(run_id, chunk_index)` | 复合主键 |
| `status` | TEXT CHECK (status IN ('prepared','completed')) | chunk 内部两阶段 |
| `digest` | TEXT NOT NULL | 请求体 SHA-256（不含 headers），首次落库时写入 |
| `dev_day_union_json` | TEXT NOT NULL | Phase 0 收集的旧∪新 (dev,day) 集合；Phase 2/3 重试续跑用 |
| `finished_at` | INTEGER NULL | `completed` 时写入 |

**幂等 & 顺序规则**（Phase 0 分派表；每条对应一种客户端请求）：

| 请求 | ingest_chunks 状态 | 服务端行为 |
|:-----|:-------------------|:-----------|
| 新 `runId`，`chunkIndex=0` | 无 | 建 run + chunk 行；跑 Phase 1..3；chunk → completed |
| 已知 `runId`，`chunkIndex = max_completed + 1` | 无 | 跑 Phase 1..3；chunk → completed |
| 已知 `runId`，`chunkIndex` 已存在，`status=prepared`，digest **相同** | prepared | 从 Phase 2 续跑；Phase 3 成功 → completed |
| 已知 `runId`，`chunkIndex` 已存在，`status=completed`，digest **相同**，`isFinalChunk=false` | completed | 幂等 no-op：直接返 200，counts 为空 |
| 已知 `runId`，`chunkIndex` 已存在，`status=completed`，digest **相同**，`isFinalChunk=true`，**run 未 finalized** | completed | **必须重跑 Phase 4**（此前 Phase 4 未成功）；不能返回 no-op，否则 run 永远无法 finalized |
| 已知 `runId`，`chunkIndex` 已存在，`status=completed`，digest **相同**，`isFinalChunk=true`，**run 已 finalized** | completed | 幂等 no-op：直接返 200，`finalized: true` |
| 已知 `runId`，`chunkIndex` 已存在，digest **不同**（无论 status） | 任一 | **409** — 请求体已变；客户端 bug |
| 已知 `runId`，`chunkIndex > max(completed, prepared) + 1` | 无 | **400** — 跳号；CLI 顺序错乱 |
| 已知 `runId`，`config_version` 与 run 记录不等 | 任一 | **409** — 中途 version 变化，本 run 作废 |
| `isFinalChunk=true` 且本 chunk 走到 completed | completed | 追加 Phase 4；run.status → `finalized` |
| 已 `finalized` 的 run 再收 chunk | — | **409** — 不接受追加 |

**关键点**：

- **completed → 视 run 是否 finalized 决定 no-op 还是补 Phase 4；prepared → 从 Phase 2 续跑**。这两分支必须严格区分，否则:
  - Phase 1 提交后 Phase 3 失败,重试因 digest 相同而"no-op" → 跳过 Score 写入,留下缺分。
  - Phase 3 完成后 Phase 4 失败,重试因 digest 相同而"no-op" → run 永远 chunked 状态,CLI 无法调 recompute/complete 清 stale。
- **seen_count 幂等**：Phase 1 只在**新建** chunk 行（即之前无该 `(runId, chunkIndex)` 记录）时对 unmatched `seen_count += 1`；prepared 续跑不再累加。

### 5.5 服务端反污染 / 反注入

服务端**不信任** CLI 的以下派生字段，必须重新计算并比对：

| 字段 | 服务端行为 |
|:-----|:-----------|
| `externalRef` | 用 `activities[].sourceIds` + `activities[].type` 走域包 `buildExternalRef` 重算；写库用重算值；客户端提供 `externalRef` → **400** |
| `dayKey` | 用 `occurredAt` + 当前 Settings.timezone 走域包 `dayKey` 重算；客户端提供 → **400** |
| `matchedUniqueName` | 用 `activities[].developerId` 查 Developer.alias × 当前 email_suffixes，比对客户端提供值；不一致 → **422** |
| `config_version` | 服务端写当前 `pipelineConfigVersion`；客户端提供 → **400** |
| `id` | 服务端生成（若 UPSERT 命中现有 external_ref 则复用旧 id）；客户端提供 → **400** |

**引用完整性 + sourceIds 绑定校验**（**422**）：

- `developerId` 必须在 `developers` 且 `archived_at IS NULL`
- `repoId` 若非 null 必须在 `repos` 且 `archived_at IS NULL` 且 `enabled=1`
- `type ∈ pr.*` ⇒ `repoId` 必填
- `type ∈ wi.*` ⇒ `repoId` 必须 null；`sourceIds` 必须含 `projectGuid` 与 `wiId`
- `sourceIds` 结构按 type 校验：`pr.vote` 必须有 `voterIdentityId`+`threadId`+`commentId`；`pr.active` 必须有 `iterationId`；`wi.updated` 必须有 `revisionId` 等（06 逐条落）
- 同 `external_ref` 命中不同 `developer_id` → **422**（§5.3 约束 6）
- **sourceIds 与 Repo/Project 严格绑定**（防攻击者提交别的真实 GUID）：
  - `pr.*`：`sourceIds.prRepoGuid` 必须等于 `repos.external_id`（查 `repoId` 那行）；不等 → **422**
  - `pr.*` / `wi.*`：`activities[].provider` / `.org` / `.project` 必须与对应 `repos` 行（PR 场景）或 `repos.project_external_id` 反向匹配一次的 org/project（WI 场景）**严格相等**；不等 → **422**
  - `wi.*`：`sourceIds.projectGuid` 必须等于该 `activities[].org + .project` 组合下**任意** `repos` 行的 `project_external_id`（同 project 一致由 §3.1 硬约束保证）；不等 → **422**
- 上述绑定校验必须在 Phase 0/1 之前完成；一旦发现即 short-circuit 整个 chunk。

### 5.6 鉴权契约（同步修 03 §8、04 §8 与 `pipeline-auth.ts`）

**05 明确**（替代 03 §8 与当前 `pipeline-auth.ts` 中"Access 浏览器可打 pipeline write"的旧表述）：

| 通道 | Pipeline write（`/api/pipeline/ingest`、`/api/pipeline/recompute/*`） | Pipeline read（`/api/pipeline/bootstrap`） | 管理 API（`/api/settings`、entity CRUD） |
|:-----|:------|:------|:------|
| **浏览器 + Access JWT** | ❌ **403** — Access 用户禁止 pipeline write | ❌ **403** — 浏览器无 CLI 语境；诊断走本地 loopback | ✅ |
| **Machine host + Bearer Write Token** | ✅ | ✅ | ❌ 403（machine host 不做管理写） |
| **Machine host + Bearer Read Token** | ❌ 403 | ✅ | ❌ 403 |
| **loopback (127.0.0.1 / *.dev.hexly.ai)** | ✅（本地开发，**始终**跳过 token） | ✅（**始终**跳过 token） | ✅ |
| **Pipeline Token 出现在浏览器 bundle** | 硬禁止（gitleaks 规则可考虑加） | — | — |

**05 对代码的影响**：

- `packages/worker/src/middleware/pipeline-auth.ts:44-47`：**移除** `if (browser && accessAuthenticated) { return next(); }` 对 pipeline 全部路径的放行；改为仅对 `/api/settings` 等管理 API 放行。
- 新增测试：Access JWT 打 `/api/pipeline/ingest` → 403；Access JWT 打 `/api/pipeline/bootstrap` → 403。
- `docs/03-Web模块模板.md` §8 表格同步修订（05 收尾时改，与本节表格严格对齐）。

### 5.7 recompute complete 契约收紧

`POST /api/pipeline/recompute/complete` 已在 04 §6.7 定义；05 补充作为 **stale 清理的唯一入口**（Phase 4 不清 stale）：

- Body 必须包含 `{ runId, pipelineConfigVersion, ok: true }`。
- 服务端校验：
  - `runId` 存在，`status = 'finalized'`，`mode = 'full_rematch'`；否则 **409**。
  - `pipelineConfigVersion` 与 run 记录 + 当前 Settings 三者相等；否则 **409**。
- 清 stale 的 CAS 保持 04 语义（`WHERE (SELECT value FROM settings WHERE key='pipeline_config_version') = <expected>`）。
- 一次成功清理后 `run.status` 不变（仍是 `finalized`）；`scores_stale` 标志转为 false，`scores_stale_reason` → null。
- **`incremental` mode 的 run 不能调用 recompute complete**（stale 只由 Settings 变更引入，非 incremental 触发）。

### 5.8 `/api/pipeline/ingest` 在 05 期间的行为

05 完成时服务端**必须**：

- 保留 501 响应体（04 已定的 `Not Implemented` 格式）作为**成功走完全部预检后的最终返回**。
- **强制**先跑以下预检（**皆在 05 内实装**，不留可选），任一失败即返对应错误码，不走到 501：
  - **鉴权**（§5.6）：401 / 403
  - **payload 字节校验**（§5.2 流式读取）：413
  - **Zod body schema 校验**（§6 discriminated union + strict）：400
  - **`pipelineConfigVersion` gate**（与当前 Settings 相等）：409
- 引用完整性 & sourceIds 绑定校验（§5.5 422 分支）**留给 06 实装**——因为 06 才建 `ingest_chunks` / 才真读 `activities` / 才有 UPSERT 语境；05 阶段这些走到 501 前不校验。
- **禁止**返回任何"已写入 N 条 Activity"的成功响应体——避免 CLI 误信。

---

## 6. 域包 `packages/domain` 设计（05 只出契约，06 实装函数）

### 6.1 05 交付范围

**05 只落**：包结构、导出、DTO、常量、zod schema、函数**类型定义**（`type`/`interface`，不落 `function`）。**不建**任何"抛 unimplemented"的函数文件。

**06 实装**：`matchDeveloper` / `dayKey` / `buildExternalRef` / `aggregateScores` 的**实现文件**、边界样例测试、95% 覆盖率——**05 阶段这些 `.ts` 文件根本不存在**。

理由：抛 `unimplemented` 的空壳既不能通过静态检查发现"忘了实装"，又会污染 05 覆盖率（要么门禁跳过、要么写"测试抛错"的 no-value 测试）。让 06 直接建文件更干净。

### 6.2 目录

```
packages/domain/
├── package.json                # name: @signoff/domain, private
├── tsconfig.json
├── bunfig.toml                 # bun coverage thresholds
└── src/
    ├── index.ts                # 只 re-export
    ├── constants.ts            # ACTIVITY_TYPES, DEFAULT_WEIGHTS   ← 05 落
    ├── activity.ts             # activitySchema, sourceIds unions   ← 05 落
    ├── ingest.ts               # ingestBodySchema, chunk/run 类型   ← 05 落
    ├── paths.ts                # rawPath(), normalizedPath(), cachePath()  ← 05 落
    ├── types.ts                # 函数**类型别名**（不含 impl）        ← 05 落
    │                           #   例：type MatchDeveloper = (u:string, ...) => {...}|null
    └── *.test.ts               # 05 只测已落项（常量/zod/paths）
    #
    # 以下由 06 建立(05 不存在):
    # identity.ts / day-key.ts / external-ref.ts / score.ts + 对应 .test.ts
```

### 6.3 硬约束

| 项 | 规则 |
|:---|:-----|
| 零副作用 | 不引入 React / fetch / fs / D1 类型 |
| Bun 原生测试 | `bun test --coverage`；05 阈值 ≥95%（仅已落文件参与门禁，`include` 精确列出） |
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

**Activity + sourceIds**（服务端据此重算 externalRef；按 type 走 discriminated union，防止 `wi.updated` 搭配 PR sourceIds 之类的错配）：

```ts
// packages/domain/src/activity.ts
import { z } from "zod";

const prCore = z.object({
  prRepoGuid: z.string().uuid(),
  prId: z.number().int().positive(),
}).strict();

const prVoteIds = z.object({
  prRepoGuid: z.string().uuid(),
  prId: z.number().int().positive(),
  voterIdentityId: z.string().min(1),
  threadId: z.number().int().positive(),
  commentId: z.number().int().nonnegative(),
}).strict();

const prActiveIds = z.object({
  prRepoGuid: z.string().uuid(),
  prId: z.number().int().positive(),
  iterationId: z.number().int().positive(),
}).strict();

const wiCore = z.object({
  projectGuid: z.string().uuid(),
  wiId: z.number().int().positive(),
}).strict();

const wiUpdateIds = z.object({
  projectGuid: z.string().uuid(),
  wiId: z.number().int().positive(),
  revisionId: z.number().int().positive(),
}).strict();

const activityBase = {
  occurredAt: z.number().int().positive(),
  provider: z.literal("ado"),
  org: z.string().min(1),
  project: z.string().min(1),
  developerId: z.string().min(1),
  matchedUniqueName: z.string().min(1),
  meta: z.record(z.unknown()).optional(),
} as const;

// discriminated union by `type`；每 type 只接受对应的 sourceIds 形状与 repoId 语义
export const activitySchema = z.discriminatedUnion("type", [
  z.object({ ...activityBase, type: z.literal("pr.merged"),
             repoId: z.string().min(1), sourceIds: prCore }).strict(),
  z.object({ ...activityBase, type: z.literal("pr.closed"),
             repoId: z.string().min(1), sourceIds: prCore }).strict(),
  z.object({ ...activityBase, type: z.literal("pr.created"),
             repoId: z.string().min(1), sourceIds: prCore }).strict(),
  z.object({ ...activityBase, type: z.literal("pr.vote"),
             repoId: z.string().min(1), sourceIds: prVoteIds }).strict(),
  z.object({ ...activityBase, type: z.literal("pr.active"),
             repoId: z.string().min(1), sourceIds: prActiveIds }).strict(),
  z.object({ ...activityBase, type: z.literal("wi.created"),
             repoId: z.null(),             sourceIds: wiCore }).strict(),
  z.object({ ...activityBase, type: z.literal("wi.closed"),
             repoId: z.null(),             sourceIds: wiCore }).strict(),
  z.object({ ...activityBase, type: z.literal("wi.updated"),
             repoId: z.null(),             sourceIds: wiUpdateIds }).strict(),
]);
// 禁止字段：id / externalRef / dayKey / config_version（每分支 .strict() 拒绝多余键）

export type Activity = z.infer<typeof activitySchema>;
```

**Ingest body**（含 chunk/run 状态）：

```ts
// packages/domain/src/ingest.ts
export const ingestBodySchema = z.object({
  pipelineConfigVersion: z.number().int().positive(),
  // ULID (Crockford base32, 26 chars) 或 UUID v4
  runId: z.string().regex(/^([0-9A-HJKMNP-TV-Z]{26}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/),
  chunkIndex: z.number().int().nonnegative(),
  isFinalChunk: z.boolean(),
  runMeta: z.object({
    startedAt: z.number().int().positive(),
    source: z.enum(["ado", "fixture"]),
    windowFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    windowTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mode: z.enum(["incremental", "full_rematch"]),
  }),
  activities: z.array(activitySchema).max(10), // §5.2 硬上限（Paid only）
  unmatchedIdentities: z.array(z.object({
    uniqueName: z.string().min(1),
    sampleOrg: z.string().optional(),
    sampleProject: z.string().optional(),
    sampleContext: z.string().optional(),
  })).max(10),
}).strict();
```

**函数类型（05 落，06 实装文件不在 05）**：

```ts
// packages/domain/src/types.ts
export type MatchDeveloper = (
  uniqueName: string,
  developers: readonly { id: string; alias: string }[],
  suffixes: readonly string[],
) => { id: string } | null;

export type DayKey = (occurredAtSec: number, timeZone: string) => string;

export type BuildExternalRef = (
  type: ActivityType,
  sourceIds: unknown,     // 06 用 discriminated union 收紧
) => string;

export type ScoreRow = {
  developerId: string; dayKey: string;
  total: number; breakdown: Partial<Record<ActivityType, number>>;
  activityCount: number;
};
export type AggregateScores = (
  activities: readonly Activity[],
  weights: Readonly<Record<ActivityType, number>>,
) => ScoreRow[];
```

> **`parseUniqueName` 剥前缀被删除**。01 明确「人类身份的 `uniqueName` 几乎全是邮箱」+ 精确匹配；无必要预先剥 `vsts:` 之类前缀（会引入猜测）。若 06 遇到真实 ADO 格式必须规范化，届时基于实测数据再加，并写进 06 与本节。

### 6.5 05 测试范围

| 已落项 | 测试 |
|:-------|:-----|
| 常量 | 键完整性（全部 8 种 type、DEFAULT_WEIGHTS 有全部键；权重值皆为非负整数） |
| activitySchema | 拒绝 `id`/`externalRef`/`dayKey`/`config_version`；type 不在枚举；sourceIds 与 type 错配（如 `wi.updated` + PR sourceIds、`pr.vote` 缺 threadId、`pr.merged` 附 `repoId=null`） |
| ingestBodySchema | `activities.length > 10` 拒绝；`unmatchedIdentities.length > 10` 拒绝；`runId` 长度、`windowFrom` 格式 |
| paths | `rawPath("ado", "acme", "Alpha", "repos/foo", "prs/1234")` 生成正确 |

**函数实现相关测试** 一律留给 06；05 不写任何"函数调用抛 unimplemented"级别的伪测试。

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
| `scoresStale = false` 且当前版本有 rows | 200；返回 rows；`scoresStale=false` |
| `scoresStale = false` 且当前版本无 rows | 200；`rows=[]`；`scoresStale=false` |
| `scoresStale = true`（配置刚变，未 recompute） | **200；`rows=[]`；`scoresStale=true` 与 `staleReason` 原样透传** — 不返回旧快照（当前 `scores` 主键 `(developer_id, day_key)` 会被新版本覆盖，无法保留历史版本；前端据 `scoresStale` 渲染横幅） |

**API 不得篡改 `scoresStale`**：始终读 Settings 真实状态并透传；不允许在返回旧数据时把 `scoresStale` 改成 `false`。

**SQL 骨架（06 实装）**：

```sql
-- stale=true 时直接返回空,不查 scores
-- stale=false:
SELECT developer_id, day_key, total, activity_count
FROM scores
WHERE developer_id IN (?, ?, ...)
  AND day_key BETWEEN ? AND ?
  AND config_version = (SELECT CAST(value AS INTEGER) FROM settings WHERE key='pipeline_config_version');
```

> **不保留历史快照**是 05 的刻意选择：一期 Scores 表主键决定了改配置后旧分被覆盖；用横幅 + 空数据引导用户重算，避免 UI 混淆新旧数据。二期若需 history，需单表存 snapshot（超出本文）。

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
  "pipelineConfigVersion": 3,
  "scoresStale": false,
  "staleReason": null,
  "items": [
    { "id": "01J...", "type": "pr.merged", "occurredAt": 1720000123, "dayKey": "2026-07-03",
      "org": "acme", "project": "Alpha", "repoId": "01J...", "meta": {} }
  ],
  "nextCursor": "eyJvIjoxNzIwMDAwMDAwLCJpIjoiMDFKLi4uIn0="
}
```

**stale 语义**：与 8.1 相同"stale 时返空"策略——即使 timeline 展示的是 Activity 明细而非 Score，`dayKey` 与身份匹配同样依赖当前 Settings 版本，返回旧版本的明细会与前端横幅信息不一致。

| 状态 | 行为 |
|:-----|:-----|
| `scoresStale = false` | 200；正常返回 items（含 keyset cursor） |
| `scoresStale = true` | **200；`items=[]`；`nextCursor=null`；`scoresStale=true` + `staleReason` 原样透传** |

**config_version 过滤**：非 stale 时 SQL 必须 `WHERE config_version = (SELECT CAST(value AS INTEGER) FROM settings WHERE key='pipeline_config_version')`。

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
| `signoff doctor` | ✅ 校验 az / .data / bootstrap 可达 / token（仅非 loopback 时检） | 加 ADO 网络探测 |
| `signoff settings pull` | ✅ 04 §6.4；写 `.data/cache/bootstrap.json` | — |
| `signoff settings show` | ✅ 读缓存或 `--remote` 刷新 | — |
| `signoff collect --dry-run` | ✅ 打印将要拉哪些 repo/project；**不**调 ADO | 加真 collect 主路径 |
| `signoff collect` | ⚠️ stub：打印 "not implemented (see docs/06)" 后 exit 1 | ✅ 真 ADO 拉取 + transform + ingest |
| `signoff ingest fixture <file>` | ⚠️ **STUB**：读 JSON、`ingestBodySchema.parse`、**打印** body 摘要（前 3 条 activity + 总数）、退出 0 **不真发** | ✅ 真 POST `/api/pipeline/ingest`；处理 200/409/501 |

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
  "runId": "01JAY7B4HXTMRP0VQZ0FKZH5S8",
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

- 用来做首次真正 POST `/api/pipeline/ingest` 的 E2E：D1 出现 activity / score 行 → Web heatmap 可见。

---

## 11. 与 04 / 06 / 07 的边界

| 文档 | 关系 |
|:-----|:-----|
| **01** | 定义 Activity type、默认权重、身份匹配规则（本文所有契约必须遵守） |
| **02** | Schema、external_ref 模板、config_version 语义（本文写入路径的 sourceIds 与之一一对应） |
| **03** | Web 模板与 MVVM；**§5.6 收紧鉴权表述后需同步修 03 §8** |
| **04** | Settings CAS PUT、bootstrap 契约（本文 §3.1 扩展 bootstrap 返回；本文 §5 CAS 语义与 04 一致）；**§5.6 鉴权变化需同步修 04 §8;§5.7 收紧 recompute complete 契约（必须绑 runId + mode='full_rematch' + 三重 version）后需同步修 04 §6.7** |
| **05（本文）** | 06 开工前的**基础设施 + 冻结契约** |
| **06** | Activity/Score 真实写入（基于 fixture 与 06 手工放到 `.data/normalized/` 的 Activity JSON）；算法定稿；fixture 首次落库；Web 数据读回。**不含**真实 ADO 采集 |
| **07** | 真实 ADO 拉取（az/PR/WI）+ raw 逐字段 schema + normalized transform + CLI 命令矩阵 + 增量游标 + 错误分类,写入 06 已实装的 Ingest 链路 |

**05 定"契约"；06 定"算法与实装"；07 定"外部数据源与命令表"。**

---

## 12. 05 验收清单

### S1 Schema & Bootstrap
- [x] `packages/db/migrations/0004_repo_project_guid.sql` 落地并 remote apply（review-fix 时已 `db:migrate:remote`）
- [x] `repos` 表新增 `project_external_id TEXT`；索引若需要（06 可能加）留 TODO 注释
- [x] `GET /api/pipeline/bootstrap` 响应 `repos[].projectExternalId`
- [x] Web repos 页新增 project GUID 编辑字段；`POST/PUT /api/repos` 支持该字段
- [x] `POST/PUT /api/repos` **服务端**硬拒绝同 `(provider, org, project)` 下不一致的非空 GUID → 409
- [x] Worker 与 Web 单测通过

### S1a 权重收紧为非负整数（横跨 domain / Settings / Web / 兼容）
- [x] `packages/domain` 常量 `DEFAULT_WEIGHTS` 值全部整数（已覆盖）
- [x] `PUT /api/settings` 校验 `activityWeights[*]` 为 **z.number().int().nonnegative()**；小数或负数 → 400
- [x] Web `useSettingsViewModel` 校验一致；表单 UI 阻止输入小数/负数
- [x] 既有数据兼容：远端 D1 现有 `activity_weights` 若已有小数（曾人工写入），S1 落地前跑一次 `SELECT value FROM settings WHERE key='activity_weights'` 抽查；若存在，落一次一次性 fix migration（`0005_normalize_activity_weights.sql`：round + 非负 clamp），并在 05 收尾时同步补 04 §3.2 的校验规则
- [x] `packages/worker/lib/settings.ts` 单测覆盖：小数拒绝 / 负数拒绝 / 整数通过

### S2 Domain 契约包
- [x] `packages/domain` 建包 + tsconfig + bunfig
- [x] 导出 `ACTIVITY_TYPES` / `DEFAULT_WEIGHTS` / `activitySchema` / `ingestBodySchema` / `paths` 帮手 / 函数类型别名
- [x] **不**建 `identity.ts` / `day-key.ts` / `external-ref.ts` / `score.ts` 实现文件（留给 06）；仅在 `types.ts` 落函数类型别名
- [x] `parseUniqueName` **不存在**（明确删除，避免猜测剥前缀）
- [x] `bun test` 通过；已落项覆盖率 ≥95%（`include` 精确列出已落文件，避免"没实装"文件稀释门禁）
- [x] Worker 与 Web import `@signoff/domain` 无循环

### S3 CLI 骨架
- [x] `apps/collect` 建 app + vitest
- [x] `signoff doctor` 检 az / .data / bootstrap / token；每一项 pass/fail 打印
- [x] `signoff settings pull` 打通 bootstrap → 写 cache（含 `pipelineConfigVersion` + `fetchedAt`）
- [x] `signoff settings show` 读 cache 或 `--remote` 刷新
- [x] `signoff collect --dry-run` 打印计划（org/project/repo × PR/WI），**不调 ADO**
- [x] `signoff ingest fixture <file>` 读 JSON → `ingestBodySchema.parse` → 打印 body 摘要 → 退出 0，**不发 HTTP**
- [x] Pipeline client mock 测试覆盖 200/401/403/409/413/501
- [x] exit code 语义（§9.4）落地
- [x] Coverage ≥95%

### S4 Ingest 契约冻结
- [x] §5 全部小节写完并 review 通过
- [x] `packages/worker/src/middleware/pipeline-auth.ts` 移除 `browser + Access → skip token` 对 pipeline write 的放行
- [x] 新测试：Access JWT + `POST /api/pipeline/ingest` → 403
- [x] `packages/worker/src/routes/pipeline.ts` 按 §5.8 强制预检：鉴权 401/403 → payload 413 → Zod 400 → version gate 409 → 全通过后返 501；引用完整性 422 留 06
- [x] 上述预检各写单测覆盖
- [x] `docs/03-Web模块模板.md` §8 鉴权表格与本文 §5.6 完全一致
- [x] `docs/04-Settings设计.md` §8 鉴权表格与本文 §5.6 完全一致
- [x] `docs/04-Settings设计.md` §6.7 recompute complete 契约按本文 §5.7 更新（新增 `runId` + `mode='full_rematch'` 三重 version 校验）

### S5 本地闭环
- [x] `bun run dev:all` 起 web + worker + wrangler local D1，migrations apply
- [x] loopback 用例：`curl http://127.0.0.1:37042/api/pipeline/bootstrap` 无 token 应 200
- [x] loopback 用例：合法 fixture body 的 `POST /api/pipeline/ingest` 应返 501（`{}` 会先 400；loopback 始终绕过鉴权）
- [x] `signoff doctor` 全绿
- [x] `signoff settings pull` 写出 `.data/cache/bootstrap.json` 且 `pipelineConfigVersion` 与 Web 一致
- [x] `signoff ingest fixture ./fixtures/activities.sample.json` 打印 body 摘要，退出 0

### 全阶段横切
- [x] 所有新增文件 Biome 0 warning
- [x] `.data/` 已在 `.gitignore`；本地 token 不进仓库
- [x] `docs/README.md` 索引指向 05；06 / 07 骨架已建（可为 stub）

**任何"D1 里出现 Activity/Score 行"都不是 05 验收信号 —— 那是 06。**

---

## 13. 后续文档

| 编号 | 内容 | 触发时机 |
|:-----|:-----|:---------|
| 06 | Activity 重建算法与 Score（§7.4 待决清单定稿；ingest 真实写入实装；Web 读回 UI；fixture 首次落库）—— **不含**真实 ADO 拉取 | 05 完成 S1..S5 后立即开工 |
| 07 | 真实 ADO 拉取（az/PR/WI + raw 逐字段 schema + normalized transform + 增量游标），复用 06 的 Ingest 链路 | 06 完成后展开 |
| 08 | Ingest 鉴权与运维（Pipeline Token 轮换、machine 白名单、ingest_runs 观察面） | 06 上线后按需 |

---

**文档结束（05）**
