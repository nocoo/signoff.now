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

- 人类：`"uniqueName": "<alias>@<corp-domain>"`（邮箱），`isContainer` 缺省
- 评审组：`"uniqueName": "vstfs:///Classification/TeamProject/{guid}\\<Group Name>"`，`isContainer: true`

→ 01 的「人类 uniqueName 几乎全是邮箱、group 忽略」成立。

**多 org 实测**：三个不同 org 均可访问（org 名不在此列出，见 01 §11），01 §4.2 的多 org 要求必须支持。

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
  这次刷新**不消耗重试预算**——token 过期不是远端故障，让它吃掉一次重试
  会使碰上 401 的那趟比没碰上的少一次机会。
- **每个请求有 60s 超时**（`AbortController`，可用 `timeoutMs` 覆盖）。
  半开连接不会报错也不会推进，没有超时就是整个 collect 无限期挂起；
  超时按网络失败处理（走重试预算，耗尽后 `SERVER`），错误文案明确写
  `timed out after Nms` 而不是笼统的 "aborted"——后者读起来像用户按了 Ctrl-C。
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
| `signoff collect --since <date>` | 覆盖增量游标，强制从该日期起。**不影响 `active` PR 的全量拉取**，故并不能显著缩短耗时（见 §8「限流与耗时」） |
| `signoff collect --no-wi` | 跳过 Work Item（PR-only，加速调试） |
| `signoff collect --full` | 忽略游标全量重采（配合 `full_rematch`）。**不可与 `--repo` / `--no-wi` 同用**：`scores_stale` 是全局的，部分重算会把没算的仓也标成新鲜 |
| `signoff collect --offline` | **未实现**（04 §6.4 的期望；当前 bootstrap 不可达即失败） |
| `signoff collect --concurrency <n>` | **未实现**：当前采集是**串行**的 |
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

**写入方式**：一律 `write temp → rename` 原子替换，避免中断留下半截 JSON。
（**不调 `fsync`**：Bun 的 `write` 没暴露它，而 rename 在同一文件系统内已是原子的；
断电这一级的持久性本项目不承诺 —— raw 丢了重采即可。）
路径每段先做 `encodeURIComponent`，并断言解析后的绝对路径仍在 `.data/` 之下——
repo 名可含 `/`、`..` 等字符，`paths.ts` 只去首尾斜杠，不防目录穿越。

**PR 快照不可覆盖**：一个 PR 可以 abandoned 后重开再 completed。若直接覆盖
`prs/{prId}.json`，旧的 `pr.closed` 就再也无法从 raw 复算，违反 01 §6.2「可重建」。
故**所有按实体落盘的 raw 一律追加快照**，不只是 PR/WI：

```text
repos/{repo}/prs/{prId}/{fetchedAt}-{collectRunId}.json
repos/{repo}/pr-threads/{prId}/{fetchedAt}-{collectRunId}.json
repos/{repo}/pr-iterations/{prId}/{fetchedAt}-{collectRunId}.json
workitems/{wiId}/{fetchedAt}-{collectRunId}.json
workitem-updates/{wiId}/{fetchedAt}-{collectRunId}.json
```

`fetchedAt` 是**整秒**，同一秒内两次抓取会撞名并覆盖，等于快照白留。
故文件名带上 `collectRunId`（ULID，单调且唯一）。

threads 同样会变（评论可编辑/删除、投票可撤销），覆盖同样破坏可重建性。
**没有 `latest.json` 指针文件**：文件名里的 `{fetchedAt}-{collectRunId}` 已经
按字典序单调，目录列表排最后一项即是最新，多一个需要同步维护的指针只会多一处
可能说谎的地方。

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

**校验失败 → 不产生任何可 ingest 的产物**，不只是跳过该实体。

01 §7.2 硬约束 3 是「落盘后必须验证，失败禁止 ingest」。若只跳过单个实体而让其余
数据照常 ingest 并推进游标，那条坏实体就**永久跳过**了——下次增量窗口已经不含它。

具体分两种机制，都满足「无可 ingest 产物 + 游标不动」：

| 失败类型 | 机制 |
|:---|:---|
| 分页缺口（`problems`）、transform 异常（`anomalies`） | 所属 scope 置 `incomplete`，manifest 照写但该 scope 不可 ingest |
| **raw schema 失败**（`parseRaw`） | 抛 `AdoError("bad_response")`，`collect` **整体退出**，**manifest 根本不写** |

第二种更粗暴是有意的：schema 变了说明我们对 ADO 的理解已经过期，此时继续
采其余 repo 只会产出一批基于错误假设的数据。两种情况修好后重跑同一窗口即可，
因为游标都没动。

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
  projectExternalId: string;                  // project GUID, for the §6.1 check
  prs: RawPr[];
  threadsByPr: Map<number, RawThread[]>;
  iterationsByPr: Map<number, RawIteration[]>;
};

type WiTransformInput = Common & {
  projectExternalId: string;                  // project GUID
  workItems: RawWorkItem[];
  updatesByWi: Map<number, RawWiUpdate[]>;
  /**
   * State name → category, per work item type. Resolved by the CALLER via
   * GET /_apis/wit/workitemtypes/{type}/states and passed in, because the
   * transform is a pure function and cannot make HTTP calls (§6.2.2).
   */
  stateCategories: Map<string, Map<string, string>>;
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
| `pr.vote` | thread 的 `CodeReviewThreadType==="VoteUpdate"` 且 **`propNumber(...) !== 0`** | 该 VoteUpdate comment 的 `publishedDate` | **投票者**（该 comment 的 author） | `{prRepoGuid, prId, voterIdentityId, threadId, commentId}` |
| `pr.active` | iteration 存在 | iteration `updatedDate` | iteration `author` | `{prRepoGuid, prId, iterationId}` |
| `wi.created` | 总是 | `System.CreatedDate` | `System.CreatedBy` | `{projectGuid, wiId}` |
| `wi.closed` | 见 §6.2.2 | 该 revision 的 `revisedDate` | 该 revision 的 `revisedBy` | `{projectGuid, wiId}` |
| `wi.updated` | 每个**唯一 rev**（见 §6.2.3） | `revisedDate` | `revisedBy` | `{projectGuid, wiId, revisionId: rev}` |

#### 6.2.1 `pr.vote` 细则

- **`$value` 是字符串，必须先转数字**。实测：`{"$type":"System.String","$value":"10"}`。
  直接写 `props.CodeReviewVoteResult.$value !== 0` 会因为 `"0" !== 0` 恒真，
  把**撤销投票当成有效投票**。一律经 `propNumber()`（domain 已实现并单测）。
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

#### 6.2.3 `rev` 会重复（实测）

实测发现：同一个 WI 的 updates 流里**存在 `rev` 相同的多条记录**（`id` 不同、
作者与时间不同，其中一条 `fields` 为空，疑似关联/链接更新）。一个真实样本里
132 条 update 有 3 组重复 rev。

这会破坏幂等：external_ref 模板是 `…:{wiId}:rev:{revisionId}`，两条记录算出
**同一个 ref**，服务端按 ref UPSERT，后写的会**静默覆盖**先写的，
且最终留下哪条取决于 chunk 顺序 —— 同样的 raw 反复复算得到不同结果。

规则（实测修订）：

1. **传输层先按 `update.id` 去重** —— `id` 才是 update 的真实主键。
2. 按 `rev` 分组后，**选有 `fields` 差异的那条**。
3. 若同一 rev 有多条都带差异且**作者或时间不一致** → 记异常并阻塞 scope，**不猜**。
4. 全是空壳记录时按 `id` 最小取，保证确定性。

> **不要用 `revisedDate` 在同 rev 内挑选**。30 个真实 WI（372 条 update、
> 10 组重复 rev）实测：**10/10** 的「最早」记录都是 `fields` 为空的占位记录，
> 其中 5 组作者不同、5 组日期不同（最大偏差 4 个月）。按最早取会把修订
> 归给错误的开发者、落在错误的 `dayKey`，进而污染热力图与分数。

> 为什么不改用 `id` 做 ref：02 §5.2 的模板已冻结，且 06 已按此实装并上线远端
> schema。改模板要重迁移；而按 rev 取最早在语义上也站得住 ——
> 同一 rev 代表同一次修订。

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
4. **`completed` 却没有 merge commit** → **不静默丢弃**：记为异常（`no_merge_commit`），
   该 scope 置 `incomplete`。50 条实测样本中未出现，
   出现即说明假设有偏差，应当暴露而非掩盖。
   （**不重拉 PR 详情**：列表接口返回的就是 PR 详情本身，同一个 URL 再取一次
   只会得到同一份数据，重试是无意义的仪式。）
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
      "baseCursor": "2026-07-20T00:00:00Z",
      "from": "2026-07-19T00:00:00Z",
      "watermark": "2026-07-26T12:00:00Z",
      "commitEligible": true,
      "status": "pending",
      "artifacts": [
        { "path": "…/activities-01J….json", "runId": "01J…", "sha256": "…", "status": "pending" }
      ]
    }
  ]
}
```

| 字段 | 含义 |
|:---|:---|
| `baseCursor` | 采集时**已提交**的游标值（`null` = 从未采过） |
| `from` | 本次实际查询下界（= `baseCursor - overlap`，或被 `--since` 覆盖） |
| `watermark` | 采集前预取的上界（§7.2） |
| `commitEligible` | `from <= baseCursor` 才为 `true`，见 §7.1.1 |
| `status` | `pending` / `complete` / `incomplete` |

#### 7.1.1 `--since` 不得造成永久跳窗

游标停在 7/1，操作者跑 `--since 7/20`，ingest 成功 —— 若直接把 watermark 写进游标，
**7/1–7/20 就永久丢了**，而且无人知晓。

规则：**一次 run 只有在它的覆盖区间衔接得上已提交游标时，才允许推进游标。**

```
commitEligible = (baseCursor === null) || (from <= baseCursor)
```

- `commitEligible === false` 的 scope：产物照样可以 ingest（数据本身有效），
  但**永不推进游标**，且 CLI 在 ingest 成功后打印显式提醒：
  「该 run 起点晚于当前游标，游标未推进；如需补齐请跑 `--since <=baseCursor>`」。
- `--full` 把 `from` 设为 `null`（全量），恒 `commitEligible`。

#### 7.1.2 提交协议（崩溃安全）

写 manifest 与写 `cursor.json` 是两次文件操作，中间可能崩。定死顺序：

1. artifact ingest 成功 → 原子改写 manifest，把该 artifact 标 `complete`。
2. 该 scope 全部 artifact 都 `complete` → 把 scope 标 `complete`（原子写）。
3. 该 scope 为 `complete` **且** `commitEligible` 时，才原子写 `cursor.json`。

> `commitEligible` 是**第 3 步**的条件，不是第 2 步的。`markArtifactComplete`
> 只看 artifact 是否齐全；`isScopeCommittable` 才把两者相与。分开是对的——
> 一个 `commitEligible === false` 的 scope 数据完全有效、应当 ingest，
> 只是不该推游标（§7.1.1）。

> **实现现状（与上面三步一致，但不要读出多余承诺）**：第 3 步的判定用的是
> 刚写出的 manifest 对象本身，**不是**重新从磁盘读一遍。两者在单写者约定下
> 等价（同一进程刚写完自己的文件），要防的是"写 manifest 失败却推进游标"，
> 而写失败会抛出、根本走不到第 3 步。

崩溃恢复：**manifest 是唯一真相**，且**恢复由人驱动**——
重新执行同一条 `ingest normalized <file> --manifest <manifest>` 即可。
artifact 与 chunk 都是**幂等**的 —— 注意是幂等，**不是跳过**：重跑会把每个
chunk 重新 POST 一遍，服务端按 digest 认出已完成的并返回成功而不重复写入。
所以重跑是安全的，但不会更快。

> **没有**启动时扫 `.data/meta/runs/` 自动补游标这回事，也**没有**
> 由文件路径反查所属 manifest：`--manifest` 是必填参数，CLI 只读你指定的
> 那一份，并在其中按 `path` 找到对应 artifact；找不到 → 拒绝执行并提示先跑
> `collect`（避免手工丢进来的文件推进游标）。
>
> 游标领先于 manifest 属数据损坏，但目前**没有**启动自检去发现它。

### 7.2 Watermark 竞态

分页期间仍有新数据写入 ADO。若把「本次见到的最大时间」当作新游标，
分页过程中产生的变更会被永久跳过。

规则：

1. **采集前**先取 `watermark = now - safetyLag`（`safetyLag` 默认 5 分钟，
   因 ADO 索引是最终一致的）。
2. 查询区间用**闭开区间** `[from - overlap, watermark)`，`overlap` 默认 1 小时。
   重叠部分靠 `external_ref` 幂等吸收（06 已保证同 ref 重放不重复计分）。
3. WIQL **必须**同时带上下界，但**只能给日期、不能带时间**：
   `WHERE [System.ChangedDate] >= '2026-07-01' AND [System.ChangedDate] <= '2026-07-27'`。

   带上时间会被直接拒绝（真实 ADO 实测，非推测）：
   > You cannot supply a time with the date when running a query using date precision.

   因此 `wiqlDay()` 把 watermark 截到日：**下界向下取整、上界推到次日**，
   即查询区间只会**变宽**不会变窄。反过来（窄一点）会永久漏掉工作项 ——
   游标照样推进，下一个增量窗口从更晚开始，那些 WI 再也不会被看到。
   注意上界因此是 `<=` 次日而不是 `<` 当日：日期精度丢掉时分秒后，
   `< to` 会把 `to` 当天发生的一切排除在外。

   二分时两个子窗口取整后会**重叠**，这是无害的 —— id 用 Set 去重；
   而留空隙则会静默丢数据。
4. 只有 scope 全部 artifact finalized 后，才把这个**预先算好的** watermark 提交为新游标——
   而不是提交「实际见到的最大值」。

### 7.3 分端点的查询与分页

不同端点分页方式不同，不能用一个通用分页器：

| 端点 | 分页 | 终止条件 |
|:---|:---|:---|
| PR 列表 | `$skip` / `$top`（每页 100） | 返回条数 < `$top` |
| WI updates | `$skip` / `$top` | 同上 |
| WIQL | **无续传令牌**，结果集有上限（约 20000） | 命中上限即**递归二分时间窗**重查；窗口无下界时改为**从上界回退扫描** |
| threads / iterations | 一次性返回全集 | 无需分页 |

PR 三种状态**分别查**（`completed` / `abandoned` / `active`），因为
`searchCriteria.status` 只接受单值；漏了 `abandoned` 就等于永远不产 `pr.closed`。
`active` 不受时间过滤（活跃 PR 数量小，全量拉）。

**`$skip` 偏移不稳定**：分页途中若有 PR 状态变化，其在服务端排序里的位置会移动，
可能导致某条记录被**跳过且不产生重复**——只查重是抓不到的。缓解：

- 按 `closedDate` **降序**分页（实测该顺序稳定且无缺口/重叠），并记录每页边界值；
  若下一页首条的 `closedDate` **大于**上一页末条，说明发生了重排 → scope `incomplete`。
- **总量核对未实现**：服务端 `count` 的语义（是否受 `$top` 影响、是否含被过滤行）
  未经实测确认，凭猜实现只会制造误报。重叠窗口（§7.2）是当前的兜底手段。
- **已知缺口**：若某条记录在我们已经翻过的偏移之前被删除，窗口会前移并跳过一条，
  且**不产生重复**。降序分页本身就总是「下一页比上一页旧」，因此无法用日期跳跃
  区分正常翻页与真正的遗漏 —— 曾经实现过这个检查，结果把每个多页仓库都误判为
  incomplete，会让游标永久卡住，故已移除。keyset 分页可能是真正的解法，
  但需先实测 `maxTime` 的开闭区间语义与同秒大量记录的行为。

去重键：PR 用 `pullRequestId`；**WI updates 用 `update.id`**（回落 `rev`）——
同一个 WI 天然有多条 revision，只按 `wiId` 去重会丢掉除首条外的全部更新。
但也**不能**用 `(wiId, rev)`：§6.2.3 实测发现 `rev` 在真实数据里**不唯一**，
同一个 `rev` 会返回多条 update 记录，按 `(wiId, rev)` 去重会丢掉其中真正带
字段变更的那条。`update.id` 才是分页去重的真实主键；`rev` 的多条记录留到
transform 里由 `chooseRevisionRecord` 挑选（优先 `fields` 非空者）。

**无下界窗口不能直接放弃**。`--full` 恒把 `from` 设为 `null`，
而一个大型 ADO 项目的工作项总数轻易超过 WIQL 的 2 万上限。
若此时报 `incomplete` 了事，后果是：project scope 永远无法完成 →
`recompute/complete` 永远不会被调用 → `scores_stale` **永远清不掉** →
Dashboard 对该团队永久空白，且**没有任何出路**。真实环境实测到这一点。

所以无下界时改为**从上界回退扫描**，而且**先问出真正的下界**：
WIQL 支持 `ORDER BY [System.ChangedDate] ASC`，一次查询即可拿到该 project
最早的工作项（实测某真实项目为 `2015-06-04`）。以它为终点，
30 天起步、每次跨度翻倍（上限 720 天）往前切片。

- 翻倍让调用次数对历史长度取对数，同时每片都小到能装下；
- **下界是问出来的，不是猜的**。早期版本用「连续三片为空」判定历史到头，
  只覆盖 210 天 —— 一个八个月前迁走的项目会被判成「从无数据」，
  不报 problem、游标推进、`--full` 顺势清掉 stale。
  **自信的空白比可见的空白更糟**；
- 探测返回**零行属于自相矛盾**（此路径只在 ADO 刚说「超过 2 万条」后才走），
  按错误处理而非「空项目」；
- 探测失败**原样抛出**，保住 `AdoError.kind` —— 降级成 `problems` 会让
  403 和 503 都退成 `CONTRACT`，而正确答案分别是「去要权限」和「稍后重试」；
- 有步数预算（默认 60），耗尽则记 `problems` —— **绝不静默截断**，
  未扫完的 scope 必须挡住游标。

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
| `az` 未登录 / token 401 | `ENV` | 提示 `az login`（见 §2） |
| 403 | `ENV` | 提示**检查该 org/project 授权**——已认证但无权限，再 `az login` 无用 |
| ADO 429 | 重试 | **优先读 `Retry-After`**；无该头再用指数退避（1s/2s/4s）+ 抖动，3 次后 `SERVER` |
| ADO 5xx | 重试 | 指数退避（1s/2s/4s）+ 抖动，3 次后 `SERVER` |
| raw zod 校验失败 | `CONTRACT` | 打印实体与字段路径；`collect` 整体退出，不写 manifest（见 §5） |
| bootstrap 版本与库不符 | `CONTRACT` | 提示先 `settings pull` |
| 网络中断 | `SERVER` | 已落盘 raw 保留，可续跑 |

`collect` 的抛出路径由 `exitCodeForError()`（`commands/exit-code-for-error.ts`）
把 `AdoError.kind` 映射到退出码，而不是一律 `RUNTIME`——否则自动化分不清
「重新登录」「稍后重试」「这是 bug」这三件需要不同响应的事：

| `AdoErrorKind` | 退出码 |
|:---|:---|
| `unauthenticated` / `forbidden` | `ENV` |
| `rate_limited` / `server`（含网络中断） | `SERVER` |
| `not_found` / `bad_request` / `bad_response`（含 raw zod 失败） | `CONTRACT` |
| `result_too_large` | `RUNTIME`（分治收窄是 paging 的职责，冒到顶层即为缺陷） |

上表两处「含」是关键，否则上面那张场景表会落空：

- **网络中断**：`fetchFn` 抛出（DNS 失败、连接重置）在 client 内被捕获，
  与 5xx 共用同一重试预算；预算耗尽后抛 `AdoError("server")`。
  不包这层的话它会以裸 `Error` 逃逸 → `RUNTIME`，等于告诉自动化
  「网络抖动是程序缺陷」。
- **raw zod 失败**：`collect.ts` 的 `parseRaw()` 把 `ZodError` 转成
  `AdoError("bad_response")` 并带上字段路径与实体标识（如
  `PR 1001 threads failed schema — id: expected number`）。裸 `.parse()`
  同样会退出 `RUNTIME`，而真相是 ADO 的形状变了，运维需要知道是哪个字段。

其余非 `AdoError` 的异常（真正的程序缺陷）仍为 `RUNTIME`。

**限流与耗时**：当前实现是**串行**的（并发与 `--concurrency` 未实现）。
客户端已按 `Retry-After` / `X-RateLimit-Delay` 退避。

**`--since` 并不能有效缩短耗时**，这一点必须说清楚，否则会误导使用者：

- `--since` 只作用于 `completed` / `abandoned` 两个状态；
- **`active` 是无窗口全量拉取的**（`from: null`）—— 因为 `pr.active` 要算的是
  「此刻仍开着的 PR」，一个 2024 年创建、今天仍在活跃的 PR 必须算进来。
  按 `queryTimeRangeType=created` 收窄会把它漏掉（实测该参数确实生效：
  某真实仓 1000 → 747，但漏掉的正是长命 PR）；
- 而 threads/iterations 是 **per-PR 两次调用**，PR 总数才是主导成本。

实测量级（真实仓 `teams-modular-packages`，`--since` 两天窗口）：
**2948 个 PR × 2 次调用 ≈ 6000 次串行请求，耗时以十分钟计**。
这不是缺陷而是取舍，但要有预期：大仓的首次采集应当安排在能等的时候，
真正的提速要靠并发（未实现），不是靠 `--since`。

---

## 9. 分片与 ingest 衔接

transform 产物是 `fixtureFileSchema` 形状（06 §6.2，`activities` 上限 5000）：

- 超过 5000 条 → 拆多个 `activities-{runId}-{n}.json`，各自独立 runId。
- `ingest normalized` 复用 `splitFixtureIntoChunks`（每 chunk ≤10 条）。
  重试是**独立实现**的（最多 3 次尝试 = 2 次退避，100/200ms，仅重试 5xx/429/网络错误），
  不是复用 `ingest fixture` 的那份。
- 单写者约定（06 §5.7）：CLI 帮助文本声明「同一时刻只跑一个 ingest」。
- **`full_rematch` 不得提前清 stale**。`scores_stale` 是**全局**标志，不是 per-scope，
  所以规则有三层：
  1. `recompute/complete` 只在 manifest 里**所有** `fullRematch` scope 都
     committable 之后调用一次；
  2. `--full` **禁止**与 `--repo` / `--no-wi` 同用（CLI 直接拒绝），
     否则一个只含单 scope 的 manifest 会「全部完成」并清掉全局 stale，
     而其余仓根本没重算；
  3. **清 stale 前重新拉 bootstrap，比对仓库宇宙**。前两条只保证
     「manifest 里记的都到齐了」，但 manifest 记的是**采集开始时**的宇宙 ——
     采集与最后一次 ingest 之间新绑定或启用的仓根本不在里面，它的旧分数从未
     重算，此时清 stale 等于宣称它是新的。故 `finishRematch` 比对
     `rematchUniverse(live)` 与 manifest 的 `fullRematch` scope 集合：
     - 有缺口 → `CONTRACT`，提示重跑 `collect --full`（游标不回退：数据确实落了）；
     - bootstrap 本身失败 → `SERVER`，**不清**。「无法验证」不等于「已验证」，
       在校验失败时清标志，正是这道校验要防的事；
     - 采集期间被**解绑**的仓不算缺口 —— 它的 scope 落了地，没有任何未重算的东西。

---

## 10. 测试策略

| 层 | 内容 |
|:---|:---|
| **raw schema 单测** | 用**真实 API 响应脱敏后**的样本（`packages/domain/fixtures/raw/`），确保 schema 与现实一致，而非凭空写 |
| **transform 单测** | 每个 type 的正例 + §6.4 每条丢弃规则各一反例；覆盖率 ≥95% |
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
