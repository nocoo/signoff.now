# 06 — Activity 重建与 Score 算法

> 状态：**设计稿（Codex 阻断项已回写；待人工终审 / 未实施）**
> 依赖：[05-管线铺垫与Ingest实现](./05-管线铺垫与Ingest实现.md)（**契约冻结**）、[01](./01-项目定位.md)、[02](./02-数据结构与D1.md)、[04](./04-Settings设计.md)
> **不含**：真实 ADO / `az` REST 采集、raw 逐字段 schema、增量游标（属 **07**）
> **前提**：05 S1–S5 已落地；`/api/pipeline/ingest` 预检后仍 **501**；domain 仅有 DTO / 类型别名

---

## 边界一句话

**06 把 05 冻结的 Ingest 契约与 domain 类型实装为「fixture → POST ingest → D1 Activity/Score → Web 只读可见」的闭环。**

| 06 做 | 06 不做 |
|:------|:--------|
| domain 四函数实现 + ≥95% 测 | 真 ADO 拉取（07） |
| Worker 替换 501：多阶段写库 | 改 05 Ingest **协议**（body / 错误码 / 鉴权） |
| migration `0006_ingest_run_states.sql` | 历史 Score 快照表（二期） |
| CLI `ingest fixture` **真 POST** + 首次 E2E 落库 | 改 Settings / entity CRUD 产品语义 |
| Web heatmap / timeline API + MVVM | GitHub provider、多租户 |
| **定稿** 05 §7.4 算法待决 | 放大 `activities.length` 上限（除非实测后另开修订） |

**验收信号（06 完成）**：本机 fixture 一次成功 ingest 后，D1 有 Activity/Score 行；`GET /api/activity/heatmap` 能返回非空 rows（在 `scoresStale=false` 时）；Activity 页不再是纯占位。

**任何「从 ADO 自动拉数」都不是 06 验收信号 —— 那是 07。**

---

## 1. 为什么需要这份文档

05 已交付：

- Ingest body / 错误码 / 多阶段 / 状态机 / 鉴权 / D1 预算（**写死**）
- domain DTO + 函数**类型**（无实现）
- CLI 骨架 + fixture stub
- Web heatmap / timeline **DTO**（无路由 / 无页）

若 06 直接编码，会在「折叠规则未定、migration 细节未写、E2E 路径未排期」下返工。本文职责：

1. **拍板** 05 §7.4 全部待决（且不违反 §7.3 硬约束）
2. **展开** domain / Worker / CLI / Web 的实装顺序与验收
3. **明确** 与 05 契约的引用关系（协议不重开，只补实现细节）
4. **划清** 与 07 的边界

### 1.1 05 → 06 交接表

| 事项 | 05 状态 | 06 动作 |
|:-----|:--------|:--------|
| `POST /api/pipeline/ingest` | 预检 → **501** | 预检后走 Phase 0–4 真写；**501 退役** |
| 引用完整性 422 | 未做 | Phase 0 全量校验（05 §5.5） |
| `matchDeveloper` / `dayKey` / `buildExternalRef` / `aggregateScores` | 仅 `types.ts` | 建实现文件 + 测试 |
| Score 折叠 / 终态 | 待决清单 | **本文 §3 定稿** |
| `ingest_runs` 状态集 | 契约；表仍是 0001 CHECK | `0006` 重建 + `ingest_chunks` |
| `ingest fixture` | 打印 body，不 HTTP | 真 POST；处理 200/409/5xx |
| heatmap / timeline | DTO only | Worker 路由 + Web MVVM |
| 真 collect | stub | **不在 06** |

---

## 2. 目标链路（06 成功形态）

```
fixtures/activities.sample.json
        │  fixtureFileSchema → 切 chunk → 每块 ingestBodySchema
        ▼
signoff ingest fixture <file>     # 真 POST；可多 chunk
        │  Authorization: Bearer write token（非 loopback）
        ▼
Worker POST /api/pipeline/ingest
  Phase 0  预检 + 引用完整性 + externalRef/dayKey 重算 + digests
  Phase 1  UPSERT activities / unmatched + chunk=prepared
  Phase 2  SELECT 受影响 dev-day 的当前版本 activities
  Phase 3  aggregateScores → UPSERT/DELETE scores + chunk=completed
  Phase 4  isFinalChunk → run=finalized（不清 stale）
        │
        ▼  （仅 full_rematch 且需清 stale 时）
POST /api/pipeline/recompute/complete   # 04/05 已定；06 验证接线
        │
        ▼
GET /api/activity/heatmap|timeline      # 只读；stale 时 rows/items 空
        │
        ▼
Web /activity                           # heatmap + 明细；横幅提示 stale
```

**fixture 路径是 06 的主 E2E**；normalized 目录落盘与 transform 管线留给 07（或 06 可选把 fixture 写成「已是 ingest body」即可，不要求 raw→activity 变换器）。

---

## 3. Score 算法定稿（关闭 05 §7.4）

> 本节为 **SoT**。实现必须与边界样例表一致。
> 不违反 05 §7.3：纯函数、顺序无关、`breakdown` 仅含出现过的 type、整数权重。

### 3.1 决策一览

| # | 议题 | **06 决策** | 依据 |
|:--|:-----|:------------|:-----|
| D1 | `pr.vote` 是否折叠 | **不折叠**：同一 dev-day 多条 vote **各计一份权重** | 05 候选；vote 的 external_ref 已含 thread/comment，事件可重建 |
| D2 | `pr.active` 同 PR 同日 | **Score 层折叠为一次权重**；Activity 行仍按 iteration 保留 | 01 §6.3 / 02 §5.3 |
| D3 | `wi.updated` 同 WI 同日 | **Score 层折叠为一次权重**；Activity 按 revision 保留 | 01 §6.3 / 02 §5.3 |
| D4 | 作者侧终态优先 | 同 **(developerId, dayKey, prRepoGuid, prId)** 上作者 type 只保留优先级最高的一种参与计分 | 01 §6.3 |
| D5 | `activityCount` | **折叠前**：该 dev-day 输入 Activity **条数**（含将被折叠掉权重的行） | 05 候选；便于审计「发生了多少事件」 |
| D6 | `pr.merged` vs `pr.closed` | **互斥计分**：同 PR 同日同时出现时只计 `merged`；`closed` 不计分（仍可保留 Activity 行，见 §3.3） | 01 终态语义；正常采集不应同时产出两者 |
| D7 | `created` vs `active`（无终态时） | 优先级 **created > active**：同 PR 同日无 merged/closed 时只计 **created**（有 created）；仅 active 则计 active（折叠后 1 次） | 补全 01「created / active」总序，避免双计 |

### 3.2 作者侧 PR type 优先级（严格全序）

对同一 `(developerId, dayKey, prRepoGuid, prId)`，从下列 type 中最多选 **1** 种进入权重计算：

```
pr.merged  >  pr.closed  >  pr.created  >  pr.active
```

- `pr.vote` **不在此链**：始终独立计分（D1）。
- 选取规则：在该 PR-日、该 dev 的输入中，取优先级最高的 type；**仅该 type** 的权重进入 `breakdown` / `total`。
- 若最高 type 为 `pr.active` 且当日多条 active → 仍只计 **一份** `weights["pr.active"]`（D2）。
- 若最高 type 为 `pr.merged` 且仅一条（正常）→ 计一份 `weights["pr.merged"]`。

### 3.3 折叠发生在哪一层

| 层 | 是否丢 Activity 行 | 作用 |
|:---|:-------------------|:-----|
| **Activity 写入** | **否**（按 external_ref UPSERT） | 保留可重建明细；timeline 可展示全部 |
| **`aggregateScores`** | 不删输入；**输出** Score 时折叠权重 | 热力图 / total 用折叠后结果 |

> 采集侧（07）应尽量不产生「同 PR 同时 merged+closed」；算法侧仍按 D4/D6 防御。

### 3.4 `aggregateScores` 算法（伪代码）

```
输入: activities[], weights
输出: ScoreRow[]  // 每个 (developerId, dayKey) 至多一行

1. 按 (developerId, dayKey) 分组。

2. 对每个组 G：
   a. activityCount = |G|                          // D5 折叠前

   b. 将 G 拆成：
        votes   = type == pr.vote
        wiUpd   = type == wi.updated
        wiOther = type in {wi.created, wi.closed}
        prAuth  = type in {pr.merged, pr.closed, pr.created, pr.active}
        // 其他 type 一期不应出现；若出现：单独按条计权（防御）

   c. breakdown 累加（均为非负整数权重）：
        // votes: 不折叠
        for each a in votes:
          breakdown["pr.vote"] += weights["pr.vote"]

        // wi.created / wi.closed: 不按 WI 折叠（各 external_ref 一条权重）
        for each a in wiOther:
          breakdown[a.type] += weights[a.type]

        // wi.updated: 按 (projectGuid, wiId) 折叠 — 每键最多 +weights 一次
        for each distinct (projectGuid, wiId) in wiUpd:
          breakdown["wi.updated"] += weights["wi.updated"]

        // 作者 PR: 先按 (prRepoGuid, prId) 分组，每组取最高优先级 type
        for each prGroup in group prAuth by (prRepoGuid, prId):
          t = maxPriority(prGroup.types)   // §3.2
          if t == "pr.active":
            breakdown["pr.active"] += weights["pr.active"]   // 仅一次
          else:
            breakdown[t] += weights[t]                       // merged/closed/created 每组一次

   d. total = sum(breakdown.values)
   e. 产出 ScoreRow { developerId, dayKey, total, breakdown, activityCount }

3. 返回所有 ScoreRow（顺序不确定；调用方勿依赖顺序）。
```

**顺序无关性**：分组与 distinct 集合运算，不依赖输入顺序。

**空组**：若某 dev-day 经 rematch 后无任何当前版本 Activity，Phase 3 **DELETE** 该 scores 行（05 §5.3 约束 7），**不**产出 total=0 的残留行。

### 3.5 `dayKey`

```
dayKey(occurredAtSec, timeZone) -> "YYYY-MM-DD"
```

- `occurredAtSec`：UTC unix **秒**（与 Activity 一致）。
- `timeZone`：IANA，来自当前 Settings（默认 `Asia/Shanghai`）。
- 实现：**冻结**为（**locale 与 timeZone 不得对调**；Bun 实测 `new Intl.DateTimeFormat("Asia/Shanghai", …)` → `RangeError: invalid language tag`）：

```ts
const parts = new Intl.DateTimeFormat("en-CA", {
  timeZone, // IANA，如 "Asia/Shanghai"
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date(occurredAtSec * 1000));
// 从 parts 取 year/month/day → "YYYY-MM-DD"
// en-CA 倾向 YYYY-MM-DD 部件顺序，仍以 type 取值，勿依赖 format() 整串
```

- **禁止**把 IANA 时区当作 locale 第一参；**禁止** `Temporal` polyfill / host local TZ / 第三方时区库（除非 `Intl` 在目标 runtime 失败再开修订）。
- 非法 timeZone → 抛错；Worker 在 Phase 0 将此映射为 **500**（配置损坏），不静默回退 UTC。
- 跨日边界用例必须进单测（例：UTC `2026-07-01T16:00:00Z` + `Asia/Shanghai` → `2026-07-02`）。

### 3.6 `matchDeveloper`

```
matchDeveloper(uniqueName, developers, suffixes) -> { id } | null
```

对齐 01 / 02：

1. 对 `uniqueName` 与每个 `alias + "@" + suffix` 做 **大小写不敏感** 精确相等。
2. 多个 Developer 同时命中 → **确定性**：选 `id` 字典序最小者，并在测试中固定该行为；CLI/采集侧应避免歧义配置。
3. 无命中 → `null`（写入 unmatched，不写 Activity）。
4. **不**剥 `vsts:` 等前缀（05 已删 `parseUniqueName`）。若 07 实测需要规范化，另开修订并回写 01/05/06。
5. 空 `uniqueName` / 空 alias → 不匹配。

> 06 **ingest 路径**主要消费 **已带 `developerId` 的 Activity**（fixture / 未来 transform 已匹配）。`matchDeveloper` 供：
> - 07 transform；
> - 可选：服务端对 `matchedUniqueName` 的交叉校验辅助；
> - full_rematch 若在 Worker 侧重放 raw（**06 不做 raw rematch**；full_rematch 的 Activity 仍由 CLI 算好后 POST）。

### 3.7 `buildExternalRef`

严格对齐 02 §5.2（字符串模板）：

| type | external_ref |
|:-----|:-------------|
| `pr.created` | `ado:pr:{prRepoGuid}:{prId}:created` |
| `pr.merged` | `ado:pr:{prRepoGuid}:{prId}:merged` |
| `pr.closed` | `ado:pr:{prRepoGuid}:{prId}:closed` |
| `pr.vote` | `ado:pr:{prRepoGuid}:{prId}:vote:{voterIdentityId}:{threadId}:{commentId}` |
| `pr.active` | `ado:pr:{prRepoGuid}:{prId}:iter:{iterationId}` |
| `wi.created` | `ado:wi:{projectGuid}:{wiId}:created` |
| `wi.closed` | `ado:wi:{projectGuid}:{wiId}:closed` |
| `wi.updated` | `ado:wi:{projectGuid}:{wiId}:rev:{revisionId}` |

- 输入 `sourceIds` 必须已通过 activitySchema 判别联合；非法 type/shape → throw（Worker 视为 500 编程错误，正常请求应在 zod 层 400）。
- GUID / 数字原样拼入，**不**改大小写。
- 禁止名称型 org/project 进入 ref。

### 3.8 边界样例表（必须单测）

下列样例均假设 `weights = DEFAULT_WEIGHTS`，同一 `developerId=D1`，同一 `dayKey=2026-07-01`，除非另行说明。

| ID | 输入摘要 | 期望 total | 期望 breakdown（要点） | activityCount |
|:---|:---------|----------:|:----------------------|-------------:|
| B1 | 1× `pr.merged` | 10 | merged:10 | 1 |
| B2 | 同 PR：`pr.created` + `pr.merged` | 10 | 仅 merged:10 | 2 |
| B3 | 同 PR：`pr.closed` + `pr.merged` | 10 | 仅 merged:10 | 2 |
| B4 | 同 PR：`pr.created` + `pr.active`×2（不同 iter） | 2 | 仅 created:2 | 3 |
| B5 | 同 PR：仅 `pr.active`×3 | 2 | active:2（折叠） | 3 |
| B6 | 同 WI：`wi.updated`×4（不同 rev） | 1 | updated:1 | 4 |
| B7 | `wi.created` + `wi.updated`×2 同 WI | 4 | created:3 + updated:1 | 3 |
| B8 | `pr.vote`×2（不同 thread） | 6 | vote:6 | 2 |
| B9 | 同日 D1：`pr.merged` + `pr.vote`×1（同 PR） | 13 | merged:10 + vote:3 | 2 |
| B10 | 两 PR 各 `pr.merged` | 20 | merged:20 | 2 |
| B11 | 空数组 | [] | — | — |
| B12 | 两 dev 各 1 activity | 两行 Score | 各自 total | 各 1 |
| B13 | 输入顺序打乱的 B2 | 同 B2 | 顺序无关 | 2 |
| B14 | 仅权重为 0 的 type（若 settings 设 0） | 0 | key 可出现值为 0 或省略：实现选 **省略 0 键** | n |

**B14 细则**：`breakdown` 只包含 **贡献了正权重或显式 0 且该 type 在折叠后仍被选中** 的键——统一为：**折叠后权重和为 0 的 type 键省略**；`total===0` 但 `activityCount>0` 时仍产出 ScoreRow（全 0 权重配置），便于区分「无事件」与「有事件零分」。

**B15（跨日）**：同一 external 逻辑事件不应跨 dayKey 聚合；两 dayKey → 两 ScoreRow。

**B16（dayKey TZ）**：见 §3.5 用例，独立测 `dayKey`，不强制进 `aggregateScores`。

---

## 4. domain 实装规格

### 4.1 新增文件（05 不存在）

```
packages/domain/src/
  identity.ts          # matchDeveloper
  day-key.ts           # dayKey
  external-ref.ts      # buildExternalRef
  score.ts             # aggregateScores
  identity.test.ts
  day-key.test.ts
  external-ref.test.ts
  score.test.ts        # 含 §3.8 全表
```

`index.ts` re-export 实现函数（保留 types 别名导出以兼容）。

### 4.2 覆盖率门禁

- 新文件纳入 domain 既有 coverage 门禁（**≥95%** lines/functions/statements，Bun 指标）。
- §3.8 样例 **必须全部作为命名测试**（`B1`…），禁止只测 happy path。

### 4.3 非目标（domain）

- 不读 D1 / Settings / fs
- 不实现 raw ADO → Activity transform（07）
- 不实现 HTTP

---

## 5. Worker Ingest 实装规格

### 5.1 原则

- **协议不改**：05 §5.1–§5.8 为硬约束；本文只补「如何落地」。
- **501 退役**：预检全部通过后进入 Phase 0–4；不再返回 501。
- **Paid only**：stmt 预算按 05 §5.2；加 **query-count 断言**（单 chunk ≤ 80 statements）。

### 5.2 Migration `0006_ingest_run_states.sql`

严格按 05 §5.4，并补 06 缺口（sourceIds 落库）：

#### 5.2.1 可执行空表守卫（普通 SELECT 不会 abort）

SQLite / D1 的 `SELECT COUNT(*) ...` **不会**让 migration 失败。必须用 **INSERT 进带 CHECK 的守卫表** 把非空变成 statement 错误。
**同时**断言 `ingest_runs` **与** `activities` 均为 0（重建 activities 无回填路径；有行则必须人工处理）：

```sql
-- 0006 文件开头（示意）
CREATE TABLE _mig_0006_guard (n INTEGER NOT NULL CHECK (n = 0));
INSERT INTO _mig_0006_guard (n) SELECT COUNT(*) FROM ingest_runs;
INSERT INTO _mig_0006_guard (n) SELECT COUNT(*) FROM activities;
-- 任一 COUNT>0 → CHECK 失败 → 整份 migration 中止
DROP TABLE _mig_0006_guard;
```

当前 501 + 远端已核对两表 0 行。守卫失败时**禁止**盲目改 CHECK、跳过或 `DEFAULT '{}'` 糊弄。

#### 5.2.2 表变更顺序

1. 守卫通过后：建 `ingest_runs_new`（新 CHECK：`chunked|finalized|failed` + 列 `config_version NOT NULL`、`mode NOT NULL`、`finished_at`、**`run_meta_json TEXT NOT NULL CHECK (json_valid(run_meta_json))`**（首 chunk 冻结的完整 `runMeta` 规范 JSON，见 §5.3.1）等）。
2. 无旧行可迁（表空）。
3. **`DROP TABLE ingest_runs; ALTER TABLE ingest_runs_new RENAME TO ingest_runs;`**（先 rename 到最终名）。
4. **再**建 `ingest_chunks`，FK 引用**最终** `ingest_runs(id)`（勿在 rename 前建 FK 到 `_new` 表名残留）。
   - PK `(run_id, chunk_index)`
   - `status` ∈ `prepared|completed`
   - `digest` TEXT NOT NULL — **Worker 对请求 body 计算的** SHA-256（协议**不**传客户端 digest）
   - `dev_day_union_json TEXT NOT NULL CHECK (json_valid(dev_day_union_json))`
5. **`activities` 重建**（**禁止** `ALTER ... ADD COLUMN ... DEFAULT '{}'`——漏写列会静默落毒数据 `{}`，Phase 2 必 500；有存量时 DEFAULT 会整表回填无效 JSON）：

```sql
-- 示意：复制 0003 activities DDL，增加无默认值的 source_ids_json
CREATE TABLE activities_new (
  -- …既有列与 0003 一致…
  source_ids_json TEXT NOT NULL CHECK (json_valid(source_ids_json)),
  -- 无 DEFAULT；INSERT/UPSERT 必须显式提供真实 sourceIds JSON
  …
);
-- 因守卫保证 activities 为空：无需 INSERT…SELECT
DROP TABLE activities;
ALTER TABLE activities_new RENAME TO activities;
-- 重建 0003 全部 activities 相关索引 / FK 语义
```

- UPSERT 时 **必须** `source_ids_json = JSON.stringify(sourceIds)`。
- **不要**塞进 `meta_json`（meta 仅展示/审计；折叠键一等公民）。

6. 本地 + **remote** apply 列入验收；`packages/db` 的 `DB_SCHEMA_VERSION` → **6**。

**编号**：0005 已用于 weights 规范化；本 migration **必须是 0006**。同步修订 **02 §6.5**（`source_ids_json`，无 DEFAULT）。

#### 5.2.3 `failed` 状态口径

`ingest_runs.status` CHECK 含 `failed`，但 **06 正常重试路径不写入 `failed`**：

| 场景 | 状态 |
|:-----|:-----|
| Phase 1/3 中途失败 | 保持 `chunked` + chunk `prepared` 或无行；CLI 重试同 chunk |
| 版本冲突 / digest 冲突 | HTTP 409；run **不**标 failed |
| 人工/运维废除 run（预留） | 可 UPDATE `failed` + `error_message`；**06 不实现**该 API |

文档与代码注释标明：`failed` = **预留**，避免把可重试失败误终结。

### 5.3 Phase 0 增补（相对 05 的 422 落地）

05 预检已做：鉴权 / 413 / Zod / version gate。06 在进入 Phase 1 前 **必须** 完成 05 §5.5：

| 检查 | 失败码 |
|:-----|:-------|
| developerId 存在且未归档 | 422 |
| repoId 非 null → 存在、未归档、enabled=1 | 422 |
| pr.* 要求 repoId；wi.* 要求 repoId null | 422 |
| sourceIds 与 type；prRepoGuid = repos.external_id | 422 |
| wi projectGuid ∈ 同 org/project 下 repos.project_external_id | 422 |
| org/project/provider 与 repo 行一致 | 422 |
| matchedUniqueName 与 alias×suffixes 交叉校验 | 422 |
| 同 external_ref 已存在且 `developer_id` 不同 | 422（`incremental`）；`full_rematch` 见下 |

**external_ref 跨 developer 冲突口径**：

- UPSERT 前 SELECT 已有行：若 `external_ref` 命中且 `developer_id` ≠ 请求 → **422**（05 §5.3 约束 6），**除非** `effectiveMode = 'full_rematch'`（定义见 §5.3.1）。
- `incremental` 下跨 developer 抢 ref → 422。
- 写入时仍按 05：Phase 0 收集旧 dev-day（不过滤 config_version）∪ 新 dev-day。

#### 5.3.1 `effectiveMode` 与跨 chunk 冻结 `runMeta`（P1）

**问题**：新 run 的 `chunkIndex=0` 在 Phase 0 **尚无** `ingest_runs` 行（INSERT 在 Phase 1），不能「一律只读库内 mode」。

**`effectiveMode` 规则**：

| 情形 | `effectiveMode` | 说明 |
|:-----|:----------------|:-----|
| **新 run**（无 `ingest_runs` 行）且 `chunkIndex=0` | `parsedBody.runMeta.mode` | 完成全部校验后，在 **同一 Phase 1 batch** 用 **普通 INSERT** 固化 `mode` + `run_meta_json` + 首 chunk（§5.3.2） |
| **已存在** `ingest_runs` 行 | **仅** `ingest_runs.mode` | 请求 `runMeta` 必须与 `run_meta_json` **逐字段相等**；`runMeta.mode` ≠ 库内 mode → **409**；**禁止**再用 body mode 提权 |
| 换 developer 权限 | `effectiveMode === 'full_rematch'` | 按上表取值，不是「永远读库」也不是「永远读 body」 |

chunk digest **只**约束单次请求体；跨 chunk 的 mode 漂移靠 **`run_meta_json` 精确比对** 防住。

| 规则 | 行为 |
|:-----|:-----|
| 新 run + chunk 0 成功 Phase 1 | 固化 `mode`、`config_version`、`run_meta_json`（此后不可改） |
| 同 run 后续 chunk | `runMeta` ≡ `run_meta_json`；否则 **409** |
| 换 developer | **仅** `effectiveMode === 'full_rematch'` |

`pipelineConfigVersion` 仍走既有三重 version 校验（05 §5.3 约束 8）。

#### 5.3.2 `ingest_runs` 写入：INSERT 新 run / CAS 更新已有（P1）

05 原文 Phase 1 写「UPSERT ingest_runs」。若实现为 `ON CONFLICT DO UPDATE`，**两个并发 chunk 0 都可能成功**，后者还能 **覆盖** 已固化的 `mode` / `run_meta_json` / `config_version`。这与 §5.3.1 冻结语义冲突。

**06 冻结（并回写 05 §5.3 Phase 1 SQL 描述；HTTP 契约不变）**：

| 情形 | SQL 语义 | 硬约束 |
|:-----|:---------|:-------|
| **新 run**（Phase 0 无行） | **`INSERT INTO ingest_runs (...)`**（**禁止** `ON CONFLICT DO UPDATE`） | PK 冲突 → **整个 Phase 1 batch 失败回滚**；返回 5xx 或映射为可重试错误，CLI 同 `(runId, chunkIndex)` 重试 |
| **已有 run**（后续 chunk 或重试后的 chunk 0） | **`UPDATE ingest_runs SET stats_json=…, … WHERE id=? AND config_version=? AND mode=? AND status='chunked'`** 一类 **CAS** | **绝不**更新 `config_version`、`mode`、`run_meta_json`、`started_at`；`changes=0` → 按版本/状态冲突处理（通常 409） |
| `ingest_chunks` | 新 chunk 用 **INSERT**（PK 冲突 + digest 分支见 05 §5.4） | 与 runs 同一 batch 时，runs INSERT 失败必须拖垮 chunks |

**并发两个 chunk 0、不同 `runMeta`**（违反单写者，仍须可测）：

1. 两者 Phase 0 均视为新 run，`effectiveMode` 暂取各自 body。
2. Phase 1 仅 **INSERT** `ingest_runs`：一人成功；另一人 PK 冲突 → **整 batch 回滚**（activities/unmatched 不得半提交）。
3. 失败者重试 → Phase 0 见已有 run → `effectiveMode`/授权 **只认库内**；`runMeta` 与库不一致 → **409**（后到的不同 mode **不能**覆盖先到者）。

**必测**：两个并发 chunk 0、`runMeta.mode` 不同（或 `windowFrom` 不同）→ 恰好一个 Phase 1 batch 完整生效；库内 `run_meta_json` 等于胜者；败者重试得 409 或按库内 mode 继续（同 meta 时）。

**服务端派生字段**（写库用）：

| 字段 | 来源 |
|:-----|:-----|
| `external_ref` | `buildExternalRef(type, sourceIds)` |
| `source_ids_json` | `JSON.stringify(activities[].sourceIds)`（**必须落库**，见 §5.2.2 / §5.5） |
| `day_key` | `dayKey(occurredAt, settings.timezone)` |
| `config_version` | 当前 `pipeline_config_version` |
| `id` | 已存在 ref 则复用；否则新建 ULID/UUID |

客户端若带 `id` / `externalRef` / `dayKey` / `config_version` → 已在 zod **400**（05）。

### 5.4 digest 与幂等（仅 Worker）

- **协议不传 digest**；客户端**不得**也不需要计算 digest。
- Worker：`digest = SHA-256(stableStringify(parsedBody))`，`stableStringify` = 对象键名递归排序后 `JSON.stringify`（实现放 worker `lib/stable-json.ts` 或 domain，**单测固定向量**）。
- 首次 INSERT `ingest_chunks` 时写入 digest；重试同 chunk：digest 相同才续跑 / no-op；不同 → **409**。
- Phase 0 分派表：完整复制 05 §5.4，测试矩阵至少覆盖：新 chunk / prepared 续跑 / completed no-op / completed+final 补 Phase4 / digest 冲突 409 / 跳号 400 / 已 finalized 再写 409 / **runMeta 漂移 409**。

### 5.5 Phase 2 读回与 Score 写入

**为什么必须 `source_ids_json`**：`aggregateScores` 的折叠键来自 `sourceIds`（`prRepoGuid`/`prId`/`projectGuid`/`wiId`…）。Phase 2 从 D1 重读受影响 dev-day 的 **全部** 当前版本 Activity 时，若只有 `external_ref` 字符串，**无法**稳定还原结构化 `sourceIds` 而不写易碎 parser。
**禁止**从 `meta_json` 取折叠键。

Phase 2 映射：

```
row → Activity-shaped input for aggregateScores:
  type, occurredAt, provider, org, project, developerId,
  matchedUniqueName, repoId, sourceIds: JSON.parse(source_ids_json)
```

parse 失败或与 `type` 不匹配 → **500**（数据损坏；正常 UPSERT 路径不应出现）。

Score 写入：

- `breakdown_json`：`JSON.stringify(breakdown)`；读回时 parse。
- `activity_count` ← ScoreRow.activityCount。
- `computed_at` ← unix 秒。
- UPSERT 主键 `(developer_id, day_key)`；写入 `config_version = expected`。
- DELETE 空聚合 dev-day：05 约束 7。

### 5.6 recompute complete

- 不改 04/05 契约。
- 06 验收：`full_rematch` run finalized 后，CLI 调 complete → `scores_stale=false`。
- `incremental` fixture E2E **不要求**调 complete（stale 未置位时）。

### 5.7 并发与单写者

多阶段读写对 **不同 `runId` 并发** 不安全：后完成的旧聚合可能覆盖新 Score（同一 `(developer_id, day_key)`）。

| 约束 | 口径 |
|:-----|:-----|
| **单写者** | 一期运维约定：**同一时刻仅一个** ingest 逻辑写者（单 CLI 进程 / 单操作者） |
| 并发同 run | 不允许；第二写者对同一 `runId` 乱序 chunk → 400/409 |
| 并发不同 run | **不支持**；文档 + CLI 帮助声明；不引入分布式锁（超出 06） |
| 检测（可选，非必须） | 若 `ingest_runs` 存在 `status=chunked` 且 `started_at` 过新，可 409 拒绝新 run——**P2 可选**，默认靠单写者约定 |

### 5.8 测试策略（Worker）

| 类 | 内容 |
|:---|:-----|
| 单测 mock D1 | Phase 分派、422/409、digest、runMeta 冻结、finalized、chunk0 effectiveMode |
| stmt 计数 | 统计实际执行的 **`.first` / `.all` / `.run` 次数 + 每个 `batch([...])` 的 `statements.length` 之和** ≤ 80（05 最坏明细 71）；**禁止**只数 `prepare()` 调用 |
| **本地 D1 集成（门禁，非可选）** | `wrangler dev --local`（或等价 local Worker）+ 已 apply 的 local D1：seed → fixture → `SELECT` activities/scores；缺此门禁不得标 06 完成 |

---

## 6. CLI 实装规格（仅 fixture 真写）

### 6.1 为何不能先跑 `ingestBodySchema`

正式 `ingestBodySchema` 硬限制 `activities.length ≤ 10`（及 unmatched ≤ 10）。若 fixture 文件先 `ingestBodySchema.parse`，**大于 10 条永远到不了自动分 chunk**。

因此 CLI 使用 **专用宽松 schema** → 切块 → **每块再** `ingestBodySchema` 复验。

### 6.2 `fixtureFileSchema`（CLI only，domain 可导出）

```ts
// 概念形状；键与 ingest body 对齐，但数组上限放大
// fixture 代表「完整逻辑 run」：文件内 isFinalChunk 必须为 true（表示逻辑上会收尾），
// CLI 发出时仅最后物理 chunk 带 true，中间 chunk 覆写为 false。
fixtureFileSchema = z.object({
  pipelineConfigVersion: z.number().int().positive(),
  runId: /* 同 ingest：ULID|UUID */,
  chunkIndex: z.literal(0),           // 文件内必须 0；CLI 重写发出的 chunkIndex
  isFinalChunk: z.literal(true),      // 禁止 false 后又静默覆盖；语义=本文件是完整 run
  runMeta: /* 同 ingestBodySchema.runMeta */,
  activities: z.array(activitySchema).max(5000),          // 文件级上限；防误塞全库
  unmatchedIdentities: z.array(...).max(5000),
}).strict();
```

**切块规则**（activities 与 unmatched **并行**按索引窗切片，窗长 10）：

1. 令 `n = max(ceil(activities.length/10), ceil(unmatched.length/10), 1)`。
2. chunk `i`（`i=0..n-1`）：
   - `activities = activities.slice(i*10, (i+1)*10)`
   - `unmatchedIdentities = unmatched.slice(i*10, (i+1)*10)`
   - `runId` / `pipelineConfigVersion` / **`runMeta` 全文复制（禁止改 mode）**
   - `chunkIndex = i`
   - `isFinalChunk = (i === n-1)`
3. 每个 chunk 对象再 `ingestBodySchema.parse`；失败 → 本地 exit 3，不发 HTTP。
4. **06 不做** 多 chunk 数组格式 B（`{ chunks: [...] }`）。

### 6.3 `signoff ingest fixture <file>` 步骤

| 步骤 | 行为 |
|:-----|:-----|
| 1 | 读文件 → `JSON.parse` → **`fixtureFileSchema`**（不是直接 ingestBodySchema） |
| 2 | 校验 `pipelineConfigVersion` 与本地 cache；支持 `--pull` 先 bootstrap |
| 3 | 按 §6.2 切 chunk；顺序发送 |
| 4 | `pipelineClient.ingest(body)` **真 HTTP** |
| 5 | **200**：`ingestSuccessSchema`（05 成功响应形）校验通过后才发下一块；打印摘要 |
| 6 | **可重试**（同 `(runId, chunkIndex)`，有限次 + 退避）：HTTP **5xx**、网络断开、超时、fetch 失败；**不可**对 4xx 盲重试 |
| 7 | **409**：中止后续 chunk；提示 `settings pull` / 新 `runId`；exit 3 |
| 8 | **400/401/403/413/422**：中止；映射 exit code；不重试 |
| 9 | 全部成功且 `mode=full_rematch` 需清 stale 时：`--complete-rematch` 调 recompute complete |

**退出码**：沿用 05 §9.4（0 成功；3 契约/409；4 5xx/网络耗尽等）。

### 6.4 Fixture 文件与 sample

- 形态 **仅 A**：单 fixture 对象（`fixtureFileSchema`）；CLI 负责分 chunk。
- `packages/domain/fixtures/activities.sample.json`：更新为可跑 E2E 的 shape；**id 由 seed 脚本注入**或文档要求先 seed 再 sed 替换。

### 6.5 E2E 门禁（必做，非可选）

06 完成定义 **必须**包含一条自动化或脚本化路径：

```text
1. wrangler d1 migrations apply signoff-db --local（含 0006）
2. 启动 Worker：wrangler dev --local --port 37042（或文档规定端口；必须在 seed/ingest 前就绪）
3. seed：1 developer + 1 repo（project GUID）+ 已知 pipelineConfigVersion
4. 注入 fixture 的 developerId / repoId / org / project / GUID
5. SIGNOFF_API_BASE=http://127.0.0.1:37042 signoff ingest fixture <file> → exit 0
6. 断言 D1（local）：activities ≥ 1 AND scores ≥ 1
7. GET http://127.0.0.1:37042/api/activity/heatmap?... → scoresStale=false 且 rows 非空
```

缺步骤 2 / 6–7 不得勾选「06 已实施」。

### 6.6 明确不做（CLI）

- `signoff collect` 真拉 ADO
- raw 落盘 / transform
- 格式 B 多 chunk 文件
- 客户端计算 / 上传 digest

---

## 7. Web 只读读回实装规格

### 7.1 API

实现 05 §8.1 / §8.2，无协议变更：

| 路由 | 鉴权 |
|:-----|:-----|
| `GET /api/activity/heatmap` | 与管理读 API 相同（浏览器 Access / loopback） |
| `GET /api/activity/timeline` | 同上 |

- **禁止** pipeline token 专属；管理者浏览器可读。
- stale 语义：原样透传；stale 时 **不查** 业务表，直接空 rows/items。
- SQL：`config_version = current pipeline_config_version`。

### 7.2 前端

| 层 | 路径 |
|:---|:-----|
| Model | `apps/web/src/models/activity.ts` |
| ViewModel | `apps/web/src/viewmodels/useActivityHeatmapViewModel.ts`（+ timeline VM 可同文件或拆分） |
| View | `apps/web/src/views/activity/*` 替换 `ActivityPlaceholder` |

一期最小 UI：

1. 开发者多选（1..20）+ 日期范围（≤366 天）
2. 热力图（basalt `--heatmap-*` token）
3. stale 横幅（`scoresStale`）
4. 单人 timeline 列表（keyset「加载更多」）
5. **简单多选对比**：并排 total 或双行 heatmap（不要求复杂图表）

覆盖率：Model / ViewModel ≥95%；View 可排除（与项目惯例一致）。

### 7.3 路由

- `App.tsx`：`/activity` → 真实页。
- Dashboard 入口文案可改为「查看活跃度」而不再写「尚未写入」。

---

## 8. full_rematch 在 06 的最小支持

| 项 | 06 |
|:---|:---|
| CLI 从 raw 重算 Activity | ❌ 07 / 后续 |
| CLI POST `mode=full_rematch` 的 fixture body | ✅ 允许（手工构造） |
| Worker：chunk0 用 body mode，固化后仅库内 mode（`effectiveMode`） | ✅ |
| 后续 chunk runMeta 漂移 → 409 | ✅ |
| Phase 0 旧 dev-day 并集 + Score DELETE | ✅ |
| 换 developer 仅 `effectiveMode=full_rematch` | ✅ |
| `recompute/complete` 清 stale | ✅ 接线验证 |
| Settings 变更自动触发 rematch | ❌（仍靠人跑管线；Web 只置 stale） |

---

## 9. 实施阶段与发布顺序

> 设计评审通过后，**按序**实装；每阶段可独立合并且测试绿。

### 9.1 发布顺序（运维硬约束）

```
1) 0006 remote migration apply
2) Worker deploy（含 ingest 真写 + heatmap API）
3) CLI 版本发布 / 本机升级后 smoke（fixture E2E）
```

**禁止**先发 CLI 真 POST 再迁 0006（会写进旧 schema / 无 `ingest_chunks`）。
**禁止**先 deploy Worker 真写再迁 0006。

### 9.2 代码切片

### P1 — domain 算法

- [ ] `identity` / `day-key`（Intl） / `external-ref` / `score` + §3.8 测试
- [ ] `fixtureFileSchema` + 切块纯函数（可单测）
- [ ] coverage 门禁
- [ ] **验收**：纯函数单测全绿；无 Worker 行为变化

### P2 — migration + ingest 真写

- [ ] `0006`：守卫 + ingest_runs/chunks + `source_ids_json` + `run_meta_json`；本地 + remote
- [ ] Phase 0–4；422/409/runMeta 矩阵；stmt ≤ 80
- [ ] **并发 chunk 0**：不同 `runMeta` 仅一 batch 生效（§5.3.2）
- [ ] 501 移除
- [ ] **验收**：local D1 集成门禁通过（§5.8）

### P3 — CLI fixture 真 POST

- [ ] fixtureFileSchema → 切块 → 真 POST；5xx/网络重试；200 schema
- [ ] sample + seed 脚本
- [ ] **验收**：§6.5 全链路 exit 0

### P4 — Web heatmap / timeline

- [ ] 两 API + MVVM + 替换占位页
- [ ] stale 横幅
- [ ] **验收**：heatmap 与 D1 total 一致（含在 §6.5 **步骤 7**）

### P5 — 横切

- [ ] `bun run lint/typecheck/test/test:coverage/security`
- [ ] 按 §9.1 发布
- [ ] `docs/README.md` → 已实施；05 进度表回写 ingest 非 501
- [ ] Retrospective：若算法有偏差记一笔

---

## 10. 风险与明确不做

| 风险 | 缓解 |
|:-----|:-----|
| D1 多阶段非原子 | 05 状态机 + CLI 同 chunk 重试；prepared 续跑测试 |
| 多 run 并发写 Score | **单写者**约定（§5.7） |
| dayKey | 冻结 `Intl.DateTimeFormat` + formatToParts |
| fixture 与 seed id 耦合 | §6.5 强制 seed；仓库不写死生产 id |
| 放大 chunk 上限诱惑 | 06 **不**改 HTTP 10 条上限 |
| 范围膨胀进 07 | 任何 `az`/REST → 拒收 |

**禁止**：

- 单 batch 写完 Activity+读+聚合+Score（05 已否决）
- Web 手工改 Activity/Score
- 服务端信任客户端 externalRef/dayKey
- **已有 run** 时用 body `runMeta.mode` 提权（新 run/chunk 0 允许用 body 作为 `effectiveMode`，见 §5.3.1；固化后仅库内）
- 对 `ingest_runs` 使用 `ON CONFLICT DO UPDATE` 覆盖 `mode` / `run_meta_json` / `config_version`
- 把 sourceIds 只放在 `meta_json`
- 用 `ChangedDate` 伪造 wi.updated（07 采集约束）

---

## 11. 与其它文档的关系

| 文档 | 关系 |
|:-----|:-----|
| **01** | type 集合、默认权重、匹配规则、稳定性；算法不得违背 |
| **02** | external_ref 模板、表结构、scores PK |
| **03** | Web MVVM / basalt；Activity 页用 basalt heatmap token |
| **04** | Settings CAS、stale、recompute complete、bootstrap |
| **05** | Ingest **协议与状态机 SoT**；本文只实装 |
| **06（本文）** | 算法定稿 + 实装切片 + Web 读回 |
| **07** | 真 ADO、raw schema、transform、collect 命令矩阵 |

---

## 12. 验收清单（设计层 — review 用）

### 文档完备

- [x] 边界 / 非目标写清
- [x] 05 §7.4 全部拍板（§3.1）
- [x] 边界样例表 B1–B16
- [x] domain 文件列表与门禁
- [x] migration 0006：**双表**空守卫 + activities **重建**（`source_ids_json` 无 DEFAULT）+ `run_meta_json`
- [x] Phase 0 422；`effectiveMode`（chunk0 body / 其后库内）
- [x] dayKey：`en-CA` locale + `timeZone` option（非 IANA-as-locale）
- [x] CLI `fixtureFileSchema`（`isFinalChunk: true`）→ 切块 → `ingestBodySchema`
- [x] digest 仅 Worker；stmt 计 `.first/.all/.run`+batch.length；单写者；failed 预留
- [x] local E2E 含 `wrangler dev --local` + 发布顺序
- [x] Web API + UI 最小集
- [x] P1–P5 实施切片
- [x] Codex 第二轮阻断项已回写
- [x] Codex 第三轮：ingest_runs **INSERT/CAS**（非 UPSERT 覆写）+ 05 Phase 1 同步
- [ ] **人工终审通过**（你）

### 实施后（实装阶段再勾）

- [ ] P1–P4 代码 + 测试
- [ ] §6.5 local E2E：fixture → D1 → heatmap
- [ ] remote migration 0006 → Worker deploy → CLI smoke（§9.1）
- [ ] security / coverage 全绿
- [ ] README：06 标为已实施

---

## 13. 已拍板（Codex review + 默认）

| ID | 决策 | 状态 |
|:---|:-----|:-----|
| D7 | `created > active`（无终态时只计 created） | **通过** |
| B14 | breakdown 省略 0 权 type 键 | **通过** |
| rematch | 仅 `effectiveMode=full_rematch`（chunk0=body，其后=库内） | **通过**（§5.3.1） |
| dayKey | `Intl.DateTimeFormat("en-CA", { timeZone, … })` + `formatToParts`；无 Temporal | **通过**（locale≠IANA） |
| 格式 B | 06 不做 | **通过** |
| stmt 上限 | 单 chunk ≤ 80（05 最坏 71） | **通过** |
| 时区默认 | `Asia/Shanghai` | **通过** |

**非开放（冻结）**：HTTP `activities≤10`、Paid only、501 退役、不采 ADO、不改 05 HTTP 错误码表、单写者、sourceIds 一等列。

---

## 14. 后续

| 编号 | 触发 |
|:-----|:-----|
| **07** | 06 P1–P4 验收后展开真采集 |
| **08** | Token 轮换、machine 白名单、ingest_runs 观察面（06 上线后按需） |

---

**文档结束（06 设计稿）**
