# CLI 导航

[返回文档索引](../README.md) · [根目录使用说明](../../README.md)

SignOff 当前有三个 CLI 包。工作台采集与辅助工具的数据来源不同，工作台缓存消费者不能与 `pulse` 的直接 GitHub 查询混淆。

| 工具 | 当前用途 | 当前说明 |
| --- | --- | --- |
| `signoff` / `@signoff/collect` | 缓存查询、共享关注清单、ADO 采集 daemon，以及保留的 Activity 管线 | [18 — CLI / HTTP](../18-cli-query-contract.md)、[11 — 真实 PR 采集](../11-真实PR采集与本地工作台.md)、[07 — Activity 落盘](../07-CLI命令矩阵与ADO落盘.md) |
| `gitinfo` / `@signoff/gitinfo` | 本地 Git 仓库、分支、工作区和提交分析 | [gitinfo 使用文档](gitinfo.md) |
| `pulse` / `@signoff/pulse` | 通过本机 GitHub CLI 查询 PR、详情、diff、搜索和仓库，需要有效 GitHub 访问权限 | [pulse 使用文档](pulse.md) |

## 共享监控清单与缓存查询

[18 — CLI 查询、观察与命令契约](../18-cli-query-contract.md) 定义新的 `signoff pr`、`watch list / add / remove`、`discover`、`refresh` 和 `daemon`。这些命令已实现；短命消费者只读本机 Worker / D1 的已发布缓存，无需 Azure / GitHub 登录，增删观察与刷新命令通过 API 交给后台模块。

架构入口见 [14](../14-collector-architecture.md)，调度和自动淘汰见 [16](../16-scheduler-state-machine.md)，消费者自己的 Query 周期见 [17](../17-query-cadence.md)。

不发布即可让其他 App 使用：在任意目录执行 `bun /Users/nocoo/workspace/personal/signoff.now/apps/collect/src/main.ts watch list --all`，读取运行中的本机 Worker。开发环境完整路径、启动条件及 Node.js 示例见 [18，第 6 节](../18-cli-query-contract.md#6-其他项目接入示例)。Agent 使用 [signoff-cli skill](../../skills/signoff-cli/SKILL.md)；本机入口为 `~/.codex/skills/signoff-cli/SKILL.md`，与仓库版本同步。

## 当前帮助入口

从仓库根目录执行：

```bash
bun run signoff --help
bun run signoff workbench --help
bun run gitinfo --help
bun run pulse --help
```

`gitinfo` / `pulse` 使用 JSON 输出，`--pretty` 用于缩进显示；`signoff` 查询默认输出 JSON，进度与错误写 stderr；`workbench watch` 是 daemon 别名，`workbench sync` 只排入显式发现任务。运行时为 Bun，类型与静态检查沿用根目录命令；各包实际测试 runner 和门禁见 [CLAUDE.md](../../CLAUDE.md)。

## 历史记录

[旧 CLI 草稿](../archive/cli-history/README.md) 与 [桌面 PR 方案](../archive/cli-desktop/README.md) 已归档，保留历史内容；当前命令以上方文档和实际 `--help` 为准。
