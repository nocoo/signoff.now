# Retrospective

Accident narratives belong here. Keep only recurring project rules in `CLAUDE.md`; cross-project lessons belong in global rules and deterministic checks in hooks/tests.

### 2026-07-28 — D1 batch 不因 0 行回滚；预读回写会吞掉并发修改

**背景**：Codex review 指出 developer PATCH 两处缺陷，**本地都复现了**。

**缺陷 1（预读回写 / lost update）**：PATCH 先 `SELECT` 整行，再把 name/alias/
avatar 三个标量**全部**写回。两个只改不同字段的请求并发时，后落地的那个会用自己
读到的旧值覆盖对方刚写的新值，而**两个都返回 200**。实测：avatar-only + alias-only
并发后 avatar 丢失。
→ 改为 SQL 内 `CASE WHEN ?n = 1 THEN ? ELSE 列 END`，只写请求真正提到的列，不预读。

**缺陷 2（batch 不回滚）**：`UPDATE ... WHERE archived_at IS NULL` 命中 0 行时，
**D1 不会回滚同一 batch 的后续语句**（只有报错才回滚）。实测：membership INSERT
提交了、`pipeline_config_version` 也 +1 了，然后路由返回 404 —— 一次没人要求的
版本 bump，会让 Dashboard 一直 stale。
→ 每条依赖语句自带守卫。

**守卫选型（重要）**：`changes()` 报告的是**上一条改行语句**，含义随语句顺序变化。
夹在中间的语句一多就会悄悄失效。因此新增 `onlyIfLive: {table, id}`，用
`EXISTS(SELECT 1 FROM <表> WHERE id=? AND archived_at IS NULL)` —— **与顺序无关**。
`changes()` 版本保留给 archive/restore 那种"紧跟其后"的场景。

**规则化提醒**：

- **D1 batch 只在报错时回滚**，`changes === 0` 不回滚。凡是"前一条决定后面该不该做"
  的 batch，后面每一条都必须自带 SQL 守卫。
- **PATCH 不要预读整行再全量回写**。只写请求点名的列，并发修改才能叠加而非互相覆盖。
- **`changes()` 是位置相关的**，别在多语句 batch 中间用；要顺序无关就用 EXISTS。
- **验证安全修复时先怀疑测试脚手架**。这轮 shell 循环里 `$u` 展开导致一次假的
  "生产 200 通过"，换成逐条 single-quote 后三种凭据 URL 全是 400。
- **变异测试要覆盖谓词的每个分支**：`u.username || u.password` 把后半截删掉后测试
  仍然全绿（`https://:pw@host` 没被测到），补了用例才杀掉。

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

### Migrated Access setup incident (date not recorded)

Two things that cost time when they were missing:

- Creating the token is **not enough**. The Application protecting
  `signoff.hexly.ai` needs a **Service Auth** policy including that token, or
  Access answers 302 (measured — the redirect still carries the right AUD, so
  it looks like a credential problem and is not).
- A service-token JWT has **no `email`** and an empty `sub`; the only
  identifier is `common_name`. `principalFromPayload` reads it and sets
  `service: true`, otherwise `/api/me` reports a blank identity and an
  automated session is indistinguishable from a person's.

### 2026-09-21 — Sample discovery reused detailed-check coverage

During local validation of the collector cadence refactor, an automatic Sample discovery failed with `INCOMPLETE_UPLOAD`. The Sample executor classified its list publication using the cached PR check coverage. A fully enumerated list can contain PRs whose detailed checks are partial; those are separate completeness measures. Discovery now publishes complete enumeration independently of check coverage, while full PR refreshes preserve partial-check reporting. A regression test exercises Sample discovery with a partial cached PR. Live PR collection was unaffected.

## 2026-09-21 — Jev local runtime verification

The first connection test failed before reaching Jev because Workers rejects Fetch redirect mode `error`. Mock Fetch tests had accepted it. The implementation now uses `manual`, treats redirects as failures, and tests that request option. A real local Workers connection test and watched-PR evaluations then passed. The initial browser test cleanup used a new context without the local TLS setting; its temporary policy text was immediately restored and the corrected test completed successfully. Real-runtime checks remain necessary alongside typed mocks.

## 2026-09-21 — Observation clocks caused transient Jev Pending

The PR snapshot trigger invalidated evaluations for every JSON change, including collection timestamps. The scheduler correctly deduplicated identical decision facts, but the UI could briefly show Pending and an observation-only publication could discard an in-flight result. The trigger now ignores observation/update clocks while preserving explicit check-availability changes. Regression tests cover in-flight preservation, unchanged results across cooldowns, changed-only batch membership, and cooldown measured from request completion. Actual build/stage changes still enter Pending immediately and wait for the remaining cooldown.

## 2026-09-21 — Sidebar clipped the network tooltip

The network chart allowed its tooltip to escape the chart view box but left it inside Basalt's overflow-hidden sidebar. The initial E2E checked tooltip text without checking whether the part outside the sidebar was painted. The tooltip now uses Recharts' body portal with viewport-bounded positioning that follows scroll and resize. The regression checks a point outside the sidebar with browser hit testing. Local desktop and mobile navigation checks confirm the entire tooltip is visible; Escape still dismisses it.

### 2026-09-21 — Provider timeline timestamp sentinel rejected collection

Adding cached stage `lastModified` exposed a pre-epoch provider placeholder that the date parser accepted as a negative timestamp. The upload schema correctly rejected it, leaving earlier snapshots intact but causing watched refreshes to fail. The shared provider date parser now treats pre-epoch values as unavailable (`null`). A regression test parses a normalized stage with the ADO year-one placeholder through the full build schema. Temporary diagnostics recorded field paths only and were removed after diagnosis. Live refresh must be verified after restarting the collector, in addition to mocked normalization tests.

### 2026-09-21 — PR column breakpoints ignored content overflow

The first responsive PR-column change used fixed container breakpoints. Its browser checks verified those breakpoints but did not test whether the actual table fit. At a 1920px viewport, the live table needed approximately 2337px inside a 1596px container, yet both metadata columns remained visible. Column visibility now measures the actual table: hide Author first, then Repository if it still overflows, and restore each only when it fits. Resize, content and font changes trigger measurement; header, rows and skeleton share visibility. Regression checks include a wide viewport with long content, reload and sidebar resizing. The user explicitly retains complete content and permits residual horizontal scrolling after both columns are hidden.


### 2026-09-22 — Local API stalled while its port remained open

The dashboard HTML still returned 200 and both Vite and workerd were listening, but direct and proxied API health probes timed out. Wrangler logged requests taking 60–84 seconds and ProxyWorker connection losses; the collector repeatedly timed out too. Restarting only the local Worker restored database health and collector contact with all 13 existing watches intact. High machine load was observed, and later requests still occasionally exceeded 15 seconds during validation; the evidence does not establish the deeper runtime cause. No live cache was reset or seeded.

The browser previously surfaced AbortSignal timeout text independently in the PR list, repository filters and pending watch queue. The shared HTTP client now bounds reads, normalizes transport/proxy failures, and preserves navigation cancellation and structured domain errors. The workbench consolidates connection failures, retains cached rows, offers a cache-only retry, and clears the alert after recovery. An unavailable collector query now reports unknown status rather than claiming collection has paused. Regression checks cover simultaneous query failures, recovery, cancellation, body-read failure, and distinct authentication/business errors.

### 2026-09-22 — Idle collector claims scanned retained history

Slowness recurred while the machine was awake. HTML took 17 ms, but simultaneous cache API probes took 1.2–3.7 seconds, with earlier request logs reaching 11–17 seconds. Native workerd sampling showed substantial SQLite execution and page reads. The live cache contained approximately 15,300 collection jobs; the claim transaction repeatedly joined retained jobs by an unindexed lease token, even when no work was claimed. Read-only reproductions took up to 781 ms for a single empty lookup. A copied job table showed full scans before the index and lease seeks after it.

Migration 0036 adds a partial index for non-null lease tokens without deleting history or changing cooldowns. Applied to the running local database without restarting the service, four concurrent probe rounds returned PR lists in 0.48–0.58 seconds and health in 3–9 ms; idle claims logged approximately 7–12 ms. Query-plan regression checks cover the actual claim statements, alongside the existing scheduling, concurrency and lease-fencing tests. Sleep recovery is only a guard; the earlier restart did not identify or correct this database bottleneck.

The final local browser run loaded all 13 watches on three page loads in 1.9–2.8 seconds and verified an automatic refresh with no page or connection errors. These timings include concurrent dashboard API requests and local development assets, so they differ from isolated API probes and are not a latency guarantee. All seven workspace coverage tasks, lint, typecheck and build passed.

### 2026-09-22 — Verify Basalt export paths before changing a live view

While implementing Collections, replacing a native table with Basalt components imported `Table` from the package root. Basalt exports these components from `@nocoo/basalt/components/table`; the incorrect import briefly prevented the local Vite application from rendering. Typecheck and an actual browser load exposed the missing export. The import now follows the existing PR table. Read the installed types and neighboring imports before changing a shared component; verify typecheck before browser acceptance.

### 2026-09-22 — Compact evidence over-weighted a deferred final gate

During local readiness refactoring, typed mock tests passed while real compact inputs classified active-build PRs as Attention. The sampled evidence had no completed negative conclusion except Proof Of Presence, which the user's rules defer until builds and reviews finish. Retaining those rules in state did not reliably communicate which action was due now after removing detailed context. The rubric now explicitly excludes deferred final-step policies from immediate Attention and preserves prerequisite order. Its version changed so previous judgments cannot appear current under the revised question. Real reevaluation returned Running for active-build samples; valid model choices remain authoritative. Mixed build-currentness/review-policy evidence is recorded separately as a calibration limitation. Input-size reduction and schema validity do not establish semantic equivalence; compare real judgments on boundary cases before accepting a prompt refactor.

### 2026-09-22 — Unmet review policies looked like execution failures

The user confirmed that several successful, unexpired PRs should be Review Needed. The compact model input called both rejected policy evaluations and failed build executions `failed`. A live counterfactual retained Attention after changing only build-currentness, but returned Review Needed after changing only review compliance. Merely expanding category descriptions did not consistently fix deferred PoP cases. The shared evidence projection now describes completed policy conditions as `satisfied` / `unsatisfied`, retains build execution outcomes and all expiry evidence, and states this distinction in the question. Provider snapshots and inspection responses stay unchanged. A domain regression preserves these independent facts; eight bounded real-model cases covered review deficits, deferred PoP, active CI, build failure, unresolved comments, expiry and requested changes. The rubric version invalidates old cached judgments while preserving cooldown and deduplication. A known classification regression needs a concrete boundary check and correction, not an open-ended calibration note.

### 2026-09-22 — Missing reviews hid an unresolved discussion

The first scheduled source audit found a successful, unexpired PR classified Review Needed even though its blocking Comment requirements policy was rejected. Direct ADO reads confirmed two nondeleted pending threads requiring additional evidence. The saved Jev input already contained the unsatisfied C9 policy, so neither stale collection nor omitted evidence caused this judgment. The earlier comment-related sample also had a failed build; it did not isolate the comment condition once that build passed. The common rule now names unresolved discussions as human follow-up that missing reviewer approvals must not hide. Four bounded real requests verified this distinction alongside review-only, active-CI and partial-success controls. Future boundary checks must isolate competing blockers rather than count a case with several blockers as independent validation of each one.

### 2026-09-23 — Scope test updates to the scenario that changed

Repository discovery now produces separate repository receipts and a catalogue receipt. A broad replacement of the expected scan count also changed an unrelated scope-edit test that intentionally seeded one historical receipt. The focused route suite caught the incorrect assertion before commit, and it was restored. Update expectations inside the affected test block; identical assertion text does not imply identical setup or behavior.

### 2026-09-23 — Narrow process inspection before reading arguments

A broad process-text search for the word `collect` also matched an unrelated application's long telemetry arguments. The output was irrelevant to locating the SignOff daemon. Process inspection now first selects Bun/Node executables, checks their working directories, and reads arguments only for this repository. Use executable and workspace identity rather than generic feature words when inspecting a development service.

## 2026-09-23 — Directory fixture and long profile content

A scripted fixture update inserted `blockedContributorKeys` before the first
`revision` field in a test file, which belonged to a Project instead of Directory.
Typecheck caught it; the field was moved into the explicit Directory fixture.
Scope future replacements to the declared object, not a shared field name.
The first profile layout also allowed intrinsic name width and wrapping actions
to escape the intended compact layout. Constrain flex children with min-width zero,
wrap names, and verify action geometry at narrow viewport sizes before handoff.


## 2026-09-23: avatar registration interrupted PR publication

An avatar trigger used `INSERT OR IGNORE`, but an outer PR UPSERT overrode its conflict policy. Repeated avatar identities raised a unique constraint error and stopped both discovery and watched-PR publication. A read-only backup of the local database reproduced the failure. Replaced trigger inserts with explicit `ON CONFLICT(source,url) DO NOTHING`, repaired the four local triggers, and added repeated PR UPSERT coverage that preserves cached image bytes and refresh deadlines. Test trigger behavior through the actual outer UPSERT, not only a standalone UPDATE.

## 2026-09-23: contributor actions remounted the report

Directory revision was included in the report query identity. Follow and hide commands therefore cleared the cached report and unmounted its tables, discarding selection, pagination and hover state. Keep source and filters as query identity; directory revisions revalidate that same query while retaining the visible data. Background directory failures also retain the last successful data.

## 2026-09-23: portaled member pickers could not scroll

The bulk member picker passed selection tests with a few candidates, but those DOM tests never exercised a real overflowing list. In Edge, a 1,084px list inside a 240px viewport stayed at scroll position zero because the outer dialog's scroll lock canceled wheel events on the nonmodal popover portaled to the document body. A reproducible Bun patch exposes Basalt MultiSelect's underlying Radix Popover modal option. All directory dialog pickers enable it while page filters retain their existing behavior. Real browser regression coverage checks wheel scrolling, touch input, selection, Escape, focus return and background locking with 40 candidates. Check scroll behavior at the portal boundary rather than treating `overflow-y-auto` or passing selection tests as evidence that a list is usable.

The narrow-screen check also caught a menu extending below the viewport. Its flex layout now caps height at Radix's available space while preserving the search field and shrinking the scrollable list. Patch files participate in Turbo cache keys so editing an installed dependency cannot reuse an older build. During verification, a test initially used `/members` instead of the registered `/developers` route, and an assertion incorrectly required background wheel cancellation even when the overlay itself prevented background scrolling. Verify registered routes and observable scroll positions before drawing conclusions from test failures.
