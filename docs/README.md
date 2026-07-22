# 文档索引

按编号阅读。**当前有效的产品定义从 01 开始。**

| 编号 | 文档 | 状态 |
|:-----|:-----|:-----|
| 01 | [项目定位](./01-项目定位.md) | 已确认 |
| 02 | [数据结构与 D1](./02-数据结构与D1.md) | 已确认（0001–0005 本地+远端已应用） |
| 03 | [Web 模块模板](./03-Web模块模板.md) | 设计稿（**basalt 模板**；Access / pipeline 鉴权见 §8，与 05 §5.6 对齐） |
| 04 | [Settings 设计](./04-Settings设计.md) | 设计稿（DB / Web CRUD / CLI 读 D1；recompute 见 §6.7） |
| 05 | [管线铺垫与 Ingest 契约](./05-管线铺垫与Ingest实现.md) | **已实施**（S1–S5；ingest 仍 501；**要求 Cloudflare Workers Paid plan**） |
| 06 | [Activity 重建与 Score 算法](./06-Activity重建与Score算法.md) | **设计稿**（待 review；未实施；fixture→D1→heatmap） |
| 07 | [CLI 命令矩阵与 ADO 落盘](./07-CLI命令矩阵与ADO落盘.md) | 大纲（06 完成后展开） |

## 归档

| 路径 | 说明 |
|:-----|:-----|
| [archive/](./archive/) | Electron 时代、旧 CLI 草稿、桌面 PR UI 等 |
| [cli/](./cli/) | 既有 `gitinfo` / `pulse` 工程说明（质量标杆参考，**不是** 01 产品全文） |
