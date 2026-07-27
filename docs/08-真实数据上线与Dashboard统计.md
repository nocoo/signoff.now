# 08 — 真实数据上线与 Dashboard 统计

> 状态：设计稿（待 Codex review）
> 依赖：[01](./01-项目定位.md) §6.4 展示要求、[03](./03-Web模块模板.md) MVVM 与 basalt、[06](./06-Activity重建与Score算法.md) 只读 API、[07](./07-CLI命令矩阵与ADO落盘.md) 采集链路
> 范围：把 07 采到的**真实 ADO 数据**推到远端 D1，并让 Web Dashboard 展示可用的统计

## 边界一句话

**08 只做「让真实数据在生产环境里被看见」；采集规则、计分算法、Ingest 协议一律不动。**

- ✅ 08 做：远端上线流程、Dashboard 统计 API 与视图、运维手册、真实数据验收
- ❌ 08 不做：改 Activity type / 权重 / external_ref / 表结构 / 采集规则
- ⚠️ 08 **确实新增两个索引**（`0007`，纯 `CREATE INDEX`，不动任何列）：
  见 §3.5。这是对「不改 schema」边界的一处显式豁免，理由是没有它们
  按 type 聚合会全表扫描。

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
1) 远端 apply 0007（索引）
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
| `daily[].dayKey` | 设置时区下的自然日；**缺失日必须补 0**，否则 CSS 条形序列会把空闲日折叠掉，看起来像连续活跃 |
| `topDevelopers` | 固定 N=10，排序 `score DESC, developer_id ASC`（第二键保证并列时稳定） |
| `byType` | 基数**不设上限**：`activities.type` 是开放字符串（02 §6.5），一期不裁剪 |
| `lastIngestAt` | 当前 `config_version` 下 `status='finalized'` 的 `MAX(finished_at)`。失败或半途的 run **不算**，否则界面会显示「已采集」而实际没有 |

**默认窗口用设置时区算**（01 §4.7），不是浏览器时区也不是 UTC ——
否则「最近 28 天」在不同人机器上边界不同。

**stale 响应形状**（冻结）：`totals` 全 0、`byType`/`topDevelopers`/`daily` 为空数组、
`lastIngestAt` 照常返回（它是运维元数据，不是统计），语句 2–7 一条都不执行。

- 所有查询绑定当前 `config_version`，与 `activity.ts` 同样处理。
- 只读：08 不新增任何写接口。

### 3.3 D1 查询预算

Worker 每次调用有 statement 上限（05 §5.2）。本接口 **stale 时 1 条**（只跑
`loadSettings` 就返回），**正常时 7 条**：

| # | 用途 |
|:--|:-----|
| 1 | `loadSettings`（版本 + stale） |
| 2 | `scores` 窗口聚合 → totals + activeDevelopers |
| 3 | `scores` 按 day_key 分组 → daily |
| 4 | `activities` 按 type 分组 → `byType.count`（原始事件数） |
| 5 | `scores` + `json_each(breakdown_json)` → `byType.score`（折叠后得分） |
| 6 | `scores` join `developers` 取 top N（N=10，按 score DESC, developer_id ASC）→ topDevelopers |
| 7 | `ingest_runs` 取 `MAX(finished_at)` where `status='finalized'` → lastIngestAt |

跨度上限 92 天让第 3 条的返回行数可控（≤92 行）。7 条远低于 Paid 上限。

**快照一致性**：业务聚合（2–7）放进一次 `DB.batch`，避免各条查询看到不同的
ingest 中间态。若无法同批，返回前重读一次 `config_version` 与 `scores_stale`
并比对；不一致则按 stale 处理。

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

### 3.5 Migration 0007（新增索引）

`EXPLAIN QUERY PLAN` 实测：按 type 聚合会选中 `idx_activities_config_version`，
然后**扫遍该版本全部行**再过滤日期。0006 只恢复了 `day_key` / `type` /
`config_version` 三个**独立**索引，没有复合索引。

```sql
-- 支撑 byType.count：先按版本+日窗收敛，再按 type 分组
CREATE INDEX idx_activities_config_day_type
  ON activities (config_version, day_key, type);

-- 支撑 lastIngestAt
CREATE INDEX idx_ingest_runs_config_status_finished
  ON ingest_runs (config_version, status, finished_at DESC);
```

score 侧已有 `idx_scores_config_day_dev(config_version, day_key, developer_id)`
（0003），totals / daily / topDevelopers 都走它的范围扫描，无需新增。

0007 是**纯增量索引**：无守卫、无重建、可在有数据的库上直接 apply。

### 3.4 Web 侧

| 层 | 文件 | 职责 |
|:---|:---|:---|
| Model | `models/stats.ts` | DTO + zod parse + 派生（占比、空态判定） |
| API | `models/statsApi.ts` | `fetchSummary(from, to)` |
| ViewModel | `viewmodels/useDashboardViewModel.ts` | 窗口状态、加载、错误、stale 横幅 |
| View | `views/DashboardPage.tsx` | 纯展示 |

**这也顺带补上 03 §4.1 的欠账**：Dashboard 目前把 fetch 与派生逻辑写在
View 里，逃出了覆盖率门禁。08 把它改成三层，逻辑落到 Model/ViewModel。

展示元素（basalt token，见 03 §5）：

1. **窗口选择**：最近 7 / 28 / 92 天。
2. **StatCard ×3**：活动总数、总分、活跃开发者数。
3. **每日趋势**：复用 `--heatmap-*` 色阶的条形序列。一期不引入图表库——
   01 §8 提到 Recharts，但为一个条形图增加依赖不划算，先用 CSS 高度。
4. **按类型分布**：type / 次数 / 得分，占比条用 `--chart-*`。
5. **Top 开发者**：姓名 + 得分 + 活动数，点击跳 Activity 页并带上该开发者。
6. **stale 横幅**：与 Activity 页同一措辞。
7. **空态**：区分「窗口内无数据」与「从未采集过」，后者给出
   `signoff collect` 的下一步提示。

---

## 4. 运维手册（写进 README）

```bash
# 一次增量采集
bun run signoff -- doctor
bun run signoff -- collect --repo <repoId>
bun run signoff -- ingest normalized <artifact> --manifest <manifest>

# 配置变更后的全量重算
bun run signoff -- collect --full
bun run signoff -- ingest normalized <artifact> --manifest <manifest>
```

**单写者**：同一时刻只跑一个 ingest（06 §5.7）。手册须显式写明。

---

## 5. 验收标准

07 的验收是「能采」，08 的验收是「**看得见且可信**」。

### 5.1 清单

- [ ] 远端 apply 0007，`wrangler d1 migrations list` 无待应用项
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
- [ ] `bun run security` 通过

### 5.2 对账 SQL（逐字段，非只看页面）

页面可能在展示缓存、空数组或错误态，所以每个数字都要有对应的直查。
`?v` = 当前 `pipeline_config_version`，`?from`/`?to` = 页面窗口。

```sql
-- totals
SELECT SUM(total) AS score, SUM(activity_count) AS activities,
       COUNT(DISTINCT CASE WHEN activity_count > 0 THEN developer_id END) AS activeDevelopers
FROM scores WHERE config_version = ?v AND day_key BETWEEN ?from AND ?to;

-- daily
SELECT day_key, SUM(total) AS score, SUM(activity_count) AS activityCount
FROM scores WHERE config_version = ?v AND day_key BETWEEN ?from AND ?to
GROUP BY day_key ORDER BY day_key;

-- byType.count（原始事件）
SELECT type, COUNT(*) AS count FROM activities
WHERE config_version = ?v AND day_key BETWEEN ?from AND ?to GROUP BY type;

-- byType.score（折叠后得分）
SELECT j.key AS type, SUM(CAST(j.value AS INTEGER)) AS score
FROM scores s, json_each(s.breakdown_json) j
WHERE s.config_version = ?v AND s.day_key BETWEEN ?from AND ?to GROUP BY j.key;

-- topDevelopers
SELECT developer_id, SUM(total) AS score, SUM(activity_count) AS activityCount
FROM scores WHERE config_version = ?v AND day_key BETWEEN ?from AND ?to
GROUP BY developer_id ORDER BY score DESC, developer_id ASC LIMIT 10;

-- lastIngestAt
SELECT MAX(finished_at) FROM ingest_runs
WHERE config_version = ?v AND status = 'finalized';
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
| **P0** | migration 0007（两个索引） | 本地 + 远端 apply，`EXPLAIN QUERY PLAN` 命中新索引 |
| **P1** | `GET /api/stats/summary` + Worker 测试 | 真实 SQLite 集成测试，含 stale 分支与 §5.3 不变量 |
| **P2** | Web Model + ViewModel（含 zod parse、补零、派生） | statements/branches/functions/lines 均 ≥95% |
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
