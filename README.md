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

## 本地运行（Dashboard + Settings CRUD）

```bash
# 0. 依赖
bun install

# 1. 本地 D1 migrations
bun run db:migrate:local

# 2. Worker（终端 1）— :37042，本地 D1
bun run dev:worker

# 3. Vite SPA（终端 2）— :7042
bun run dev

# 4. 浏览器
#    https://signoff.dev.hexly.ai   （Caddy TLS，推荐）
#    或 http://localhost:7042
```

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

Web dashboard + Settings / Developers / Teams / Tags / Repos CRUD 可本地运行；Activity 热力图与 ADO 采集管线待后续。
