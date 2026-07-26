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

---

## 2. 认证

```bash
az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798
```

`499b84ac-…` 是 Azure DevOps 的固定 resource id。CLI 通过 `az` 取 token 后走 HTTP，**不存 PAT**（01 §7.3）。

- 入口先跑 `doctor` 校验 `az account show` 成功（已实现）。
- token 有效期内缓存在内存，**不落盘**。
- 401/403 → exit code `ENV`，提示重新 `az login`。

---

## 3. 命令矩阵

| 命令 | 行为 |
|:---|:---|
| `signoff collect --dry-run` | 现状：读 bootstrap 缓存打印计划，不调 ADO |
| `signoff collect` | **07 新增**：真实拉取 → 落盘 → 校验 → transform → 写 `.data/normalized/` |
| `signoff collect --repo <id>` | 只采集指定 repo（调试用） |
| `signoff collect --since <date>` | 覆盖增量游标，强制从该日期起 |
| `signoff collect --no-wi` | 跳过 Work Item（PR-only，加速调试） |
| `signoff collect --offline` | 用已有缓存，缺则报错（04 §6.4 要求） |
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
  cursor.json                          # 增量游标
```

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

**校验失败即中止该实体**，记入 run 报告，不写半截数据。

---

## 6. Transform：raw → Activity[]

纯函数，放 `packages/domain/src/transform/`，无 I/O，可单测。

### 6.1 输入

```ts
type TransformInput = {
  settings: { timezone: string; emailSuffixes: string[] };
  developers: { id: string; alias: string }[];
  repo: {
    id: string; org: string; project: string;
    externalId: string; projectExternalId: string;
  };
  prs: RawPr[];
  threadsByPr: Map<number, RawThread[]>;
  iterationsByPr: Map<number, RawIteration[]>;
};
```

### 6.2 逐 type 规则（严格对齐 01 §6.1）

| type | 触发条件 | occurredAt | 归属 | sourceIds |
|:---|:---|:---|:---|:---|
| `pr.created` | 总是 | `creationDate` | `createdBy` | `{prRepoGuid, prId}` |
| `pr.merged` | `status==="completed"` **且** `lastMergeCommit` 存在 | `closedDate` | `createdBy` | `{prRepoGuid, prId}` |
| `pr.closed` | `status==="abandoned"` | `closedDate` | `createdBy` | `{prRepoGuid, prId}` |
| `pr.vote` | thread 的 `CodeReviewThreadType==="VoteUpdate"` **且** `CodeReviewVoteResult > 0` | thread `publishedDate` | **投票者**（comment author） | `{prRepoGuid, prId, voterIdentityId, threadId, commentId}` |
| `pr.active` | iteration 存在 | iteration `updatedDate` | iteration `author` | `{prRepoGuid, prId, iterationId}` |
| `wi.created` | 总是 | `System.CreatedDate` | `System.CreatedBy` | `{projectGuid, wiId}` |
| `wi.closed` | update 把 `System.State` 改成关闭态 | 该 update 的 `revisedDate` | 该 update 的 `revisedBy` | `{projectGuid, wiId}` |
| `wi.updated` | 每条 update | `revisedDate` | `revisedBy` | `{projectGuid, wiId, revisionId: rev}` |

### 6.3 硬性丢弃规则（01 §6.2）

1. **缺时间戳 → 丢弃**：`closedDate` 为 null 的 completed PR、无 `publishedDate` 的 vote、无 `updatedDate` 的 iteration，一律不产 Activity。
2. **身份不匹配 → 不产 Activity，记 unmatched**：`matchDeveloper` 返回 null 时把 `uniqueName` 加入 `unmatchedIdentities`（06 已有契约，每 chunk ≤10 条）。
3. **忽略 container**：`isContainer === true` 或 `uniqueName` 不含 `@` → 直接跳过，**不记 unmatched**（避免评审组刷屏）。
4. **禁止**：用 `reviewers[].vote` 快照反推投票日、用 `System.ChangedDate` 伪造逐日 updated、用 `isDraft` 推断历史草稿状态。

### 6.4 客户端不算的东西

`externalRef` / `dayKey` / `config_version` **不由 CLI 计算**（05 §5.1）——服务端重算并比对。transform 只产出 06 `activitySchema` 要求的字段。

---

## 7. 增量游标

`.data/meta/cursor.json`：

```json
{
  "schemaVersion": 1,
  "byRepo": {
    "<repoId>": { "prsUpdatedThrough": "2026-07-20T00:00:00Z", "lastRunId": "01J…" }
  },
  "byProject": {
    "<projectGuid>": { "wiChangedThrough": "2026-07-20T00:00:00Z" }
  }
}
```

- PR 增量：`searchCriteria.minTime` + `queryTimeRangeType=closed`（对已完成），外加一次 `status=active` 全量（活跃 PR 数量小）。
- WI 增量：WIQL `WHERE [System.ChangedDate] >= @cursor`。
- **游标只在 ingest 成功后推进**：collect 落盘不动游标，`ingest normalized` 返回 200 且 `finalized` 后才写。避免「采了没进库但游标已推进」导致永久丢数据。
- `--since` 覆盖游标；`--full` 忽略游标全量重采（配合 `full_rematch`）。

---

## 8. 错误分类与退出码

复用已有 `ExitCode`：

| 场景 | 退出码 | 行为 |
|:---|:---|:---|
| `az` 未登录 / token 401 403 | `ENV` | 提示 `az login` |
| ADO 429 / 5xx | 重试 | 指数退避（1s/2s/4s），3 次后 `SERVER` |
| raw zod 校验失败 | `CONTRACT` | 打印字段路径，不落该实体 |
| bootstrap 版本与库不符 | `CONTRACT` | 提示先 `settings pull` |
| 网络中断 | `SERVER` | 已落盘 raw 保留，可续跑 |

**限流**：默认并发 4，`--concurrency` 可调。threads/iterations 是 per-PR 调用，PR 多时为主要耗时。

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
| **P1** | `ado/client.ts`：token 获取 + HTTP + 重试 + 分页 | 单测 mock 全绿 |
| **P2** | raw schema + 落盘 | 真实 API 抓样本，schema 通过 |
| **P3** | transform（PR：created/merged/closed/vote/active） | 单测覆盖 §6.2/§6.3 |
| **P4** | transform（WI：created/closed/updated） | 同上 |
| **P5** | 游标 + `collect` 真路径接线 | 真实 repo 跑通落盘 |
| **P6** | `ingest normalized` + 端到端 | heatmap 出真实数据 |

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
