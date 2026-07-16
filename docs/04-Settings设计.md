# 04 — Settings 设计

> 状态：设计稿（待实现）  
> 依赖：[01-项目定位](./01-项目定位.md)、[02-数据结构与D1](./02-数据结构与D1.md)、[03-Web模块模板](./03-Web模块模板.md)  
> 范围：Settings 的 DB 语义、Web 页面与 CRUD、CLI/管线如何读取 D1 中的 Settings 供采集使用

---

## 1. 目标

Settings 是**单实例全局配置**的唯一来源（Source of Truth 在 **D1 `settings` 表**）。

| 消费者 | 用途 |
|:-------|:-----|
| **Web** | 管理者查看/修改配置；展示 stale 状态；引导触发重算 |
| **CLI / Scripts（本机采集）** | 读取后缀、时区、权重、`pipeline_config_version`，用于匹配、`day_key`、Score 与幂等写入 |
| **全量 rematch/recompute 任务** | 以**当前** Settings 为准重放 raw |

本文不展开 Activity 重建算法细节（见后续计分文档），但定义 **何时必须触发** 以及 Settings API 如何标记 stale。

---

## 2. 概念模型

### 2.1 两类键

| 类别 | 键 | Web 可编辑 | 变更副作用 |
|:-----|:---|:-----------|:-----------|
| **业务配置** | `timezone`、`email_suffixes`、`activity_weights` | ✅ | 见 §5 副作用矩阵 |
| **管线状态** | `pipeline_config_version`、`scores_stale`、`scores_stale_reason` | ❌ 直接编辑（只读展示） | 由 Settings 写入事务 / 管线任务维护 |

### 2.2 聚合视图（应用层 `AppSettings`）

DB 为 KV；应用层组装为强类型对象（Model）：

```ts
interface AppSettings {
  // 业务
  timezone: string;                    // IANA, e.g. "Asia/Shanghai"
  emailSuffixes: string[];             // non-empty, unique, lowercased domain
  activityWeights: Record<string, number>; // keys = activity type

  // 管线状态（只读给 Web 表单主区；状态条单独展示）
  pipelineConfigVersion: number;       // integer ≥ 1
  scoresStale: boolean;
  scoresStaleReason: string | null;

  // 元数据
  updatedAtByKey: Record<string, number>; // unix sec, optional for UI
}
```

**序列化：** 每个 key 的 `settings.value` 是 **JSON 文本**（含 `json_valid` 约束）。  
例如 timezone 存 `"Asia/Shanghai"`（带 JSON 字符串引号），version 存 `1`（JSON number）。

---

## 3. 数据库（D1）

### 3.1 表结构（已有，02 已定）

```sql
-- settings
-- key   TEXT PRIMARY KEY
-- value TEXT NOT NULL CHECK (json_valid(value))
-- updated_at INTEGER NOT NULL
```

无单独 `settings` 宽表；扩展新配置 = **新 key 行** + migration 种子（若需默认值）。

### 3.2 一期键字典

| key | JSON 类型 | 默认 | 校验规则（应用层） |
|:----|:----------|:-----|:-------------------|
| `timezone` | string | `"Asia/Shanghai"` | 非空；建议校验为合法 IANA（库表或 `Intl` 试探） |
| `email_suffixes` | string[] | `["microsoft.com"]` | 长度 ≥1；元素去空格、转小写、不含 `@`；去重 |
| `activity_weights` | object | 见 01 §6.3 | 值必须为有限 number；一期应覆盖全部一期 type 键，允许额外 type |
| `pipeline_config_version` | number | `1` | 整数 ≥1；**仅服务端递增** |
| `scores_stale` | boolean | `false` | |
| `scores_stale_reason` | string \| null | `null` | 短文本，供 UI |

**一期 `activity_weights` 必选键（缺省用默认补齐）：**

```json
{
  "pr.merged": 10,
  "pr.closed": 2,
  "pr.created": 2,
  "pr.vote": 3,
  "pr.active": 2,
  "wi.created": 3,
  "wi.updated": 1,
  "wi.closed": 5
}
```

### 3.3 读写 SQL 模式

**读全部（Web / CLI 组装 AppSettings）：**

```sql
SELECT key, value, updated_at FROM settings;
```

**读单键：**

```sql
SELECT value, updated_at FROM settings WHERE key = ?;
```

**更新业务键（在事务内，见 §5）：**

```sql
UPDATE settings SET value = ?, updated_at = unixepoch() WHERE key = ?;
-- 若不存在则 INSERT（防御）
INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
```

**bump 版本 + stale（同事务）：**

```sql
-- 读出版本 JSON number → +1 → 写回
UPDATE settings SET value = ?, updated_at = unixepoch() WHERE key = 'pipeline_config_version';
UPDATE settings SET value = 'true', updated_at = unixepoch() WHERE key = 'scores_stale';
UPDATE settings SET value = ?, updated_at = unixepoch() WHERE key = 'scores_stale_reason';
```

**管线成功清 stale：**

```sql
UPDATE settings SET value = 'false', updated_at = unixepoch() WHERE key = 'scores_stale';
UPDATE settings SET value = 'null', updated_at = unixepoch() WHERE key = 'scores_stale_reason';
```

### 3.4 不在 Settings 表的内容

| 数据 | 存放 |
|:-----|:-----|
| Developer / alias | `developers` |
| Repo 绑定 | `repos` |
| 采集窗口、上次成功时间 | 建议 `ingest_runs.stats_json` 或后续 `pipeline_state` 键（**非一期必须**） |

---

## 4. Web：页面与信息架构

### 4.1 路由（建议）

| 路径 | 说明 |
|:-----|:-----|
| `/settings` | Settings 主页（单页分节，一期足够） |
| `/settings/weights` | 可选：权重子页（若主页过长再拆） |

导航：侧栏 **Settings** 入口（与 Developers / Repos / Dashboard 并列）。

### 4.2 页面结构（单页）

```
┌─────────────────────────────────────────────────────────┐
│ Settings                                                 │
│ ┌─ StaleBanner (scores_stale) ─────────────────────────┐ │
│ │ 配置已变更，积分可能过期。[如何重算] [上次原因…]      │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ § 时区                                                   │
│   [Timezone combobox / input]  预览：今日 day_key = …    │
│                                                          │
│ § 邮箱后缀                                               │
│   [chip list] microsoft.com  [+]                         │
│   说明：alias + @ + 后缀 对齐 ADO uniqueName             │
│                                                          │
│ § 活跃度权重                                             │
│   表格：type | weight | 说明                             │
│   [恢复默认]                                             │
│                                                          │
│ § 管线状态（只读）                                       │
│   config version: 3                                      │
│   stale: false                                           │
│                                                          │
│              [保存变更]   （disabled until dirty）        │
└─────────────────────────────────────────────────────────┘
```

### 4.3 MVVM 分层

| 层 | 职责 | 建议路径 |
|:---|:-----|:---------|
| **View** | 表单控件、Banner、无业务规则 | `src/views/settings/SettingsPage.tsx` |
| **ViewModel** | dirty 状态、校验错误文案、提交中、成功 toast | `src/viewmodels/settings/SettingsViewModel.ts` |
| **Model** | `AppSettings` 类型、parse/serialize、副作用策略枚举 | `src/models/settings.ts` |
| **API client** | `GET/PUT /api/settings` | `src/models/settingsApi.ts` |

View **禁止**直接拼 SQL 或直接 `JSON.parse` 业务规则散落；校验在 Model/ViewModel。

### 4.4 交互细节

| 交互 | 行为 |
|:-----|:-----|
| 进入页面 | `GET /api/settings` → 填表；`scores_stale` 控制 Banner |
| 编辑 | 本地 dirty；校验实时（后缀格式、权重 ≥0 等） |
| 保存 | `PUT /api/settings` body = 变更后的业务三字段（或全量业务配置） |
| 保存成功 | 若服务端返回 `recomputeRequired: true`：Toast + 保持 Banner；文案说明需本机跑 rematch/recompute |
| 恢复默认权重 | 仅改表单内 weights 为默认值，仍需用户点保存 |
| 只读状态区 | 不显示为可编辑 input |

### 4.5 默认权重表（UI 展示用文案）

| type | 默认 | 文案 |
|:-----|-----:|:-----|
| `pr.merged` | 10 | PR 合并 |
| `pr.closed` | 2 | PR 关闭未合并 |
| `pr.created` | 2 | PR 创建 |
| `pr.vote` | 3 | 个人投票 |
| `pr.active` | 2 | PR 推进（有 iteration） |
| `wi.created` | 3 | WI 创建 |
| `wi.updated` | 1 | WI 更新（日折叠在 Score） |
| `wi.closed` | 5 | WI 关闭 |

---

## 5. Web CRUD / API 契约

### 5.1 `GET /api/settings`

**Auth：** Cloudflare Access（浏览器会话）。

**Response 200：**

```json
{
  "timezone": "Asia/Shanghai",
  "emailSuffixes": ["microsoft.com"],
  "activityWeights": { "pr.merged": 10, "...": 0 },
  "pipelineConfigVersion": 3,
  "scoresStale": false,
  "scoresStaleReason": null,
  "updatedAt": {
    "timezone": 1710000000,
    "email_suffixes": 1710000000
  }
}
```

### 5.2 `PUT /api/settings`

**Auth：** Access。  
**Body：** 允许只传业务字段（partial 或 full；推荐 **full 业务三字段** 减少合并歧义）：

```json
{
  "timezone": "Asia/Shanghai",
  "emailSuffixes": ["microsoft.com", "ntdev.microsoft.com"],
  "activityWeights": { "pr.merged": 10, "pr.closed": 2, "pr.created": 2, "pr.vote": 3, "pr.active": 2, "wi.created": 3, "wi.updated": 1, "wi.closed": 5 }
}
```

**服务端处理（单事务）：**

1. 校验 body（§3.2 规则）。  
2. 读出旧值，计算 diff。  
3. 写 `timezone` / `email_suffixes` / `activity_weights`（仅变化的键也可，但 version 策略看 diff）。  
4. **若任一「影响计分/匹配」的字段变化**（见矩阵）→  
   - `pipeline_config_version += 1`  
   - `scores_stale = true`  
   - `scores_stale_reason = "<human readable>"`  
5. **不**在 Web 请求内跑 az / rematch（本机权限）；只标记状态。  
6. 返回新 `AppSettings` + 标志：

```json
{
  "settings": { "...": "..." },
  "recomputeRequired": true,
  "recomputeKind": "full_rematch" | "recompute_scores_only" | "none"
}
```

### 5.3 副作用矩阵

| 变更字段 | `pipeline_config_version` | `scores_stale` | `recomputeKind` | 说明 |
|:---------|:--------------------------|:---------------|:----------------|:-----|
| `timezone` | +1 | true | `recompute_scores_only`* | day_key 变；匹配集不变。*实现上仍可用统一 full 任务 |
| `activity_weights` | +1 | true | `recompute_scores_only`* | 只重算分；Activity 可保留 |
| `email_suffixes` | +1 | true | **`full_rematch`** | 必须 raw→Activity→Score |
| 无业务变化 | 不变 | 不变 | `none` | |

\* 为降低实现分叉，**允许**一律返回 `full_rematch` 并由本机任务 no-op 优化；**禁止** suffixes 走 scores_only。

Developer.alias 变更不在本 API，在 Developers API，但副作用同 **`full_rematch`**（02 已定）。

### 5.4 不提供的 API

| API | 原因 |
|:----|:-----|
| `DELETE /api/settings/:key` | 种子键不可删 |
| 客户端直接改 `pipeline_config_version` / `scores_stale` | 防伪造「已重算」 |
| Web 内嵌「一键重算」直连 az | 无本机 az；重算入口在本机 CLI（可后续做「复制命令」按钮） |

### 5.5 错误

| HTTP | 场景 |
|:-----|:-----|
| 400 | 校验失败（空后缀、非法 timezone、权重非数字） |
| 401/403 | Access |
| 409 | 可选：乐观锁（若传 `expectedVersion` 且不匹配） |
| 500 | D1 / JSON 约束失败 |

---

## 6. CLI：如何读取 D1 中的 Settings

### 6.1 原则

- **SoT 仍是远端 D1**（与 Web 同一库），避免本机另一份「真配置」。  
- 采集在本机跑，但**启动时必须拉到与 D1 一致的 Settings**（及 Developer/Repo 列表，见 04/05）。  
- 允许**短时本地缓存**，但必须带 `pipelineConfigVersion`，过期或版本不一致则刷新。

### 6.2 推荐架构

```
┌─────────────┐   HTTPS + API Token    ┌──────────────────┐
│ CLI / Script│ ───────────────────►  │ Worker /api/*     │
│ (本机)      │   GET /api/pipeline/   │ binding D1        │
│             │        bootstrap       │                  │
└─────────────┘ ◄───────────────────  │ settings +        │
       │              JSON             │ developers+repos │
       ▼                               └──────────────────┘
  .data/cache/bootstrap.json   (optional, versioned)
       │
       ▼
  crawl → raw → match → activities → scores → D1 write API
```

**一期推荐：`GET /api/pipeline/bootstrap`**（只读聚合），而不是 CLI 直连 D1 HTTP API（密钥与 SQL 散落难测）。

### 6.3 `GET /api/pipeline/bootstrap`（CLI 专用读）

**Auth：** 与浏览器 Access **分离** 的 **Pipeline Token**（环境变量 `SIGNOFF_PIPELINE_TOKEN`，Worker secret）。  
（实现见 06；本文定契约。）

**Response 200：**

```json
{
  "fetchedAt": "2026-07-16T12:00:00.000Z",
  "settings": {
    "timezone": "Asia/Shanghai",
    "emailSuffixes": ["microsoft.com"],
    "activityWeights": { "pr.merged": 10 },
    "pipelineConfigVersion": 3,
    "scoresStale": true,
    "scoresStaleReason": "email_suffixes updated"
  },
  "developers": [
    { "id": "…", "name": "Ada", "alias": "ada" }
  ],
  "repos": [
    {
      "id": "…",
      "provider": "ado",
      "org": "…",
      "project": "…",
      "name": "…",
      "externalId": "guid",
      "enabled": true
    }
  ]
}
```

- 仅返回 **未归档** Developer；Repo 仅 `enabled=1 AND archived_at IS NULL`。  
- CLI **禁止**在本地静默改写这些字段后当作已同步回 D1。

### 6.4 CLI 模块划分（建议）

| 命令 / 模块 | 职责 |
|:------------|:-----|
| `signoff settings pull` | 调用 bootstrap（或仅 settings），打印 JSON；写 `.data/cache/bootstrap.json` |
| `signoff settings show` | 读缓存或 pull 后展示；`--remote` 强制刷新 |
| 采集入口 `signoff collect …` | **启动时** `pull`（或 `--offline` 仅当缓存存在且 `--allow-stale-cache`） |

**伪代码：**

```ts
async function loadSettingsForCrawl(opts: { offline?: boolean }): Promise<AppSettings> {
  if (!opts.offline) {
    const boot = await pipelineClient.bootstrap(); // GET /api/pipeline/bootstrap
    await writeCache(".data/cache/bootstrap.json", boot);
    return boot.settings;
  }
  const cache = await readCache(".data/cache/bootstrap.json");
  if (!cache) throw new Error("No cache; run settings pull or omit --offline");
  return cache.settings;
}

function matchDeveloper(uniqueName: string, developers: Dev[], suffixes: string[]): Dev | null {
  const u = uniqueName.toLowerCase();
  for (const d of developers) {
    for (const s of suffixes) {
      if (u === `${d.alias.toLowerCase()}@${s.toLowerCase()}`) return d;
    }
  }
  return null;
}

function dayKey(occurredAtSec: number, timeZone: string): string {
  // format YYYY-MM-DD in timeZone
}
```

### 6.5 备选通道（调试用，非主路径）

```bash
# 不推荐作为日常采集依赖
npx wrangler d1 execute signoff-db --remote --command \
  "SELECT key, value FROM settings ORDER BY key;"
```

封装为 `signoff settings pull --via wrangler` 仅用于排障；CI/技能默认走 HTTP bootstrap。

### 6.6 采集过程中 Settings 的用法

| 步骤 | 使用的 Settings 字段 |
|:-----|:---------------------|
| 解析身份 | `emailSuffixes` + developers.alias |
| 计算 `day_key` | `timezone` + `occurred_at` |
| 写 `activities.config_version` | `pipelineConfigVersion` |
| 算 Score / breakdown | `activityWeights` |
| 决定是否提示用户先 recompute | `scoresStale`（采集仍可继续写**新** version 数据；UI 在 stale 时警告） |
| 增量 vs 全量 | 若本地任务是 `rematch`，忽略旧 version 行策略见 02 §3.4 |

### 6.7 写回 D1

采集/重算 **写** Activity/Score 走：

`POST /api/pipeline/ingest`（或分端点），body 带 `pipelineConfigVersion`；  
若 body 版本 **&lt;** 服务端当前版本 → **409**，要求 CLI 重新 `pull` 后再跑（防用旧配置写入）。

清 stale 仅允许：

`POST /api/pipeline/recompute/complete`（管线 token + 成功报告），或由同一 ingest 事务在 full rematch 成功后服务端清除。

---

## 7. 本地缓存约定

| 路径 | 内容 |
|:-----|:-----|
| `.data/cache/bootstrap.json` | 最近一次 bootstrap 全文 |
| `.data/cache/settings.json` | 可选仅 settings 切片 |

```json
{
  "schemaVersion": 1,
  "fetchedAt": "…",
  "pipelineConfigVersion": 3,
  "settings": { }
}
```

- **gitignore** 已覆盖 `.data/`。  
- 缓存 **不能** 替代 D1 作为 Web 的 SoT。

---

## 8. 安全

| 通道 | 认证 |
|:-----|:-----|
| 浏览器 `GET/PUT /api/settings` | Cloudflare Access（管理者） |
| CLI `GET /api/pipeline/bootstrap` | `Authorization: Bearer <SIGNOFF_PIPELINE_TOKEN>` |
| CLI 写 ingest | 同上 Pipeline Token（权限可分 read/write scope，06 细化） |

- Pipeline Token **不**进入前端 bundle。  
- Settings PUT **不**接受 token 提权改 version 为任意值（只能 +1 服务端逻辑）。

---

## 9. 测试计划（实现时 TDD）

| 层 | 用例 |
|:---|:-----|
| Model | parse/serialize 默认值；后缀校验；权重缺键补默认 |
| API | PUT suffixes → version+1 且 stale；PUT 相同值 → none；非法 timezone → 400 |
| CLI | `loadSettingsForCrawl` mock HTTP；offline 无缓存失败；version 冲突 409 |
| 集成 | D1 中改 settings 后 bootstrap 读到新值 |

覆盖率：Settings Model/ViewModel/CLI loader 计入 95% 门禁；View 排除。

---

## 10. 实现落点（建议目录，非本篇必建）

```text
apps/web/src/
  models/settings.ts
  models/settingsApi.ts
  viewmodels/settings/SettingsViewModel.ts
  views/settings/SettingsPage.tsx
packages/pipeline-client/   # 可选：CLI 与 script 共用的 bootstrap HTTP 客户端
apps/<ado-cli>/src/
  settings/load.ts
  settings/pull.ts
```

Worker 路由（未来 `packages/worker` 或 `apps/web` functions）：

- `GET/PUT /api/settings`
- `GET /api/pipeline/bootstrap`
- `POST /api/pipeline/ingest`（概要）
- `POST /api/pipeline/recompute/complete`（概要）

---

## 11. 验收清单

- [ ] `AppSettings` 类型与 KV 键一一对应  
- [ ] Web `/settings` 可编辑三业务字段，状态只读  
- [ ] PUT 副作用矩阵与 02 rematch 规则一致  
- [ ] CLI `settings pull` / collect 启动路径读到 **D1 同源** Settings  
- [ ] 本地缓存带 `pipelineConfigVersion`  
- [ ] 文档不要求 Web 在浏览器内跑 az  

---

## 12. 与其它文档关系

| 文档 | 关系 |
|:-----|:-----|
| 01 | 业务含义：时区、后缀、权重 |
| 02 | 表结构、stale、config_version 列 |
| 03 | Web 模板：Basalt/MVVM/覆盖率/hooks/Access（本文 UI 按 03 落地） |
| 04（本文） | Settings 专篇：UI/API/CLI 读路径 |
| 05 | 采集 CLI 命令与 raw 布局（将消费 bootstrap） |
| 06 | 其它实体 CRUD 页面 |

---

**文档结束（04）**
