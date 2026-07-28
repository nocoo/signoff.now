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

## Production access

Two hosts, one Worker, two auth paths — see README「运维手册」for the full setup.

| Host | Caller | Auth |
|:-----|:-------|:-----|
| `signoff.hexly.ai` | people, and automation needing **CRUD** | Cloudflare Access |
| `signoff-ingest.hexly.ai` | CLI ingest | `SIGNOFF_PIPELINE_WRITE_TOKEN` |

**The pipeline token cannot create entities.** `MACHINE_ROUTES`
(`middleware/entry-control.ts`) whitelists only bootstrap / ingest /
recompute / live / me; every CRUD route answers 403. That is deliberate — a
leaked ingest token should be able to write activity data, never to add an
identity to the roster and start scoring it.

So automation that needs CRUD authenticates as an Access **service token**:

```bash
curl -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
     -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
     https://signoff.hexly.ai/api/repos
```

Two things that cost time when they were missing:

- Creating the token is **not enough**. The Application protecting
  `signoff.hexly.ai` needs a **Service Auth** policy including that token, or
  Access answers 302 (measured — the redirect still carries the right AUD, so
  it looks like a credential problem and is not).
- A service-token JWT has **no `email`** and an empty `sub`; the only
  identifier is `common_name`. `principalFromPayload` reads it and sets
  `service: true`, otherwise `/api/me` reports a blank identity and an
  automated session is indistinguishable from a person's.

Credentials live in `.env` (gitignored, chmod 600). `.env.example` documents
the shape and is tracked — `.gitignore` has an explicit `!.env.example` after
the `.env.*` rule, or the template would be ignored too.

## Quality

- TDD; Biome 0 warnings
- Coverage ≥95% on CLI/scripts/shared and web Model/ViewModel; Views excluded
- Do not reintroduce Electron or local better-sqlite3/drizzle for product data

## Retrospective

### 2026-07-28 — 采集产物绑定环境，跨环境重放必然 422

**背景**：把一份 06:59 采集的 artifact ingest 到生产，得到 `HTTP 422`。

**原因**：artifact 里的 `developerId` / `repoId` 是**采集当时那个环境的主键**。生产的
developer 行创建于 01:44 UTC、repo 是 `9f9ff2bc…`，而 artifact 里写的是
`05ab05e8…` / `7614d977…` —— 两边对不上，服务端按 05 §5.5 拒收。

**做对的**：

- 服务端拒收是**正确行为**，不是 bug。核对后确认 `activities` 仍为 0、游标未推进，
  422 干净回滚，没有留下半截状态。
- 没有去改服务端放宽校验，而是重新采集。

**规则化提醒**：

- **artifact 不是环境无关的**。换目标环境（或目标环境的 roster/repo 重建过）之后，
  旧 artifact 必须**重新采集**，不能重放。
- ingest 报 422 先查**主键是否属于目标环境**，再怀疑数据本身。
- 判断"有没有写脏"要直接查 `activities` 计数与游标，别靠 CLI 退出码推测。

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
