# 08 — 真实数据上线与 Dashboard 统计

> 状态：设计稿（待 Codex review）
> 依赖：[01](./01-项目定位.md) §6.4 展示要求、[03](./03-Web模块模板.md) MVVM 与 basalt、[06](./06-Activity重建与Score算法.md) 只读 API、[07](./07-CLI命令矩阵与ADO落盘.md) 采集链路
> 范围：把 07 采到的**真实 ADO 数据**推到远端 D1，并让 Web Dashboard 展示可用的统计

## 边界一句话

**08 只做「让真实数据在生产环境里被看见」；采集规则、计分算法、Ingest 协议一律不动。**

- ✅ 08 做：远端上线流程、Dashboard 统计 API 与视图、运维手册、真实数据验收
- ❌ 08 不做：改 Activity type / 权重 / external_ref / 表结构 / 采集规则
- ⚠️ 08 **确实新增两个索引**（`0007`，纯 `CREATE INDEX`，不动任何列；
  `0008` 只重建其中一个的定义）：见 §3.5。这是对「不改 schema」边界的一处
  显式豁免，理由是没有它们按 type 聚合会全表扫描。

---

## 1. 为什么需要这份文档

07 结束时，链路在**本地**是通的：CLI 能采、能落盘、能写本地 D1，Activity 页能读回。
但离「管理者打开网页看到团队数据」还差三件事：

| 缺口 | 后果 |
|:---|:---|
| 远端未部署新 Worker | 线上 `/api/pipeline/ingest` 仍是旧代码 |
| 无人跑过真实采集 | 所有验证都基于 fixture 或本地库 |
| Dashboard 只有实体计数 | 打开首页看不到任何活跃度信息 |

08 把这三件事做完，并留下可重复的运维步骤。

---

## 2. 上线顺序（硬约束）

沿用 06 §9.1 的原则：**schema 先行，代码其次，数据最后**。

```
1) 远端 apply 0007 + 0008（索引）
2) Worker + SPA deploy
3) 核对生产 Settings：邮箱后缀不能还是默认的 example.com、
   时区是否正确、权重是否是想要的       ← 见下方警告
4) 本机 smoke：doctor 全绿 → collect --dry-run
5) 灰度：collect --repo <一个仓> --since <近期>
6) 检查 manifest：scope 必须 pending 且 errors 为空
7) ingest normalized → 游标推进 → 页面能看到这一个仓的数字
8) 全量基线：对**每个启用的 repo/project** 跑一遍采集与 ingest
9) 才可以把 Dashboard 当作团队全貌对外
```

**第 3 步不能省**。02 §3.1 的种子后缀是 `example.com`，没改过的话
`matchDeveloper` 会匹配不到任何真人，采集「成功」但一条 Activity 都不产。

**第 8 步不能省**。灰度只证明链路通，不代表数据全。在只采了一个仓的库上
展示「团队活跃度」，比不展示更糟 —— 管理者会据此判断人。

**若第 3 步改了 Settings**：版本会 bump 并置 `scores_stale`（04 §3.2），
此时必须走 `collect --full` 全量重算，增量 ingest **清不掉** stale。

**禁止**跳过第 5 步。manifest 里出现 `incomplete` 就说明采集有缺口，
此时 ingest 会被拒绝（07 §7.1.2），但更重要的是**不要靠重试掩盖**——
先看 `errors` 里的原因。

### 2.1 回滚

数据层无「回滚」概念：Activity 按 `external_ref` 幂等，重跑同窗口不会重复计分。
真正需要撤销时的手段只有两种：

- **配置错**（权重 / 后缀 / 时区）→ 改 Settings，版本自动 bump，
  按 04 §3.2 触发 `full_rematch`，用 `collect --full` 重采重算。
- **代码错**（transform 规则有 bug）→ 修代码后同样走 `--full`。

因为 raw 快照不可覆盖（07 §4），**任何历史窗口都能重新复算**，这是回滚的真正保障。

---

## 3. Dashboard 统计

### 3.1 现状与目标

现状：Dashboard 只显示 Developer / Team / Tag / Repo 的**计数**，以及
`pipelineConfigVersion` 与 `scoresStale`。真实数据进来后，这一页应该回答
管理者的第一个问题：**「最近团队在干什么？」**

一期只做**汇总**，不做下钻——下钻是 Activity 页的职责（01 §6.4）。

### 3.2 新增 API：`GET /api/stats/summary`

| 参数 | 说明 |
|:---|:---|
| `from` / `to` | `YYYY-MM-DD`，闭区间，跨度 ≤92 天（默认最近 28 天） |

响应：

```json
{
  "pipelineConfigVersion": 1,
  "scoresStale": false,
  "staleReason": null,
  "window": { "from": "2026-06-29", "to": "2026-07-26" },
  "totals": { "activities": 1234, "score": 5678, "activeDevelopers": 12 },
  "byType": [{ "type": "pr.merged", "count": 88, "score": 880 }],
  "topDevelopers": [{ "developerId": "01K…", "name": "Ada", "score": 420, "activityCount": 61 }],
  "daily": [{ "dayKey": "2026-07-26", "score": 120, "activityCount": 18 }],
  "lastIngestAt": 1784737800
}
```

**鉴权**：与 `/api/activity/*` 完全一致 —— 走 Access 的管理读路径，
**不是**公开接口，也不接受 pipeline token（06 §7.1、03 §8）。

**字段语义**（不定义清楚就会被各自解读）：

| 字段 | 定义 |
|:---|:---|
| `totals.activities` | 窗口内 `SUM(scores.activity_count)`，**原始事件数**（折叠前） |
| `totals.score` | 窗口内 `SUM(scores.total)`，**折叠后得分** |
| `totals.activeDevelopers` | 窗口内 `activity_count > 0` 的 distinct 开发者数（**不是**得分 >0，全 0 权重配置下仍算活跃） |
| `daily[].dayKey` | 设置时区下的自然日；API **只返回有数据的天**，补 0 由 ViewModel 负责（见 §3.3） |
| `topDevelopers` | 固定 N=10，排序 `score DESC, developer_id ASC`（第二键保证并列时稳定） |
| `byType` | D1 列是开放字符串（02 §6.5），但 ingest 只接受 `ACTIVITY_TYPES` 的 8 种，故实际基数 ≤8 |
| `lastIngestAt` | 当前 `config_version` 下 `status='finalized'` 的 `MAX(finished_at)`。失败或半途的 run **不算**，否则界面会显示「已采集」而实际没有 |

**默认窗口用设置时区算**（01 §4.7），不是浏览器时区也不是 UTC ——
否则「最近 28 天」在不同人机器上边界不同。

**stale 响应形状**（冻结）：`totals` 全 0、`byType`/`topDevelopers`/`daily` 为空数组、
`lastIngestAt` 照常返回（它是运维元数据，不是统计）。聚合语句一条都不执行 ——
所以 stale 路径是 **2 条**（settings + lastIngestAt），不是 1 条。

- 所有查询绑定当前 `config_version`，与 `activity.ts` 同样处理。
- 只读：08 不新增任何写接口。

### 3.3 D1 查询预算

Worker 每次调用有 statement 上限（05 §5.2）。本接口 **stale 时 2 条**
（`loadSettings` + `lastIngestAt`，见 §3.2 的语义说明），**正常时 9 条**：

| # | 用途 |
|:--|:-----|
| 1 | `loadSettings`（版本 + stale） |
| 2 | `scores` 窗口聚合 → totals + activeDevelopers |
| 3 | `scores` 按 day_key 分组 → daily |
| 4 | `activities` 按 type 分组 → `byType.count`（原始事件数） |
| 5 | `scores` + `json_each(breakdown_json)` → `byType.score`（折叠后得分） |
| 6 | `scores` join `developers` 取 top N（N=10，按 score DESC, developer_id ASC）→ topDevelopers |
| 7 | `ingest_runs` 取 `MAX(finished_at)` where `status='finalized'` → lastIngestAt |
| 8 | `ingest_chunks` join `ingest_runs` 计 `status='prepared'` → **是否有 chunk 半写入**（见下） |
| 9 | batch 之后再次 `loadSettings` → 检测聚合期间配置漂移 |

第 2–8 条在一次 `DB.batch` 内；第 1、9 条是 batch 前后各一次单独读取。
**第 9 条只在守卫未触发时执行**：守卫命中就直接返回，所以那条路径是 **8 条**。
完整计数因此是：窗口非法 1 条、settings 已 stale 2 条、守卫命中 8 条、
正常/配置漂移 9 条。跨度上限 92 天让第 3 条的返回行数可控（≤92 行）。
9 条远低于 Paid 上限。

**快照一致性**：业务聚合放进一次 `DB.batch`，让它们看到同一个快照。

但同批**不足以**保证数字自洽。ingest 的写入路径把 Activity（Phase 1）和
Score（Phase 3）提交在**两个不同的 batch** 里（`pipeline-ingest-write.ts`），
所以落在两者之间的快照会看到「活动已入库、分数还没算」：
`byType.count` 读 `activities`、`totals.activities` 读 `scores`，两者会对不上。

重读 `config_version` / `scores_stale` **检测不到**这种情况 —— 增量 ingest
期间这两个值都不变。因此在**同一批**里查一次

```sql
SELECT COUNT(*) AS inFlight, MIN(r.id) AS runId
FROM ingest_chunks c JOIN ingest_runs r ON r.id = c.run_id
WHERE c.status = 'prepared' AND r.config_version = ?
  AND (
    EXISTS (
      SELECT 1 FROM json_each(c.dev_day_union_json) d
      WHERE json_valid(d.value)
        AND json_extract(d.value, '$.dayKey') BETWEEN :from AND :to
    )
    OR json_type(c.dev_day_union_json) <> 'array'
    OR EXISTS (
      SELECT 1 FROM json_each(c.dev_day_union_json) d
      WHERE NOT json_valid(d.value)
         OR json_extract(d.value, '$.dayKey') IS NULL
    )
  )
```

只要有 chunk 处于 `prepared`，就按 stale 返回并给出
`staleReason: "an ingest is in progress; numbers are still settling (run <id>)"`。
宁可说「还在算」，也不要给出两个互相矛盾的数字。

**必须盯 chunk，不能盯 run**。三个理由：

1. run 在**整个生命周期**里都是 `chunked`，盯它会让一次多 chunk 的 ingest
   全程遮蔽 Dashboard，而不只是不一致的那个窗口；
2. 若某个 run 被遗弃，盯 run 会让 Dashboard **永久**空白且无恢复路径 ——
   「还在算」和「产品坏了」在用户眼里不可区分，比原来的竞态更糟；
3. 被标为 `failed` 的 run 仍可能留下 `prepared` chunk，而写入路径
   （`pipeline-ingest-write.ts`，同 digest 重试直接跳到 score 阶段）
   允许 CLI 续跑它 —— 那份数据是真实的半写入，盯 run 会漏掉。

`prepared` 是**可恢复**状态，不是终态：CLI 重发同一 chunk 即可完成 Phase 3，
守卫随之解除。`runId` 写进 `staleReason` 是因为这个状态可能比造成它的那次
ingest 活得更久 —— 没有 id 就没人知道该去续跑或放弃哪个 run。

**按「实际影响的天」收窄，不是按声明的窗口**。一次卡住的 7 月 ingest 对
1 月的数字不构成任何证据，把所有窗口一起遮蔽会让「一个 run 卡住」
看起来像「产品坏了」。但收窄的依据必须是 `dev_day_union_json`
（写入路径为自己的 resume 存的那份），**不能**是 `run_meta.windowFrom/To`：

- CLI 的 watermark 按 **UTC** 切片，而 `day_key` 按**设置时区**算。
  默认 `Asia/Shanghai` 下，一条 `20:00Z` 的活动落在**次日** ——
  已经越过它自己声明的 `windowTo`。这不是恶意客户端，是出厂配置下的正常行为。
- `full_rematch` 的 `oldDevDays` 从既有行按 `external_ref` 反查 `day_key`，
  那些日期可以是任意历史值。

按声明收窄就会把这些半写入的天当作已结算公布出去。按 union 收窄不会 ——
它就是 resume 路径重算分数时用的同一份列表。

**空 union 不遮蔽任何窗口**：采集端**有意**产出零活动 artifact 来承载
`unmatched` / `skipped`（`writeArtifacts`），且 `activities` 没有下限，
所以 `[]` 是合法的 —— 这种 chunk 一天的分数都没碰，不可能与任何数字矛盾。

真正要拦的是**读不懂**的 union：非数组（`json_type <> 'array'`），
或**任意一条**条目读不出 `dayKey`。判据是「存在任何坏条目」而**不是**
「全部都坏」—— 后者会让一条好条目替它损坏的兄弟洗白：
`[{"dayKey":"1999-01-01"},"bad"]` 会照常公布 7 月，
而那条读不出的很可能**就是**半写入的 7 月那天。

`json_valid(d.value)` 不可省：`json_extract` 对标量条目会抛
"malformed JSON"，那会变成 500 错误页 —— 本意是「暂缓显示」。

**`finalize` 必须拒绝跨过 `prepared` chunk**（`finalizeRun`）。
否则会形成单向门：`processIngestChunk` 对 finalized 的 run 在**到达**
prepared-resume 分支**之前**就返回 `Run already finalized`，
于是那个 chunk 永远无法完成 —— 活动已入库、分数永远算不出来、
守卫永远解除不了，且除了手改 D1 没有任何出路。
现在 finalize 会带上「chunk N 仍是 prepared，请先重发」拒绝。

**零填充归属**：`daily` 的缺失日由 **Web ViewModel** 补 0，API 只返回有数据的
天。API 不做是因为窗口边界属于展示决策；ViewModel 必须做，否则 CSS 条形序列
会把空闲日折叠掉，看起来像连续活跃。

> **byType 的两个字段来自两张表，这不是冗余**：
>
> - `byType.count` = **原始事件数**，来自 `activities`。它回答「发生了多少次」，
>   与 `scores.activity_count` 同口径（06 §3.1 D5：折叠**前**计数）。
> - `byType.score` = **折叠后得分**，来自 `SUM(json_each(scores.breakdown_json))`。
>
> **不能用 `COUNT(activities) × weight` 算得分**。06 §3.1 定义了四类折叠/压制：
> 同日同 PR 的 `pr.active` 折为一次、同日同 WI 的 `wi.updated` 折为一次、
> 作者侧终态优先（`merged` 压制 `created`/`active`）、`merged` 与 `closed` 互斥。
> 逐条乘权重会把这些**全部重新计入**，得出比 `totals.score` 大的数字 ——
> 管理者会看到 Dashboard 与热力图对不上。
>
> 反过来 `breakdown_json` 是安全的：每行是一个 `(developer_id, day_key)`，
> 彼此不相交，跨天求和不会重复计入任何已折叠事件。
>
> **不变量**：`SUM(byType.score) === totals.score`，`SUM(byType.count) === totals.activities`。

### 3.4 Web 侧

| 层 | 文件 | 职责 |
|:---|:---|:---|
| Model | `models/stats.ts` | DTO + **手写严格解析** + 派生（占比、空态判定、heatmap 档位） |
| API | `models/statsApi.ts` | `fetchSummary(from, to)` |
| ViewModel | `viewmodels/useDashboardViewModel.ts` | 窗口状态、加载、错误、stale 横幅 |
| View | `views/DashboardPage.tsx` | 纯展示 |

**这也顺带补上 03 §4.1 的欠账**：Dashboard 目前把 fetch 与派生逻辑写在
View 里，逃出了覆盖率门禁。08 把它改成三层，逻辑落到 Model/ViewModel。

展示元素（basalt token，见 03 §5）：

1. **窗口选择**：最近 7 / 28 / 92 天。
2. **StatCard ×3**：活动总数、总分、活跃开发者数。
3. **每日趋势**：复用 `--heatmap-*` 色阶的条形序列。
4. **按类型分布**：type / 次数 / 得分，占比条用 `--chart-*`。
5. **Top 开发者**：姓名 + 得分 + 活动数，点击跳 Activity 页并带上该开发者。
6. **stale 横幅**：与 Activity 页同一措辞，正文直接渲染 `staleReason`。
7. **空态**：区分「窗口内无数据」与「从未采集过」，后者给出
   `signoff collect` 的下一步提示。

**`staleReason` 是不透明展示文本**：View 与 ViewModel 一律**不得**对它做
字符串判断来分支。in-flight 守卫复用了 stale 的响应形状但换了措辞，
这组理由今后还会增加；要分支就加结构化字段，不要 match 文案。

**Recharts 例外（记在这里，不改 01 §8）**：01 §8 把 Recharts 定为项目默认
图表库，这条**不因本页而更改**。08 的每日趋势与占比条用 CSS 高度实现，
是一处**局部豁免**：两者都是单序列条形，为它们引入图表库不划算。
一旦 Dashboard 需要多序列、坐标轴或交互式 tooltip，就按 01 §8 引入 Recharts，
而不是继续堆 CSS。

### 3.5 Migration 0007 / 0008（索引）

`EXPLAIN QUERY PLAN` 实测：按 type 聚合会选中 `idx_activities_config_version`，
然后**扫遍该版本全部行**再过滤日期。0006 只恢复了 `day_key` / `type` /
`config_version` 三个**独立**索引，没有复合索引。

```sql
-- 支撑 byType.count：先按版本+日窗收敛，再按 type 分组
CREATE INDEX idx_activities_config_day_type
  ON activities (config_version, day_key, type);

-- 支撑 lastIngestAt（0007 原样，含 DESC；0008 把它改回升序）
CREATE INDEX idx_ingest_runs_config_status_finished
  ON ingest_runs (config_version, status, finished_at DESC);
```

score 侧已有 `idx_scores_config_day_dev(config_version, day_key, developer_id)`
（0003），totals / daily / topDevelopers 都走它的范围扫描，无需新增。

0007 是**纯增量索引**：无守卫、无重建、可在有数据的库上直接 apply。
0008 只把 `finished_at DESC` 改回 `finished_at`（对 `MAX()` 无差别，SQLite
会反向扫升序索引）—— 0007 已经在远端跑过，直接改它会让迁移历史与实际不符，
所以补一个新迁移而不是改旧的。

> **本文档一度自相矛盾过**：`a23ecc6` 在 0007 里删掉了 `IF NOT EXISTS`，
> 同一个 commit 却加注释说「本文件保持应用时原样」。已由 `f20f633` 按
> `0416f4c` 的字节恢复。教训是「不改已应用的迁移」这条规则对**注释之外的
> 每一个字节**同样成立 —— 一个自称未被修改的文件，比一个诚实记录了修改的
> 文件更危险。

---

## 4. 运维手册（已写进 [README](../README.md#运维手册)）

> 本节是**规格**，README 是**交付物**。两者内容必须一致；
> 改这里就要同步改 README，否则运维读到的是过期版本。

```bash
# 一次增量采集
bun run signoff -- doctor
bun run signoff -- collect --repo <repoId>
bun run signoff -- ingest normalized <artifact> --manifest <manifest>

# 配置变更后的全量重算
bun run signoff -- collect --full
bun run signoff -- ingest normalized <artifact> --manifest <manifest>
```

README 的手册比这里多两节，都是实测/复审后补的：
**卡住的 ingest 如何恢复**（重发同一 chunk）与**生产 Access 配置**
（未配时受保护接口 fail-closed 返回 500，属预期而非故障；
      `/api/live` 与 pipeline 机器端点走各自鉴权，不受影响）。

**单写者**：同一时刻只跑一个 ingest（06 §5.7）。手册已显式写明。

---

## 5. 验收标准

07 的验收是「能采」，08 的验收是「**看得见且可信**」。

### 5.1 清单

> **本地已全链路验收通过**（真实 ADO 仓 `domoreexp/Teamspace/workshop-v7`）：
> `collect` → 50 条 Activity → `ingest normalized` → 5 chunk 入库 → 游标推进 →
> `recompute/complete` 清 stale → Dashboard 与热力图数字一致（均为 26）。
> §5.3 五条不变量全部成立（其中含跨端点一致那条）；浏览器渲染 28 天零填充、4 天有色、无控制台错误。
> 采集过程中真实数据验证了：服务主体身份按 `non_email` 丢弃、未建档真人计入
> `unmatched`、增量 ingest 清不掉 stale、部分完成的 rematch 拒绝清除全局标志。
>
> **下面的清单仍是「生产」的**，本地通过不等于线上通过。

- [ ] 远端 apply 0007 + 0008，`wrangler d1 migrations list` 无待应用项
- [ ] Worker + SPA 部署完成
- [ ] 生产 Settings 已核对（后缀非 `example.com`、时区、权重）
- [ ] 灰度单仓 `collect` → `ingest normalized`，游标推进
- [ ] **每个启用 scope** 都完成一次基线采集
- [ ] 远端 `activities` / `scores` 有真实行，`external_ref` 无重复
- [ ] §5.2 的每条对账 SQL 与页面一致
- [ ] §5.3 的交叉不变量全部成立
- [ ] `scoresStale=true` 时页面显示横幅且不显示可疑数字
- [ ] 覆盖率门禁通过：Web 非 View 与 Worker 的
      **statements / branches / functions / lines 均 ≥95%**（01 §9、03 §6）
- [ ] **生产 Access 已配置**：`CF_ACCESS_TEAM_DOMAIN` + `CF_ACCESS_AUD`。
      未配置时 Worker 对 `/api/*` 返回 500（fail-closed，03 §8），
      页面会全线报错 —— 这是预期行为，不是故障。
- [ ] `bun run security` 通过

### 5.2 对账 SQL（逐字段，非只看页面）

页面可能在展示缓存、空数组或错误态，所以每个数字都要有对应的直查。
下面的语句已经写死示例值（`config_version = 1`、窗口 `2026-07-01`~`2026-07-26`），
换成实际值再执行 —— `wrangler d1 execute --command` 不接受命名参数。
`COALESCE` 不能省：空窗口下 `SUM()` 返回 `NULL`，而 API 返回 0，
不加会看起来像对不上。

```sql
-- totals
SELECT COALESCE(SUM(total),0) AS score, COALESCE(SUM(activity_count),0) AS activities,
       COUNT(DISTINCT CASE WHEN activity_count > 0 THEN developer_id END) AS activeDevelopers
FROM scores WHERE config_version = 1 AND day_key BETWEEN '2026-07-01' AND '2026-07-26';

-- daily
SELECT day_key AS dayKey, COALESCE(SUM(total),0) AS score,
       COALESCE(SUM(activity_count),0) AS activityCount
FROM scores WHERE config_version = 1 AND day_key BETWEEN '2026-07-01' AND '2026-07-26'
GROUP BY day_key ORDER BY day_key;

-- byType.count（原始事件）
SELECT type, COUNT(*) AS count FROM activities
WHERE config_version = 1 AND day_key BETWEEN '2026-07-01' AND '2026-07-26' GROUP BY type;

-- byType.score（折叠后得分）
-- json_each 对数值 JSON 已经返回 integer，无需 CAST；与 stats.ts 逐字一致。
SELECT j.key AS type, COALESCE(SUM(j.value), 0) AS score
FROM scores s, json_each(s.breakdown_json) j
WHERE s.config_version = 1 AND s.day_key BETWEEN '2026-07-01' AND '2026-07-26' GROUP BY j.key;

-- topDevelopers
SELECT s.developer_id, COALESCE(d.name, s.developer_id) AS name,
       COALESCE(SUM(s.total),0) AS score, COALESCE(SUM(s.activity_count),0) AS activityCount
FROM scores s LEFT JOIN developers d ON d.id = s.developer_id WHERE s.config_version = 1 AND s.day_key BETWEEN '2026-07-01' AND '2026-07-26'
GROUP BY s.developer_id ORDER BY score DESC, s.developer_id ASC LIMIT 10;

-- lastIngestAt
SELECT MAX(finished_at) FROM ingest_runs
WHERE config_version = 1 AND status = 'finalized';
```

### 5.3 交叉不变量

单看某个数字对得上还不够 —— 内部自洽才说明聚合口径没走偏：

- `SUM(daily.score) === totals.score`
- `SUM(daily.activityCount) === totals.activities`
- `SUM(byType.score) === totals.score`
- `SUM(byType.count) === totals.activities`
- 同一开发者同一窗口，**Activity 页热力图的分数之和 === Dashboard 该人的分数**

对账期间**暂停 ingest**，或记下比对时的 `config_version` 与时间点 ——
否则数字对不上可能只是因为中途又进了数据。

## 6. 实施切片

| 切片 | 内容 | 验收 |
|:---|:---|:---|
| **P0** | migration 0007 + 0008（两个索引） | 本地 + 远端 apply，`EXPLAIN QUERY PLAN` 命中新索引 |
| **P1** | `GET /api/stats/summary` + Worker 测试 | 真实 SQLite 集成测试，含 stale 分支与 §5.3 不变量 |
| **P2** | Web Model + ViewModel（含严格解析、补零、派生） | statements/branches/functions/lines 均 ≥95% |
| **P3** | DashboardPage 重写为三层 + basalt 视图 | 本地起服务看到真实数字 |
| **P4** | 远端部署 + 灰度 + 全量基线 + 逐条对账 | §5 清单全绿 |

---

## 7. 明确不做

- 不引入图表库（一期 CSS 足够）
- 不做团队 / 标签维度的聚合（二期）
- 不做导出、订阅、定时任务
- 不改 06 的 heatmap / timeline 接口
- 不在 Dashboard 提供任何写操作

---

**文档结束（08 设计稿）**
