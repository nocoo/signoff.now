# SignOff

Project and PR workbench with local Azure DevOps collection and retained Activity/Score analytics.
Profile: ts-worker-web + ts CLI.
Direction: [product definition](docs/01-项目定位.md). Frameworks must preserve this handbook.

## Scope and instruction sources

- This file is the only project handbook; nested files do not compete with it. Do not create a `CLAUDE.md` alias or copy.
- This file is the quality contract; hooks, CI and config are enforcement. Close implementation gaps without lowering the contract. Historical test results are not evidence of a current passing run.
- Product/live collection: [README.md](README.md), [PR workbench](docs/10-PR工作台与Mock预览.md), [local collection](docs/11-真实PR采集与本地工作台.md). Directory/PR contributions: [members, relationships and manual statistics](docs/13-成员目录与PR贡献统计.md). Watch list/query architecture: [implementation and contracts 14–18](docs/14-collector-architecture.md); shared persisted watches, explicit discovery, cache-only reads. Access/identity: [access contract](docs/12-agent-access.md) and `packages/worker/src/middleware`. Runtime/versions: root, Worker and web `package.json`; keep those service versions aligned. Tests/enforcement: package Vitest and `bunfig.toml` configs, `.husky`, `scripts/run-security.ts`, CI. Accidents: [Retrospective.md](Retrospective.md). Machine workflow: global `AGENTS.md` and Git rules.

## Project invariants

- ADO PR collection is live locally; GitHub workbench collection is planned despite existing GitHub samples and pulse queries. Keep normalized provider contracts and sample/live separation.
- PR snapshots/jobs/staging are separate from Activity/Score ingest. Workbench collection writes only a loopback Worker and must not borrow the production pipeline token.
- Watch lists start empty. Registration, page loads, queries and an idle daemon must never invoke providers/auth or implicitly add watches. Explicit discovery includes all states: first/full scans cover history, subsequent scans use only a successfully published repository cursor and an overlapping creation window. Never assume ADO PR ID ordering. Confirmed terminal snapshots retire observations atomically.
- Scope identities by source, provider, organization, project, repository ID and PR number. Guard writes with project revisions, leases, snapshot versions and observation generations; a late result must not recreate removed watches. Reconcile summary/check facts by their own observation times, and shared repository names by their metadata clock; completion order must not revert newer facts.
- Browser Access and pipeline-token routes remain disjoint. Machine credentials may bootstrap/ingest/recompute/live/me, never entity CRUD or identity roster creation.
- Every API route is default-deny through `packages/worker/src/route-policy.ts` (public, member, admin, collector, pipeline); a test fails when a registered route has no policy. Access users need tenant membership; admins come from the `SIGNOFF_ADMIN_EMAILS` secret or the `admins` table. Loopback trust requires both a local host and `SIGNOFF_LOCAL_TRUST=1`, set only by the dev and E2E launchers. See [docs/23](docs/23-remote-connector-and-tenants.md).
- CRUD automation needs an Access service token plus a Service Auth policy; identify service JWTs by `common_name` and mark `service: true`. Never assume email/sub.
- D1 is the product store. Use TDD; do not reintroduce Electron or local better-sqlite3/Drizzle product storage. Keep credentials in ignored `.env` (0600) and preserve its tracked example.
- Activity artifacts bind to the target environment IDs/config version: recollect after environment changes, retain idempotent chunks and run only one ingest at a time.
- Directory accounts link by exact source/provider/organization/actor identity. Insights counts PRs created in the last 90 UTC dates from cached facts; the global Calculate command requests deep per-repository discovery and lifecycle refresh. Keep Live/Sample data separate. Demo writes remain restricted to local demo mode.

## Setup and commands

Web/API/storage: `apps/web` Vite/Basalt, `packages/worker` Hono, `packages/db` D1 migrations. PR/analytics domain: `packages/domain`, provider-neutral facts and readiness rules. CLIs: `apps/collect` ADO/ingest, `apps/gitinfo` local Git, `apps/pulse` collaboration queries. Run from root with Bun 1.4.0, Node 22.22.1–22.x/24.x/26+, Git, gitleaks and OSV. Unit tests use injected providers/local SQLite and need no live Azure login. Actual collection requires an authorized `az` session and dedicated local data scope.

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

## Testing and quality contract

6DQ keeps its name with unified L1, L2/L3, G2 and D1; the owner merged former G1 into L1 on 2026-09-21. Statuses: `enforced`, `planned`, `manual`, or `N/A`; partial enforcement below does not certify the full required bar.
Unified L1 requires statements, branches, functions and lines each ≥95%, with no skipped/focused tests; strict check-only types and lint/format with zero errors/warnings; installed hooks and failure rejection. Preserve any stricter package threshold. Native tools must identify unmeasured metrics as gaps.
G2 requires dependency and secret scans, with missing required scanners failing.

| Dimension | Status | Required proof and current evidence/gap |
|---|---|---|
| L1 TypeScript | planned | Vitest gates web four metrics at 95%, gitinfo branches at 88%, pulse at 90%; Bun packages lack branch coverage and collect functions is 93%. Exclusions also leave full 95% incomplete. CI uses full Biome with errors on warnings and typecheck; local pre-commit uses autofixing lint-staged, so index check-only behavior is incomplete. |
| L2 Worker / CLI | planned | Unit suites include real SQLite and independent concurrent connections behind a D1 adapter. Monitoring adds HTTP contract tests and real CLI subprocess workflows. Full 100% route/command proof across legacy APIs is still incomplete. |
| L3 browser / CLI | manual | `bun run test:e2e` runs Playwright against a disposable Wrangler Worker/D1 plus real CLI subprocesses, with an injected provider. Covers discovery, watch add/remove, terminal retirement, concurrency and Live/Sample separation; `bun run test:e2e -- <spec or -g filter>` selects tests. Not yet wired to CI; legacy flows remain outside this lane. |
| G2 | enforced | `security` runs OSV and gitleaks in parallel, failing on missing tools/findings; CI shares the security gate. Existing ignores must stay explicit and reviewed. |
| D1 | planned | Monitoring unit/system harnesses use memory/temp SQLite and per-run D1/ports/process groups with marker/ownership cleanup guards. The legacy Activity shell E2E still uses default local D1 and fixed `.data` fixtures; run it only in a disposable copy. |

Pre-commit runs coverage, lint-staged and typecheck. Pre-push runs G2 only; the Electron-era L2 was removed. Secret scope is upstream..HEAD (or full history without upstream), not every stdin push ref. CI adds quality/security, not L2/L3.

Target hooks: pre-commit checks unified L1 against the index snapshot (`git checkout-index`) in <30s; pre-push checks L2 and G2 in parallel against every stdin push ref/commit in <3min, plus build where applicable. L3 runs in CI or an explicit manual lane.
Never bypass commit/push hooks, force-push, or use autofix in checks. Documentation changes do not authorize deploying or implementing new gates.

## Resources and isolation

Dev: web 7042, local Worker 37042. Always open the development UI through the Caddy HTTPS domain `https://signoff.dev.hexly.ai`; do not use localhost URLs for browser access. `SIGNOFF_DATA_DIR` controls collector artifacts; default is `.data`. The legacy shell E2E requires a running disposable loopback Worker (`SIGNOFF_PORT`) and resets named fixture rows in default local state; do not run it against daily data. The new `scripts/test-e2e.ts` uses per-run `--local --persist-to`, separate SQLite, `NODE_ENV=test`, checked markers and ownership guards. No remote test provisioning.

`dev:worker` applies local migrations before starting. Migration 0019 preserves cached PRs, cancels legacy work and creates zero watches. 0020 resolves Unicode project/repository scope through stable IDs; 0021 adds explicit-discovery cursors. 0022 adds an independent status lane and bounded clock-aware publication; 0023 gives shared repository names their own fact time. 0024 adds versioned state machines and bounded observation history; 0025 permits two concurrent claims per project/lane. These forward migrations preserve existing watches, snapshots and cooldown settings without creating work.

`signoff daemon` reserves two workers per lane: status checks each active PR 30 seconds after its last attempt, while full checks become due per PR after the configured cooldown (default 300 seconds after that PR's last attempt completes). Each project permits two running tasks per lane; explicit discovery runs exclusively in the checks lane and queued discovery cannot be starved by newer checks. Manual full checks do not disable lifecycle checks; empty watches create no periodic provider work. A confirmed terminal summary skips enrichment and atomically publishes, retires the watch and cancels other work for that generation. Status receipts expire after 24 hours without deleting snapshots or stopped observations. Collector queries expose actual oldest fact ages; cooldowns are not a maximum-latency guarantee.

Readiness, custom mappings and gate priority belong to the shared domain state-machine evaluator. Web and CLI consume the same cached query results. Workspace → State machines supports project defaults/repository overrides, preview and version rollback. Provider evidence and rule revisions are retained for replay; layout/filter changes never modify facts. See [state-machine contract](docs/19-pr-state-machines.md).

Web cache queries use independent blocks: Collector every 3 seconds signals source `dataRevision` changes through coalesced `revalidate`, preserving coherent in-flight reads; PR/detail/pending 15 seconds and catalog 30 seconds remain fallbacks. Explicit reloads and command receipts fence older reads. Hidden pages pause queries only; the daemon keeps running. Time values represent successful facts, never query time or a promise of maximum latency. See contracts 14–18 for publication limits and action-evidence boundaries.

## Operations / release

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

## Local Development

- When starting local development or opening this project's frontend in a browser, use the Caddy HTTPS URL: `https://signoff.dev.hexly.ai`.
- Do not use direct `localhost` or `127.0.0.1` URLs for browser access. If the Caddy URL is unavailable, diagnose the proxy instead of switching to a direct URL.
- Start the frontend with `bun run dev` and the local API with `bun run dev:worker` when needed; reuse healthy running instances.
- `bun run dev:collector` is the canonical standalone Connector command and invokes `daemon` directly.
- `bun run dev:all` starts the frontend, local API and Connector together. `bun run start:all` first builds the frontend, then starts Vite preview with the same local API and Connector. Both use the Caddy URL and local D1; neither deploys or connects to production D1. Stop the existing stack before switching modes; both reserve ports 7042 and 37042. Ctrl+C stops the grouped processes.
- Connector polling coalesces heartbeats globally and scheduling per lane with a 15-second cooldown after success. Empty claims back off from 3 to 6 to 12 to at most 15 seconds; processed work resets the delay and drains queued tasks immediately. AI ticks run every 10 seconds. Keep task lease renewal independent of these cooldowns. Idle manual commands may wait up to 15 seconds plus request time to be claimed.
- Grouped runtime logs use timestamped, colored categories for heartbeat, claim, scheduling, cache, AI and task activity. Slow HTTP responses (at least one second) and 4xx responses are warnings; 5xx responses are errors. Collector task logs include lane, target, short job ID and completion duration. Set `NO_COLOR=1` for plain runtime logs. Preserve unknown Wrangler diagnostics and stderr routing when changing the formatter.
- Internal upstreams remain unchanged: Caddy forwards to Vite on port `7042`, and Vite proxies `/api` to the local Worker on port `37042`.

## Cached Reports and Discovery

- Insights uses the last 90 UTC creation dates. Query routes only read cached facts; provider work belongs to explicit commands or collector scheduling.
- Keep all visible repository authors in the comparison denominator when filtering followed contributors. Link accounts only by exact source/provider/organization/actor identity.
- Discovery tasks are scoped by repository and depth (`smart` or `deep`). Deep report discovery refreshes summary/lifecycle data; detailed checks belong to watched PRs.
- See `docs/22-contribution-reports.md` for the report and collection contract.

- Contributor hiding is source-scoped and preserves PR cache and follow membership. Use Hide, Unhide and Hidden in the UI. Avatar reads use local D1; collector refreshes images every seven days.

## Modal Pickers

- Set `modal` on Basalt `MultiSelect` inside a dialog so its portaled list participates in the active scroll/focus lock. The Bun patch for Basalt 2.1.8 exposes Radix Popover's existing option; retain this behavior when upgrading Basalt.
- Verify overflowing pickers with real browser wheel and touch input. DOM-only selection tests do not exercise modal scroll locks; see `tests/e2e/directory-scroll.spec.ts`.
