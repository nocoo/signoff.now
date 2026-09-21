# 17 — Query 周期、采集周期与数据新鲜度

> Current implementation, 2026-09-21. Web and CLI share one watch list. Project discovery and watched PR refresh use independent completion-based cooldowns.

## 1. Independent clocks

| Clock | Default | Effect |
| --- | --- | --- |
| Project discovery | 10 minutes after each project's completed attempt | Paginate repository PR lists and update all returned PR states. |
| Watched PR refresh | 5 minutes after each PR's completed attempt | Fetch the full PR state, checks, builds and stages. |
| Daemon queue polling | 3 seconds while idle; 10 seconds after transport errors | Read local scheduler state; contact ADO only after claiming eligible work. |
| Running-task heartbeat | 20 seconds | Renew the local lease and report current phase. |
| Collector dialog queries | 3 seconds while visible | Read cached groups, history and selected task details. |
| Dialog elapsed/countdown clock | 1 second | Render existing timestamps locally; no request. |
| PR/pending/detail queries | 15 seconds, plus publication-driven reload | Read the cache. |
| Repository reference lookup | 30 seconds until resolved | Read cached repository identities. |

Closing the webpage does not stop the daemon. Hidden query blocks suspend automatic polling. Query failures back off to two and four times their base interval. External consumers choose their own read cadence. None of these reads bypasses collection cooldowns.

## 2. Completion-based example

```text
10:00:00  Project list starts; watched PR A starts independently.
10:00:35  Project list finishes; next project list is due at 10:10:35.
10:01:20  PR A finishes all details; next PR A refresh is due at 10:06:20.
10:02:00  Manual PR A refresh queues for 10:06:20; it cannot run early.
10:02:10  PR B finishes independently; next PR B refresh is due at 10:07:10.
10:06:20  PR A becomes eligible, subject to available worker capacity.
```

Cooldown is a minimum wait after completion, not a freshness SLA. Task duration, queues and provider availability can make data older. Every discovery fully rereads accessible lists, including old and terminal PRs; only watched PRs receive periodic detailed checks. The separate 30-second status lane has been removed.

## 3. 时间字段的唯一含义

对外 Query 使用 UTC ISO 8601 字符串；时间间隔使用明确的秒数，缺失时间为 `null`。现有数据库的秒时间戳在适配层转换，不混用 JavaScript 毫秒值。

| 字段 | 含义 | 可以让它更新的事件 |
| --- | --- | --- |
| `pr.updatedAt` | 源 PR 自身提供的更新时间 | 成功取得新的源 PR 事实 |
| `freshness.listObservedAt` | 最新成功摘要请求的开始时间；内部为可含毫秒精度的 `summaryObservedAt`，旧缓存兼容原 observedAt | Successful discovery or full refresh 中较新的基础事实；失败不推进 |
| `freshness.checksObservedAt` | 此 PR 的 policy / review / build / stage 检查观测时间 | 成功取得检查；部分取得还需配合完整性与缺失项解释 |
| `publishedAt` | 该记录被原子发布到 SnapshotStore 的时间 | 通过租约和 revision 验证的发布 |
| `generatedAt` | 本次 Query 响应产生时间 | 一次查询；不表示源数据更鲜 |
| `lastCompletedAt` / `nextDueAt` | Completion / due time for the individual PR generation or project discovery | 调度状态转移 |
| `calculatedAt` | Repos / Insights 统计上次成功计算时间 | 用户显式刷新该统计模块 |
| `observation.addedAt / stoppedAt` | 当前观察代次加入 / 停止的时间 | 明确增删、项目 / 范围移除或成功确认终态；与 PR 采集时间分开 |

摘要时钟记录请求开始，避免“很早读到 open，补全 build 很久后完成”看起来比随后读到的 merged 更新。每次实际摘要 / 仓库页请求单独记时，不沿用任务领取时间；认证等待后才开始的请求使用较新的时刻。内部 `observedAt` 仍计入成功读取的完成时间，供验证源时间与上传边界；`checksObservedAt` 单独反映检查采集。PR 在摘要请求期间新建或合并时，其源 `updatedAt` 可以晚于请求开始，这是合法情况，不能把摘要时钟改写为检查完成时间。

发布分别选择摘要和与其提交匹配的检查，公开 `listObservedAt` 与 `checksObservedAt` 因而可以不同。迁移保持旧记录原始时间；查询、展示、失败重试不补成 `now`；摘要复用旧检查时保留检查时间。仓库共享名称也按独立元数据事实时间择新，不由不同 PR 任务的完成次序决定。

`freshness.ageSeconds.list / checks` 由响应时钟与各自观测时间计算；缺失为 null。发现未来时间时年龄下限为 0，同时返回 `clockSkew: true`，不把异常时钟悄悄描述为刚同步。同一秒内的毫秒精度与整数响应时钟差异不误报偏差。

## 4. 有效性、完整性与服务可用性

这三件事分别表达，不能压缩成一个绿色图标：

| 维度 | 例子 | 对消费者的意义 |
| --- | --- | --- |
| 已知事实是否适用 | `checksValidity: valid / invalidated / missing` | head / target 改变后的旧绿灯不能用于当前 PR |
| 内容是否完整 | `complete / partial / not_collected`，附缺失项 | 缺少 timeline 或 policy 与“没有失败项”含义不同 |
| 是否持续更新 | Collector ready / offline / auth_required / error，附上次心跳 | 采集停止时旧快照仍可读，但时间继续变老 |

`valid` 只表示检查适用于**最后已知**的提交与目标，不是对当前源站状态的保证。readiness 基于这些已知事实统一计算，并返回全部 requirement 和主要卡点；无有效检查时不能宣称 ready。

ADO `targetSha` 仍来自源 PR 的 `lastMergeTargetCommit`，不是另外读取的当前目标 ref；`valid` 因此不能单独证明 CI 覆盖当前主分支。执行合并或 stage retry 的消费者仍需其明确操作前的证据读取。build policy 的明确到期标记显示为红色 `Build Expired`，不与一般构建排队状态混淆，也不改变上述证据边界。

查询默认返回最近已发布的数据，即使它较旧。调用者可以按自己的规则，比如“列表年龄不超过 5 分钟、checks 年龄不超过 15 分钟”，决定是否使用、提示或另发刷新命令。v1 不提供隐式“过期就拉取”的选项。

| 情况 | 查询结果 | 采集动作 |
| --- | --- | --- |
| Collector 正在采集 | 返回上一版已发布快照 | 不额外创建任务 |
| `az` 登录过期 | 返回已有数据和可独立查询的认证状态 | 由采集模块恢复，不要求查询者登录 |
| 仓库已配置但从未采集 | 空结果、`not_collected`，不能伪装成仓库没有 PR | 用户可显式请求 discover |
| 筛选确实没有匹配 PR | 空结果且说明缓存覆盖范围 | 不刷新 |
| 只知道 PR 基础数据 | 返回基础字段，检查为 missing / unknown | 用户加入观察后由 checks 补齐；不自动加入 |
| 观察项尚无首次结果 | `watch list` 返回已解析仓库身份的引用和等待状态，缓存 PR 查询可能尚未找到 | 已观察项按队列执行首次定向刷新 |
| completed / abandoned 已淘汰 | 缓存中保留 merged / closed、停止原因与最后采集时间 | 不再周期检查；GET 不会重新加入 |
| Worker 不可用 | 明确服务连接错误 | CLI 不改为直接访问 ADO，消费项目保留自己上次文件 |
| 某个模块读取失败 | 该模块报错；其他模块与其成功缓存保持可用 | 不触发跨模块刷新 |

## 5. 外部项目的典型接入

外部项目先显式添加需要持续观察的 PR，再独立配置每分钟查询一次。首次使用的仓库若尚无本地身份，先注册并显式 discover，再添加观察；命令不会为了补齐身份而同步访问源站。`watch list` 获取 active 集合及已有状态；`pr list` 可以读取全部已发现的缓存 PR，也可用 `--watching` 限定范围。它保存原样身份和时间字段，再根据需要调用 `pr get` 获得已缓存的明细，或利用源 URL、repository ID、PR number 进行自己的调查。

```text
外部 cron
  → signoff pr list --repo <repo-url> --watching --all
  → 成功后替换消费者的本地快照
  → 按 provider / project / repository / PR ID 关联本项目状态
  → 根据 listObservedAt、checksObservedAt 和 checksValidity 判断适用性
  → 可选：显式 signoff refresh，下一周期再读
  → 不再需要持续更新时，signoff watch remove <pr-ref>
```

调度者只运行一套 SignOff daemon；每个消费者无需启动采集器，不需要 Azure 登录。`signoff watch list / add / remove` 是短命命令，不是常驻循环。消费者进程结束不影响已经保存的观察列表或后台周期。

## 6. 需要锁定的时间测试

- 固定假时钟：相同快照连续查询 100 次，只有 `generatedAt` 和派生年龄变化，观测时间、队列和 provider 调用数不变。
- Slow tasks: each PR refresh and each project discovery starts its cooldown after completion. Scheduler ticks and browser polling never bypass it.
- 慢速认证、多个仓库发现及摘要读取期间 PR 新建 / 合并：摘要记录实际请求开始，内部完成时间覆盖响应期间的源变化；较旧摘要不能因补全检查耗时而冒充更新，终态通过真实 Worker 发布并淘汰观察。
- 持续发布与慢网页 Query：同来源版本变化合并重读，有效在途结果仍能落地；命令前旧读取不能覆盖成功回执，来源切换的旧结果不串入新页。
- 页面隐藏：停止 Query，观察项与后台刷新保持不变；重新进入前台立即读缓存，不发送观察增删或页面采集心跳。
- 淘汰 / 主动移除：继续 Query 只能看到最后结果，不产生下一次状态刷新，也不延后 `stoppedAt`。
- 发布延迟、网络失败和认证过期：旧时间保持，不能因一次重试或读取变成新数据。
- 字段缺失、未来时间、秒 / 毫秒混淆、UTC 日期边界都使用固定数据断言。
- 统计恰好 24h / 72h 保持前一等级，超过边界才黄 / 红；分钟显示小于 1 分钟、3 分钟等，不出现秒级闪动。

浏览器的读取状态机、调度时钟和显示用时钟分别测试；不需要让测试真实等待两分钟或五分钟。
