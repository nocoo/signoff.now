# 24 — Local Development, Runtime Operations, and Quality Boundaries

Operational reference offloaded from root [AGENTS.md](../AGENTS.md). Architecture and contracts live in [Collector architecture](14-collector-architecture.md), [Scheduler state machine](16-scheduler-state-machine.md), [Query cadence](17-query-cadence.md), [PR state machines](19-pr-state-machines.md), [Contribution reports](22-contribution-reports.md), and [Remote connectors & tenants](23-remote-connector-and-tenants.md).

## Local Stack Modes and Upstreams

- Browser access must always use the Caddy HTTPS URL `https://signoff.dev.hexly.ai`, never direct `localhost` or `127.0.0.1` URLs. If the Caddy URL is unavailable, diagnose the proxy rather than switching to a direct URL.
- Internal upstreams: Caddy forwards to Vite on port `7042`; Vite proxies `/api` to the local Worker on port `37042`.
- Standalone commands: `bun run dev` (frontend), `bun run dev:worker` (applies local D1 migrations via `db:migrate:local`, then starts Worker with `SIGNOFF_LOCAL_TRUST=1`), and `bun run dev:collector` (canonical standalone Connector command invoking `daemon` directly). Reuse healthy running instances.
- Grouped commands:
  - `bun run dev:all` runs Vite dev, local Worker API, and Connector together.
  - `bun run start:all` builds the frontend first (`build:web`), then runs Vite preview with the same local Worker API and Connector.
  - Both modes use the Caddy URL and local D1 only; neither deploys nor connects to production D1. Stop the existing stack before switching modes because both reserve ports `7042` and `37042`. `Ctrl+C` stops the grouped processes (verify both ports are free before restarting; see [Retrospective.md](../Retrospective.md)).
- `SIGNOFF_DATA_DIR` controls Activity collector artifacts (default `.data`), separate from Wrangler's local D1 PR cache.
- Demo seeding: `bun run db:seed:local` resets only named demo projects and is never a production workflow. The Sample seed also initializes its member directory; pass `bun run db:seed:local --directory-only` to add directory relationships without resetting existing PR or project settings.

## Connector Polling, Scheduling, and Watch Retirement

- `watchCollections` (`apps/collect/src/workbench/run.ts`) runs five concurrent worker loops: two `checks` (watched PR refresh) workers, one `discover` (project/repository discovery) worker, one `ai` (Jev readiness) worker, and one `avatars` worker. The older separate 30-second status lane was removed (see [17-query-cadence.md](17-query-cadence.md)).
- Global heartbeat and per-lane scheduling (`checks`, `discover`) coalesce with a `15s` cooldown after success.
- Empty claim loops back off exponentially (`3s → 6s → 12s → max 15s`). Processed work resets the idle delay to `3s` and drains queued tasks immediately. Transport errors wait `10s`.
- AI ticks run every `10s`; avatar batches sleep `1s` after processing work and `60s` when idle.
- Task lease renewal (`120s` lease, `20s` running-task heartbeat) remains independent of polling and scheduling cooldowns. Idle manual commands may wait up to `15s` plus request time before being claimed.
- Per-project concurrency allows up to two running refresh tasks and one discovery task; queued discovery cannot be starved by newer checks. Manual full checks do not disable automatic lifecycle checks, and empty watch lists generate zero periodic provider work.
- Watch retirement and membership:
  - Confirmed terminal summaries (`completed` / `abandoned`) skip enrichment and atomically publish the final snapshot, stop collection, and cancel sibling work for that generation.
  - Watch membership survives terminal retirement: `active` is the collection flag, not the membership flag, so lifecycle and Watched filters compose independently. Manual Unwatch clears membership including retired watches.
  - Validated open discovery publication resumes retained terminal watches under a new generation with an immediate check; manually removed or scope-invalidated watches never resume automatically.
  - Status receipts expire after 24 hours without deleting snapshots or stopped observations. Collector queries report actual oldest fact ages; cooldowns are minimum post-completion waits, not a maximum-latency guarantee.

## Grouped Runtime Logs

- `apps/collect/src/runtime-log.ts` and `scripts/dev-worker-log.ts` format grouped runtime logs with timestamped, colored categories (`HEARTBEAT`, `HEALTH`, `CLAIM`, `SCHEDULE`, `CACHE`, `WRITE`, `AI`, `AVATAR`, `NETWORK`, `TASK`, `CHECKS`, `DISCOVER`, `COLLECTOR`, `API`).
- Slow HTTP responses (`>= 1s`) and `4xx` responses log as warnings; `5xx` responses log as errors.
- Collector task logs include lane, target (`org/project[/repo #pr]`), 8-char short job ID, and completion duration.
- Set `NO_COLOR=1` for plain uncolored logs. Preserve unknown Wrangler diagnostics and `stderr` routing whenever changing the formatter.

## Web Cache Cadence and Forward Migrations

- Web cache queries run in independent blocks: Collector polls every `3s` and signals source `dataRevision` changes through coalesced `revalidate`, preserving coherent in-flight reads. PR/detail/pending (`15s`) and catalog (`30s`) timers remain fallbacks.
- Explicit reloads and command receipts fence older in-flight reads. Hidden pages pause browser query timers only; the daemon keeps running. Displayed timestamps represent successful observation facts, never query time or a latency SLA (details in [docs 14–18](14-collector-architecture.md)).
- Forward D1 migrations preserve existing watches, snapshots, and cooldown settings without creating work:
  - `0019` preserves cached PRs, cancels legacy work, and creates zero watches.
  - `0020` resolves Unicode project/repository scope via stable IDs; `0021` adds explicit-discovery metadata/cursors.
  - `0022` adds bounded clock-aware publication; `0023` gives shared repository names independent fact time.
  - `0024` adds versioned state machines and bounded observation history; `0025` permits two concurrent claims per project/lane.

## Coverage Boundaries, Local Hook Gaps, and E2E Isolation

- **Per-package L1 coverage gates** (target: statements, branches, functions, and lines each ≥95%):
  - `apps/web` (Vitest): four metrics ≥95% on `src/models`, `src/viewmodels`, and `src/lib`; Views and legacy HTTP clients (`activityApi.ts`, `settingsApi.ts`, `statsApi.ts`) remain explicitly excluded.
  - `apps/gitinfo` (Vitest): statements/functions/lines ≥95%, branches floor 88% (I/O adapters & thin wrappers excluded).
  - `apps/pulse` (Vitest): statements/functions/lines ≥95%, branches floor 90% (I/O adapters, fs-cache & mock-client excluded).
  - `packages/domain`, `packages/worker`, `packages/db` (Bun test): lines/functions/statements ≥95%; Bun lacks native branch coverage.
  - `apps/collect` (Bun test): lines/statements ≥95%, functions floor 93% (inline paging lambdas); Bun lacks native branch coverage.
  - All Bun coverage gates pass natively on current/latest Bun (`1.4.4+`), which enforces thresholds per file rather than only globally; no local Bun version pin is required.
- **Local hook behavior vs CI (`quality-slots.yml`)**:
  - `.husky/pre-commit` exports the staged Git index into a temp directory (`git checkout-index`), requires staged `package.json`/`bun.lock` to match worktree copies, runs `test:coverage` (`L1`), `lint` (`S2`), and `typecheck` (`S1`), and cleans up on exit or interrupt without touching the working tree. `lint-staged` remains check-only for manual use. `G1` and `S3` are `enforced` in CI and `planned` for local `pre-commit`.
  - `.husky/pre-push` runs `bun run security` (`osv-scanner` on `bun.lock` + `gitleaks` on `upstream..HEAD`, or full history without upstream—not per stdin push ref). Local `B1`, `L4`, and per-ref `pre-push` checks are `planned` (`enforced` in CI).
- **E2E isolation**:
  - `bun run test:e2e` (`scripts/test-e2e.ts`) spawns an isolated per-run Wrangler Worker/D1 (`--local --persist-to`, separate SQLite, random ports, `NODE_ENV=test`, `owner.json` ownership guard, process-group cleanup) plus real CLI subprocesses with an injected provider. Pass `bun run test:e2e -- <spec or -g filter>` to target specs.
  - The legacy Activity shell E2E (`scripts/e2e-06-local.sh`) requires a running disposable loopback Worker (`SIGNOFF_PORT`) and resets named fixture rows in default local D1 plus fixed `.data` fixtures; run it only in a disposable copy, never against daily data.

## Modal Picker Contract

- Set `modal` on Basalt `MultiSelect` inside dialogs so its portaled popover participates in the active dialog scroll and focus lock.
- The Bun patch (`patches/@nocoo%2Fbasalt@3.5.1.patch`, originally added on Basalt `3.2.1`) exposes Radix Popover's `modal` option and caps height to available viewport space; retain this behavior when upgrading `@nocoo/basalt`.
- Always verify overflowing dialog pickers with real browser wheel and touch input (`tests/e2e/directory-scroll.spec.ts`); DOM-only selection tests do not exercise modal scroll locks.
