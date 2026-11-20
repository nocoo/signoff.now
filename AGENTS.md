# SignOff

Project and PR workbench with local Azure DevOps collection and retained Activity/Score analytics (`apps/web` Vite/Basalt, `packages/worker` Hono, `packages/db` D1, `packages/domain`, `packages/connector-cli`, CLIs `apps/collect`, `apps/gitinfo`, `apps/pulse`).
Docs: [README.md](README.md) · [Index](docs/README.md) · [Direction](docs/01-项目定位.md) · [Collection](docs/11-真实PR采集与本地工作台.md) · [Directory](docs/13-成员目录与PR贡献统计.md) · [Collector 14–18](docs/14-collector-architecture.md) · [Runtime Ops](docs/24-local-dev-and-runtime-ops.md) · [Retrospective](Retrospective.md)

## Commands

Run from root with current Bun (1.4+), Node 26.x LTS (CI 26.12.1), Git, `gitleaks`, and `osv-scanner`. Secrets live in gitignored `.env` (`0600`); keys in `.env.example`. Unit tests use injected providers/local SQLite (no Azure login); live collection needs an authorized `az` session and local scope.

```sh
bun install --frozen-lockfile
bun run dev:all                        # Web 7042 + Worker 37042 + Connector (https://signoff.dev.hexly.ai)
bun run start:all                      # Build web + preview + Worker + Connector (local D1 only)
bun run dev                            # Frontend only
bun run dev:worker                     # Local D1 migrations + local Worker
bun run dev:collector                  # Standalone Connector daemon
bun run db:seed:local --directory-only # Seed Sample directory without resetting PRs/settings
bun run typecheck                      # S1
bun run lint                           # S2 (Biome check-only, 0 warnings)
bun run test:coverage                  # L1
bun run build:web                      # B1
bun run test:e2e                       # L4 Playwright + Worker/D1 + CLI (-- <spec or -g filter>)
bun run security                       # G1/G2 (osv-scanner + gitleaks)
bun run signoff -- --help              # Also: bun run gitinfo -- --help, bun run pulse -- --help
```

## Invariants

- ADO PR collection is live locally; GitHub workbench collection is `planned` despite samples and pulse queries. Keep normalized provider contracts, Live/Sample separation, and demo writes in local demo mode only.
- PR snapshots/jobs/staging stay separate from Activity/Score ingest. Collection writes via loopback trust or the machine host with an `sfc_` connector token—never the production pipeline token.
- Connectors claim only projects whose data owner matches the connector owner and is a tenant member ([docs/23](docs/23-remote-connector-and-tenants.md)).
- Every API route is default-deny in `packages/worker/src/route-policy.ts` (`public`, `member`, `admin`, `collector`, `connector`, `login`, `pipeline`); tests fail on unlisted routes.
- Access users need tenant membership; admins come from `SIGNOFF_ADMIN_EMAILS` or `admins`. Loopback trust requires a local host plus `SIGNOFF_LOCAL_TRUST=1` (dev/E2E launchers only).
- Browser Access and pipeline-token routes stay disjoint: machine credentials call only bootstrap/ingest/recompute/live/me, never entity CRUD or roster creation.
- CRUD automation needs an Access service token + Service Auth policy; identify service JWTs via `common_name` (`service: true`), never email/`sub` ([docs/12](docs/12-agent-access.md)).
- Keep `/api/live` public, `no-store`, D1-aware (503 on failure), and versioned; keep root, `packages/worker`, and `apps/web` `package.json` versions aligned. Access bypasses only `/api/live`.
- Watch lists start empty; registration, page loads, queries, and an idle daemon never invoke providers/auth or add watches. All discovery modes paginate all states across 90 days without cursor early-stopping.
- Never assume ADO PR ID order. Validated open publication resumes retained terminal watches (new generation + immediate check), never manually removed/invalidated ones; terminal snapshots retire atomically.
- Scope identities by `(source, provider, org, project, repositoryId, prNumber)`. Guard writes with revisions, leases, snapshot versions, and observation generations so late results never recreate removed watches.
- Reconcile summary/check facts by observation times and shared repository names by metadata clock; completion order never reverts newer facts.
- D1 is the product store (TDD; no Electron, `better-sqlite3`, or Drizzle). Activity artifacts bind to target env IDs/config version: recollect after changes, keep chunks idempotent, run one ingest at a time.
- Directory accounts link by exact `(source, provider, org, actor)`. Insights reads 90 UTC creation days of cache keeping all visible authors in denominators; global Calculate runs deep per-repo discovery.
- Contributor hiding is source-scoped (preserving cache/follows); avatars read local D1 and refresh every 7 days ([docs/22](docs/22-contribution-reports.md)).
- Readiness, custom mappings, and gate priority belong to the shared domain state-machine evaluator; Web and CLI read identical cached results ([docs/19](docs/19-pr-state-machines.md)).
- PATCH only fields present in the request (never read-whole-row/write-whole-row). D1 batches roll back on error, not zero affected rows—guard dependent statements with `EXISTS`, not order-dependent `changes()`.
- Keep multi-step write/read/aggregate flows staged and idempotent, and test auth/validation predicates branch-by-branch.
- Set `modal` on Basalt `MultiSelect` in dialogs (`patches/@nocoo%2Fbasalt@3.5.1.patch`; keep on upgrades) and test wheel/touch scroll in `tests/e2e/directory-scroll.spec.ts`.
- Develop directly on `main` unless a branch is explicitly requested; merge existing branches with a normal merge (never squash or rewrite history). Deployments require explicit authorization.

## Quality & Local Gates

Follows `system1-quality`; CI slots and pinned `base-ci` revision live in `.github/workflows/quality-slots.yml` (`quality / Z1: Gate` required on `main`). Statuses: `enforced`, `planned`, `manual`, `N/A`.

- **Exceptions / gaps**: `L2 Runtime`, `L3 Integration`, `P1 Package` are `N/A` (Worker app covered by `L1`/`L4`, not on npm); full 95% four-metric `L1` is `planned` ([Runtime Ops](docs/24-local-dev-and-runtime-ops.md)).
- **Local hooks**: `bun run prepare` installs `.husky/`; `pre-commit` checks staged index (`L1`/`S2`/`S1`, no autofix/restage; local `G1`/`S3` `planned`). `lint-staged` is check-only `manual`.
- **Pre-push**: runs `bun run security` (`osv-scanner` + `gitleaks` on `upstream..HEAD`); local `B1`, `L4`, and per-ref `pre-push` checks are `planned` (`enforced` in CI).

## Resources & Isolation

| Lane | Endpoint / State | Boundary |
| --- | --- | --- |
| Dev | `https://signoff.dev.hexly.ai` (`7042` → `37042`), local D1, `.data` (`SIGNOFF_DATA_DIR`) | Always use Caddy HTTPS (never localhost); reuse healthy stack; stop before switching `dev:all`/`start:all` |
| Tests | Per-run `--local --persist-to`, temp SQLite, random ports, `owner.json` (`scripts/test-e2e.ts`) | Isolated fixtures + process-group cleanup; legacy `scripts/e2e-06-local.sh` in disposable copy only |
| Prod | `https://signoff.hexly.ai` (Access), `https://signoff-ingest.hexly.ai` (machine/connector) | Read-only unless deploy is authorized; `db:seed:local` is local demo only |

Polling/backoff (`15s` coalescing, `3s→15s`, `10s` AI ticks), runtime logs (`NO_COLOR=1`), web cache cadence, and forward migrations: [Runtime Ops](docs/24-local-dev-and-runtime-ops.md).

## Retrospective

Record incidents in [Retrospective.md](Retrospective.md); promote recurring project constraints to `Invariants` above and enforceable safeguards to tests or hooks.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
