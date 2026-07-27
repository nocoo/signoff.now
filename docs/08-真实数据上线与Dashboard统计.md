# 08 — 真实数据上线与 Dashboard 统计

> 状态：设计稿（待 Codex review）
> 依赖：[01](./01-项目定位.md) §6.4 展示要求、[03](./03-Web模块模板.md) MVVM 与 basalt、[06](./06-Activity重建与Score算法.md) 只读 API、[07](./07-CLI命令矩阵与ADO落盘.md) 采集链路
> 范围：把 07 采到的**真实 ADO 数据**推到远端 D1，并让 Web Dashboard 展示可用的统计

## 边界一句话

**08 只做「让真实数据在生产环境里被看见」；采集规则、计分算法、Ingest 协议一律不动。**

- ✅ 08 做：远端上线流程、Dashboard 统计 API 与视图、运维手册、真实数据验收
- ❌ 08 不做：改 Activity type / 权重 / external_ref / D1 schema / 采集规则

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
1) 远端 D1 migration 已是最新        ← 已完成（0006 已 apply）
2) Worker deploy（含 07 期间的改动）
3) 本机 smoke：collect --dry-run → doctor 全绿
4) 单仓真实采集：collect --repo <id> --since <近期>
5) 检查 manifest：scope 必须是 pending 且无 errors
6) ingest normalized → 游标推进
7) Web 打开 Dashboard 与 Activity，核对数字
```

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

**与既有契约一致的地方**（不得偏离）：

- `scoresStale === true` 时**返回空统计**并透传 `staleReason`，与 06 §7.1 的
  heatmap / timeline 行为一致——**宁可空白，不可给出可疑数字**。
- 所有查询绑定当前 `config_version`，与 `activity.ts` 同样处理。
- 只读：08 不新增任何写接口。

### 3.3 D1 查询预算

Worker 每次调用有 statement 上限（05 §5.2）。本接口固定 **5 条**：

| # | 用途 |
|:--|:-----|
| 1 | `loadSettings`（版本 + stale） |
| 2 | `scores` 窗口聚合 → totals + activeDevelopers |
| 3 | `scores` 按 day_key 分组 → daily |
| 4 | `activities` 按 type 分组 → byType（含权重求和） |
| 5 | `scores` join `developers` 取 top N（N=10）→ topDevelopers |

跨度上限 92 天是为了让第 3 条的返回行数可控（≤92 行）。

> **为什么 byType 查 activities 而不是 scores**：`scores.breakdown_json` 是
> 折叠后的每日汇总，跨天求和会重复计入被折叠的事件。逐 type 计数必须从
> `activities` 出发（与 06 §3.3「折叠只在 Score 层」一致）。

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

07 的验收是「能采」，08 的验收是「**看得见且可信**」：

- [ ] 远端 Worker 部署完成，`/api/live` 返回新版本
- [ ] 至少一个真实 repo 完成 `collect` → `ingest normalized`，游标推进
- [ ] 远端 D1 中 `activities` / `scores` 有真实行，`external_ref` 无重复
- [ ] Dashboard 显示非零统计，数字与 D1 直查一致
- [ ] Activity 页热力图对同一开发者显示相同的分数
- [ ] `scoresStale=true` 时 Dashboard 显示横幅且不显示可疑数字
- [ ] 覆盖率门禁通过（新增 Model/ViewModel ≥95%）
- [ ] `bun run security` 通过

**「数字与 D1 直查一致」是核心验收**：用 `wrangler d1 execute --remote`
直接 `SELECT SUM(total)`，与页面显示比对。只看页面不算验证——
页面可能在展示缓存、空数组或错误状态。

---

## 6. 实施切片

| 切片 | 内容 | 验收 |
|:---|:---|:---|
| **P1** | `GET /api/stats/summary` + Worker 测试 | 真实 SQLite 集成测试，含 stale 分支 |
| **P2** | Web Model + ViewModel（含 zod parse 与派生） | 单测 ≥95% |
| **P3** | DashboardPage 重写为三层 + basalt 视图 | 本地起服务看到真实数字 |
| **P4** | 远端部署 + 真实采集 + 逐条验收 | §5 清单全绿 |

---

## 7. 明确不做

- 不引入图表库（一期 CSS 足够）
- 不做团队 / 标签维度的聚合（二期）
- 不做导出、订阅、定时任务
- 不改 06 的 heatmap / timeline 接口
- 不在 Dashboard 提供任何写操作

---

**文档结束（08 设计稿）**
