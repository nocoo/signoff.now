# 06 — Activity 重建与 Score 算法

> 状态：**设计稿（待 review / 未实施）**  
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
        │  zod (ingestBodySchema)
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
- 实现：**必须**用明确的时区日历换算（推荐 `Temporal` 若运行时可用；否则经审计的轻量库或自研 **仅日期** 换算，禁止依赖 host local TZ）。  
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

严格按 05 §5.4：

0. **前置断言**：`SELECT COUNT(*) FROM ingest_runs` 必须为 0；否则 **migration 失败**（abort）。当前 501 保证表空。  
1. 建 `ingest_runs_new`（新 CHECK：`chunked|finalized|failed` + `config_version` / `mode` / `finished_at` 等）。  
2. 无数据迁移。  
3. 建 `ingest_chunks`（PK `(run_id, chunk_index)`，`status` prepared|completed，`digest`，`dev_day_union_json`，…）。  
4. Drop/rename；重建必要索引。  
5. 本地 + remote apply 列入验收。  

**编号**：0005 已用于 weights 规范化；本 migration **必须是 0006**。

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
| 同 external_ref 已存在且 developer_id 不同（当前版本或任意？） | 422 |

**external_ref 跨 developer 冲突口径**：

- UPSERT 前 SELECT 已有行：若 `external_ref` 命中且 `developer_id` ≠ 请求 → **422**（05 §5.3 约束 6）。  
- rematch **允许** 同 ref 换 developer（full_rematch 场景）——仅当请求 `runMeta.mode === 'full_rematch'` 时允许覆盖 developer_id / day_key；`incremental` 下仍 422。  
  - **理由**：incremental 重放不应静默「抢」别人的事件；full_rematch 是配置变更后的权威重写。  
  - 写入时仍按 05：Phase 0 收集旧 dev-day（不过滤 config_version）∪ 新 dev-day。

**服务端派生字段**（写库用）：

| 字段 | 来源 |
|:-----|:-----|
| `external_ref` | `buildExternalRef(type, sourceIds)` |
| `day_key` | `dayKey(occurredAt, settings.timezone)` |
| `config_version` | 当前 `pipeline_config_version` |
| `id` | 已存在 ref 则复用；否则新建 ULID/UUID |

客户端若带 `id` / `externalRef` / `dayKey` / `config_version` → 已在 zod **400**（05）。

### 5.4 digest 与幂等

- `digest = SHA-256(canonical JSON of body)`：建议对 body 做 **稳定序列化**（键排序）后哈希，避免空格差异误伤；**同一 CLI 实现**与 Worker 必须一致。  
- 文档约定：使用 `JSON.stringify` 对 **已 parse 的对象** 按键名递归 sort 后序列化（实现放 `packages/domain` 或 worker `lib/stable-json.ts`，单测固定向量）。  
- Phase 0 分派表：完整复制 05 §5.4，测试矩阵至少覆盖：新 chunk / prepared 续跑 / completed no-op / completed+final 补 Phase4 / digest 冲突 409 / 跳号 400 / 已 finalized 再写 409。

### 5.5 Score 写入

- `breakdown_json`：`JSON.stringify(breakdown)`，键顺序不要求稳定；读回时 parse。  
- `activity_count` ← ScoreRow.activityCount。  
- `computed_at` ← unix 秒。  
- UPSERT 主键 `(developer_id, day_key)`；写入 `config_version = expected`。  
- DELETE 空聚合 dev-day：05 约束 7。

### 5.6 recompute complete

- 不改 04/05 契约。  
- 06 验收：`full_rematch` run finalized 后，CLI 调 complete → `scores_stale=false`。  
- `incremental` fixture E2E **不要求**调 complete（stale 未置位时）。

### 5.7 测试策略（Worker）

| 类 | 内容 |
|:---|:-----|
| 单测 mock D1 | Phase 分派、422/409、digest、finalized |
| stmt 计数 | mock 记录 prepare 次数 ≤ 80 |
| 集成（可选本地） | wrangler local + 真实 D1 文件：一条 fixture chunk → SELECT scores |

---

## 6. CLI 实装规格（仅 fixture 真写）

### 6.1 `signoff ingest fixture <file>`

| 步骤 | 行为 |
|:-----|:-----|
| 1 | 读文件 → `JSON.parse` → `ingestBodySchema`（或 **数组/多 chunk 文件格式** 见 §6.2） |
| 2 | 校验 `pipelineConfigVersion` 与本地 cache / 可选 `--pull` 先 bootstrap |
| 3 | 按 ≤10 activities 切 chunk；生成或保留 `runId`；`chunkIndex` 单调 |
| 4 | `pipelineClient.ingest(body)` **真 HTTP** |
| 5 | 200：打印 upsert 摘要；5xx：同 chunk 重试（有限次）；409：中止并提示 pull / 新 runId |
| 6 | 全部 chunk 成功且需清 stale 时：可选 `--complete-rematch` 调 recompute complete |

**退出码**：沿用 05 §9.4（0 成功；3 契约/409；4 5xx 耗尽等）。

### 6.2 Fixture 文件形态

**06 主推两种**（实现至少支持 A）：

| 形态 | 说明 |
|:-----|:-----|
| **A. 单 body** | 即一个 `ingestBodySchema` 对象；activities 可 ≤10；>10 时 CLI **自动切 chunk**（复制 runMeta / runId，改 chunkIndex / isFinalChunk / 切片 activities） |
| **B. 多 chunk 数组** | `{ "chunks": [ body0, body1, ... ] }` 可选；06 若时间紧可只做 A |

仓库内 `fixtures/activities.sample.json`：更新为 **可真实 POST** 的 body（developerId/repoId 用环境说明：E2E 脚本先 CRUD 或文档写明「先 seed」）。

### 6.3 E2E 推荐脚本（文档级，可后补 package script）

```text
1. wrangler dev --local + migrate
2. seed：1 developer + 1 repo（含 project GUID）+ settings 版本已知
3. 改写 fixture 中的 developerId / repoId / org / project / GUID 与 seed 一致
4. signoff ingest fixture ./fixtures/activities.sample.json
5. 断言 D1：activities ≥ 1, scores ≥ 1
6. curl heatmap → rows 非空
```

### 6.4 明确不做（CLI）

- `signoff collect` 真拉 ADO  
- raw 落盘 / transform  
- 改 doctor 语义（可加「ingest 连通性」探测，非必须）  

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
| Worker 接受 mode、绑定 run.config_version | ✅ |
| Phase 0 旧 dev-day 并集 + Score DELETE | ✅ |
| `recompute/complete` 清 stale | ✅ 接线验证 |
| Settings 变更自动触发 rematch | ❌（仍靠人跑管线；Web 只置 stale） |

---

## 9. 实施阶段（建议 commit / PR 切片）

> 设计评审通过后，**按序**实装；每阶段可独立合并且测试绿。

### P1 — domain 算法

- [ ] `identity` / `day-key` / `external-ref` / `score` + §3.8 测试  
- [ ] coverage 门禁  
- [ ] **验收**：纯函数单测全绿；无 Worker 行为变化  

### P2 — migration + ingest 真写

- [ ] `0006_ingest_run_states.sql` 本地 + remote  
- [ ] Phase 0–4；422/409 矩阵；stmt ≤ 80 断言  
- [ ] 501 移除  
- [ ] **验收**：mock/local 下 fixture body → activities + scores 行存在  

### P3 — CLI fixture 真 POST

- [ ] 自动分 chunk；重试；错误码映射  
- [ ] sample fixture 可跑通 local E2E（文档或 script）  
- [ ] **验收**：`signoff ingest fixture` exit 0 且 D1 有数据  

### P4 — Web heatmap / timeline

- [ ] 两 API + MVVM + 替换占位页  
- [ ] stale 横幅  
- [ ] **验收**：浏览器（或组件测）可见与 D1 一致的 total  

### P5 — 横切

- [ ] `bun run lint/typecheck/test/test:coverage/security`  
- [ ] 更新 `docs/README.md` 状态为「已实施」  
- [ ] 05 文首/§1 进度表如需可回写「ingest 已非 501」（实施后）  
- [ ] Retrospective：若算法决策有偏差记一笔  

---

## 10. 风险与明确不做

| 风险 | 缓解 |
|:-----|:-----|
| D1 多阶段非原子 | 05 状态机 + CLI 重试；测试 prepared 续跑 |
| dayKey 库在 Workers 不可用 | 选型时验证 Workers runtime；必要时自研日期换算 |
| fixture 与 seed id 耦合 | E2E 文档强制 seed 步骤；不把真实 id 写死进仓库 |
| 放大 chunk 上限诱惑 | 06 **不**改 10 条上限；优化 SQL 后另开 05 修订 |
| 范围膨胀进 07 | 任何 `az`/REST 代码 → 拒收，挪 07 |

**禁止**：

- 单 batch 写完 Activity+读+聚合+Score（05 已否决）  
- Web 手工改 Activity/Score  
- 服务端信任客户端 externalRef/dayKey  
- 用 `ChangedDate` 伪造 wi.updated（07 采集约束，transform 时遵守 01）  

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
- [x] migration 0006 步骤与空表断言  
- [x] Phase 0 422 / full_rematch 覆盖口径  
- [x] CLI fixture 真 POST 行为  
- [x] Web API + UI 最小集  
- [x] P1–P5 实施切片  
- [ ] **人工 review 通过**（你）  

### 实施后（实装阶段再勾）

- [ ] P1–P4 代码 + 测试  
- [ ] local E2E：fixture → D1 → heatmap  
- [ ] remote migration 0006  
- [ ] security / coverage 全绿  
- [ ] README：06 标为已实施  

---

## 13. 开放问题（希望 review 拍板或确认）

下列已在正文给了默认；若你不同意请在 review 直接改决策号：

| ID | 默认 | 可讨论点 |
|:---|:-----|:---------|
| D7 | created > active | 是否改为「无终态时 created 与 active **都计分**」 |
| B14 | 省略 0 权 type 键 | 是否保留键值为 0 |
| rematch 覆盖 | 仅 `full_rematch` 允许换 developer_id | incremental 是否也允许（更易误伤） |
| dayKey 实现 | Workers 可用方案待 P1 选型 | 是否强制 `Temporal` polyfill |
| 多 chunk fixture 格式 B | P3 可只做 A | 是否要在 06 支持 chunks 数组 |

**非开放（冻结）**：activities≤10、Paid only、501 退役、不采 ADO、不改 05 HTTP 错误码表。

---

## 14. 后续

| 编号 | 触发 |
|:-----|:-----|
| **07** | 06 P1–P4 验收后展开真采集 |
| **08** | Token 轮换、machine 白名单、ingest_runs 观察面（06 上线后按需） |

---

**文档结束（06 设计稿）**
