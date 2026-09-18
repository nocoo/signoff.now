# SignOff

Project and PR workbench with local Azure DevOps collection and retained Activity/Score analytics.
Profile: ts-worker-web + ts CLI.
Direction: [product definition](docs/01-项目定位.md). Frameworks must preserve this handbook.

## Sources of Truth

This file is the quality contract; hooks, CI and config are enforcement. Close implementation gaps without lowering the contract. Historical test results are not evidence of a current passing run.

| Fact | Where |
|---|---|
| Product / live collection | [README.md](README.md), [PR workbench](docs/10-PR工作台与Mock预览.md), [local collection](docs/11-真实PR采集与本地工作台.md) |
| Directory / PR contributions | [members, relationships and manual statistics](docs/13-成员目录与PR贡献统计.md) |
| Watch list / query architecture | [implementation and contracts 14–18](docs/14-collector-architecture.md); shared persisted watches, explicit discovery, cache-only reads |
| Access / identity | [access contract](docs/12-agent-access.md), `packages/worker/src/middleware` |
| Runtime / versions | root, Worker and web `package.json`; keep those service versions aligned |
| Tests / enforcement | package Vitest and `bunfig.toml` configs, `.husky`, `scripts/run-security.ts`, CI |
| Accidents | [Retrospective.md](Retrospective.md) |
| Machine workflow | global `AGENTS.md` and Git rules |

## Project Invariants

- ADO PR collection is live locally; GitHub workbench collection is planned despite existing GitHub samples and pulse queries. Keep normalized provider contracts and sample/live separation.
- PR snapshots/jobs/staging are separate from Activity/Score ingest. Workbench collection writes only a loopback Worker and must not borrow the production pipeline token.
- Watch lists start empty. Registration, page loads, queries and an idle daemon must never invoke providers/auth or implicitly add watches. Discovery is explicit and includes all accessible states/history; confirmed terminal snapshots retire observations atomically.
- Scope identities by source, provider, organization, project, repository ID and PR number. Guard writes with project revisions, leases, snapshot versions and observation generations; a late result must not recreate removed watches.
- Browser Access and pipeline-token routes remain disjoint. Machine credentials may bootstrap/ingest/recompute/live/me, never entity CRUD or identity roster creation.
- CRUD automation needs an Access service token plus a Service Auth policy; identify service JWTs by `common_name` and mark `service: true`. Never assume email/sub.
- D1 is the product store. Use TDD; do not reintroduce Electron or local better-sqlite3/Drizzle product storage. Keep credentials in ignored `.env` (0600) and preserve its tracked example.
- Activity artifacts bind to the target environment IDs/config version: recollect after environment changes, retain idempotent chunks and run only one ingest at a time.
- Directory accounts link by exact provider/organization/actor identity. PR statistics use merge dates and calculate only on explicit module refresh; keep saved calculations and Live/Sample data separate. Demo writes remain restricted to local demo mode.

## Stack / Layout

| Component | Path / choice |
|---|---|
| Web / API / storage | `apps/web` Vite/Basalt; `packages/worker` Hono; `packages/db` D1 migrations |
| PR / analytics domain | `packages/domain`, provider-neutral facts and readiness rules |
| CLIs | `apps/collect` ADO/ingest; `apps/gitinfo` local Git; `apps/pulse` collaboration queries |

## Commands

Run from root with Bun 1.4.0, Node 22.22.1–22.x/24.x/26+, Git, gitleaks and OSV. Unit tests use injected providers/local SQLite and need no live Azure login. Actual collection requires an authorized `az` session and dedicated local data scope.

```bash
bun install --frozen-lockfile
bun run dev
bun run dev:worker
bun run dev:collector
bun run db:seed:local --directory-only
bun run lint
bun run typecheck
bun run build:web
bun run test:coverage
bun run test:e2e
bun run security
bun run gitinfo -- --help
bun run pulse -- --help
bun run signoff -- --help
```

## Verification

6DQ = L1/L2/L3 + G1/G2 + D1 (test isolation). Status: `enforced`, `planned`, `manual`, or `N/A`; partial enforcement below does not certify the full required bar.
L1 requires statements, branches, functions and lines each ≥95%, with no skipped/focused tests; preserve any stricter package threshold. Native tools must identify unmeasured metrics as gaps.
G1 requires check-only strict analysis/formatting with zero errors/warnings. G2 requires dependency and secret scans, with missing required scanners failing.

| Dimension | Status | Required proof and current evidence/gap |
|---|---|---|
| L1 TypeScript | planned | Vitest gates web four metrics at 95%, gitinfo branches at 88%, pulse at 90%; Bun packages lack branch coverage and collect functions is 93%. Exclusions also leave full 95% incomplete. |
| L2 Worker / CLI | planned | Unit suites include real SQLite and independent concurrent connections behind a D1 adapter. Monitoring adds HTTP contract tests and real CLI subprocess workflows. Full 100% route/command proof across legacy APIs is still incomplete. |
| L3 browser / CLI | manual | `bun run test:e2e` runs Playwright against a disposable Wrangler Worker/D1 plus real CLI subprocesses, with an injected provider. Covers discovery, watch add/remove, terminal retirement, concurrency and Live/Sample separation. Not yet wired to CI; legacy flows remain outside this lane. |
| G1 TypeScript | planned | CI uses full Biome with errors on warnings and typecheck. Local pre-commit uses autofixing lint-staged; index check-only behavior is incomplete. |
| G2 | enforced | `security` runs OSV and gitleaks in parallel, failing on missing tools/findings; CI shares the security gate. Existing ignores must stay explicit and reviewed. |
| D1 | planned | Monitoring unit/system harnesses use memory/temp SQLite and per-run D1/ports/process groups with marker/ownership cleanup guards. The legacy Activity shell E2E still uses default local D1 and fixed `.data` fixtures; run it only in a disposable copy. |

Pre-commit runs coverage, lint-staged and typecheck. Pre-push runs G2 only; the Electron-era L2 was removed. Secret scope is upstream..HEAD (or full history without upstream), not every stdin push ref. CI adds quality/security, not L2/L3.

Target hooks: pre-commit checks G1 + L1 against the index snapshot (`git checkout-index`) in <30s; pre-push checks L2 and G2 in parallel against every stdin push ref/commit in <3min, plus build where applicable. L3 runs in CI or an explicit manual lane.
Never bypass commit/push hooks, force-push, or use autofix in checks. Documentation changes do not authorize deploying or implementing new gates.

## Resources / Isolation

Dev: web 7042, local Worker 37042, optional trusted `https://signoff.dev.hexly.ai`. `SIGNOFF_DATA_DIR` controls collector artifacts; default is `.data`. The legacy shell E2E requires a running disposable loopback Worker (`SIGNOFF_PORT`) and resets named fixture rows in default local state; do not run it against daily data. The new `scripts/test-e2e.ts` uses per-run `--local --persist-to`, separate SQLite, `NODE_ENV=test`, checked markers and ownership guards. No remote test provisioning.

`dev:worker` applies local migrations before starting. Migration 0019 preserves cached PRs, cancels legacy work and creates zero watches. Forward migration 0020 preserves those watches and resolves Unicode project/repository scope through stable IDs, guarded by the project revision and exact repository catalog. `signoff daemon` claims explicit discovery and active-watch jobs; project refresh rounds cool down for 300 seconds after completion, independent of browser visibility. No periodic discovery is enabled. Web cache queries use independent blocks: PR/detail/pending 15 seconds, collector 3 seconds, catalog 30 seconds after request completion; hidden pages pause queries only.

## Operations / Release

Keep `/api/live` public, no-store, versioned and D1-aware (503 on failure); Access must also bypass that exact path while business routes retain verification. Follow README for current CI release and separate environment credentials; `db:seed:local` resets only named demo projects and is not a production workflow.

The Sample seed also initializes its member directory. Use `db:seed:local --directory-only` to add those relationships without resetting existing PR or project settings.

## Git workflow

- Develop directly on `main`; do not create a branch unless the user explicitly asks.
- Make atomic commits: one coherent, reviewable change per commit, with its relevant tests.
- Preserve all existing commits when bringing an existing branch into `main`; use a normal merge, never squash or rewrite history.
- Run the required checks and keep commit/push hooks enabled. Push when authorized by the task.

## Retrospective

Move accident narratives to [Retrospective.md](Retrospective.md); keep at most about ten concise recurring project rules here. Put architecture and operational detail in linked docs.

- PATCH only fields present in the request; avoid read-whole-row/write-whole-row lost updates.
- D1 batches roll back on errors, not zero affected rows; guard each dependent statement with SQL predicates.
- `changes()` depends on statement order; use EXISTS for order-independent guards.
- Keep write/read/aggregate/write flows staged and idempotent; test auth and validation predicates branch by branch.
