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

## 5. Ingest API 契约（新）

### 5.1 `POST /api/pipeline/ingest`

**Auth**：Pipeline Token（machine host 或 loopback）；浏览器 Access **禁止**打此路由（entryControl 白名单）。

**Body**：

```json
{
  "pipelineConfigVersion": 3,
  "runId": "01J...ULID",
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
      "dayKey": "2026-07-03",
      "provider": "ado",
      "org": "acme",
      "project": "Alpha",
      "repoId": "01J...",
      "externalRef": "ado:pr:{repoGuid}:{prId}:merged",
      "developerId": "01J...",
      "matchedUniqueName": "ada@example.com",
      "meta": { "prId": 1234, "title": "..." }
    }
  ],
  "unmatchedIdentities": [
    {
      "uniqueName": "bot@acme.example",
      "sampleOrg": "acme",
      "sampleProject": "Alpha",
      "sampleContext": "pr.vote:1234"
    }
  ]
}
```

**校验**（400 场景）：

| 项 | 规则 |
|:---|:-----|
| `pipelineConfigVersion` | 整数，缺 → 400 |
| `runId` | 非空字符串；CLI 生成（推荐 ULID） |
| `activities` | 数组，长度 ≤ **5000**（A7）；元素通过 B4 zod |
| `activities[].dayKey` | 格式 `YYYY-MM-DD`；服务端**不重算**（信任 CLI，但 §5.4 有 rematch 抽查规则） |
| `activities[].externalRef` | 匹配 02 §5.2 模板；非空 |
| `activities[].developerId` | 存在于 `developers` 且未归档 |
| `activities[].repoId` | 若 type 为 `pr.*`：必填且未归档；若 `wi.*`：必须为 null |
| `activities[].type` | 在 `ACTIVITY_TYPES` 枚举内 |

**成功响应 200**：

```json
{
  "runId": "01J...ULID",
  "pipelineConfigVersion": 3,
  "activities": { "received": 1234, "upserted": 1234, "skipped": 0 },
  "scores": { "affectedDevDays": 88, "recomputed": 88 },
  "unmatched": { "upserted": 3 }
}
```

**错误码**：

| HTTP | 场景 |
|:-----|:-----|
| 400 | body 校验失败 |
| 401/403 | Pipeline Token 缺失 / 白名单不通过 |
| 409 | `pipelineConfigVersion` 与当前不等（并发或 CLI 未刷新 cache） |
| 413 | `activities.length > 5000`（或后续可提到 100k，视 D1 batch 限制） |
| 422 | 引用完整性：`developerId` 归档、`repoId` 归档、`type` 与 `repoId` 组合非法 |
| 500 | D1 约束失败、意外错误 |

### 5.2 服务端处理顺序（**同一 `env.DB.batch()`**）

1. 载入 `pipelineConfigVersion`（`loadSettings`）。
2. `gate = { kind }` 校验 body（沿用 `pipeline-ingest.ts` 结构，新增 `ok` 分支替代 `not_implemented`）。
3. 组装 batch：
   - N × `INSERT OR REPLACE INTO activities (...) VALUES (...) WHERE (SELECT value FROM settings WHERE key='pipeline_config_version')='<expected>'`
     - **注意**：D1 `INSERT OR REPLACE` 遇 UNIQUE(external_ref) 会替换旧行；`config_version` 列写当前值。
   - M × `INSERT OR REPLACE INTO scores (developer_id, day_key, config_version, total, breakdown_json, activity_count, computed_at) VALUES (...) WHERE ...`
     - M 条 = 本 batch 涉及的 `(dev, day_key)` 集合
   - K × `INSERT ... ON CONFLICT(unique_name) DO UPDATE SET last_seen_at=..., seen_count=seen_count+...`（unmatched）
   - 1 × `INSERT INTO ingest_runs (id, started_at, finished_at, status, stats_json)`
4. `batch()` 执行；任一 `INSERT INTO activities` 或 `scores` 的 `changes === 0` 判定为 CAS 失败 → **409**（版本已变），**整批不写**（依赖 D1 batch 事务语义）。

> **D1 事务性提醒**：D1 `batch()` 目前是事务性执行；一旦某条失败整批回滚（截至本文写作时的行为）。若未来 D1 语义变化，需在此加入显式 `BEGIN/COMMIT` 或改用 sessions。

### 5.3 Score 重算范围（增量语义）

**增量 ingest**（`runMeta.mode = "incremental"`）：

- 只重算「本次 batch 涉及的 `(dev, day_key)` 对」的 Score。
- 服务端根据 `activities[].developerId` × `activities[].dayKey` 派生受影响 dev-day 集合。
- 对每个受影响 dev-day，从 **D1 `activities` 表当前所有行** 重新聚合（不是仅本 batch！否则丢失同日历史 activity）。

**Full rematch**（`runMeta.mode = "full_rematch"`）：

- CLI 责任：**在同一次 ingest 序列中**覆盖历史窗口的全部 activities。
- 服务端：ingest 完成后需一次 `POST /pipeline/recompute/complete` 清 stale。
- 简化实现：**一期 full_rematch 不做分批**，若数据量超出 5000 上限则强制拒绝，要求 CLI 拆窗口。

### 5.4 反注入 / 反污染

- Web 通过 Access 打的 `/api/settings` 已能改 `pipelineConfigVersion`（+1），但**不能**指定任意值。
- Ingest 不允许 body 中的 `activities[].config_version` 或 `activities[].id`；服务端生成 `id`（若采用 UPSERT by external_ref 则不需要）与 `config_version`。
- `external_ref` 不能包含空格与非 ASCII 控制字符（zod regex）。
- 拒绝跨 developer 的 `external_ref` 冲突（同 ref 命中不同 developer_id 视为攻击 / bug）→ 422。

---

## 6. 域包 `packages/domain` 设计

### 6.1 目录

```
packages/domain/
├── package.json                # name: @signoff/domain, private, exports: index, activity, score, identity
├── tsconfig.json
├── bunfig.toml                 # bun coverage thresholds
└── src/
    ├── index.ts                # 只 re-export，不写业务
    ├── constants.ts            # ACTIVITY_TYPES, DEFAULT_WEIGHTS
    ├── identity.ts             # matchDeveloper, parseUniqueName
    ├── identity.test.ts
    ├── day-key.ts              # dayKey(occurredAt, tz), inverseDayKey (仅测试用)
    ├── day-key.test.ts
    ├── external-ref.ts         # buildExternalRef by type
    ├── external-ref.test.ts
    ├── activity.ts             # zod schema + Activity type
    ├── activity.test.ts
    ├── score.ts                # aggregateScores(activities, weights)
    └── score.test.ts
```

### 6.2 硬约束

| 项 | 规则 |
|:---|:-----|
| 零副作用 | 不引入 React / fetch / fs / D1 类型 |
| Bun 原生测试 | `bun test --coverage`；≥95%（对齐 02 § 9 门禁） |
| 无网络 | 测试禁止真实网络 / 时区 fallback；使用 `TZ=UTC` 与 `formatToParts` 断言 |
| Import boundary | Worker/Web/CLI 都通过 `@signoff/domain` import；**禁止**跨 monorepo 相对路径引用 |

### 6.3 关键 API 类型

```ts
// packages/domain/src/activity.ts
export const ACTIVITY_TYPES = [
  "pr.merged", "pr.closed", "pr.created", "pr.vote", "pr.active",
  "wi.created", "wi.updated", "wi.closed",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const activitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  occurredAt: z.number().int().positive(),
  dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  provider: z.literal("ado"),          // 一期仅 ado
  org: z.string().min(1),
  project: z.string().min(1),
  repoId: z.string().nullable(),
  externalRef: z.string().min(1),
  developerId: z.string().min(1),
  matchedUniqueName: z.string().min(1),
  meta: z.record(z.unknown()).optional(),
});
export type Activity = z.infer<typeof activitySchema>;
```

```ts
// packages/domain/src/day-key.ts
export function dayKey(occurredAtSec: number, timeZone: string): string {
  const d = new Date(occurredAtSec * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  // 拼 YYYY-MM-DD
}
```

```ts
// packages/domain/src/identity.ts
export function matchDeveloper(
  uniqueName: string,
  developers: readonly { id: string; alias: string }[],
  suffixes: readonly string[],
): { id: string } | null;
```

```ts
// packages/domain/src/score.ts
export function aggregateScores(
  activities: readonly Activity[],
  weights: Readonly<Record<ActivityType, number>>,
): Array<{
  developerId: string;
  dayKey: string;
  total: number;
  breakdown: Partial<Record<ActivityType, number>>;
  activityCount: number;
}>;
```

---

## 7. Score 聚合骨架（详细算法见 06）

**05 只定「够 P2 打通」的骨架**；06 展开边界与证明。

### 7.1 输入

- `activities: Activity[]` — 属于同一 `pipelineConfigVersion`、可跨 developer、跨日
- `weights: Record<ActivityType, number>` — 来自 Settings

### 7.2 步骤（默认策略）

1. **分组**：按 `(developerId, dayKey)` 分组。
2. **同日折叠**（防重复计分）：
   - `pr.vote`：**不折叠**，一天多次投票各计。
   - `pr.active`：**同 PR 同日** 折叠为一次（多个 iteration 只计一次）。
   - `wi.updated`：**同 WI 同日** 折叠为一次（多个 revision 只计一次）。
   - `pr.created` / `pr.merged` / `pr.closed`：每个 PR 状态转换只会有一条 external_ref，自然唯一。
3. **终态优先**（PR 作者侧同日多条时的优先级）：
   - `pr.merged` > `pr.closed` > `pr.created` / `pr.active`
   - 命中终态的当天，同 PR 的 `created` / `active` **不再计入作者侧 total**（但仍写入 activities 表供审计）。
   - `pr.vote` 记投票者，独立于作者侧，不受此规则影响。
4. **加权求和**：`total = Σ weight[type] × 折叠后计数`
5. **breakdown**：`{ "pr.merged": 10, "wi.updated": 1, ... }`（仅出现的 type）
6. **activityCount**：**折叠前**的原始条数（审计意义）；DB 存这个值。

### 7.3 边界样例（06 会写全表）

| 场景 | 输入 | 期望 total |
|:-----|:-----|:-----------|
| 同 PR 同日 create + active × 3 + merged | 5 条 activity | `pr.merged` 权重（终态优先，其余作者侧丢） |
| 同 WI 同日 3 次 revision | 3 条 `wi.updated` | 1 × `wi.updated` 权重 |
| 同 dev 同日给 3 个 PR 各投一票 | 3 条 `pr.vote` | 3 × `pr.vote` 权重 |
| 同 dev 同日 5 个不同 PR 都合并 | 5 条 `pr.merged` | 5 × `pr.merged` 权重 |

### 7.4 决议

一期算法**必须与 06 保持一致**；写 P1 时 06 先落骨架、留边界表 TODO 即可，但**默认策略见 §7.2**、不允许在 P2 里自造。

---

## 8. Web 只读读回（P3）

### 8.1 `GET /api/activity/heatmap`

**Query**：`devs=id1,id2,...`（≤ 20 个）、`from=YYYY-MM-DD`、`to=YYYY-MM-DD`（闭区间，≤ 366 天）

**Auth**：Access。

**Response 200**：

```json
{
  "pipelineConfigVersion": 3,
  "scoresStale": false,
  "rows": [
    { "developerId": "01J...", "dayKey": "2026-07-01", "total": 10, "activityCount": 1 },
    { "developerId": "01J...", "dayKey": "2026-07-02", "total": 3, "activityCount": 3 }
  ]
}
```

**SQL 骨架**：

```sql
SELECT developer_id, day_key, total, activity_count
FROM scores
WHERE developer_id IN (?, ?, ...)
  AND day_key BETWEEN ? AND ?
  AND config_version = (SELECT value FROM settings WHERE key='pipeline_config_version');
```

> 用 `config_version` 过滤 → 一旦 stale 且未重算，返回可能为空或部分；前端应显示 stale 横幅（F4）。

### 8.2 `GET /api/activity/timeline`

**Query**：`dev=id`、`from=`、`to=`（≤ 90 天）、`limit=100`（分页，默认按 `occurred_at DESC`）

**Response 200**：

```json
{
  "items": [
    {
      "id": "01J...",
      "type": "pr.merged",
      "occurredAt": 1720000123,
      "dayKey": "2026-07-03",
      "org": "acme", "project": "Alpha", "repoId": "01J...",
      "meta": { "prId": 1234, "title": "..." }
    }
  ],
  "nextCursor": null
}
```

### 8.3 前端 MVVM 落点

| 层 | 路径 |
|:---|:-----|
| Model | `apps/web/src/models/activity.ts`（DTO parse + heatmap 色阶映射） |
| ViewModel | `apps/web/src/viewmodels/useActivityHeatmapViewModel.ts` |
| View | `apps/web/src/views/activity/*` |

heatmap 色阶：**复用 basalt tokens `--heatmap-*`**，不硬编码 hex。

### 8.4 P3 完成的可视化验收

用 P4-骨架的 `signoff ingest fixture ./fake-activities.json` 灌一份 3 dev × 30 天假 Activity → 打开 `https://signoff.dev.hexly.ai` → 能看到热力图、色阶正确、多选对比可切换、stale 横幅在改 Settings 后出现 → **P3 通过**。

---

## 9. CLI 骨架预留（P4-骨架，不含真 ADO）

### 9.1 目录

```
apps/collect/                    # @signoff/collect — 临时名，06 定 final 名
├── package.json                 # 依赖: @signoff/domain, commander, zod, ...
├── tsconfig.json
├── src/
│   ├── main.ts                  # commander 入口
│   ├── logger.ts                # gitinfo/pulse 风格
│   ├── config/env.ts            # 读 SIGNOFF_API_BASE / SIGNOFF_PIPELINE_TOKEN
│   ├── az/check.ts              # az login 校验（P4-骨架只做 --dry-run）
│   ├── az/check.test.ts
│   ├── pipeline/client.ts       # bootstrap / ingest / recompute/complete
│   ├── pipeline/client.test.ts
│   ├── cache/bootstrap.ts       # .data/cache/bootstrap.json 读写
│   ├── raw/paths.ts             # C3 path builder
│   ├── raw/schema.ts            # C2 zod（骨架版，字段少）
│   ├── commands/
│   │   ├── settings-pull.ts     # D5
│   │   ├── ingest-fixture.ts    # D7
│   │   └── collect.ts           # P5 才实现；P4-骨架只留 stub + --dry-run
│   └── commands/*.test.ts
```

### 9.2 命令表（P4-骨架）

| 命令 | 状态 | 说明 |
|:-----|:-----|:-----|
| `signoff settings pull` | ✅ P4-骨架 | 04 §6.4；写 `.data/cache/bootstrap.json` |
| `signoff settings show` | ✅ P4-骨架 | 读缓存 |
| `signoff ingest fixture <file>` | ✅ P4-骨架 | 读 Activity JSON → POST ingest；验证 P2/P3 链路 |
| `signoff collect --dry-run` | ⚠️ stub | 打印计划：需要拉哪些 org/project/repo；**不**调 ADO |
| `signoff collect` | ❌ P5 | 真 ADO 拉取 → raw → transform → ingest |

### 9.3 质量门

对齐 gitinfo/pulse：

| 项 | 阈值 |
|:---|:-----|
| Coverage stmts/branches/funcs/lines | ≥ 95% |
| Biome | 0 warning |
| Typecheck | 0 error |
| 网络测试 | mock 强制；无真实网络 |

---

## 10. Fixture 定义（P3 验收用）

`fixtures/activities.sample.json`（可放 `packages/domain/fixtures/` 或 `apps/collect/fixtures/`）：

```json
{
  "pipelineConfigVersion": 1,
  "runId": "fixture-01",
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
      "dayKey": "2026-07-03",
      "provider": "ado",
      "org": "acme", "project": "Alpha",
      "repoId": "<seeded-repo-id>",
      "externalRef": "ado:pr:11111111-1111-1111-1111-111111111111:1001:merged",
      "developerId": "<seeded-dev-id>",
      "matchedUniqueName": "ada@example.com",
      "meta": { "prId": 1001, "title": "Fixture PR" }
    }
  ],
  "unmatchedIdentities": []
}
```

配套 seed 脚本：`scripts/seed-fixture.ts` 通过 `wrangler d1 execute --local` 插入若干 developers / repos，让 fixture 里的 `developerId` / `repoId` 有效。

---

## 11. 与 04 / 06 / 07 的边界

| 文档 | 关系 |
|:-----|:-----|
| **01** | 定义 Activity type、默认权重、身份匹配规则（本文所有算法必须遵守） |
| **02** | Schema、external_ref 模板、config_version 语义（本文写入路径必须遵守） |
| **03** | Web 模板与 MVVM（P3 页面必须遵守） |
| **04** | Settings CAS PUT、bootstrap 契约（本文 5.2/5.3 CAS 语义与之一致） |
| **05（本文）** | 铺垫 & Ingest 服务端实现 & 域包 & Web 只读 & CLI 骨架 |
| **06** | Activity 重建算法与 Score 细节（终态优先证明、日折叠边界、rematch 全流程） |
| **07** | CLI 命令矩阵、raw 逐字段 schema、az 调用与错误分类 |

**05 定「怎么写库、写什么形状」；06 定「怎么算、边界如何」；07 定「怎么拉、raw 长什么样」**。

---

## 12. 验收清单

### P1 域逻辑
- [ ] `packages/domain` 建包 + Bun coverage ≥95%
- [ ] `matchDeveloper` 测试覆盖大小写、多后缀、group/bot 拒绝
- [ ] `dayKey` 用真 IANA（`Asia/Shanghai` / `America/Los_Angeles` / `UTC`）三时区断言跨零点边界
- [ ] `buildExternalRef` 8 种 type 全覆盖 + 拒绝空 id
- [ ] `activitySchema` zod 拒绝：type 不在枚举、dayKey 格式错、外部 ref 空、pr.* 缺 repoId、wi.* 有 repoId
- [ ] `aggregateScores` §7.3 表格样例全通过

### P2 服务端写入
- [ ] `POST /pipeline/ingest` 真实写入 activities + scores + unmatched + ingest_runs
- [ ] CAS 失败（`pipelineConfigVersion` 不匹配）→ 409
- [ ] 引用完整性（归档 dev / 归档 repo / type-repoId 组合非法）→ 422
- [ ] body 校验（缺字段、超 5000 条）→ 400 / 413
- [ ] fixture E2E：wrangler --local D1 灌数据成功；重复 POST 同 ref 不产生第二行（幂等）
- [ ] bootstrap 返回增加 `projectGuid` 字段（A6）

### P3 Web 读回
- [ ] `GET /api/activity/heatmap` 按 `config_version` 过滤，支持多 dev、限时间窗
- [ ] `GET /api/activity/timeline` 分页
- [ ] Web dashboard / activity 页从占位换为真调用
- [ ] `scores_stale=true` 时 UI 显示横幅
- [ ] 浏览器打开 `signoff.dev.hexly.ai/activity` 看到 P2 灌入的假数据

### P4-骨架 CLI
- [ ] `apps/collect` 建 app + coverage ≥95%
- [ ] `signoff settings pull` 打通 bootstrap → 写 cache
- [ ] `signoff ingest fixture <file>` 读 JSON POST 到 ingest → 打通
- [ ] `signoff collect --dry-run` 打印计划（不调 ADO）
- [ ] Pipeline HTTP client 用 mock 测试 401 / 409 / 200
- [ ] `az login` 校验 stub（真实调用留 P5）

### 全阶段横切
- [ ] 所有新增文件 Biome 0 warning
- [ ] `packages/domain` 被 worker/web/collect 三边 import 不循环
- [ ] `.data/` 覆盖在 `.gitignore`
- [ ] `docs/README.md` 更新索引到 05

---

## 13. 后续文档

| 编号 | 内容 | 触发时机 |
|:-----|:-----|:---------|
| 06 | Activity 重建算法与 Score（终态优先/日折叠边界表；rematch 全流程；分批策略） | P1 落地前先出骨架；P2 前定稿 |
| 07 | CLI 命令矩阵与落盘（ADO REST 端点、raw 逐字段 schema、错误分类） | P4-骨架落地后、P5 开工前 |
| 08 | Ingest 鉴权与运维（Pipeline Token 轮换、machine 白名单、ingest_runs 观察面） | P2 上线后按需 |

---

**文档结束（05）**
