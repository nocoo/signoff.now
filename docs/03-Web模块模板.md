# 03 — Web 模块模板

> 状态：设计稿（实现清单）  
> 依赖：[01-项目定位](./01-项目定位.md)、[02-数据结构与D1](./02-数据结构与D1.md)  
> 范围：`apps/web` + Worker 服务端的**工程模板**——从哪抄、怎么分层、怎么测、怎么卡门禁、CF Access 怎么验  
> 不在本文：Settings 字段语义（→ [04](./04-Settings设计.md)）、Activity 计分算法、具体页面文案

---

## 1. 目标

signoff Web **只有一套模板：basalt**（`../basalt`）。

| 角色 | 仓库 | 是什么 | 对 signoff 的意义 |
|:-----|:-----|:-------|:------------------|
| **模板** | **basalt** | 设计系统 + Vite/React SPA 工程范式（tokens、Dashboard 壳、MVVM、覆盖率门、hooks 形态） | **唯一**前端/视觉/分层规范来源；从这里拷贝与对齐 |
| **参考实现** | **bat** | **basalt 家族里的另一个应用**（已声明 design system = Basalt），把 basalt SPA 接到 CF Worker + Access + D1 跑通了 | **不是第二套模板**；需要「Vite 如何挂 Worker / Access / 双入口 / 六维门」时对照代码与文档 |

关系一句话：

```
basalt  ──(模板 / 规范)──►  signoff apps/web
   │
   └──  bat  ──(同一 basalt 体系下的完整应用参考)──►  signoff 的 Worker/Access/部署写法可对照 bat
```

一期产品形状（01）：

```
Browser ──Access──► signoff.<domain> ──Worker──► D1
CLI/Scripts ──Pipeline Token──► signoff-ingest.* (或同 Worker 机器入口) ──► D1
```

Web **只读** Activity/Score；**可写** Developer / Team / Tag / Repo / Settings。采集不在浏览器里跑。

---

## 2. 模板与参考实现怎么用

### 2.1 basalt = 模板（唯一）

signoff 的 UI、分层、测试门禁口径 **以 basalt 为准**，不要另起设计语言或第二套 MVVM。

| 资产 | basalt 位置 | signoff 用法 |
|:-----|:------------|:-------------|
| 3-tier 亮度 token | `src/index.css` `:root` / `.dark` | **原样拷贝** token 语义；不要另起一套灰阶 |
| Dashboard 壳 | `src/components/DashboardLayout.tsx` + `AppSidebar.tsx` | 改导航项为 Dashboard / Developers / Repos / Teams / Tags / Settings |
| shadcn primitives | `src/components/ui/*` | 按需 `components.json` 同步；禁止每页手写 button |
| MVVM | `src/models/*` + `src/viewmodels/use*ViewModel.ts` + `src/pages/*` | 业务页一律此三层（见 §4） |
| 覆盖率门 | `vitest.config.ts` `include: models/viewmodels/lib`，阈值 95 | Web 同策略；View/Page 排除 |
| pre-commit / pre-push | `.husky/*` + `osv-scanner.toml` | 对齐 monorepo 根 hooks（见 §7） |
| 主题 | `ThemeToggle` system→light→dark | 一期保留；与 basalt 三态一致 |
| Vite dev 形态 | `vite.config.ts`（port / `allowedHosts` / Caddy 域名） | 端口表见 [04 §4.2](./04-Settings设计.md)；范式同 basalt |

basalt 本体是 **demo SPA**（无生产 Access / D1）。登录页（`/login`、`/badge-login`）仅视觉参考；**生产鉴权走 Access 边缘拦截**，不自建账号密码。  
「如何把 basalt 式 SPA 接到 Worker + Access」——看 **bat 参考实现**，不另造模板。

### 2.2 bat = basalt 应用上的 Vite / Worker 参考实现

bat **不是**并行模板，而是 basalt 体系下的**真实产品代码**，适合对照：

| 对照点 | bat 位置 | signoff 用法 |
|:-------|:---------|:-------------|
| Vite SPA + Caddy 本地域名 | `packages/ui`（`bat.dev.hexly.ai`、port 7025） | 同模式：`signoff.dev.hexly.ai` / 7042（见 04） |
| 同 Worker 托管 SPA 静态资源 | build → `worker/static` + wrangler `[assets]` | 部署形态对照 |
| 双入口 | `entry-control.ts` | Browser host vs ingest host 分流 |
| Access JWT | `access-auth.ts`（`jose` + remote JWKS） | 浏览器 API 必验；fail-closed |
| API Key | `api-key.ts` | 映射为 **Pipeline Token**（ingest / recompute） |
| `/api/me` | `routes/me.ts` | 侧栏邮箱；本地无 JWT → 匿名 |
| 质量六维 | `docs/07-testing.md` | L1/L2/G1/G2 映射（见 §6–§7） |
| 本地绕过 | `isLocalhost` + `*.dev.hexly.ai` | Caddy dev 跳过 Access |

**冲突时的优先级：**

1. **视觉 / MVVM / Model 覆盖率 / 组件壳** → **basalt 模板**  
2. **Worker 中间件、Access、ingest 双入口、SPA 打进 Worker** → **bat 参考实现**  
3. bat UI 若偏薄（SWR + routes、未严格 MVVM），**不得**反过来削弱 basalt 的 MVVM 要求——signoff 前端仍按 basalt 分层。

### 2.3 明确不抄的

| 项 | 原因 |
|:---|:-----|
| basalt mock `src/data/*` 作为生产数据源 | signoff 数据在 D1，经 Worker API |
| 把 bat 当成第二套设计系统或第二套目录规范 | 模板只有 basalt；bat 是应用参考 |
| bat 的 probe / Rust / Netdata 语义 | 产品无关 |
| Electron / better-sqlite3 产品库 | 已废弃（01） |
| 浏览器内 `az` / ADO 采集 | 01 已否决 |

---

## 3. 目标目录与职责

一期目标结构（可在 scaffold 上演进）：

```
apps/web/                          # @signoff/web — Vite SPA（basalt 形态）
├── index.html
├── vite.config.ts
├── vitest.config.ts               # coverage 门：models + viewmodels + lib ≥95%
├── components.json                # shadcn
└── src/
    ├── main.tsx
    ├── App.tsx                    # Router + DashboardLayout 壳
    ├── index.css                  # basalt tokens（L0/L1/L2 + chart/heatmap）
    ├── components/
    │   ├── ui/                    # shadcn
    │   ├── DashboardLayout.tsx
    │   └── AppSidebar.tsx
    ├── models/                    # 纯 TS：类型、parse、校验、副作用策略（无 React）
    ├── viewmodels/                # useXxxViewModel：组装 model + fetch + UI 状态
    ├── views/ 或 pages/           # 纯展示；不写业务规则
    ├── lib/                       # cn()、api client、palette
    └── hooks/                     # 跨页通用（useMobile、useTheme）— 非业务 ViewModel

packages/db/                       # D1 migrations + 未来 repos（见 02）
apps/worker/  或  packages/worker/ # Hono Worker（对照 bat 的 basalt+Vite 参考实现）
└── src/
    ├── index.ts                   # middleware 链 + routes
    ├── middleware/
    │   ├── entry-control.ts
    │   ├── access-auth.ts
    │   └── pipeline-auth.ts       # 对照 bat api-key，名随 signoff 语义
    └── routes/
        ├── me.ts
        ├── live.ts
        ├── settings.ts            # 04
        ├── developers.ts
        └── ...

wrangler.toml                      # D1 binding + assets + env secrets 占位
.husky/pre-commit | pre-push
scripts/run-security.ts            # 已有：osv + gitleaks
```

当前仓库状态：`apps/web` 已有 Vite scaffold + coverage 阈值；Worker 业务路由与 Access 中间件**待按本文落地**；`wrangler.toml` 已绑 D1 migrations。

---

## 4. MVVM 设计

### 4.1 分层规则（硬约定）

| 层 | 依赖 | 可测性 | 放什么 |
|:---|:-----|:-------|:-------|
| **Model** | 零 React、零 DOM | 纯 unit | 类型、`parse`/`serialize`、校验、枚举、副作用策略、与 API DTO 映射 |
| **ViewModel** | React hooks + Model + `api` | unit（mock fetch） | dirty、loading、error 文案、提交、派生展示字段 |
| **View / Page** | ViewModel 返回值 + ui 组件 | 不进覆盖率门 | 布局、控件绑定、无 `if (weight < 0)` 类规则 |
| **API client** | `fetch` | unit mock | 路径、方法、错误码映射；不藏业务默认值 |

禁止：

- Page 内直接 `JSON.parse` 业务配置或拼 SQL  
- ViewModel 里写 JSX  
- Model 里 `useState` / `useEffect`  
- 为了「方便」把校验只写在 Worker 而 Web 零校验（双边都要；Worker 为权威）

### 4.2 basalt 范式（抄法）

Model（可测纯函数）：

```typescript
// apps/web/src/models/stats-overview.ts  — basalt 同构示意
export function classifyChange(change: string): "positive" | "negative" | "neutral" {
  if (change.startsWith("+")) return "positive";
  if (change.startsWith("-")) return "negative";
  return "neutral";
}
```

ViewModel（组合数据源 + model）：

```typescript
// apps/web/src/viewmodels/useStatsOverviewViewModel.ts
export function useStatsOverviewViewModel() {
  const stats = useMemo(
    () => rows.map((s) => ({
      ...s,
      changeColorClass: changeToColorClass(classifyChange(s.change)),
    })),
    [rows],
  );
  return { stats };
}
```

signoff Settings 页的对应关系见 [04 §4.3](./04-Settings设计.md)；其它实体 CRUD 同一套：

| 实体 | Model | ViewModel | View |
|:-----|:------|:----------|:-----|
| Settings | `models/settings.ts` | `useSettingsViewModel` | `views/settings/SettingsPage` |
| Developer | `models/developer.ts` | `useDeveloperListViewModel` / `useDeveloperEditViewModel` | `views/developers/*` |
| Repo / Team / Tag | 同理 | 同理 | 同理 |
| Activity 热力图（只读） | `models/activity.ts`（聚合 DTO → 格子色阶） | `useActivityHeatmapViewModel` | `views/activity/*` |

### 4.3 数据获取

一期建议：

- **SWR 或 TanStack Query** 二选一（bat 参考实现用 SWR；任选其一写进实现，不要混用）  
- 所有浏览器请求 **same-origin** `/api/*`（Access cookie / header 由边缘注入，前端**不**手写 JWT）  
- 错误：`401/403` → 统一「未通过 Access / 会话失效」提示；本地 dev 可匿名  
- 乐观更新：仅 Settings/实体表单在 ViewModel 层；Activity **禁止**乐观写

### 4.4 路由草图（一期）

| 路径 | 权限语义 | 说明 |
|:-----|:---------|:-----|
| `/` | Access | Dashboard 只读摘要 |
| `/developers`、`/developers/:id` | Access | CRUD |
| `/teams`、`/tags`、`/repos` | Access | CRUD |
| `/settings` | Access | 见 04 |
| `/activity` 或开发者下钻 | Access | 只读 |
| Worker `GET /api/live` | 公开 | 健康检查 |
| Worker `GET /api/me` | 本地可无 JWT | 侧栏用户 |

---

## 5. Basalt 设计语言应用

### 5.1 哲学（写进 PR 描述时可引用）

- **Dense. Refined. Functional.**  
- 深度靠**亮度阶梯**，不靠厚重阴影堆叠。  
- Subdued, not dim：对比度算过，明暗双主题可读。  
- 字体：正文 Inter 14px 量级；展示标题可用 DM Sans；图标 Lucide **1.5px** stroke。  
- 圆角：`--radius: 0.75rem`（12px 基），卡片 `rounded-widget` 一类统一类名。

### 5.2 三层亮度（L0 / L1 / L2）

| 层 | Token | 用途 | Light（示意） | Dark（示意） |
|:---|:------|:-----|:--------------|:-------------|
| **L0** | `--background` | 页面底、侧栏底 | `220 14% 94%` | `0 0% 9%`（#171717） |
| **L1** | `--card` | 主内容面板 | `220 14% 97%` | `0 0% 10.6%`（#1b1b1b） |
| **L2** | `--secondary` | 内嵌卡片、控件底 | `0 0% 100%` | `0 0% 12.2%`（#1f1f1f） |

布局骨架（basalt `DashboardLayout`）：

```
div.bg-background (L0)
├── AppSidebar
└── main
    ├── header (h-14)
    └── content panel → bg-card (L1) 内再放 L2 卡片
```

热力图与图表：直接复用 basalt 的 `--heatmap-*` 与 24 色 `--chart-*`；Activity 强度映射到 heatmap scale，**不要**硬编码 hex。

### 5.3 组件与交互

- 侧栏：桌面可折叠；移动端 drawer + backdrop blur（basalt 已实现，直接移植）  
- `⌘K` 命令面板：二期；一期可用侧栏导航  
- Toast：sonner 或 basalt 同类  
- 空态 / 加载：L1 面板内 skeleton，禁止整页白闪无结构  
- 无障碍：保留 skip-to-main；表单 label 与错误 `aria-invalid`

### 5.4 与 basalt 家族应用（含 bat）的关系

bat 等项目已声明 design system = **Basalt**——它们是**同一模板下的应用**，不是并列模板。  
signoff 与它们共享 token 语义；**组件与 token 从 basalt 模板拷贝**进 `apps/web`，不跨仓 import bat/basalt 源码路径。

---

## 6. 测试覆盖率

### 6.1 分层与阈值

| 层 | 工具 | 阈值 | 范围 |
|:---|:-----|-----:|:-----|
| **L1 Web** | Vitest + v8 | **≥95%** stmts/branches/funcs/lines | `src/models/**`、`src/viewmodels/**`、`src/lib/**`（排除纯类型文件） |
| **L1 Worker** | Vitest / bun test | **≥95%** | middleware 纯逻辑、route helpers、settings 副作用矩阵、DTO 校验 |
| **L1 packages/db** | bun test | **≥95%** | migrate 幂等、schema 辅助（已有基线则保持） |
| **L1 CLI** | Vitest | **≥95%** | gitinfo/pulse 质量标杆继续 |
| **View / Page** | 不计入门禁 | — | 可选 smoke；禁止用 E2E 替代 Model 测试 |
| **L2** | Wrangler local + HTTP | 关键写路径 100% 覆盖（settings PUT、ingest、CRUD） | pre-push 或 CI |
| **L3** | Playwright（可选，二期） | 登录后主路径 | CI only（可对照 bat 的 L3 做法） |

### 6.2 vitest 配置模板（**basalt 模板** + 当前 scaffold）

```typescript
// apps/web/vitest.config.ts（目标形态）
coverage: {
  provider: "v8",
  include: ["src/models/**/*.ts", "src/viewmodels/**/*.ts", "src/lib/**/*.ts"],
  exclude: [
    "src/**/*.{test,spec}.{ts,tsx}",
    "src/**/*.d.ts",
    "src/models/types.ts",
    "src/**/views/**",
    "src/**/*.view.tsx",
    "src/App.tsx",
    "src/main.tsx",
  ],
  thresholds: {
    statements: 95,
    branches: 95,
    functions: 95,
    lines: 95,
  },
},
```

说明：当前 scaffold 用 `include: src/**` 再 exclude views；落地 MVVM 后**收窄 include** 与 basalt 一致，避免组件噪声稀释门禁。

### 6.3 测试命名与夹具

- 文件：`*.test.ts` 与源码同目录，或 `src/test/models/`（basalt 风格二选一，**包内统一**）  
- 禁止真实网络；`fetch` mock  
- Worker Access：fixture JWT + mock JWKS（对照 bat 参考实现 `access-auth.test.ts`）  
- 本地 L2：`localhost` 绕过 Access，与生产路径分离（**D1 Isolation**：仅 Miniflare/`--local`）

---

## 7. Hooks 与自动化检查

### 7.1 六维映射（对照 bat 文档 `07-testing` → signoff；门禁口径仍服从 basalt 覆盖率）

| 维 | 含义 | signoff 触发 | 命令 / 工具 |
|:---|:-----|:-------------|:------------|
| **L1** | 单测 + 覆盖率 | pre-commit | `bun run test:coverage` |
| **G1** | 静态 | pre-commit | `lint-staged`（Biome）+ `bun run typecheck` |
| **G2** | 安全 | pre-push（+ pre-commit 可跑 gitleaks staged） | `bun run security`（osv-scanner + gitleaks） |
| **L2** | Worker HTTP E2E | pre-push 或 CI（实现 Worker 后启用） | `wrangler dev --local` + 路由套件 |
| **L3** | 浏览器 E2E | CI only（二期） | Playwright |
| **D1** | 测试库隔离 | 始终 | 禁止 L2 打 production D1 |

### 7.2 当前 monorepo hooks（已有）

**pre-commit**（`.husky/pre-commit`）：

```text
bun run test:coverage
bunx lint-staged --concurrent false
bun run typecheck
```

**pre-push**（`.husky/pre-push`）：

```text
bun run security   # osv-scanner.toml + gitleaks
```

**lint-staged**：对 staged `*.{ts,tsx,js,jsx,json,jsonc,css}` 跑 Biome `--error-on-warnings`。

### 7.3 目标增强（实现 Worker 后）

对齐 **basalt 模板**的门禁强度，并吸收 bat 参考实现里 monorepo / Worker 的扩展，建议演进为：

| 阶段 | 增加项 |
|:-----|:-------|
| pre-commit | `gitleaks protect --staged`（若尚未并入 security 的 staged 子集） |
| pre-push | Worker L2 E2E；可选 `gate:routes`（路由表与测试对齐，可对照 bat） |
| CI | 全量 L1 + G1 + G2 + L2；tag 发版再 L3 |
| 工具缺失 | 可对照 bat `scripts/ensure-tools.sh`：无 `gitleaks`/`osv-scanner` 则 fail 并提示安装 |

### 7.4 Biome / 安全配置约定

- **Biome 0 warnings** 门禁（basalt 模板口径）  
- `osv-scanner.toml`：仅允许**有理由**的间接 dev 依赖 ignore（**抄 basalt**，禁止无理由全关）  
- `.data/` 采集落盘 **gitignore**；gitleaks 防 token 入库  
- 覆盖率不过 → commit 失败；漏洞不过 → push 失败

### 7.5 basalt 单仓 hooks 对照（前端包级）

basalt 模板 pre-commit 更重：`typecheck + lint + test + gitleaks + build + test:coverage`；pre-push：`osv-scanner`。  
signoff 是 monorepo，**门禁放在根 husky**，不要每个 app 再嵌一套冲突 hooks。

---

## 8. Cloudflare Access 登录实现细节

### 8.1 总体模型（对照 bat 参考实现，改名适配 signoff）

| 入口 | 域名（示例） | 边缘 | Worker 内 |
|:-----|:-------------|:-----|:----------|
| **Browser** | `signoff.example.com` | Access 应用（IdP：Google / 企业 IdP，email allowlist） | 校验 `Cf-Access-Jwt-Assertion` |
| **Machine / Pipeline** | `signoff-ingest.example.com` 或 `*.workers.dev` 机器 host | **无** Access | Pipeline Token（Bearer） |
| **Local** | `localhost` / `*.dev.hexly.ai` | 无 | 跳过 JWT；按需 mock 用户 |

同 Worker 进程，靠 **Host** 分流（`entry-control`），避免「只靠前端藏路由」。

### 8.2 中间件顺序（必须）

```
request
  → entryControl      // host → browser | machine | localhost
  → accessAuth        // browser：验 JWT；machine/localhost：skip
  → pipelineAuth      // machine 写/读 key；browser 已 accessAuthenticated 则放行 API
  → repos / handlers
```

**安全要点（从 bat 参考实现沉淀，必须保留）：**

1. **Fail closed**：Browser host 上若未配置 `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`，返回 **500**，禁止静默降级到「有 header 就算过」。  
2. **不得**仅凭「header 存在」信任 JWT；必须 `jwtVerify` + JWKS。  
3. `accessAuthenticated` 由中间件 **set 到 context**，下游看 flag 而非重复读未校验 header。  
4. Machine host **白名单 path+method**；未列出的管理 API 在 ingest 域名上 **403**。  
5. 公开路由极短名单：`GET /api/live`（及文档明确的 health）；`/api/me` 在无 JWT 时返回匿名而非 401（便于侧栏）。

### 8.3 Access JWT 校验（逻辑规格）

环境变量（Worker secrets / vars）：

| 变量 | 含义 |
|:-----|:-----|
| `CF_ACCESS_TEAM_DOMAIN` | 如 `myteam.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Access Application Audience（AUD tag） |

算法：

1. 读 header `Cf-Access-Jwt-Assertion`（Access 注入；浏览器 same-origin 请求自动带 cookie/header 策略以 CF 配置为准）。  
2. 缺失 → **401** `{ error: "Missing Access JWT" }`。  
3. `createRemoteJWKSet(https://${teamDomain}/cdn-cgi/access/certs)`，进程内按 teamDomain **缓存 JWKS**。  
4. `jwtVerify(jwt, jwks, { issuer: https://${teamDomain}, audience: aud })`。  
5. 失败 → **403** `{ error: "Invalid Access JWT" }`。  
6. 成功 → `c.set("accessAuthenticated", true)`。

对照实现：`../bat/packages/worker/src/middleware/access-auth.ts`（可几乎原文件移植，改 env 名与 host 判断）。

### 8.4 `/api/me`

- JWT 已由 `accessAuth` 验证（生产 browser）。  
- Payload 解码取 `email` / `name`（对照 bat `decodeJwtPayload`：base64url payload，**不**在 me 路由再验签——验签只在 middleware 一次）。  
- 响应：

```json
{ "email": "user@company.com", "name": "user", "authenticated": true }
```

- 本地无 JWT：`authenticated: false`，侧栏显示 Anonymous / Dev。  
- **不**依赖 Google 头像 URL（Access 默认不提供）；头像用 email 首字母。

### 8.5 Pipeline Token（机器入口）

| 用途 | 机制 | 路由示例 |
|:-----|:-----|:---------|
| 采集 ingest | `Authorization: Bearer <PIPELINE_WRITE_TOKEN>` | `POST /api/pipeline/ingest` |
| 可选只读 bootstrap | 独立 read token 或同 write 收窄 scope | `GET /api/settings`、developers 列表（CLI 启动拉取） |
| 浏览器 CRUD | **不**用 pipeline token；仅 Access | `PUT /api/settings` 等 |

CLI 读 Settings：见 [04 §6](./04-Settings设计.md)——优先经 **已鉴权 HTTP** 拉 D1 同源配置；token 只放本机环境变量 / secret manager，永不进仓库。

### 8.6 Cloudflare Dashboard 配置清单

- [ ] Zero Trust → Access → Application：覆盖 `signoff.example.com`（含 `/api/*` 与 SPA）  
- [ ] Identity provider + **email allowlist**（管理者集合）  
- [ ] 复制 Application **AUD** → Worker `CF_ACCESS_AUD`  
- [ ] Team domain → `CF_ACCESS_TEAM_DOMAIN`  
- [ ] **不要**给 ingest 域名套同一 Access 应用（否则 CLI 无法非交互推数）  
- [ ] Session duration 按公司政策；登出依赖 Access 应用会话  

### 8.7 本地开发

| 方式 | 行为 |
|:-----|:-----|
| `bun run dev`（Vite only） | 端口 **7042**；`/api` proxy → `127.0.0.1:37042`；无 JWT，`/api/me` 匿名 |
| Caddy **`https://signoff.dev.hexly.ai`** | TLS → `localhost:7042`；host 属 `*.dev.hexly.ai`，Access 跳过 |
| 生产联调 | 真实 Access；用 allowlist 测试账号 |

**端口分配（Hexly 表，2026-07-16）：**

| 角色 | 端口 | 域名 |
|:-----|-----:|:-----|
| Vite SPA | 7042 | `signoff.dev.hexly.ai` |
| Worker wrangler | 37042 | （Vite proxy，无独立 Caddy） |
| L2 E2E | 17042 | — |

细节与 Caddyfile 片段见 [04 §4.2](./04-Settings设计.md)。历史 `signoff.now`→7027 / Electron 5173 **不**再用于当前 SPA。

前端**禁止**实现「输入邮箱密码」的假登录作为生产路径；basalt 模板里的登录页仅 demo。

### 8.8 测试点（Access）

| 用例 | 期望 |
|:-----|:-----|
| browser host + 无 JWT | 401 |
| browser host + 坏签名 JWT | 403 |
| browser host + 未配置 team/aud | 500 fail-closed |
| localhost + 无 JWT | 放行（后续 pipelineAuth 策略按路由） |
| machine host + 非白名单路径 | 403 |
| machine host + 正确 Bearer + ingest | 2xx |
| JWKS 缓存 | 同 teamDomain 不重复创建 JWKS client（单测可断言） |

---

## 9. Worker 与 SPA 部署形态

部署管线**对照 bat 参考实现**（basalt 本体不包含 Worker 发布）：

1. `bun run build --filter=@signoff/web` → 产物进 Worker `static/` 或 wrangler `assets` 目录。  
2. `wrangler deploy` 一次发布 API + SPA。  
3. SPA fallback：非 `/api/*` 回 `index.html`。  
4. D1：`packages/db/migrations` 已由根 `wrangler.toml` 指向；业务 SQL 只经 migration，禁止运行时瞎 `CREATE`。

---

## 10. 实现顺序（建议 PR 切分）

| PR | 内容 | 验收 |
|:---|:-----|:-----|
| W1 | 从 **basalt 模板**拷 tokens + DashboardLayout + 空路由壳 | 视觉 L0/L1；无业务 |
| W2 | `models/` + `viewmodels/` 目录约定 + vitest include 收窄 | coverage 门绿（basalt 口径） |
| W3 | Worker 骨架（对照 bat）：entryControl + accessAuth + pipelineAuth + `/api/live` + `/api/me` | 单测 + 本地 host 矩阵 |
| W4 | Settings API + Web MVVM 页 | 对 04 验收清单 |
| W5 | Developers/Teams/Tags/Repos CRUD | 软删除与 02 一致 |
| W6 | L2 E2E 挂 pre-push；文档勾选 §11 | hooks 全绿 |

---

## 11. 验收清单

- [ ] 文档明确：**模板只有 basalt**；bat 是 basalt 应用参考实现，不是第二模板  
- [ ] `apps/web` 使用 basalt L0/L1/L2 token 与布局壳  
- [ ] 业务页 MVVM 三层（basalt）；View 无业务规则  
- [ ] Model/ViewModel/lib 覆盖率 ≥95%，View 排除  
- [ ] 根 husky：pre-commit L1+G1；pre-push G2（+ 后续 L2）  
- [ ] Access / 双入口：对照 bat 实现，JWKS 验签、fail-closed、context flag  
- [ ] `/api/me` 行为与本地匿名一致  
- [ ] Pipeline Token 不进 git；ingest 不走 Access  
- [ ] 无 Electron / 浏览器 az 回潮  

---

## 12. 与其它文档关系

| 文档 | 关系 |
|:-----|:-----|
| [01](./01-项目定位.md) | 产品边界：Web 读写范围、采集在 CLI |
| [02](./02-数据结构与D1.md) | 表与 migration；API 字段对齐 |
| **03（本文）** | Web **basalt 模板**落地约定 + Worker/Access（对照 bat 参考实现） |
| [04](./04-Settings设计.md) | Settings 专篇（在 basalt 模板上落第一页） |
| 后续 CLI 矩阵 | ingest 路径消费 pipelineAuth |
| 后续计分 | Activity 只读 ViewModel |

### 外部只读参考（不进本仓库）

| 路径 | 角色 | 用途 |
|:-----|:-----|:-----|
| `../basalt` | **模板** | 设计语言、MVVM、coverage、tokens、Vite SPA 结构 |
| `../bat` | **basalt 家族参考应用** | Vite+Worker 部署、Access、双入口、六维门 |
| `../bat/packages/worker/src/middleware/*` | 同上 | Access / entry-control 实现细节 |
| `../bat/docs/06-ui.md`、`07-testing.md`、`02-architecture.md` | 同上 | 叙事对照 |

---

**文档结束（03）**
