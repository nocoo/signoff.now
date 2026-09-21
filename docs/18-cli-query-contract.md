# 18 — CLI 查询、观察与命令契约

> Current implementation, 2026-09-21. Web and CLI share one watch list. Project discovery and watched PR refresh use independent completion-based cooldowns.
> 当前可用采集命令见 [11](11-真实PR采集与本地工作台.md)，辅助工具见 [cli/](cli/README.md)。架构见 [14](14-collector-architecture.md)，观察生命周期见 [16](16-scheduler-state-machine.md)。

## 1. 给其他项目的保证

- 查询只返回 SignOff 已发布的数据，不执行 `az` / `gh`、不检查源站登录、不等待真实拉取。
- 本机消费者无需认证，默认连接 `http://127.0.0.1:37042`。需要 Worker 提供缓存服务，不需要打开网页或运行采集器才能查询旧数据。
- `watch add / remove` 修改持久观察列表；`discover` 与 `refresh` 返回排队回执，由执行器稍后完成。
- 每个 PR 都提供 provider、组织、项目、repository、PR number、内部 ID、源 URL 与各自采集时间，供其他项目进一步调查。
- PR 列表、观察列表与单条详情是不同查询。观察列表包含等待首次结果的引用，也能包含未显示在网页当前页的 PR。
- The daemon refreshes project PR lists every 600 seconds after completion and each active watched PR every 300 seconds after full completion. Both cooldowns are configurable; the separate 30-second status lane has been removed.

## 2. 命令结构

`signoff` 仍使用现有 [`@signoff/collect`](../apps/collect/package.json) 的 bin 名称，不新建第二套产品 CLI；在同一入口里分开常驻采集模块与短命消费者模块。

| 命令 | 用途 | 是否访问 ADO |
| --- | --- | --- |
| `signoff daemon` | 运行观察刷新与已保存任务 | 执行收到的采集任务时会 |
| `signoff status` | 缓存服务、执行器、队列、观察数量与已知错误 | 否 |
| `signoff repo list` | 已注册的组织 / 项目 / 仓库与最近发现情况 | 否 |
| `signoff repo add <repo-url...>` | 显式注册仓库范围，复用现有项目注册规则 | 否；之后需要显式 discover |
| `signoff pr list` | 查询已发现 / 已缓存的 PR，支持范围、状态与观察筛选 | 否 |
| `signoff pr get <pr-ref>` | 返回单条已缓存 PR 的状态与检查详情 | 否 |
| `signoff watch list` | 查询 active 观察列表及每项已有快照；包括 Draft 和待首次结果项 | 否 |
| `signoff watch add <pr-ref...>` | 幂等加入观察，返回首个刷新任务回执 | 命令本身否 |
| `signoff watch remove <pr-ref...>` | 移除当前观察代次，保留 PR 快照 | 否 |
| `signoff discover --repo <repo-url>` | 明确请求发现一个仓库的 PR，不自动观察 | 命令本身否 |
| `signoff refresh --pr <pr-ref>` | 提前刷新一个 active 观察项 | 命令本身否 |
| `signoff refresh --repo <repo-url>` / `--all` | 提前刷新该仓库 / 全部 active 观察项 | 命令本身否 |
| `signoff job get <job-id>` | 查询一个已存任务的进度、结果与错误 | 否 |

`refresh` 的 `--pr`、`--repo`、`--all` 必须且只能指定一种。对未观察 PR 请求 refresh 返回 `NOT_OBSERVED`，不隐式添加；没有目标的有效范围返回零任务回执。CLI 不提供把 Query 改成同步采集的 `--live` / `--fetch` 选项。

### PR 引用与身份

`pr-ref` 接受完整 PR URL、查询输出的 SignOff PR `id`，或带 `--repo` 的 PR number。裸数字没有仓库范围时拒绝，不能猜测项目。

```bash
# 目标命令示例；59382 仅用来说明引用格式，不代表它当前仍开放
signoff pr get \
  'https://dev.azure.com/intentional/intent/_git/whiteboard-app/pullrequest/59382'

signoff pr get 59382 \
  --repo 'https://dev.azure.com/intentional/intent/_git/whiteboard-app'
```

对 `pr get`，未缓存引用返回 `CACHE_MISS`，不能先调用源站补齐。对 `watch add`，本地仓库目录已能解析 provider repository ID 时，PR 本身可以尚无缓存，保存规范引用并等待首次刷新。未注册范围返回 `REPOSITORY_NOT_TRACKED`；已注册但仓库身份尚未知返回 `REFERENCE_UNRESOLVED`，调用者先显式 discover。目录也保存零 PR 仓库身份；不建立临时 URL 观察项。归一规则与唯一键见 16。

仓库目录由迁移 0019 引入。对首次使用且身份未解析的仓库，必须先完成 `repo add`，再等待 discover 回执对应仓库成功、目录可解析后，才允许 URL / number 形式的 watch add；仅拿到 discover 的 202 不足以添加。已有可解析目录的仓库不必每次重复发现。

仓库在源站改名后，显式 discover 按已解析的 provider ID 更新名称并保留旧别名。原配置名称、旧 / 新 URL 与缓存 PR ID 仍指向同一仓库和观察项，项目元数据编辑也不会丢弃这个范围。

完整 URL 中的仓库段先按稳定 ID 匹配，再解析唯一名称或保留别名。ADO GUID 格式始终作为 ID，即使目录为空也不能落到同名仓库；GUID 格式的仓库名称应改用它自己的真实 ID 引用。查找仓库身份先于 PR number 和 active 筛选，因此某个编号未缓存 / 未关注时，不会误用另一仓库的同编号记录。HTTP `repositoryId` 参数只接受 ID 语义，名称 / 别名筛选使用 `repo=<完整仓库 URL>`。

输出中的已解析 ADO repository / PR / observation URL 统一使用 provider repository ID，名称仅作显示；将输出 URL 直接用于 lookup、watch add 或 refresh 必须指向同一身份。旧观察记录里保存的名称 URL 在读取时规范化，不修改其持久 identity / generation。未解析的配置继续保留名称引用；GitHub URL 继续使用 owner / repository name。

仓库目录和覆盖信息也按保留别名解析配置范围，改名后仍只有一条已解析仓库；只有真正未解析的配置才显示为缺少发现结果。旧关注项后续刷新时，其保存的 ref 不覆盖目录新名称；成功发布的当前 PR 事实可以更新目录名称，失败和迟到结果保留已有信息。

`watch remove` 接受相同引用语法，先调用只读 observation lookup 取得该 PR 唯一记录的 ID / generation，再发送带版本的删除。查到同代次已停止是幂等成功；从未观察返回 `NOT_FOUND`；两步之间发生重新加入则返回冲突，不自动重试删除新代次。查询可以利用本地仓库目录或停止记录内保留的自足 ref；项目删除后也可找到停止记录。别名有歧义时返回 `REFERENCE_AMBIGUOUS`，要求使用带仓库 GUID 的引用，不能猜测。

批量移除先校验全部引用语法，再按输入顺序执行。某项 lookup 或命令返回 400 / 404 / 409 / 422 时，保留其结构化错误并继续其他独立项；stdout 的 `results` 与输入一一对应，退出码为 3。连接中断或服务异常则停止后续请求，但仍在 stdout 保留已收到的前缀回执，stderr / 退出码报告本次致命错误。此时尚未收到回执的当前项可能已提交，需重新查询缓存确认；剩余项尚未执行，客户端不会盲目重试删除。

真实 GitHub 观察在本期返回明确的 `PROVIDER_UNSUPPORTED`，不退回示例；GitHub Sample 可以显式查询并在本地 demo 模式演示观察操作。

### 通用选项

| 选项 | 默认 / 规则 |
| --- | --- |
| `--api-base <origin>` | `http://127.0.0.1:37042`；仅回环 origin，无 URL 用户信息、不跟随到远端的重定向 |
| `--source live\|sample` | live；内部映射到现有 cli / demo，绝不自动回退 |
| `--format json\|table` | json；表格用于人工阅读，不作为脚本契约 |
| `--pretty` | JSON 缩进；不改变字段和默认格式 |
| `--timeout <duration>` | 5s；控制缓存服务请求超时，不是 ADO 拉取时间 |
| `--help` / `--version` | 不创建 provider、不访问网络、不要求环境凭据 |

可用 `SIGNOFF_QUERY_API_BASE` 配置查询 origin，命令行优先。新消费者入口不读取 Activity 管线的生产 token 或 Azure 凭据；`SIGNOFF_DATA_DIR` 继续属于旧采集文件用途。

### 列表筛选

| 选项 | 语义 |
| --- | --- |
| `--repo <repo-url>` | `pr list` 可重复，完整区分 provider / org / project / repo |
| `--provider ado\|github`、`--org <key>`、`--project <key>` | 服务端范围过滤；同名项目仍由父级区分 |
| `--state open\|merged\|closed\|all` | 默认 open；Draft 由下一项单独控制 |
| `--draft exclude\|include\|only` | 默认 exclude；只看 Draft 时要求 state 为 open 或 all |
| `--author <identity-key>` | 可重复，使用输出的精确账号键，不通过显示名猜测同一人 |
| `--watching` | 仅返回当前 active 观察项对应的已缓存 PR；待首次结果项需看 `watch list` |
| `--limit <n>` / `--cursor <opaque>` | CLI 默认 100，最大 200；服务端分页 |
| `--all` | 顺序读取该查询的全部页，完整成功后一次性输出 JSON；不是发现全部 PR |

生命周期先筛选：`state=open` 匹配 open / draft 这一开放集合，再应用 draft 选项；输出仍保留独立的 draft 状态。`state=all` 仍遵守默认排除 Draft。`watch list` 默认返回全部 active 项，包括显式观察的 Draft，可用 `--repo` 限定范围、`--include-stopped` 包含所有保留的停止记录，同样支持分页。

CLI 列表默认按稳定身份排序，不受个人网页的排序设置影响。网页额外的 readiness / updated 等排序参数仍由同一查询服务处理，并带稳定 ID 作为同值排序的后备条件。

## 3. 机器输出

stdout 默认只有一个 JSON 文档，stderr 承载诊断；无需消费者过滤动画、进度条或登录提示。`schemaVersion: 1` 表示外部契约，新增可选字段不改变版本；删除、改名、改变类型或语义需要新版本。

以下是**合成格式示例**，不是对 whiteboard-app #59382 当前状态的报告。项目与仓库 ID 为示意值，时间也不是实际采集结果。

```json
{
  "schemaVersion": 1,
  "source": "live",
  "dataRevision": "42",
  "generatedAt": "2026-09-18T02:03:00Z",
  "coverage": { "state": "complete", "missing": [] },
  "page": { "limit": 100, "total": 1, "nextCursor": null },
  "data": [
    {
      "id": "ado:example-project:example-repository:59382",
      "provider": "ado",
      "organization": {
        "key": "intentional",
        "url": "https://dev.azure.com/intentional"
      },
      "project": {
        "id": "example-project",
        "key": "intent",
        "url": "https://dev.azure.com/intentional/intent"
      },
      "repository": {
        "id": "example-repository",
        "name": "whiteboard-app",
        "url": "https://dev.azure.com/intentional/intent/_git/example-repository"
      },
      "number": 59382,
      "url": "https://dev.azure.com/intentional/intent/_git/example-repository/pullrequest/59382",
      "title": "Example pull request",
      "state": "open",
      "updatedAt": "2026-09-18T01:50:00Z",
      "publishedAt": "2026-09-18T02:02:10Z",
      "freshness": {
        "listObservedAt": "2026-09-18T02:02:00Z",
        "checksObservedAt": "2026-09-18T02:01:00Z",
        "checksValidity": "valid",
        "ageSeconds": { "list": 60, "checks": 120 },
        "clockSkew": false
      },
      "observation": {
        "id": "example-observation",
        "generation": 1,
        "active": true,
        "addedAt": "2026-09-18T01:55:00Z",
        "stoppedAt": null,
        "stopReason": null
      },
      "readiness": {
        "kind": "unknown",
        "label": "Unknown · Pending",
        "status": "pending",
        "nextAction": "Waiting for Jev to evaluate the current facts.",
        "error": null,
        "current": null,
        "previous": null
      }
    }
  ]
}
```

字段规则：

- `id` 是 SignOff 内部不透明身份；`number` 是源 PR 编号；`project.id` 是 SignOff 项目 ID；`repository.id` 是 provider 的仓库身份。消费者不要解析内部 `id` 的拼接格式。
- ADO 的组织 / 项目 / 仓库为 `msdata / Vienna / online-meetings` 等三级结构；GitHub Sample 按 `github.com / nocoo / signoff.now` 表达，项目 key 对应 owner。
- 列表还返回作者身份、分支 / SHA、检查完成摘要与内容完整性。`pr get` 的 `data` 为一个对象，补全描述、全部 merge requirements、reviewers、policies、builds / stages、下一步和缺失原因。
- Readiness is a persisted Jev judgment (direct provider Conflict is excluded from Jev) for watched PRs. Changed PRs are batched by project only during visible, focused SignOff presence, with an independent 5-minute completion cooldown per project configured in Connector details. Background time counts; returning resumes overdue work. Cached CLI reads never invoke inference. Raw requirements retain source IDs, states and provider links. Ready includes the configured PoP-only final-step convention and still requires provider merge requirements; see [Jev contract](19-pr-state-machines.md).
- Explicit build expiry remains in `policies[].expired` and raw requirements. It does not force an AI classification; Jev interprets all evidence and user instructions.
- `freshness.listObservedAt` 使用成功摘要请求的开始时间，检查保留独立 `checksObservedAt`；慢检查不能把旧 open 覆盖较新 merged。`targetSha` 仍是 ADO PR 的 `lastMergeTargetCommit`，不是当前目标 ref 的独立读取。`checksValidity: valid` 只关联最后已知提交，不能单独作为当前目标 CI 或 stage retry 的操作证据；缓存没有完整 raw build / stage attempt / policy evaluation 操作上下文。
- `coverage.state=complete` describes collection coverage, not freshness. Every discovery paginates accessible history and all states; watched PR refreshes independently collect full details. Inspect the actual observation timestamps.
- `watch list` 每项返回观察元数据、完整 `ref`、可空的 `pullId` 和可空的 `pull` 摘要，首次采集前不会伪造一个 PR 快照。
- 每个规范 PR 只保留一条观察记录；inactive 首版不自动清理。`--include-stopped` 返回所有保留行的当前 generation，不按“最近 N 天 / N 条”截断，也不是每次增删的事件日志。重新加入覆盖该行启停字段并推进 generation；lookup 始终取当前一代，不查历史代次。`stopReason` 为 null、manual、completed、abandoned、project_deleted 或 scope_changed。项目删除后停止记录仍保留，`pull` 可为空。
- 观察查询按内部 `projectId`（或 `project` 指定内部 ID）筛选时，仅返回该次注册下的记录；删除后重新注册相同外部项目，不会把旧注册的停止项混入新项目。未指定内部 ID 的外部范围查询仍可包含该范围的保留记录。
- 无匹配结果是 `data: []`；未采集范围另标 `not_collected`。缺失检查 / 计数 / 时间使用 null 或明确 unknown；不能填 0 / passed。
- 已停止观察的 PR 仍能在普通 `pr list --state all` 或 `pr get` 中查询；默认 `watch list` 排除它，可通过 `--include-stopped` 查看原因。

时间与有效性的完整含义以 [17](17-query-cadence.md) 为准。

## 4. HTTP 对应关系

下列 Query 路由共用只读服务；Command 路由只修改配置 / 观察 / 队列，不直接调用 provider。

| 方法 / 路径 | 请求与结果 |
| --- | --- |
| `GET /api/query/v1/repos` | 范围内的已注册仓库与覆盖信息；仅有配置时 provider repository ID 可空，明确标记身份未解析 |
| `GET /api/query/v1/prs` | 与 CLI 对应的过滤、分页、同响应计数和版本 |
| `GET /api/query/v1/prs/:id` | 按不透明内部 ID 读取单 PR 缓存 |
| `GET /api/query/v1/prs/lookup` | `source`、`repositoryUrl`、`number` 唯一定位缓存详情；客户端把完整 PR URL 拆成这些字段，不访问源站；缓存未找到为 404 |
| `GET /api/query/v1/observations` | 默认 active；`includeStopped=true` 包含所有保留的 inactive 行，按规范身份稳定排序并使用同一 source 版本分页 |
| `GET /api/query/v1/observations/lookup` | `source` 加 `pullId`，或 `repositoryUrl` + `number`；本地解析后返回唯一观察项 ID / generation 及 active / 停止状态，未观察为 404 |
| `GET /api/query/v1/collector` | 执行器、按范围 / 通道去重的任务预览、完整队列计数、观察数量、最近错误、检查与状态冷却，以及 `sampleCommandsEnabled` |
| `GET /api/query/v1/jobs/:id` | 已存任务状态；状态探测的终结回执保留 24 小时，超过保留期可返回 NOT_FOUND |
| `POST /api/commands/v1/observations` | `{ source, refs: [{ pullId } 或 { url }] }`，每批最多 100 项，逐项返回 added / already_observed / rejected、observation ID / generation、job 回执或 error |
| `DELETE /api/commands/v1/observations/:id?source=…` | `If-Match: "<generation>"`，仅移除该代次；同代次已停止为幂等成功，代次不匹配为 409 |
| `POST /api/commands/v1/observations/remove` | `{ source, items: [{ id, generation }] }`，最多 100 项，逐项 removed / already_stopped / conflict / not_found |
| `POST /api/commands/v1/discover` | `{ source, repositoryUrl }` or `{ source, projectId }`; enqueue a complete list refresh for the registered scope and revision; returns HTTP 202 and respects discovery cooldown. |
| `POST /api/commands/v1/refresh` | `{ source, target }`，target 为 `{ pullId }`、`{ url }`、`{ repositoryUrl }` 或 `{ all: true }` 之一；只覆盖 active 观察项，返回 HTTP 202 |

`repo add` 复用现有 `/api/projects` 的注册 / 扩展逻辑及 revision 校验，在客户端显式完成，不增加第二套项目存储。先读取完整分页目录，再判断已注册范围，避免目录较大时重复修改项目 revision。同 org / project 的第二个仓库扩展已有项目，项目范围为 all 时保持 all。项目删除 / 范围缩小与对应观察停用、任务取消必须在同一 CAS 事务中完成；旧 enabled 字段不控制关注清单或显式发现，详见 16。

批量观察操作逐项原子，不因一项已终态而撤销其他成功添加项；批量结果 HTTP 200，CLI 在任一项失败时返回非零并保留结构化逐项结果。顶层格式无效则整次 400，零写入。移除客户端先只读取得当前 observation ID / generation，再发送带版本的命令；冲突不自动重试删除新一代。

可通过顶层 URL 格式校验、但路径含非法百分号编码的引用（例如 `%ZZ`）也只是该项的 `INVALID_REFERENCE`；后续有效项继续执行，成功项保留 job 回执。CLI 在本地解析到此类参数时，以 exit 3 / `INVALID_ARGUMENT` 返回，不访问服务或 provider。

added 项的 `job` 为 `{ id, kind: "refresh", state: "queued", coalesced: false, notBefore }`，与观察激活同一事务创建；失败项没有观察 / 任务残留。already_observed 不产生新工作：若有同代次 queued / running / auth_required 的完整检查任务则复用该 job，否则 job 为 null，保留当前冷却。`refresh` 也只复用 checks 工作，不把一次基础状态探测当成完整检查。执行任务后来失败不撤销观察，按 16 的恢复规则重试；消费者可直接查询回执 ID。

discover / refresh 的回执包含 `jobs: [{ id, kind, state, coalesced, notBefore }]` 和零目标时的说明。收到 202 仅表示任务已保存，不表示刷新成功。消费者稍后用 `job get` 查询；登录过期作为任务状态返回，不能触发查询 CLI 自己登录。

A discovery freezes one project revision and repository scope. Matching unfinished requests coalesce. Automatic discovery defaults to 600 seconds after completion; manual requests respect the same cooldown.

项目级发现与仓库 URL 发现采用相同的别名唯一性校验。名称复用导致多个稳定 ID 匹配时，返回 HTTP 409 / `REFERENCE_AMBIGUOUS`，不入队；可通过仓库 ID 消除歧义。固定范围内的 provider ID 不能由另一个仓库的名称替代。`repo add` 遇到 Unicode 大小写等价的多个项目注册时，也以 exit 3 / `REFERENCE_AMBIGUOUS` 拒绝，不任意编辑其中一个项目。

`job get` 返回任务 kind、固定 scope / projectRevision、state、updatedAt、进度及结果；可选 `lane: "status"` 表示仅检查 PR 摘要，省略 lane 的旧 / 完整任务按 checks 理解。状态为 queued、running、auth_required，或终结状态 succeeded、partial、failed、canceled；canceled 带 reason。项目删除为 project_deleted，范围或 revision 变化分别为 scope_changed / project_changed，观察移除为 observation_removed，终态取消其他任务为 observation_retired。项目删除不主动清除摘要；状态探测仍受 24 小时回执保留期约束。

Collector returns `listCooldownSeconds` and `detailCooldownSeconds`. Zero disables automatic scheduling for that task type. Its job preview contains up to 200 latest tasks; grouped history provides full pagination. Queue and connection status are computed separately. Cached snapshots and stopped watch records remain available.

discover 结果含 `repositories: [{ repository, state, pullCount, error }]`；pullCount 是本次返回的窗口数量，不是仓库历史总量。单仓库完整结果与成功游标原子发布，失败仓库保留旧数据和边界，尚未取得的数量为 null。部分仓库失败时任务为 partial，全部失败为 failed。auth_required 是等待状态，不能伪装成完成。

Every discovery paginates all accessible PR states without individual PR requests. Creation-time cursors and the discovery `--full` option are removed. Full watched PR refreshes use an independent completion-based cooldown. See [16](16-scheduler-state-machine.md).

对未终结任务，取消事务立即令整体 state=canceled，优先于未结算的 partial / failed，不等待在途请求。已结束的 repositories 项保留 succeeded / failed，尚未结束的项变成 canceled；所以“一个仓库已成功，另一个被取消”返回 canceled 和逐仓库结果。先前发布不因取消而回滚，项目删除 / 来源替换仍可按配置操作的语义删除缓存；旧任务摘要保留。迟到响应不得再发布。若任务先已终结，则后来的配置操作不改写其历史结果。

这些服务复用 Worker。本期有意信任可访问本机端口的进程，Query 与观察 / 入队 / 仓库配置命令共用无认证的本机边界；本机 Worker 绑定回环地址，CLI 校验目标 origin、拒绝带凭据 URL 与重定向，HTTP 路由保留 Host 校验。生产网页继续由现有 Access 契约保护，命令和查询都不扩展 Activity pipeline token 的路由白名单。

## 5. 分页、并发发布与错误

首版使用**每个 source 一个持久 `dataRevision` 计数器**，接受保守的 source 范围失效，不另建每种筛选的版本系统。PR 快照、仓库目录 / 覆盖、项目范围 / 元数据 / Readiness、观察项发生实际变化时，在同一写事务中推进版本；一次事务只需推进一次。失败、幂等无变化、任务心跳和普通查询不推进。另一个仓库或一条未显示的观察变化，也会使该 source 的游标失效；Live 与 Sample 互不影响。

PR、repos 与 observations 的列表 / 单项 / lookup 均返回 `dataRevision`。同一响应的记录、数量与版本保持一致：详情在同一 batch 读取；PR 列表先读取 open PR 事实与配置，再以 SQL 筛选、排序、分页和计数。名称范围查询先从紧凑目录解析稳定 ID；观察查询先读取目录，再在 SQL 内筛选、计数和分页，并只关联选中页的 PR 快照。各阶段均校验同一 source 版本。版本改变时丢弃整次结果；无游标查询最多重试两次，带游标直接返回 `SNAPSHOT_CHANGED`。游标包含 source、规范化过滤 / 排序、版本与下一页位置，不能跨查询复用。16 中防止旧事实发布的单 PR 快照版本是独立的条件写版本，不用 source 计数器拒绝无关仓库的发布。Collector / job 的运行状态使用各自 updatedAt，不宣称与数据块共享冻结版本；Directory 和保存的统计继续使用自己的 revision / calculatedAt。

终态历史和观察清单（含全部保留的停止记录）仅加载请求页的快照，不整库解析描述、build 或 stage。单项 observation lookup 只关联目标快照；pending-only 读取不加载 PR 快照。项目、仓库名称和旧别名在命令、查询与筛选中使用一致的 Unicode 大小写转换；规范 identity 中的稳定 provider repository ID 仍作为去重依据。全文筛选只额外读取紧凑的搜索文本，在 JavaScript 中对文本和搜索词执行一致的 Unicode 大小写转换，再把匹配 ID 交给 SQL 分页；非英文作者和标题也可匹配。Readiness is read from persisted Jev evaluations; queries never invoke the model.

这意味着仅 observation 增删 / 淘汰也会让同 source 的 PR、repos、observations **后续分页**收到 `SNAPSHOT_CHANGED`，即使 PR 查询未启用 watching 筛选。没有游标的独立读取直接返回当时版本；GET observations 比先前 PR 列表版本新是正常情况，客户端不能据此使全页报错或循环重载所有块。includeStopped 与范围筛选属于 observation 游标签名；停止、重加或项目级停用同样按事务推进版本。

v1 不保留多份历史读版本：后续页若发现版本改变，返回 `409 SNAPSHOT_CHANGED`，要求从第一页重读，避免漏项或重复。`--all` 最多重启整个读取 2 次，持续变化时明确失败，stdout 不输出伪装完整的半份结果；不套用旧 `/api/workbench` 的 1,000 条截断。大规模持续发布导致重试过多是需要度量的限制，不承诺跨版本分页天然一致。

沿用现有退出码 0–4 的含义，新增 5 代表本地目标未找到；旧 Activity 命令的码值不改。

| 退出码 | 语义 |
| --- | --- |
| 0 | 成功读取 / 命令已接受；空列表、较旧缓存或 provider 当前离线本身不使有效查询失败 |
| 1 | CLI 运行错误 |
| 2 | 本地环境 / 服务连接失败，如 Worker 未运行 |
| 3 | 参数、契约、版本冲突、批量部分失败、未观察目标、不支持的 provider，或 REFERENCE_UNRESOLVED / REFERENCE_AMBIGUOUS |
| 4 | 缓存服务错误、数据库不可用、服务端超时 |
| 5 | 缓存 PR / 仓库 / 任务未找到，错误码区分 `CACHE_MISS`、`NOT_FOUND`、`REPOSITORY_NOT_TRACKED` |

常规失败 stdout 为空，stderr 为结构化 `error.code / message / retryable`；批量部分失败是明确例外，stdout 保留逐项结果，stderr 提示未全部成功。批量移除遇到致命服务错误时也保留已经确认的前缀回执，不能把它当作完整批量结果。未知参数不是成功的空结果。较旧缓存成功返回，其时间与完整性由消费者判断。

## 6. 其他项目接入示例

### 开发环境：不发布，直接调用

CLI 是本仓库的 Bun / TypeScript 入口，不需要发布 npm 包、部署网页或全局安装 `signoff`。其他 App 可在任意工作目录运行它；依赖从 SignOff checkout 的 `node_modules` 解析。

| 内容 | 当前本机路径 |
| --- | --- |
| 仓库根目录 | `/Users/nocoo/workspace/personal/signoff.now` |
| CLI 入口 | `/Users/nocoo/workspace/personal/signoff.now/apps/collect/src/main.ts` |
| Bun 可执行文件 | `/opt/homebrew/bin/bun`；其他机器用 `command -v bun` 确认 |
| 完整 CLI / HTTP 文档 | `/Users/nocoo/workspace/personal/signoff.now/docs/18-cli-query-contract.md` |
| 随仓库维护的 agent skill | `/Users/nocoo/workspace/personal/signoff.now/skills/signoff-cli/SKILL.md` |
| 本机 skill 入口 | `~/.codex/skills/signoff-cli/SKILL.md`，链接到上面的仓库版本 |

`apps/collect/package.json` 的 `bin.signoff` 也指向 `./src/main.ts`。仓库移动后修改消费者配置的入口路径；不要依赖消费者自己的当前目录或猜测一个已安装的全局命令。

```bash
# 任意目录均可执行；这两个变量只是调用方的路径配置
SIGNOFF_REPO=/Users/nocoo/workspace/personal/signoff.now
SIGNOFF_CLI="$SIGNOFF_REPO/apps/collect/src/main.ts"
test -f "$SIGNOFF_CLI"
git -C "$SIGNOFF_REPO" rev-parse --show-toplevel
command -v bun

bun "$SIGNOFF_CLI" --help
bun "$SIGNOFF_CLI" status --pretty
# 完整关注清单，包括 Draft 和尚未拿到首次快照的项
bun "$SIGNOFF_CLI" watch list --all
# 只读取已有快照的关注 PR；明确包含 Draft
bun "$SIGNOFF_CLI" pr list --watching --draft include --all
bun "$SIGNOFF_CLI" pr get '<完整 PR URL 或 SignOff PR id>'
```

若 shell / cron / App 的 PATH 中没有 Bun，使用上表中的绝对 Bun 路径。`SIGNOFF_CLI` / `SIGNOFF_REPO` 不是 CLI 内置选项，只供调用方定位文件；`SIGNOFF_QUERY_API_BASE` 才是 CLI 自身读取的服务配置。

本机需已有运行中的 Worker，默认 `http://127.0.0.1:37042`。维护者在新的 SignOff checkout 先执行 `bun install --frozen-lockfile` 和 `bun run build:web`，生成 Wrangler ASSETS 绑定所需的 `apps/web/dist`，再在独立终端运行 `bun run dev:worker`；它应用本地迁移、使用原来的 Wrangler SQLite。复用现有 Worker 的消费者无需重新构建或启动网页。要处理发现任务或持续刷新关注清单，再运行 `bun "$SIGNOFF_CLI" daemon`。复用已启动的服务，每个消费 App 无需另开 daemon。网页无需打开，daemon 停止后仍可查询已有缓存；查询和清单命令都不要求 Azure / GitHub 登录，只有执行采集任务的 daemon 使用 Azure CLI。

Node.js 消费者可直接调用同一入口，以参数数组传递引用：

```js
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const cli = "/Users/nocoo/workspace/personal/signoff.now/apps/collect/src/main.ts";
const { stdout } = await run(
  "/opt/homebrew/bin/bun",
  [cli, "watch", "list", "--all"],
  { timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
);
const snapshot = JSON.parse(stdout);
// snapshot.data: 关注身份与可空的 pull 快照；同时检查时间和完整性。
```

消费端自行安排 Query 周期、进程超时和输出上限；数据量大时使用 `--limit` / `--cursor` 分页。命令失败时 `execFile` 拒绝，保留消费者上次成功快照，不把错误解析成空清单。也可直接使用本章第 4 节的 HTTP 接口；这与 CLI 读取同一份数据。

### 明确配置与观察

以下用 `signoff` 简写入口；开发环境可定义 shell 函数 `signoff() { bun "$SIGNOFF_CLI" "$@"; }`，或替换为上述绝对路径调用。

```bash
# 管理者配置一次；两个仓库分别保留 org / project / repo 身份
signoff repo add \
  'https://dev.azure.com/intentional/intent/_git/whiteboard-app' \
  'https://dev.azure.com/msdata/Vienna/_git/online-meetings'

# 显式发现后，用 job get 查询回执中的任务，再读取已有列表
signoff discover --repo 'https://dev.azure.com/msdata/Vienna/_git/online-meetings'
signoff pr list --repo 'https://dev.azure.com/msdata/Vienna/_git/online-meetings' --all

# 从列表复制实际需要观察且仍开放的 PR URL；与网页勾选使用同一 API
signoff watch add '<PR URL>'
signoff watch list --pretty

# 消费项目按自己的周期读缓存
signoff pr list --watching --draft include --all
signoff pr get '<PR URL>'

# 提前更新、主动退出；命令本身均不访问 ADO
signoff refresh --pr '<PR URL>'
signoff watch remove '<PR URL>'
```

消费项目写本地文件时先完整写临时文件、成功后原子替换；连接失败继续保留自己的上一版。终态自动淘汰后若需要记录合并 / 放弃事件，应读普通缓存列表的 `--state all` 或 `watch list --include-stopped`，不要只看 active 集合并把消失误解为删除。

### Agent skill

[signoff-cli skill](../skills/signoff-cli/SKILL.md) 随 CLI 代码在同一仓库维护，包含路径定位、缓存查询、清单操作、complete list discovery and error handling。当前本机通过 `~/.codex/skills/signoff-cli` 链接到仓库的 `skills/signoff-cli`；支持该技能目录的 agent 可在新会话发现它，也可以直接读取上表中的绝对 `SKILL.md` 路径。其他机器可把此技能目录链接到自己的技能目录，保留对实际 checkout 的路径配置。

## 7. 测试与交付清单

- Worker Query 只使用 D1 SELECT；Command 只修改观察 / 队列。SQL 只读断言、空清单执行器测试和缺少 az 的真实 CLI 子进程验证查询 / 入队不调用 provider；provider 仅在 claim 到任务后延迟初始化。
- 子进程环境移除 Azure / GitHub 凭据，令 `az` / `gh` 不可用；query、watch 增删、discover / refresh 回执仍能完成，provider 哨兵调用次数为零。
- 阻塞 / 失败的 provider、过期认证和停止的 daemon 不影响有数据的缓存查询；Worker 关闭返回明确连接错误。
- 网页与 CLI 用 URL / 内部 ID 添加同一 PR 幂等；首个 job 与观察同事务，任务写入失败不能留下 active 项，重复 add 返回复用 / null 回执；批量部分失败不丢成功项；已知仓库下未缓存 PR 可添加，未解析仓库零写入；Draft 和终态拒绝有覆盖。
- remove lookup 包含 active、stopped、从未观察、项目已删除和别名歧义；lookup 后发生重加时旧 generation 删除必须失败，不能自动重试。
- PR 终态自动淘汰之后，watch active 列表不再包含它、普通 PR 查询仍能得到最终状态；不再产生后续 refresh。
- stdout 是单个可解析 JSON，stderr 分离；命令和参数由 UT 覆盖，主要流程与错误码另由真实 CLI 子进程验证，包含帮助命令零副作用。
- 超过 1,000 条 PR、多页、并发版本变化、两次重启读取仍失败、错误游标与混合 source 全部测试；不静默返回半份结果。逐类验证数据写入与 revision 同事务，失败 / 无变化不推进、无关同 source 变更也失效，记录 / 计数 / 版本不能混读。
- 多仓库发现的固定范围、去重、逐仓库部分成功、部分发布与取消竞争、项目完成后冷却，以及项目删除后仍可查 canceled 任务和全部停止观察记录，由真实 HTTP 测试锁定。
- 无认证读写只在本机边界生效；错误 Host、非回环 origin 与跨主机重定向拒绝，生产 Access 与 Activity token 路由回归保持。
- 源项目与仓库同名、跨组织 PR number 相同、GitHub Sample 身份和未知字段的前向兼容有合成 fixture。
- daemon 与短命客户端共同做一次隔离系统验收：注册 → 发现 → 添加观察 → 首次结果 → 查询 → completed / abandoned 淘汰 → 最终快照查询，以及主动移除路径。

测试与文档、CLI help 同步交付；分层测试入口见 [14](14-collector-architecture.md)，既有完整 6DQ 门禁差距见 [CLAUDE.md](../CLAUDE.md)。

## Collector details and history

The wide, two-column dialog keeps connection metadata and both cooldown settings on the left. The right column groups jobs by stable PR or project identity. Queued, running, successful and failed attempts remain together; expanding a group preserves its place while status updates arrive.

`GET /api/query/v1/collector/groups?source=live` returns up to 50 groups as `{ data, nextCursor, generatedAt }`. Each group includes `cooldownSeconds`, `lastCompletedAt`, `nextRunAt`, the latest attempt and its retained PR identity. Running tasks have no fixed next start; the UI shows elapsed time and the cooldown after completion. Queued/cooling tasks show the planned timestamp and countdown; overdue tasks count upward.

`GET /api/query/v1/jobs?source=live&lane=all&outcome=all&group=pr:<observationId>` reads up to 50 attempts, newest first. Use `project:<projectId>` for list tasks. `lane` accepts `all`, `checks`, `discover`; `outcome` accepts `all` or `issues`. Pagination cursors are scoped to the source and filters. `GET /api/query/v1/jobs/:id` includes phase events, repository results, errors and the immutable returned PR snapshot with builds, stages and checks. Attempts recorded before this feature explicitly have no returned snapshot.

These reads never enqueue provider work. Old status-lane jobs are excluded from current groups and history. A newer successful attempt clears current warnings without erasing prior failures. An unassigned ADO policy build ID (`0`) remains queued and never triggers a build-0 request.
