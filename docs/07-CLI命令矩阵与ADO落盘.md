# 07 — 真实 ADO 采集：命令矩阵与落盘

> 状态：设计稿（待 Codex review）
> 依赖：[01](./01-项目定位.md) §6.1 稳定数据源、[02](./02-数据结构与D1.md) §5.2 external_ref、[05](./05-管线铺垫与Ingest实现.md) Ingest 契约、[06](./06-Activity重建与Score算法.md) 算法与 domain 函数
> 范围：把 `signoff collect` 从 `--dry-run` 骨架变成**真实拉取 ADO → 落盘 → 校验 → transform → 复用 06 ingest** 的完整链路

## 边界一句话

**07 只做「把真实 ADO 数据变成合法 `Activity[]`」；写库、计分、Web 展示一律复用 05/06 已冻结的东西。**

- ✅ 07 做：REST 拉取、raw 落盘、raw zod schema、transform、增量游标、错误分类、命令矩阵
- ❌ 07 不做：改 ingest 协议、改计分算法、改 D1 schema、Web 变更

---

## 1. 实测确认（写本文前已用真实 API 验证）

用 `~/workspace/work` 下的真实仓库 + `az rest` 实测，**01 §6.1 的每个稳定数据源都存在**：

| 数据源 | 端点 | 实测确认的关键字段 |
|:---|:---|:---|
| Repo | `GET /_apis/git/repositories/{repo}` | `id`(repo GUID)、`project.id`(project GUID)、`project.name` |
| PR 列表 | `GET .../pullrequests?searchCriteria.status=` | `pullRequestId`、`status`、`creationDate`、`closedDate`、`mergeStatus`、`lastMergeCommit`、`createdBy.uniqueName` |
| PR threads | `GET .../pullRequests/{id}/threads` | `properties.CodeReviewThreadType.$value === "VoteUpdate"`、`publishedDate`、`comments[].id`、`comments[].author.uniqueName`、`properties.CodeReviewVoteResult.$value` |
| PR iterations | `GET .../pullRequests/{id}/iterations` | `id`、`createdDate`、`updatedDate`、`author.uniqueName` |
| WI 查询 | `POST /_apis/wit/wiql` | `workItems[].id` |
| WI updates | `GET /_apis/wit/workItems/{id}/updates` | `rev`、`revisedDate`、`revisedBy.uniqueName`、`fields` diff |

**身份形态实测**（决定 01 §4.1 匹配规则可行）：

- 人类：`"uniqueName": "mastank@microsoft.com"`，`isContainer` 缺省
- 评审组：`"uniqueName": "vstfs:///Classification/TeamProject/{guid}\\CT and IM on Duty"`，`isContainer: true`

→ 01 的「人类 uniqueName 几乎全是邮箱、group 忽略」成立。

**多 org 实测**：`domoreexp` / `office` / `msdata` 三个 org 均可访问，01 §4.2 的多 org 要求必须支持。

**PR 时间过滤实测**（此参数在部分 SDK 里不可见，故实测确认）：

```
searchCriteria.minTime=2030-01-01T00:00:00Z + queryTimeRangeType=closed → 0 条
searchCriteria.minTime=2020-01-01T00:00:00Z + queryTimeRangeType=closed → 5 条
```

→ REST `api-version=7.1` **支持**该过滤。仍按 §7 保留重叠窗口与本地 `closedDate` 复核，
不把服务端过滤当作唯一正确性来源。

**其它实测**：`status=abandoned` 可查（3 条样本 `lastMergeCommit` 均为空）；
50 条 `completed` 样本 **全部**有 `lastMergeCommit` 与 `closedDate`；
VoteUpdate thread 恰含 1 条 comment，`author.id` 为稳定 GUID。

---

## 2. 认证

```bash
az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798
```

`499b84ac-…` 是 Azure DevOps 的固定 resource id。CLI 通过 `az` 取 token 后走 HTTP，**不存 PAT**（01 §7.3）。

- 入口先跑 `doctor` 校验 `az account show` 成功（已实现）。
- token 有效期内缓存在内存，**不落盘**；到期前主动刷新，收到 401 时刷新并重试**一次**。
- **401 与 403 语义不同**：401 = 未认证（提示 `az login`）；403 = 已认证但**无权限**
  （提示检查该 org/project 的访问授权）——两者都退 `ENV`，但文案必须区分，
  否则用户会对着已登录的终端反复 `az login`。
- **API 版本固定 `api-version=7.1`**，写进客户端常量。不跟随服务端默认版本漂移。

---

## 3. 命令矩阵

| 命令 | 行为 |
|:---|:---|
| `signoff collect --dry-run` | 现状：读 bootstrap 缓存打印计划，不调 ADO |
| `signoff collect` | **07 新增**：真实拉取 → 落盘 → 校验 → transform → 写 `.data/normalized/` + run manifest |
| `signoff collect --repo <id>` | 只采集指定 repo（调试用） |
| `signoff collect --since <date>` | 覆盖增量游标，强制从该日期起 |
| `signoff collect --no-wi` | 跳过 Work Item（PR-only，加速调试） |
| `signoff collect --full` | 忽略游标全量重采（配合 `full_rematch`） |
| `signoff collect --offline` | 用已有缓存，缺则报错（04 §6.4 要求） |
| `signoff collect --concurrency <n>` | 并发度，默认 4 |
| `signoff ingest normalized <file>` | **07 新增**：把 transform 产物走 06 的 ingest 链路 |

`collect` **不自动 ingest**：落盘与写库分离，便于人工检查后再提交（01 §7.2 硬约束 3「落盘后必须验证，失败禁止 ingest」）。

---

## 4. 落盘布局

沿用 01 §7.2 与 domain `paths.ts`（已实现，不改）：

```text
.data/raw/ado/{org}/{project}/
  repos/{repoName}/
    prs/{prId}.json                    # PR 详情
    pr-threads/{prId}.json             # threads 全量
    pr-iterations/{prId}.json          # iterations 全量
  workitems/{wiId}.json                # WI 详情（project 作用域）
  workitem-updates/{wiId}.json         # updates 流
.data/normalized/ado/{org}/{project}/
  activities-{runId}.json              # transform 产物，fixtureFileSchema 形状
.data/meta/
  cursor.json                          # 已提交的游标（只由 ingest 成功后推进）
  runs/{collectRunId}.json             # run manifest（见 §7.1）
```

**写入方式**：一律 `write temp → fsync → rename` 原子替换，避免中断留下半截 JSON。
路径每段先做 `encodeURIComponent`，并断言解析后的绝对路径仍在 `.data/` 之下——
repo 名可含 `/`、`..` 等字符，`paths.ts` 只去首尾斜杠，不防目录穿越。

**PR 快照不可覆盖**：一个 PR 可以 abandoned 后重开再 completed。若直接覆盖
`prs/{prId}.json`，旧的 `pr.closed` 就再也无法从 raw 复算，违反 01 §6.2「可重建」。
故 PR/WI 的 raw 按 `prs/{prId}/{fetchedAt}.json` 追加快照，`latest.json` 为软链接式指针。

**WI 按 project 落盘**（01 §7.2）：多个绑定 repo 同属一个 project 时**只采一份**，用 project GUID 去重，禁止按 repo 重复拉。

每个 raw 文件含 `schemaVersion`（01 §7.2 硬约束 1）：

```json
{ "schemaVersion": 1, "fetchedAt": 1784737800, "payload": { "…": "…" } }
```

---

## 5. Raw schema（zod）

`packages/domain/src/raw/` 新增。**只逐字段校验 transform 真正用到的字段**，其余 `.passthrough()` 容忍 ADO 加字段：

| 文件 | 导出 |
|:---|:---|
| `raw/identity.ts` | `rawIdentitySchema`（`uniqueName`/`displayName`/`id`/`isContainer?`） |
| `raw/pr.ts` | `rawPrSchema`（`pullRequestId`/`status`/`creationDate`/`closedDate?`/`mergeStatus?`/`lastMergeCommit?`/`createdBy`/`repository.id`/`repository.project.id`） |
| `raw/thread.ts` | `rawThreadSchema`（`id`/`publishedDate`/`comments[]`/`properties?`） |
| `raw/iteration.ts` | `rawIterationSchema`（`id`/`createdDate`/`updatedDate`/`author`） |
| `raw/workitem.ts` | `rawWorkItemSchema`（`id`/`fields`）、`rawWiUpdateSchema`（`rev`/`revisedDate`/`revisedBy`/`fields`） |

**校验失败 → 整个 scope 标记为 incomplete**，不只是跳过该实体。

01 §7.2 硬约束 3 是「落盘后必须验证，失败禁止 ingest」。若只跳过单个实体而让其余
数据照常 ingest 并推进游标，那条坏实体就**永久跳过**了——下次增量窗口已经不含它。
因此：任何 fetch / 分页 / schema / transform 失败都把所属 cursor scope 置为
`incomplete`，该 scope **不产生可 ingest 的 manifest，也不推进游标**。修好后重跑
同一窗口即可，因为游标没动。

---

## 6. Transform：raw → Activity[]

纯函数，放 `packages/domain/src/transform/`，无 I/O，可单测。

### 6.1 输入

PR 与 WI 的作用域不同（repo vs project），故是两个函数、两组输入：

```ts
type Common = {
  settings: { timezone: string; emailSuffixes: string[] };
  developers: { id: string; alias: string }[];
  org: string;
  project: string;
};

type PrTransformInput = Common & {
  repo: { id: string; externalId: string };   // externalId = repo GUID
  prs: RawPr[];
  threadsByPr: Map<number, RawThread[]>;
  iterationsByPr: Map<number, RawIteration[]>;
};

type WiTransformInput = Common & {
  projectExternalId: string;                  // project GUID
  workItems: RawWorkItem[];
  updatesByWi: Map<number, RawWiUpdate[]>;
};
```

**GUID 校验**：`prs[].repository.id` 必须等于 `repo.externalId`，
`repository.project.id` 必须等于绑定的 `projectExternalId`。不等 → scope
`incomplete`（说明 bootstrap 绑定与实际仓库不符，继续采集只会产生 422）。

### 6.2 逐 type 规则（严格对齐 01 §6.1）

| type | 触发条件 | occurredAt | 归属 | sourceIds |
|:---|:---|:---|:---|:---|
| `pr.created` | 总是 | `creationDate` | `createdBy` | `{prRepoGuid, prId}` |
| `pr.merged` | `status==="completed"` **且** `lastMergeCommit.commitId` 存在 | `closedDate` | `createdBy` | `{prRepoGuid, prId}` |
| `pr.closed` | `status==="abandoned"` | `closedDate` | `createdBy` | `{prRepoGuid, prId}` |
| `pr.vote` | thread 的 `CodeReviewThreadType==="VoteUpdate"` 且 `CodeReviewVoteResult !== 0` | 该 VoteUpdate comment 的 `publishedDate` | **投票者**（该 comment 的 author） | `{prRepoGuid, prId, voterIdentityId, threadId, commentId}` |
| `pr.active` | iteration 存在 | iteration `updatedDate` | iteration `author` | `{prRepoGuid, prId, iterationId}` |
| `wi.created` | 总是 | `System.CreatedDate` | `System.CreatedBy` | `{projectGuid, wiId}` |
| `wi.closed` | 见 §6.2.2 | 该 revision 的 `revisedDate` | 该 revision 的 `revisedBy` | `{projectGuid, wiId}` |
| `wi.updated` | 每条 update | `revisedDate` | `revisedBy` | `{projectGuid, wiId, revisionId: rev}` |

#### 6.2.1 `pr.vote` 细则

- **不限于赞成票**。01 §6.1 写的是「个人 vote」，不是「approve」。ADO 的取值为
  `10 / 5 / 0 / -5 / -10`；`0` 是**撤销投票**，不计分；其余非零值均计一次。
  权重按 type 统一（06 §3），不因赞成/反对而不同。
- **时间戳取 comment 而非 thread**。一个 thread 理论上可含多条 comment
  （实测样本恒为 1 条）。取那条 `commentType === "system"` 的 VoteUpdate comment：
  它的 `publishedDate` 是投票时刻，`author` 是投票者，`id` 是 `commentId`。
  若找不到唯一一条 → 丢弃该 vote 并记入 run 报告（不猜）。
- **`voterIdentityId` 用 `author.id`（GUID），不用 `uniqueName`**。邮箱会变，
  external_ref 必须稳定（02 §5.1）。

#### 6.2.2 `wi.closed` 细则

「关闭态」不能用状态名判断——状态名随流程模板自定义（Closed / Done / Completed / Resolved…）。
改用**稳定字段**：

- 触发：某条 update 的 `fields["Microsoft.VSTS.Common.ClosedDate"].newValue` 由空变为非空。
- 若该字段在此流程模板下不存在，则退化为 `System.State` 的
  `newValue` 落入 **`Completed` / `Resolved` 状态类别**（用
  `GET /_apis/wit/workitemtypes/{type}/states` 查类别，按 project+type 缓存）。
- **重开再关闭**：`wi.closed` 的 external_ref 是 `ado:wi:{projectGuid}:{wiId}:closed`，
  一个 WI 只能有一条。取**最早**满足条件的 revision 为准（确定性），
  后续再关闭不再产生新 Activity。理由：external_ref 无法表达多次关闭，
  取最早可保证同一份 raw 反复复算得到同一结果。

### 6.3 Activity 完整构造

除 `sourceIds` 外，每条 Activity 还必须填（`activitySchema` 强制）：

| 字段 | 取值 |
|:---|:---|
| `provider` | 恒为 `"ado"` |
| `org` / `project` | 来自绑定的 repo 行，**不用** raw 里的名字（大小写可能不一致） |
| `repoId` | `pr.*` → `repo.id`（D1 主键，非 GUID）；`wi.*` → `null` |
| `developerId` | `matchDeveloper(uniqueName, developers, emailSuffixes)` 的结果 |
| `matchedUniqueName` | 命中的原始 `uniqueName`（服务端会用 alias+suffix 交叉校验） |
| `occurredAt` | ISO 8601 → **UTC Unix 秒正整数**：`Math.floor(Date.parse(iso)/1000)`；`NaN` 或 ≤0 → 丢弃并记报告 |
| `meta` | 可选，≤4 KiB（05 §5.2）；只放展示用文本（如 PR 标题） |

### 6.4 硬性丢弃规则（01 §6.2）

1. **缺时间戳 → 丢弃**：`closedDate` 为 null 的 completed PR、无 `publishedDate` 的 vote、无 `updatedDate` 的 iteration，一律不产 Activity。
2. **身份不匹配 → 不产 Activity，记 unmatched**：`matchDeveloper` 返回 null 时把 `uniqueName` 加入 `unmatchedIdentities`（06 已有契约，每 chunk ≤10 条）。
3. **忽略 container**：`isContainer === true` 或 `uniqueName` 不含 `@` → 跳过，**不记 unmatched**（对齐 01 §4.1，避免评审组刷屏）。
   但**必须**在 run 报告里按原因（`container` / `non_email`）计数并留脱敏样本——
   否则 on-prem 的 `DOMAIN\alias` 这类真人身份会被静默吞掉且无人知晓。
4. **`completed` 却没有 merge commit** → **不静默丢弃**：拉 PR 详情重试一次，
   仍缺则记为异常并把 scope 置 `incomplete`。50 条实测样本中未出现，
   出现即说明假设有偏差，应当暴露而非掩盖。
5. **禁止**：用 `reviewers[].vote` 快照反推投票日、用 `System.ChangedDate` 伪造逐日 updated、用 `isDraft` 推断历史草稿状态。

### 6.5 客户端不算的东西

`externalRef` / `dayKey` / `config_version` **不由 CLI 计算**（05 §5.1）——服务端重算并比对。transform 只产出 06 `activitySchema` 要求的字段。

---

## 7. 增量游标与 run manifest

### 7.1 为什么需要 manifest

「ingest 返回 finalized 就推进游标」对**单个 fixture 文件**是安全的，但一次 collect
可能产出多个文件（§9：超 5000 条要拆，各自独立 runId）。文件 1 finalized
并不说明文件 2…N 也成功。而 `fixtureFileSchema` 里没有游标信息（06 §6.2 是
`.strict()`），`ingest normalized <file>` 单看文件也无从知道该推进哪个 scope。

故引入 **run manifest**：把「采集窗口 → 产物 → 游标推进」三者绑在一起。

`.data/meta/runs/{collectRunId}.json`：

```json
{
  "schemaVersion": 1,
  "collectRunId": "01J…",
  "startedAt": 1784737800,
  "scopes": [
    {
      "kind": "repo",
      "id": "<repoId>",
      "field": "prsClosedThrough",
      "from": "2026-07-20T00:00:00Z",
      "watermark": "2026-07-26T12:00:00Z",
      "status": "pending",
      "artifacts": [
        { "path": "…/activities-01J….json", "runId": "01J…", "sha256": "…", "status": "pending" }
      ]
    }
  ]
}
```

- `status`: `pending` | `complete` | `incomplete`
- **scope 原子提交**：只有该 scope 的**全部** artifact 都 `finalized`，才把
  `watermark` 写进 `cursor.json`。任一 artifact 失败 → scope 保持 `pending`，
  游标不动，重跑同窗口即可。
- `incomplete` 的 scope（§5 校验失败）**不生成 artifact**，也永不推进。

### 7.2 Watermark 竞态

分页期间仍有新数据写入 ADO。若把「本次见到的最大时间」当作新游标，
分页过程中产生的变更会被永久跳过。

规则：

1. **采集前**先取 `watermark = now - safetyLag`（`safetyLag` 默认 5 分钟，
   因 ADO 索引是最终一致的）。
2. 查询区间用**闭开区间** `[from - overlap, watermark)`，`overlap` 默认 1 小时。
   重叠部分靠 `external_ref` 幂等吸收（06 已保证同 ref 重放不重复计分）。
3. WIQL **必须**同时带上下界：
   `WHERE [System.ChangedDate] >= @from AND [System.ChangedDate] < @watermark`。
4. 只有 scope 全部 artifact finalized 后，才把这个**预先算好的** watermark 提交为新游标——
   而不是提交「实际见到的最大值」。

### 7.3 分端点的查询与分页

不同端点分页方式不同，不能用一个通用分页器：

| 端点 | 分页 | 终止条件 |
|:---|:---|:---|
| PR 列表 | `$skip` / `$top`（每页 100） | 返回条数 < `$top` |
| WI updates | `$skip` / `$top` | 同上 |
| WIQL | **无续传令牌**，结果集有上限（约 20000） | 命中上限即**递归二分时间窗**重查 |
| threads / iterations | 一次性返回全集 | 无需分页 |

PR 三种状态**分别查**（`completed` / `abandoned` / `active`），因为
`searchCriteria.status` 只接受单值；漏了 `abandoned` 就等于永远不产 `pr.closed`。
`active` 不受时间过滤（活跃 PR 数量小，全量拉）。

分页需防重复页：记录已见 `pullRequestId` / `wiId`，重复出现即视为服务端游标异常，
置 scope `incomplete`。

### 7.4 游标文件

```json
{
  "schemaVersion": 1,
  "byRepo": {
    "<repoId>": { "prsClosedThrough": "2026-07-20T00:00:00Z", "lastCollectRunId": "01J…" }
  },
  "byProject": {
    "<projectGuid>": { "wiChangedThrough": "2026-07-20T00:00:00Z" }
  }
}
```

`--since` 覆盖 `from`；`--full` 忽略游标全量重采（配合 `full_rematch`）。

### 7.5 Ingest 响应校验

推进游标前必须**逐字段核对**响应，而不只是校验 schema 形状：

- `runId` 等于请求的 runId
- `chunkIndex` 等于请求的 chunkIndex
- `pipelineConfigVersion` 等于请求值
- 中间 chunk `finalized === false`，最后一个 chunk `finalized === true`
- `activities.rejected === 0`

任一不符 → artifact 不算成功，scope 不推进。

---

## 8. 错误分类与退出码

复用已有 `ExitCode`：

| 场景 | 退出码 | 行为 |
|:---|:---|:---|
| `az` 未登录 / token 401 403 | `ENV` | 提示 `az login` |
| ADO 429 | 重试 | **优先读 `Retry-After`**；无该头再用指数退避（1s/2s/4s）+ 抖动，3 次后 `SERVER` |
| ADO 5xx | 重试 | 指数退避（1s/2s/4s）+ 抖动，3 次后 `SERVER` |
| raw zod 校验失败 | `CONTRACT` | 打印字段路径，不落该实体 |
| bootstrap 版本与库不符 | `CONTRACT` | 提示先 `settings pull` |
| 网络中断 | `SERVER` | 已落盘 raw 保留，可续跑 |

**限流**：默认并发 4，`--concurrency` 可调。threads/iterations 是 per-PR 调用，PR 多时为主要耗时。
ADO 返回 `X-RateLimit-Remaining` / `X-RateLimit-Delay` 时按其减速，不要硬打。

---

## 9. 分片与 ingest 衔接

transform 产物是 `fixtureFileSchema` 形状（06 §6.2，`activities` 上限 5000）：

- 超过 5000 条 → 拆多个 `activities-{runId}-{n}.json`，各自独立 runId。
- `ingest normalized` 复用 `splitFixtureIntoChunks`（每 chunk ≤10 条）与既有重试逻辑。
- 单写者约定（06 §5.7）：CLI 帮助文本声明「同一时刻只跑一个 ingest」。

---

## 10. 测试策略

| 层 | 内容 |
|:---|:---|
| **raw schema 单测** | 用**真实 API 响应脱敏后**的样本（`packages/domain/fixtures/raw/`），确保 schema 与现实一致，而非凭空写 |
| **transform 单测** | 每个 type 的正例 + §6.3 每条丢弃规则各一反例；覆盖率 ≥95% |
| **游标单测** | 推进/回退/首次运行；ingest 失败不推进 |
| **HTTP 客户端单测** | mock 401/429/5xx/超时，验证退避与退出码 |
| **端到端（手动）** | 对真实 repo 跑 `collect --repo X --since <近期>`，检查 raw 落盘 → transform → ingest → heatmap 出数 |

**脱敏规则**：fixtures 里 org/project/repo 名与邮箱替换为占位（`acme` / `Alpha` / `ada@example.com`），GUID 用固定假值。**禁止提交真实内部组织名**（01 §11）。

---

## 11. 实施切片

| 切片 | 内容 | 验收 |
|:---|:---|:---|
| **P1** | `ado/client.ts`：token（含刷新/401 重试）+ HTTP + 429/5xx 退避 + 分端点分页 | 单测 mock 401/403/429/5xx/重复页全绿 |
| **P2** | raw schema + 原子落盘 + 快照保留 + 路径安全 | 真实 API 抓样本，schema 通过；穿越路径被拒 |
| **P3** | transform（PR：created/merged/closed/vote/active） | 单测覆盖 §6.2/§6.3/§6.4 |
| **P4** | transform（WI：created/closed/updated，含状态类别查询） | 同上 |
| **P5** | `collect` 真路径 + watermark + **写 manifest（scope 恒为 pending）** | 真实 repo 跑通落盘；游标**不动** |
| **P6** | `ingest normalized` + 响应核对 + **scope 原子提交游标** | 多产物部分失败时游标不推进；全成功才推进 |

**P5 / P6 的边界**：P5 只负责「采集 + 产出 pending manifest + 读游标」，
它**不具备**推进游标的能力——推进逻辑属于 P6。这样 P5 可独立合并且行为完整
（跑完游标不动是正确行为，不是半成品）。P6 必须包含一个「多文件、其中一个
ingest 失败」的测试，证明 scope 不会被部分提交。

每片独立可合并、测试绿、原子提交。

---

## 12. 明确不做

- 不采 commit 级数据（01 §10.2）
- 不采 GitHub（二期）
- 不在云端存 PAT
- 不改 ingest 协议 / 计分算法 / D1 schema
- 不做实时 webhook（一期批量时间窗）

---

**文档结束（07 设计稿）**
