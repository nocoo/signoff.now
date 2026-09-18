# 15 — 网页查询与独立数据块

> 当前实现，2026-09-18。网页和 CLI 共用一份关注清单；升级默认空清单，发现仅按需执行。
> 调度语义见 [16](16-scheduler-state-machine.md)，查询周期与时间字段见 [17](17-query-cadence.md)，机器契约见 [18](18-cli-query-contract.md)。

## 1. 数据块边界

`WorkbenchProvider` 通过 `useWorkbenchViewModel` 协调页面操作；每个查询由独立的 `useQueryBlock` 实例持有 key、数据、错误、取消信号和轮询状态。`monitoringApi.ts` 负责公共 DTO 与网页模型适配。网页已经停止读取整份 `/api/workbench`。

PR 表格出错不会清空项目导航，Collector 失败不会清空已有 PR，详情有自己的错误和重试状态。明确的 Reload cache 可以重新读取多个块，自动轮询则各自独立。

## 2. 数据块及服务契约

下表接口已接入。Query 路由只读已发布数据；项目和目录 CRUD 使用原有接口。

| 数据块 | 查询 / key | 独立行为 |
| --- | --- | --- |
| 全局来源 | `WorkspaceSourceProvider`：Live / Sample | 只负责来源和持久偏好，不持有整份 workbench |
| 项目与仓库导航 | `GET /api/query/v1/repos?source=…`；key 为 source | 返回稳定的组织、项目、仓库身份和配置；未采集仓库也可显示 |
| PR 列表 | `GET /api/query/v1/prs`；key 含 source、规范化筛选、排序和分页 | 服务端筛选、默认 20 条；完整总数与当前筛选的状态计数不受 1,000 条旧展示上限影响 |
| PR 详情 | `GET /api/query/v1/prs/:id?source=…`；key 为 source + PR ID | 独立读取描述、review、policy、build、stage 与缺失信息；关闭后停止该块轮询 |
| 待采集观察列表 | `GET /api/query/v1/observations?source=…&pending=true`；key 为 source + 范围 + page | 独立 20 条分页、错误和 Retry；未取得首次快照的 CLI 关注项也可逐项移除 |
| Collector 与任务 | `GET /api/query/v1/collector`；当前任务通过 `GET /api/query/v1/jobs/:id` | 独立连接状态、发现与监控任务、冷却配置、项目故障与进度，不随 PR 表格错误消失 |
| 状态刷新 / 发现命令 | `POST /api/commands/v1/refresh`、`discover` | 前者仅刷新 active 观察项；后者按明确仓库发现列表，不自动添加观察项 |
| 观察增删 | `POST /api/commands/v1/observations`、`observations/remove` | 明确的批量添加 / 移除，返回逐项结果；单项删除也提供 DELETE 接口 |
| Directory | 现有 `/api/directory?source=…` | 延续独立 revision、编辑草稿、CAS 冲突处理 |
| Repos / Insights 统计 | 现有 `/api/insights/:module` | 每个模块单独读保存结果、单独手动计算，保留 `calculatedAt` |

PR 查询参数与返回身份共享 [18](18-cli-query-contract.md) 的规范。网页使用自己的分页大小与 readiness 排序默认值；外部 CLI 默认按稳定身份排序。来源、过滤和排序均在服务端完成，不将全库大 JSON 交给每个消费者处理。

同一响应中的记录、计数和 `dataRevision` 必须对应同一个 source 版本。详情查询使用一个一致性 batch；PR 分页先读取 open PR 的 readiness 事实，再通过 SQL 读取当前页、计数和作者。按项目名或仓库名筛选时，先对紧凑目录统一进行 Unicode 大小写转换，再使用已解析的稳定 ID 查询。观察清单先在 SQL 内筛选、计数和分页，仅关联当前页的 PR 快照；待采集项不读取 PR 快照。跨阶段读取均校验 source 版本一致，不返回混合版本。版本改变时，无游标读取最多重试两次；带游标读取返回 `SNAPSHOT_CHANGED`，见 18。网页的 PR 表格与待采集清单各自按页独立读取当时版本，切换来源或范围重置相应分页，移除末页最后一项后回到有效页。多个数据块允许短暂处于不同版本，不能据此报错或循环重载全页。

## 3. 数据块状态

| 情况 | 展示 | 恢复 |
| --- | --- | --- |
| 第一次读取，没有成功数据 | 块内部 skeleton，保留页面主标题和筛选容器 | 本块响应结束后进入数据、空态或错误态 |
| 已有数据，正在重新读取 | 保持内容和滚动位置，局部加载标记 | 成功后替换本 key 的数据 |
| 已有数据，读取失败 | 保留上次数据与原始采集时间，块内短错误提示 | 本块 Retry；不重置其他块 |
| 查询成功，筛选无结果 | 筛选空态，提供清除筛选 | 不提示服务故障，不生成示例 PR |
| 仓库配置存在但从未采集 | 说明尚未发现 PR，提供 Discover PRs | 点击只提交发现任务，Collector 离线时显示排队状态 |
| Collector 离线或 Azure 登录过期 | PR 继续可读，连接块说明采集停滞 | 采集恢复后下一次缓存读取看到新数据 |
| 详情缓存中找不到 PR | 局部“未找到已缓存 PR”，可返回列表或打开源链接 | 仓库身份已知的完整引用可显式加入观察；仅有配置、身份未解析时先提供 Discover PRs |
| 详情首次读取失败 | 保留服务错误与详情面板，不冒充 `CACHE_MISS` | `Retry PR details` 只重读详情，不触发发现或清空 PR 列表 |
| Sample / Live 或筛选切换 | 新 key 的缓存或 skeleton | 旧 key 的迟到响应不能写入新块 |

空态、错误态遵循 Basalt 的公共 `EmptyState`、`LayerCard` 和页面模板。ContentIsland 负责页面 padding；无内边距卡片内由 EmptyState 提供留白；图表和小模块使用 compact 空态。页面错误区明确保留上次成功数据；详情错误放在详情面板内。

## 4. 多选与观察操作

- PR 表格增加行选择框，表头只选择当前页可操作的行，不隐含“选中全部搜索结果”。选中后显示紧凑的 `Add to watch list` / `Remove from watch list` 批量操作及数量。
- 勾选是临时选择，点击 Watch 才写入观察列表。正在观察的 PR 有明确标记；提供“全部 / 监控中 / 未监控”的筛选，PR 详情提供同样的单项操作。
- 翻页、切换筛选或来源时清空临时选择，避免对不可见 PR 执行批量操作；已保存的观察列表保持不变，不存到 localStorage。
- 当前页 20 条的限制只属于显示。观察列表可以包含多个页面、多个项目，以及由 CLI 添加但尚未返回首次快照的 PR。
- 待采集清单拥有独立分页；其首屏错误仍显示该块，同一页的后续错误保留最后成功结果；切换到下一页后首次读取失败，仍保留 Previous，可返回上一页，未知总数不显示为 0 或错误的页数。PR 主表也遵循这一规则。重试只读取待采集清单，逐项移除仍携带 observation generation。
- 已确认 merged / closed 的记录仍可选择用来停止已有观察，但不允许重新加入，直到成功发现其再次开放。Draft 只由默认筛选隐藏，显式选中时可以观察。
- 添加成功回执包含观察身份与首个 job ID，随后显示观察中 / 等待首次刷新并跟踪该任务。重复添加返回现有未结束 job 或 null，不新建任务；网络失败保留原状态，重试由服务端幂等处理。点击移除后取消后续刷新并保留当前 PR 内容，逐项错误显示在批量操作附近；成功项与失败项分开反馈。
- 自动淘汰后显示 `Stopped · Merged` 或 `Stopped · Closed`，保留终态、最后同步时间和源链接；不把它当成用户丢失了记录。
- 页面隐藏、关闭、翻页和其他客户端查询不修改观察列表。不同客户端操作同一 PR 的最终状态通过观察接口重读收敛。

项目页没有自动发现或暂停监控开关，持久清单决定检查目标。删除项目或移除仓库范围会停止相关观察，界面显示 `Project deleted` / `Scope changed`；与单纯停止观察保留 PR 的动作区分，继续使用项目删除原有的数据影响说明。

## 5. 请求与命令生命周期

- 每个 key 同时最多一个自动读取请求；下一次轮询从本次响应结束后计时。组件卸载和 key 变化取消请求，同时以实例生命周期和取消信号拒绝迟到结果。
- 网络错误使用有上限的重试退避；手动 Retry 只重试读取。用户选择的筛选和未保存草稿独立于查询缓存。
- `Refresh watched` 只提交观察项的状态刷新，`Discover PRs` 只发现仓库列表；收到回执就结束提交态。后续采集进度由任务块呈现，重复点击由服务端去重。
- 采集成功只使相关 PR / 仓库块下次读取新版本，不触发 Directory 重载或 Insights 重算。
- 初次打开、翻页和筛选都只读缓存，不再发送 `usePageCollection` 的页面范围 / 可见性心跳。移除这个隐式采集入口。
- 添加使用本地可解析的规范引用，不等待 provider；不同页面和 CLI 添加同一 PR 是幂等操作。删除使用查询取得的 observation ID / generation，迟到的删除不能移除后来重新添加的一代，也不自动重试冲突。

轮询频率由 [17](17-query-cadence.md) 统一定义。读取频率不改变后台 ADO 拉取周期，前台也不因为一个 GET 失败就开始真实采集。

## 6. 保留的产品行为

- 全局 Live / Sample、Organization → Project → Repository、默认不含 Draft、作者多选、localStorage 筛选，以及 URL 明确参数优先。
- Sample 发现能力来自 Collector 查询的 `sampleCommandsEnabled`，由服务端本地 demo 配置判定，与网页是否为开发构建无关。
- PR 页默认 20 条，表头排序；项目自定义全部 merge requirements 的次序与颜色，最就绪在前；无 PoP 内置特例。
- 共享领域规则决定网页和 CLI 的 readiness。未知检查、SHA 变化与 partial 不得产生假的“可合并”。
- PR 编号、源 PR、组织、项目、仓库和 build 外链；Markdown 描述；姓名头像。
- `PR updated` 是源 PR 时间，`Synced` 和 `Checks synced` 是各自采集时间，按分钟更新显示。
- Repos / Insights 的独立 Refresh、24 小时黄 / 72 小时红以及默认排除 Draft；后台采集不自动重算统计。

## 7. 验证入口

- `useQueryBlock.test.tsx`：完成后轮询、可见性、取消、并发 Reload 合并、失败退避和来源切换。
- `useWorkbenchViewModel.test.tsx`：页面选择、逐项成功 / 失败、代次保护、来源隔离和零隐式采集。
- `monitoringApi.test.ts`：公共 DTO、分页、命令载荷和 pending 范围。
- `useContributionModule.test.tsx`：统计只在明确刷新时计算。
- `tests/e2e/monitoring.spec.ts`：浏览器与真实 CLI 共用 Wrangler D1，覆盖批量选择、Draft、来源切换、旧页面删除冲突、21 个待采集项的翻页移除、局部错误重试、构建后 Sample 发现和慢速认证后的终态发布。
