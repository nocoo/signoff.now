# 06 — Activity 重建与 Score 算法（大纲）

> 状态：大纲（05 完成后开工）
> 依赖：[05-管线铺垫与Ingest实现](./05-管线铺垫与Ingest实现.md)
> **不含**：真实 ADO 采集（属 07）

## 目标

把 05 冻结的 Ingest 契约与 domain 类型**实装为可写 D1** 的路径：fixture → transform → `POST /api/pipeline/ingest` → Activity/Score/Unmatched/IngestRun。

## 交付概要

| 项 | 内容 |
|:---|:-----|
| domain 实现 | `matchDeveloper` / `dayKey` / `buildExternalRef` / `aggregateScores` + 边界测试 ≥95% |
| Worker ingest | 替换 501：§5.3 多阶段 + §5.4 状态机 + migration `0006_ingest_run_states.sql` |
| CLI | `ingest fixture` 真 POST；fixture 首次 E2E 落库 |
| Web | heatmap / timeline 只读 API + MVVM（DTO 见 05 §8） |
| 算法定稿 | 05 §7.4 待决清单全部决策 |

## 05 §7.4 待决清单（转入本文）

- [ ] `pr.vote` 是否折叠
- [ ] `pr.active` / `wi.updated` 同日折叠策略
- [ ] 作者侧终态优先（merged/created/active）
- [ ] `activityCount` 折叠前 vs 后
- [ ] `pr.merged` 与 `pr.closed` 互斥
- [ ] 边界样例全表

## 非目标

- 真实 `az` / ADO REST 拉取（07）
- 历史 Score 快照表（二期）
