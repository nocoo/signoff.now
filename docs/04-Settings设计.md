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
| `email_suffixes` | string[] | `["example.com"]` | 长度 ≥1；元素去空格、转小写、不含 `@`；去重 |
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

**更新业务键 + bump version + stale（实现见 §5.2）：**

**禁止**「应用层先 `SELECT` 比对 version 再 `batch` 无条件 `UPDATE`」——并发请求可同时通过检查。  
版本条件必须写进 **同一** `env.DB.batch([...])` 内每条语句的 **SQL `WHERE`**；batch 返回后看 **affected rows**（D1/`meta.changes`）：version 那条为 **0** → **409**，业务键也未应生效。

示意（`expectedVersion = 3`，JSON number 存文本 `3`；`?` 为绑定参数）。  
**同一 batch 内顺序固定：先业务 + stale（WHERE 绑 expected），最后 CAS bump。**

```sql
-- 1) 业务键（仅当 version 仍为 expected）
UPDATE settings SET value = ?, updated_at = unixepoch()
WHERE key = 'timezone'
  AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?;  -- '3'

UPDATE settings SET value = ?, updated_at = unixepoch()
WHERE key = 'email_suffixes'
  AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?;

UPDATE settings SET value = ?, updated_at = unixepoch()
WHERE key = 'activity_weights'
  AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?;

-- 2) stale（仍绑 expected；须在 bump 之前）
UPDATE settings SET value = 'true', updated_at = unixepoch()
WHERE key = 'scores_stale'
  AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?;

UPDATE settings SET value = ?, updated_at = unixepoch()
WHERE key = 'scores_stale_reason'
  AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?;

-- 3) 最后 CAS bump：affected rows 必须为 1，否则整次请求 → 409
UPDATE settings SET value = ?, updated_at = unixepoch()   -- '4' = expected+1
WHERE key = 'pipeline_config_version' AND value = ?;            -- '3'
```

无业务变化（`recomputeKind: none`）→ 不写库或仅校验 `expectedVersion` 后 200，**不** bump。

**管线成功清 stale（§6.7）：版本条件进 SQL，一次 batch：**

```sql
UPDATE settings SET value = 'false', updated_at = unixepoch()
WHERE key = 'scores_stale'
  AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?;  -- body 版本

UPDATE settings SET value = 'null', updated_at = unixepoch()
WHERE key = 'scores_stale_reason'
  AND (SELECT value FROM settings WHERE key = 'pipeline_config_version') = ?;
```

任一条（或约定检查 `scores_stale` 那条）**changes === 0** → **409**（旧任务不得清新 version 的 stale）。

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

### 4.2 本地开发：Caddy 域名与 Vite 端口

依据本机 Hexly 规范（nmem「Caddy 与域名规则」）：`https://{project}.dev.hexly.ai` → Caddy TLS → `localhost:{port}`；`*.dev.hexly.ai` 已通配解析到 `127.0.0.1`，**无需** `/etc/hosts`。

#### 端口与域名（signoff 正式分配）

| 角色 | 端口 | 域名 / 访问 | 规则 |
|:-----|-----:|:------------|:-----|
| **Vite SPA（主 dev）** | **7042** | **`https://signoff.dev.hexly.ai`** | 表内下一空位（7040/7041 为 meowth；7027 仍绑历史 `signoff.now`） |
| **Worker `wrangler dev`（dev 辅助）** | **37042** | 不经 Caddy；由 Vite `proxy` 转发 | `dev + 30000` |
| **L2 HTTP E2E** | **17042** | — | `dev + 10000` |
| **BDD（若启用）** | **27042** | — | `dev + 20000` |

**历史槽位（勿复用给 SPA）：**

| 端口 | 域名 | 说明 |
|-----:|:-----|:-----|
| 7027 | `signoff.now` | Electron 时代 API 特殊域名；仍在 Caddyfile，**非**当前 Vite SPA |
| 5173 | — | 旧 Electron Vite 默认，已废弃 |

#### Vite 配置（`apps/web/vite.config.ts`）

```ts
server: {
  host: "::",
  port: 7042,
  allowedHosts: ["signoff.dev.hexly.ai"],
  hmr: { overlay: false },
  proxy: {
    "/api": {
      target: "http://127.0.0.1:37042",
      changeOrigin: true,
    },
  },
},
```

要点：

- 浏览器只打开 **`https://signoff.dev.hexly.ai`**（经 Caddy）；不要依赖裸 `http://localhost:7042` 做日常联调。  
- Settings 页请求 **`/api/settings`** 为 **same-origin**；Vite 把 `/api/*` 转到本机 Worker `37042`（proxy 后 Worker 侧 Host 为 `127.0.0.1`，走 03 的 `isLocalhost`）。  
- Worker 未起时 SPA 仍可渲染，API 为 502——属预期。

#### Caddyfile 片段（本机 Caddy 配置示例；路径按本机调整）

```caddyfile
# ---- 7042 Signoff Web (Vite SPA) ----
http://signoff.dev.hexly.ai {
  redir https://signoff.dev.hexly.ai{uri} permanent
}

signoff.dev.hexly.ai {
  tls /path/to/certs/cert.pem /path/to/certs/key.pem
  reverse_proxy localhost:7042
}
```

应用（路径为本机示例）：

```bash
caddy validate --config /path/to/Caddyfile
# 或：brew services restart caddy
```

证书需覆盖 `*.dev.hexly.ai`（如 mkcert）；**一般**改 Caddyfile 后无需重签。

#### 本地跑 Settings 的推荐流程

```bash
# 终端 1：Worker + 本地 D1（实现后）
# wrangler dev --port 37042 --local   # 或 monorepo 封装脚本

# 终端 2：SPA
bun run dev   # → :7042，allowedHosts 含 signoff.dev.hexly.ai

# 浏览器
open https://signoff.dev.hexly.ai/settings
```

| 组件 | 本地 Auth 行为 |
|:-----|:---------------|
| Vite proxy → `127.0.0.1:37042` | Worker Host 为 loopback → `isLocalhost`（与 bat 相同）→ **跳过** Access / Pipeline Token |
| Caddy `signoff.dev.hexly.ai` | Host 后缀 `*.dev.hexly.ai` → 同 bat `isLocalhost`，本地跳过鉴权（**不**另加 ENVIRONMENT 开关） |
| CLI `settings pull` | `SIGNOFF_API_BASE=http://127.0.0.1:37042`（本地）或 machine host（远端）；Bearer Pipeline Token；**不要**走浏览器 Access |

CLI 读 Settings 的契约仍见 §6；本地只是把 base URL 指到 `37042`。

### 4.3 页面结构（单页）

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
│   [chip list] example.com  [+]                           │
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

### 4.4 MVVM 分层

| 层 | 职责 | 建议路径 |
|:---|:-----|:---------|
| **View** | 表单控件、Banner、无业务规则 | `src/views/settings/SettingsPage.tsx` |
| **ViewModel** | dirty 状态、校验错误文案、提交中、成功 toast | `src/viewmodels/settings/SettingsViewModel.ts` |
| **Model** | `AppSettings` 类型、parse/serialize、副作用策略枚举 | `src/models/settings.ts` |
| **API client** | `GET/PUT /api/settings` | `src/models/settingsApi.ts` |

View **禁止**直接拼 SQL 或直接 `JSON.parse` 业务规则散落；校验在 Model/ViewModel。

### 4.5 交互细节

| 交互 | 行为 |
|:-----|:-----|
| 进入页面 | `GET /api/settings` → 填表；`scores_stale` 控制 Banner |
| 编辑 | 本地 dirty；校验实时（后缀格式、权重 ≥0 等） |
| 保存 | `PUT /api/settings` body = 变更后的业务三字段（或全量业务配置） |
| 保存成功 | 若服务端返回 `recomputeRequired: true`：Toast + 保持 Banner；文案说明需本机跑 rematch/recompute |
| 恢复默认权重 | 仅改表单内 weights 为默认值，仍需用户点保存 |
| 只读状态区 | 不显示为可编辑 input |

### 4.6 默认权重表（UI 展示用文案）

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
  "emailSuffixes": ["example.com"],
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
**Body：** 推荐 **full 业务三字段** + **必填** `expectedVersion`（乐观锁，等于当前 `pipelineConfigVersion`）：

```json
{
  "expectedVersion": 3,
  "timezone": "Asia/Shanghai",
  "emailSuffixes": ["example.com", "corp.example.com"],
  "activityWeights": { "pr.merged": 10, "pr.closed": 2, "pr.created": 2, "pr.vote": 3, "pr.active": 2, "wi.created": 3, "wi.updated": 1, "wi.closed": 5 }
}
```

**服务端处理（原子写，D1 `batch` + SQL CAS）：**

1. 校验 body（§3.2 规则）；缺 `expectedVersion` → **400**。  
2. **可选** `SELECT` 旧值仅用于算 diff / 响应体——**不得**把「读到的 version 相等」当作写锁。  
3. 用 **一次** `env.DB.batch([...])` 提交（§3.3）：每条 `UPDATE` 的 `WHERE` 带  
   `(SELECT value FROM settings WHERE key = 'pipeline_config_version') = <expectedVersion JSON>`  
   或 version 行 `WHERE key = 'pipeline_config_version' AND value = <expected>`。  
4. 若业务配置有变化：同 batch 内写业务键 + `scores_stale` / reason + **最后** CAS bump `pipeline_config_version` 为 `expected+1`。  
5. 检查 batch 结果：version bump 的 **affected rows !== 1** → **409**（并发 / 过期表单）；成功则读回新 `AppSettings`。  
6. **不**在 Web 请求内跑 az / rematch；只标记状态。  
7. 返回新 `AppSettings` + 标志：

```json
{
  "settings": { "...": "..." },
  "recomputeRequired": true,
  "recomputeKind": "full_rematch" | "none"
}
```

### 5.3 副作用矩阵

| 变更字段 | `pipeline_config_version` | `scores_stale` | `recomputeKind` | 说明 |
|:---------|:--------------------------|:---------------|:----------------|:-----|
| `timezone` | +1 | true | **`full_rematch`** | 与 02 一致：须重写 Activity.`day_key` 并重算 Score；一期不单独做 scores-only |
| `activity_weights` | +1 | true | **`full_rematch`** | 一期统一 full，避免分叉实现（二期可再拆「只重算 Score」） |
| `email_suffixes` | +1 | true | **`full_rematch`** | raw→Activity→Score |
| 无业务变化 | 不变 | 不变 | `none` | |

一期 **一律** `full_rematch | none`，与 [02 §3.4](./02-数据结构与D1.md) 全量任务对齐；**不**暴露 `recompute_scores_only`。

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
| 400 | 校验失败（空后缀、非法 timezone、权重非数字、**缺 `expectedVersion`**） |
| 401/403 | Access |
| 409 | CAS 失败：version `UPDATE` **affected rows = 0**（并发写 / 过期 `expectedVersion`） |
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
    "emailSuffixes": ["example.com"],
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

`POST /api/pipeline/ingest`（或分端点），body **必带** `pipelineConfigVersion`。  
服务端要求 body 版本与当前 Settings **严格相等**（不是「≥」或「仅拒绝更旧」）。  
实现上：写入 Activity/Score 的语句或前置 CAS 须在 SQL/`batch` 内绑定该版本；**不要**只在 JS 里 `if (body.v === read.v)` 再无条件写。失败 → **409**，CLI `settings pull` 后重跑。

清 stale 仅允许：

`POST /api/pipeline/recompute/complete`（管线 token），body **至少**：

```json
{
  "pipelineConfigVersion": 3,
  "ok": true
}
```

服务端用 **一次** `env.DB.batch`（§3.3 清 stale SQL）：`WHERE` 子查询要求 `pipeline_config_version` 的 value **等于** body 版本；**affected rows = 0** → **409**（旧 rematch 不得清新 version 的 stale）。  
也可在 full rematch 成功的 **同一** ingest `batch` 末尾带相同 CAS 清 stale——仍靠 SQL 相等条件，无需 run lease。

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

鉴权分层与 [03 §8](./03-Web模块模板.md) / bat 一致：browser Access、machine 白名单 + Pipeline Token、本地 `isLocalhost` 旁路。

| 通道 | 认证 |
|:-----|:-----|
| 浏览器 `GET/PUT /api/settings` | Cloudflare Access（`accessAuthenticated`；**不**用 Pipeline Token） |
| CLI `GET /api/pipeline/bootstrap` | machine host 或本机 loopback + `Authorization: Bearer`（read/write scope 见 03） |
| CLI 写 ingest | 同上 write token；machine 白名单 path |

- Pipeline Token **不**进入前端 bundle。  
- Settings PUT **不**接受 token 提权改 version 为任意值（只能 +1 服务端逻辑）。  
- machine host **禁止** `PUT /api/settings` 等管理路由（entryControl 白名单，见 03）。

---

## 9. 测试计划（实现时 TDD）

| 层 | 用例 |
|:---|:-----|
| Model | parse/serialize 默认值；后缀校验；权重缺键补默认 |
| API | PUT：SQL WHERE CAS + `batch`；bump `changes===0` → 409；缺 `expectedVersion` → 400 |
| API | recompute complete：清 stale 的 SQL 带 version WHERE；`changes===0` → 409 |
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
- [ ] PUT 必填 `expectedVersion`；CAS 条件在 SQL `WHERE` 内，一次 `batch`，bump `changes===0` → 409  
- [ ] 业务变更 `recomputeKind` 一期仅为 `full_rematch`（与 02 day_key 规则一致）  
- [ ] recompute complete：清 stale SQL 带 version 条件，`changes===0` → 409  
- [ ] CLI `settings pull` / collect 启动路径读到 **D1 同源** Settings  
- [ ] 本地缓存带 `pipelineConfigVersion`  
- [ ] 文档不要求 Web 在浏览器内跑 az  
- [ ] 示例域名为 `example.com` 等占位，无本机绝对路径 

---

## 12. 与其它文档关系

| 文档 | 关系 |
|:-----|:-----|
| 01 | 业务含义：时区、后缀、权重 |
| 02 | 表结构、stale、config_version 列 |
| 03 | Web **basalt 模板** + bat 参考实现（MVVM/覆盖率/hooks/Access；本文 UI 按 03 落地） |
| 04（本文） | Settings 专篇：UI/API/CLI 读路径 |
| 05 | 采集 CLI 命令与 raw 布局（将消费 bootstrap） |
| 06 | 其它实体 CRUD 页面 |

---

**文档结束（04）**
