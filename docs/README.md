# 文档索引

[中文 README](../README.md) · [English README](README.en.md)

本次评审从 [14 — 现状和目标](14-collector-architecture.md) 开始，再读 15–18。方案采用显式 PR 观察列表：网页 / CLI 添加和移除，确认终态后自动淘汰；发现由外围模块提交，查询只读缓存。**14–18 尚未实现，等待 Review。**

当前系统从 01、11、13 阅读；10 是 Mock 场景与早期 UI 记录。02、04–08 保留仍在使用的 Activity / Score 契约及阶段背景，不能用其中的旧 Dashboard 或命令状态推断当前 PR 工作台。工程质量要求及实际门禁差距以 [CLAUDE.md](../CLAUDE.md) 为准。

| 编号 | 文档 | 定位 / 状态 |
| --- | --- | --- |
| 01 | [项目定位](01-项目定位.md) | 当前产品概览；旧活动分析定位折叠保留 |
| 02 | [数据结构与 D1](02-数据结构与D1.md) | 早期实体 / 活动 schema；现有 PR 与目录迁移见 11、13 |
| 03 | [Web 模块模板](03-Web模块模板.md) | Basalt / MVVM 工程约定；质量执行现状见手册 |
| 04 | [Settings 设计](04-Settings设计.md) | 已实现 Settings 的设计记录 |
| 05 | [管线铺垫与 Ingest 契约](05-管线铺垫与Ingest实现.md) | 保留的活动管线阶段记录；早期 501 状态已被后续实现取代 |
| 06 | [Activity 重建与 Score 算法](06-Activity重建与Score算法.md) | 仍保留的算法 / API；非当前 PR 贡献统计口径 |
| 07 | [Activity 采集命令与落盘](07-CLI命令矩阵与ADO落盘.md) | 现有 collect / ingest、PR / 工作项 raw 与游标 |
| 08 | [历史上线与 Dashboard 统计](08-真实数据上线与Dashboard统计.md) | 活动管线上线与验收记录；当前页面见 13 |
| 09 | [Logo 使用](09-logo-usage.md) | 当前品牌资产 |
| 10 | [PR 工作台与 Mock 预览](10-PR工作台与Mock预览.md) | 示例场景与最初的 Mock 阶段记录 |
| 11 | [真实 PR 采集与本地工作台](11-真实PR采集与本地工作台.md) | 当前 ADO 采集、页面范围、队列、租约与快照契约 |
| 12 | [Access 与身份契约](12-agent-access.md) | 当前浏览器 / 自动化身份边界 |
| 13 | [成员目录与 PR 贡献统计](13-成员目录与PR贡献统计.md) | 当前成员关系、独立手动统计与历史口径 |
| 14 | [采集、调度与查询架构](14-collector-architecture.md) | **待 Review**：现状、目标、观察列表、实现与测试计划 |
| 15 | [网页查询与独立数据块](15-web-query-contract.md) | **待 Review**：多选观察、主动移除、局部错误恢复 |
| 16 | [观察列表与刷新状态机](16-scheduler-state-machine.md) | **待 Review**：按需发现、冷却、终态淘汰与在途竞争 |
| 17 | [Query 周期与新鲜度](17-query-cadence.md) | **待 Review**：采集 / 网页 / 外部项目周期，时间与完整性 |
| 18 | [CLI 查询与命令契约](18-cli-query-contract.md) | **待 Review**：pr / watch / discover / refresh、API、JSON 与退出码 |

## 辅助工具与归档

| 路径 | 说明 |
| --- | --- |
| [cli/](cli/README.md) | 当前 signoff 采集入口、gitinfo / pulse 辅助工具，以及新 Query CLI 的评审入口 |
| [archive/](archive/README.md) | 已退役的 Electron 架构、旧 CLI 草稿与桌面 PR UI；正文只作历史参考 |
