# 07 — CLI 命令矩阵与 ADO 落盘（大纲）

> 状态：大纲（06 完成后展开）
> 依赖：[06-Activity重建与Score算法](./06-Activity重建与Score算法.md)、[05](./05-管线铺垫与Ingest实现.md)

## 目标

真实 ADO 数据源：`az` 登录 → REST 拉 PR/WI → raw 落盘 → zod validate → transform → 复用 06 的 Ingest 链路。

## 交付概要

| 项 | 内容 |
|:---|:-----|
| 命令矩阵 | `collect` 真路径；增量游标；错误分类 |
| raw schema | 逐字段 zod + `schemaVersion`（目录见 domain `paths`） |
| transform | raw + settings + devs → `Activity[]`（用 06 domain 函数） |
| 命名 | `apps/collect` 临时名 → final monorepo 位置/包名 |
| 观测 | ingest_runs 进度、重试策略与 05 §5.2 分片 |

## 非目标

- 计分算法（06 已定）
- Ingest 协议变更（05 已冻结）
