# signoff.now

围绕**开发者**与 **Git 仓库**的数据可视化与分析平台。

管理者在本机采集 Azure DevOps 数据，写入 Cloudflare D1；Web 只读展示活跃度热力图、明细与多选对比。

## 文档

| 文档 | 说明 |
|:-----|:-----|
| **[docs/01-项目定位.md](./docs/01-项目定位.md)** | 产品定位、实体、活跃度、管线与一期范围（**从这里读起**） |
| **[docs/02-数据结构与D1.md](./docs/02-数据结构与D1.md)** | 核心数据结构与 D1 schema / 迁库 |
| **[docs/03-Web模块模板.md](./docs/03-Web模块模板.md)** | Web **basalt 模板**；bat 为 Vite/Worker 参考实现；MVVM、覆盖率、hooks、Access |
| **[docs/04-Settings设计.md](./docs/04-Settings设计.md)** | Settings：DB、Web CRUD、CLI 读 D1 |
| [docs/README.md](./docs/README.md) | 文档索引 |
| [docs/archive/](./docs/archive/) | 历史文档（不代表当前定位） |

## D1

```bash
bun run db:migrate:local
bun run db:migrate:remote
```

DDL：`packages/db/migrations/`。说明见 02。

## 本地 Web

```bash
bun run dev
# https://signoff.dev.hexly.ai  → Caddy → Vite :7042
# /api/* proxy → wrangler :37042（Worker 就绪后）
```

端口与 Caddy 约定见 [docs/04-Settings设计.md](./docs/04-Settings设计.md) §4.2。

## 状态

定位（01）与 D1 schema（02）已确认；Web 模板（03）与 Settings 设计（04）已出稿；采集管线与 Web CRUD 待实现。
