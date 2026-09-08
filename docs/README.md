# 文档索引

[中文 README](../README.md) · [English README](README.en.md)

当前产品从 01 定义起阅读。编号文档保留设计理由与阶段记录；使用、开发和采集入口见 README。

| 编号 | 文档 | 主题 |
| --- | --- | --- |
| 01 | [项目定位](01-项目定位.md) | 开发者与仓库活动分析的范围和术语 |
| 02 | [数据结构与 D1](02-数据结构与D1.md) | 实体、活动、积分与 migrations |
| 03 | [Web 模块模板](03-Web模块模板.md) | 页面结构、模板来源及 Access / pipeline 认证边界 |
| 04 | [Settings 设计](04-Settings设计.md) | 配置、版本变更与全量重算 |
| 05 | [管线铺垫与 Ingest 契约](05-管线铺垫与Ingest实现.md) | 管线接口、域模型与写入契约 |
| 06 | [Activity 重建与 Score 算法](06-Activity重建与Score算法.md) | 活动重建、折叠、计分与本地 fixture |
| 07 | [真实 ADO 采集](07-CLI命令矩阵与ADO落盘.md) | PR / 工作项采集、落盘、manifest 与游标 |
| 08 | [真实数据上线与 Dashboard 统计](08-真实数据上线与Dashboard统计.md) | 部署、统计 API、对账与阶段验收记录 |
| 09 | [Logo 使用](09-logo-usage.md) | 品牌图源与使用方法 |

## 辅助工具与归档

| 路径 | 说明 |
| --- | --- |
| [cli/](cli/README.md) | `gitinfo` / `pulse` 辅助 CLI；独立于当前 ADO 采集管线 |
| [archive/](archive/) | Electron 时代、旧 CLI 草稿与桌面 PR UI 文档 |
