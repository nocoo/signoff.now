<p align="center">
  <img src="../assets/brand/icon-rounded.png" width="128" alt="signoff.now logo" />
</p>
<h1 align="center">SignOff</h1>
<p align="center">Every project's pull requests, blockers, and next steps in one place.</p>
<p align="center">
  <a href="https://signoff.hexly.ai">Website</a> ·
  <a href="../README.md">简体中文</a>
</p>

## What it does

SignOff helps maintainers manage Azure DevOps projects and understand their PR queues. It shows reviews, policies, multiple builds and their stages, along with blockers, responsible people, and concrete next actions. This phase focuses on PRs; issues and ADO work items come later.

**The current implementation is a local mock preview:** four ADO projects, twelve repositories, and thirty-eight PRs persist in Wrangler's local SQLite database. Project CRUD and simulated scans use real Worker APIs and D1 queries. Live PR collectors are the next step: local `az` and later `gh` will feed the same normalized contract. GitHub project creation is not enabled yet.

The existing Activity / Score analytics and ADO activity CLI remain available separately. Their ingest contract is not connected to the new PR snapshot tables. The `pulse` helper can query GitHub, but does not feed this workbench.

## Features

- **Manage projects:** add, edit, pause, resume, and remove ADO projects across organizations, with saved scan history.
- **Review across projects:** search and filter by project, repository, PR state, readiness, author, or next action; share the current queue or PR through its URL.
- **Understand blockers:** distinguish conflicts, required failures, pending reviews, deployment approvals, unavailable checks, and advisory failures.
- **Inspect builds:** expand each build to see all stages, durations, results, and owners.
- **Observe progress:** refresh snapshots every 15 seconds; simulated scans advance eligible stages while preserving failures and human decisions.
- **Retain existing analytics:** the original Dashboard is at `/insights`; Directory, Activity, and Settings use their existing data pipeline.

## Usage

Start the local preview using [Development](#development). Explore the seeded projects, or add an ADO organization and project in **Projects**, then click **Scan** to create six sample PRs. Open a PR to inspect its reviews, checks, builds, and activity. All sample data is visibly marked; no live ADO login is needed.

The operations below apply to the retained Activity / Score pipeline. The production website uses Cloudflare Access. This PR preview has not been deployed or applied to remote D1; the existing collector still uses Developer and Repo bindings rather than the new `projects` table.

Collection runs on your machine. Install the dependencies under [Development](#development), install Azure CLI, run `az login`, and ensure that account can read the bound ADO projects. The CLI uses `az account get-access-token` to obtain a token for the ADO REST API.

### Operations

Run only one `ingest` at a time to avoid concurrent score aggregations overwriting each other. The CLI defaults to `http://127.0.0.1:37042`. To connect to an existing production deployment, set these values in the Git-ignored `.env` file:

```dotenv
SIGNOFF_API_BASE=https://signoff-ingest.hexly.ai
SIGNOFF_PIPELINE_WRITE_TOKEN=<matching Worker secret>
```

`.env.example` provides a template for production connectivity and automation credentials. Set `.env` permissions to `600`; local development can use the default loopback address.

| Production endpoint | Purpose | Authentication |
| --- | --- | --- |
| `signoff.hexly.ai` | Web and entity / Settings management API | Cloudflare Access |
| `signoff-ingest.hexly.ai` | CLI bootstrap, ingest, and recompute | Pipeline token |

The machine endpoint allows only pipeline routes plus `live` / `me`. Its pipeline token cannot perform entity CRUD, and an Access identity on the browser endpoint cannot call pipeline routes.

#### Initial collection and full recomputation

After the initial setup, or when changes to weights, email suffixes, timezone, or related configuration make scores stale, run a full collection. Replace the example paths and `repo-id` below with actual values:

```bash
bun run signoff -- doctor
bun run signoff -- settings pull
bun run signoff -- collect --full
# For every artifact printed by collect, use the same manifest in sequence:
bun run signoff -- ingest normalized "path/to/artifact.json" --manifest "path/to/manifest.json"
```

`--full` cannot be combined with `--repo` or `--no-wi`. Collection may produce multiple artifacts by repository, project, and activity count. The CLI requests that `scores_stale` be cleared only after every required scope has been fully ingested. Incremental ingestion cannot clear that flag.

#### Incremental collection and recovery

```bash
bun run signoff -- collect --repo repo-id
bun run signoff -- ingest normalized "path/to/artifact.json" --manifest "path/to/manifest.json"
```

`collect` does not advance the cursor. An `artifact(s) still pending` message means the current scope is incomplete; `full_rematch: scope(s) still pending` means other scopes remain. Continue ingesting the remaining files listed in the manifest.

If ingestion is interrupted, or the Dashboard keeps reporting an ingest in progress, resend the same artifact and manifest. Completed chunks can be replayed idempotently, and unfinished chunks resume processing. Artifacts contain developer and repository IDs from the collection environment and cannot be replayed directly into another environment.

`--since <date>` adjusts the incremental start, but active PRs are still fetched in full. Threads and iterations require per-PR requests, so collection time for a large repository depends on the number of PRs and ADO response times.

### Service Token

For automated entity management, create a Cloudflare Access Service Token and add a **Service Auth** policy that includes it to the Access Application protecting `signoff.hexly.ai`. Creating a token without the policy can still result in a redirect to the login page.

Store the client credentials in `.env` as `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`, and send the corresponding headers:

```bash
curl -H "CF-Access-Client-Id: <id>" \
     -H "CF-Access-Client-Secret: <secret>" \
     https://signoff.hexly.ai/api/repos
```

These are client credentials for the management endpoint, not Worker secrets. The Worker verifies the JWT issued by Access; service identities are identified by `common_name` and reported as `service: true` by `/api/me`.

## Development

Install Bun (`packageManager` and CI pin 1.4.0), Node.js 22.22.1–22.x, 24.x, or 26+, and Git. Vite, Vitest, and the pre-commit tooling run on Node.js; the CLI runs on Bun.

```bash
git clone https://github.com/nocoo/signoff.now.git
cd signoff.now
bun install --frozen-lockfile
bun run build:web
bun run db:migrate:local
bun run db:seed:local
bun run dev:worker
```

In another terminal, start the frontend from the repository root:

```bash
bun run dev
```

Open `http://localhost:7042`. Vite proxies `/api` to the local Worker on `37042`. The dev script includes the local upstream and demo flag. If you already have a trusted HTTPS reverse proxy, `https://signoff.dev.hexly.ai` is supported.

Local data lives in `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`. The seed command resets only the four named demo projects and their PR / scan rows; other projects and existing analytics are preserved. It has no remote option. Migration `0011_pr_workbench.sql` defines the shared local / D1 schema.

Loopback addresses and `*.dev.hexly.ai` use the development authentication path without production Access or pipeline credentials. `.env.example` is prefilled with the production machine endpoint; copy and configure it only when connecting to an existing deployment.

`bun run build:web` checks frontend types and then builds `apps/web/dist`. The Worker serves both the API and those SPA assets. Run `bun run lint` and `bun run typecheck` for code checks; `bun run security` requires installed `osv-scanner` and `gitleaks` binaries.

| Path | Responsibility |
| --- | --- |
| `apps/web` | React pages, client models, and viewmodels |
| `apps/collect` | ADO collection, local artifacts, and ingest CLI |
| `packages/domain` | Identity matching, event transforms, chunk contracts, and scoring |
| `packages/worker` / `packages/db` | Hono API, D1 writes, and SQL migrations |
| `apps/gitinfo` / `apps/pulse` | Helpers for local Git and GitHub queries |

### Deployment configuration

The current deployment setup requires a Cloudflare Workers Paid plan, D1, and Cloudflare Access. For self-hosting, update the D1 database ID and domains in [wrangler.toml](../wrangler.toml), then follow the [deployment document](08-真实数据上线与Dashboard统计.md) for remote migrations and the web build.

Protect the entire web domain with an Access Application. The separate machine domain uses a pipeline token; its first DNS label must be `signoff-ingest` to match the current routing logic. Set these Worker secrets:

```bash
bunx wrangler secret put CF_ACCESS_AUD
bunx wrangler secret put CF_ACCESS_TEAM_DOMAIN
bunx wrangler secret put SIGNOFF_PIPELINE_WRITE_TOKEN
```

The first two values are the Access Application's AUD and full team domain, such as `example.cloudflareaccess.com`, without a protocol. Protected APIs return `500` if either is missing; `/api/live` and machine pipeline endpoints follow their own access rules. An optional `SIGNOFF_PIPELINE_READ_TOKEN` provides read-only pipeline access; reads use the write token when it is unset. The current configuration keeps `workers.dev` enabled as a fallback.

## Tests

| Layer | Command | Prerequisites |
| --- | --- | --- |
| Unit and API handler | `bun run test` | Installed dependencies; workspaces use Bun test or Vitest |
| Coverage | `bun run test:coverage` | Same as above |
| Git subprocess integration | `bun run --cwd apps/gitinfo test:integration` | Git available locally |
| Local pipeline fixture | `PATH="$PWD/packages/worker/node_modules/.bin:$PATH" bash scripts/e2e-06-local.sh` | A fresh default local D1 and an already-running Worker |

Use a separate test checkout for the pipeline fixture. Run `bun run build:web`, then start `bun run --cwd packages/worker dev --local-upstream localhost` in another terminal. The test command's PATH selects the workspace-installed Wrangler for the existing script. The script applies local migrations, seeds test entities, writes `.data/`, and checks ingestion, the heatmap, and the timeline. It requires the initial Settings configuration (version `1`) and modifies that checkout's local data.

## Stack

| Technology | Role |
| --- | --- |
| ![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white) ![Bun](https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white) | Application logic, CLI, and monorepo scripts |
| ![React](https://img.shields.io/badge/React-149ECA?logo=react&logoColor=white) ![Basalt](https://img.shields.io/badge/Basalt-222222) | Console pages, design tokens, and interactive components |
| ![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?logo=tailwindcss&logoColor=white) | Interface styling and themes |
| ![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white) | Local development and SPA builds |
| ![Hono](https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=white) ![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?logo=cloudflareworkers&logoColor=white) | API routes, middleware, and static asset hosting |
| ![Cloudflare D1](https://img.shields.io/badge/Cloudflare_D1-F38020?logo=cloudflare&logoColor=white) | Entities, Settings, activities, and scores |
| ![Cloudflare Access](https://img.shields.io/badge/Cloudflare_Access-F38020?logo=cloudflare&logoColor=white) | Web entry and management API authentication |
| ![Azure DevOps](https://img.shields.io/badge/Azure_DevOps-0078D7) | PR, review, and work item data |
| ![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white) ![Bun test](https://img.shields.io/badge/Bun_test-000000?logo=bun&logoColor=white) | Workspace tests |

## Documentation

The design and operational documents below are primarily in Chinese.

- [Documentation index](README.md): product scope, D1, web, Settings, and pipeline design.
- [Collection commands, artifacts, and cursors](07-CLI命令矩阵与ADO落盘.md) · [Activity and Score rules](06-Activity重建与Score算法.md).
- [Deployment and Dashboard statistics](08-真实数据上线与Dashboard统计.md): deployment, queries, and reconciliation.
- [Helper CLIs](cli/README.md) · [Logo usage](09-logo-usage.md) · [Brand presentation](https://hexly.ai/logos/signoff-now).

## License

[MIT](../LICENSE)
