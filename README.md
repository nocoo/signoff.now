# signoff.now

围绕**开发者**与 **Git 仓库**的数据可视化与分析平台。

管理者在本机采集 Azure DevOps 数据，写入 Cloudflare D1；Web 配置实体与 Settings，**只读**展示 Activity / Score（管线写入）。

## 文档

| 文档 | 说明 |
|:-----|:-----|
| **[docs/01-项目定位.md](./docs/01-项目定位.md)** | 产品定位（**从这里读起**） |
| **[docs/02-数据结构与D1.md](./docs/02-数据结构与D1.md)** | D1 schema |
| **[docs/03-Web模块模板.md](./docs/03-Web模块模板.md)** | Web basalt 模板 + Worker/Access |
| **[docs/04-Settings设计.md](./docs/04-Settings设计.md)** | Settings CRUD 与 CLI 读路径 |
| **[docs/05-管线铺垫与Ingest实现.md](./docs/05-管线铺垫与Ingest实现.md)** | 06 开工前置契约（Ingest / 域包 / CLI 骨架） |

## 部署前提

- **Cloudflare Workers Paid plan**（05 起冻结）。Ingest 一次请求最坏 ≈ 71 D1 statement，超过 Free tier 每 invocation 50 的上限。详见 [docs/05 §5.2](./docs/05-管线铺垫与Ingest实现.md)。

## 本地运行（Dashboard + Settings CRUD）

```bash
# 0. 依赖
bun install

# 1. 本地 D1 migrations
bun run db:migrate:local

# 2. 同时起 Vite (:7042) + Worker (:37042, local D1)
bun run dev:all

# 或分开：
# bun run dev:worker   # 终端 1
# bun run dev          # 终端 2

# 3. 浏览器
#    https://signoff.dev.hexly.ai   （Caddy TLS，推荐）
#    或 http://localhost:7042
```

生产 Worker 静态资源：`bun run build:web` 产出 `apps/web/dist`，由 `wrangler.toml` `[assets]` 挂载（SPA fallback）。deploy / dry-run 前必须先 build web。

`POST /api/pipeline/ingest` 目前返回 **501 Not Implemented**（不会假装写入 Activity/Score）。

本地鉴权：Worker 对 `localhost` / `127.0.0.1` / `*.dev.hexly.ai` 跳过 Access（与 bat 一致）。侧栏显示 **Dev (anonymous)**。生产需配置 `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`。

| 端口 | 用途 |
|-----:|:-----|
| 7042 | Vite SPA |
| 37042 | Worker + local D1 |

## 包

| 包 | 说明 |
|:---|:-----|
| `apps/web` | Dashboard SPA |
| `packages/worker` | Hono API（settings + 实体 CRUD） |
| `packages/db` | D1 migrations |
| `apps/gitinfo` / `apps/pulse` | 质量标杆 CLI |

## 常用命令

```bash
bun run test:coverage
bun run lint
bun run typecheck
bun run security
```

## 状态

Web dashboard + Settings / Developers / Teams / Tags / Repos CRUD 可本地运行；pipeline bootstrap/complete 可用；**ingest 写 Activity/Score 尚未实现（501）**。
