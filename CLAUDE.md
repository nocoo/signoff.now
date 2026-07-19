# signoff.now

Developer + git-repo activity analytics platform (manager-facing).

Canonical product definition: **[docs/01-项目定位.md](./docs/01-项目定位.md)**.

## Shape

| Piece | Role |
|:------|:-----|
| **Web** | Vite SPA on CF Worker + Access; CRUD entities/settings; **read-only** Activity/Score |
| **CLI / Scripts / Skills** | Local ADO collection → JSON under `.data/` (gitignored) → validate → ingest D1 |
| **DB** | Cloudflare D1 (not Electron SQLite) |

## Layout

```
apps/gitinfo/   # quality-bar CLI (local git)
apps/pulse/     # quality-bar CLI (remote collab patterns)
apps/web/       # Vite frontend scaffold
docs/01-*.md    # product docs
.data/          # local payloads — never commit
```

## Commands

```bash
bun run dev
bun run test / test:coverage
bun run lint
bun run typecheck
bun run security   # osv-scanner (osv-scanner.toml) + gitleaks
bun run gitinfo -- --help
bun run pulse -- --help
```

## Quality

- TDD; Biome 0 warnings
- Coverage ≥95% on CLI/scripts/shared and web Model/ViewModel; Views excluded
- Do not reintroduce Electron or local better-sqlite3/drizzle for product data

## Retrospective

### 2026-07-19 — 05 文档职责越界与 Ingest 契约错误

**背景**：写 `docs/05-管线铺垫与Ingest实现.md` 时,把"05 铺垫 + 06 实装"混成"05 实施 P1..P4",且 Ingest 契约包含多处技术错误。经 Codex review + 用户认可,重写为「06 开工前置契约」。

**具体错误**：

1. **职责越界**:把 Activity/Score 真实写入、fixture 首次落库、Web 数据读回、真实 ADO 采集全部塞进 05 的 P1..P4;正确边界是 05 只做"契约与基础设施",实装留 06。
2. **INSERT ... VALUES ... WHERE 无效 SQL**:SQLite/D1 不支持 `INSERT OR REPLACE ... VALUES (...) WHERE ...`;应改用 `INSERT ... ON CONFLICT(external_ref) DO UPDATE`。
3. **误判 batch 语义**:错误声称"batch 中 `changes===0` 会让整个 batch 回滚"。实际上 D1 batch 只在 statement 报错时回滚;CAS 保护必须写进 SQL `WHERE`,并读 `meta.changes` 判定 200/409。
4. **无视 D1 查询预算**:提"单次 5000 条 activity",实际 D1 每次 Worker invocation 上限 Free 50 / Paid 1000 stmt;应用层硬上限应设 ≤500 条/chunk,预留二次查询与 Score UPSERT 余量。
5. **假想的"单 batch 全链路原子"**:Activity 写 + 二次查询 + TS 聚合 + Score 写不可能在一个 batch 完成——D1 中间不能返回查询结果给 TS。必须拆多阶段 + chunk 幂等 + CLI 重试兜底。
6. **鉴权契约不一致**:03 与 `pipeline-auth.ts` 都放行"Access 浏览器 → pipeline write";应明确浏览器 Access 禁 pipeline write,同步修中间件与 03。
7. **服务端过度信任 CLI**:客户端不应提供 `id` / `externalRef` / `dayKey` / `config_version`;服务端必须重算并比对。
8. **parseUniqueName 剥前缀属猜测**:01 明确"人类身份 uniqueName 几乎全是邮箱 + 精确匹配";剥 `vsts:` 之类前缀是没有真实数据支持的过度设计,已删除。

**做对的**:

- 用 `herdr agent read` 拿 Codex 完整意见后**未跳过任何一条**,每条都在重写里响应。
- 分 3 个原子 commit(范围重定位 / Ingest 契约 / §6-§13 收缩)分别提交,便于 review 追溯。

**规则化提醒**:

- **写"设计文档"时必须先划清"本文档不做什么"**——防止范围膨胀。
- **凡涉及具体 SQL / 平台限制,必须查最新官方文档**(D1 statement 上限、事务语义、batch 行为);不要凭印象写。
- **多阶段流程 vs 单事务**:D1 上任何需要"写→读→算→再写"的路径必须显式建模为多阶段 + 幂等 + 状态机,禁止承诺跨阶段原子。
- **契约收敛先于实施**:契约不定死就开工实施 = 后期返工;05 这种"铺垫文档"要么冻结契约,要么就明确"待 06 定"。
