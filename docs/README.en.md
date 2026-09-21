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

**Live ADO PR collection is available locally:** Azure CLI provides authentication for read-only ADO API requests, and the collector publishes normalized PR, policy, build and stage snapshots through the local Worker into Wrangler SQLite. The global Live / Sample switch separates real data from five sample projects, 13 repositories, and 46 PRs across ADO and GitHub. Live GitHub collection will use the same normalized contract in a later phase.

The existing Activity / Score APIs and ADO activity CLI remain available separately. Their ingest contract is not connected to the new PR snapshot tables. The `pulse` helper can query GitHub, but does not feed this workbench.

## Features

- **Manage projects:** add, edit, and remove ADO projects across organizations, with repository scopes and saved task history.
- **Jev readiness:** configure the encrypted API key in AI Settings, explain project policies, and classify watched PRs as Conflict / Attention / Warning / Running / Ready / Waiting, with separate pending/error states. Rules are editable; provider merge requirements remain authoritative. See [the contract](19-pr-state-machines.md).
- **Review across projects:** search and filter by project, repository, PR state, readiness, author, or next action; share the current queue or PR through its URL.
- **Understand blockers:** distinguish conflicts, required failures, pending reviews, deployment approvals, unavailable checks, and advisory failures.
- **Inspect builds:** expand each build to see all stages, durations, results, and owners.
- **Share a watch list:** select rows or the current page, add/remove watches in batches, and filter watched/unwatched candidates. The web and CLI share persistent identities scoped by provider, organization, project, repository ID and PR number. Drafts can be watched.
- **Observe progress:** explicit discovery reads all accessible PR history and states without adding watches. The daemon refreshes only active watches, with a configurable five-minute cooldown after each project round. It keeps running when the browser closes and retires watches only after a confirmed terminal snapshot. Errors preserve watches and cached data.
- **Manage contributors:** follow observed PR authors, explicitly link provider accounts, and maintain teams and tags separately for Live and Sample.
- **Compare contributions:** Repos and Insights use normalized PR records, using PR merge dates, with repository, member, team, and tag filters. Only PRs merged in the selected date range contribute. Each chart module calculates only on request; calculation age turns yellow after 24 hours and red after 72 hours. Drafts are excluded by default. See [Directory and contributions](13-成员目录与PR贡献统计.md).

## Usage

Start the Worker and frontend using [Development](#development), then add an ADO organization and project in **Projects**. Repository scope is optional; blank includes every repository in that project. Start `bun run dev:collector`, click **Discover PRs**, then select candidates and choose **Add to watch list**. Upgrades preserve cached PRs but start with zero watches. Starting services, registering a repository, opening pages and reading queries never invoke Azure.

```bash
# Needed only when the existing Azure session is unavailable or expired:
az login --scope 499b84ac-1321-427f-aa17-267ca6975798/.default
bun run dev:collector
# In another terminal, register and discover candidates explicitly:
bun run signoff repo add 'https://dev.azure.com/acme/Platform/_git/web-app'
bun run signoff discover --repo 'https://dev.azure.com/acme/Platform/_git/web-app'
# After discovery completes:
bun run signoff pr list --state all --draft include --all
bun run signoff watch add 'https://dev.azure.com/acme/Platform/_git/web-app/pullrequest/123'
bun run signoff watch list --all
bun run signoff pr get 'https://dev.azure.com/acme/Platform/_git/web-app/pullrequest/123'
```

Discovery includes Draft, Merged and Closed PRs across all accessible history. The daemon executes queued work and refreshes active watches independently of browser visibility. **Refresh watched** only enqueues watched PRs. A bottom-right toast shows task progress. Expired authentication is reported without erasing previous data; after the indicated `az login`, the daemon resumes.

The short-lived CLI reads the local Worker cache without Azure authentication or provider calls. Commands return queue receipts; they do not wait for collection. PR collection uses loopback only and does not borrow Activity pipeline credentials. `workbench watch` remains an alias for `daemon`; `workbench sync` enqueues explicit discovery. See the [CLI/HTTP contract](18-cli-query-contract.md) and [local collection guide](11-真实PR采集与本地工作台.md).

Filters follow Organization → Project → Repository, exclude drafts by default, and support multiple authors. Filters and column sort directions persist in localStorage and shareable URLs; pages contain 20 PRs. PR numbers and the link beside live PR titles open the source in a new tab. People have circular avatars with two initials. Descriptions render Markdown, tables, and task lists.

Each project discovers its actual required policies and merge conditions. A draggable Readiness list sets their processing order, colors, and display names; keyboard arrows also work. The first unfinished requirement determines the main blocker. PRs waiting only on later requirements sort first. Settings persist in D1 with an independent revision and do not interrupt collection. Proof Of Presence has no built-in exception.

Every page uses a main title, subtitle, and the global breadcrumb trail. The PR subtitle shows the selected organization / project / repository, without a separate repository banner.

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

If the page opens but its data does not load, check `curl --max-time 10 http://127.0.0.1:37042/api/live` and compare actual list/query timings. A listening port or a single successful health probe does not establish dashboard health. Inspect Worker request logs before restarting; repeated slowness while awake needs investigation beyond sleep recovery. Preserve `.wrangler/state` and never seed existing data during recovery. The collector reconnects independently.

Migration 0036 indexes non-null collection lease tokens. Claim queries must seek the current lease, including when no job is available; scanning retained job history on each daemon poll blocks other local D1 requests as history grows. A regression checks the query plans of the actual claim statements. Apply pending local migrations with `bun run db:migrate:local`.

Collection history expires 12 hours after completion (or the last update if no completion time exists). Each daemon scheduling request removes at most 100 expired terminal jobs and 100 old scan receipts, using the retention indexes in migration 0037. Job deletion cascades to phase/results data, staged snapshots, claim bindings and repository receipts. Queued, running and authentication-blocked jobs remain; current PR caches, watch generations and Jev results are unaffected. Cleanup runs without an open browser and resumes in bounded batches after daemon downtime. Expired job IDs return `NOT_FOUND`; SQLite reuses freed pages without an automatic blocking vacuum.

`bun run dev:worker` supervises only the Wrangler process group it starts. A sequential health probe runs every 15 seconds after the previous probe finishes, with a 5-second timeout. Startup and detected wake/clock changes receive a 30-second grace period; three consecutive failures after that window restart the owned Worker. A gap over 45 seconds discards pre-sleep failures and missed probes are never replayed. A successful probe resets the failure count. The launcher refuses an occupied port, preserves local storage, and stops its children on Ctrl+C or SIGTERM. This does not prevent sleep, restart unrelated processes, or change collection/Jev cooldowns.

Cache reads time out after 15 seconds. Network failures, timeouts and unavailable proxy responses use one connection message. The PR dashboard consolidates failures from its list, repository filters, watch queue and collector queries into one banner with Retry connection. It retains already loaded PRs, labels delayed updates, and clears the banner after those queries recover. Collector status is unknown while its API is unreachable; this does not imply the daemon has stopped or provider authentication has expired. Domain errors and provider authentication failures remain distinct. Automatic query retries use the existing bounded backoff and run while the page is visible; background collection and Jev scheduling are independent.

Local data lives in `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite`. The seed command resets only the five named demo projects and their PR / scan rows; other projects and existing analytics are preserved. It has no remote option. Migrations under `packages/db/migrations/` define the schema; `0019_observed_pull_requests.sql` adds the shared watch list, repository catalog, leases and snapshot versions, and cancels legacy page-scoped work.

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

`bun run test:e2e` runs the browser, real Worker HTTP and CLI subprocesses against owned temporary Wrangler D1 state. It injects the provider, requires Chrome or Playwright Chromium, and never touches daily data or Azure.

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
- [Architecture review draft](14-collector-architecture.md): explicit PR watch lists, automatic retirement, separate scheduling, and cached web/CLI queries. Documents 14–18 describe proposed behavior; the new commands and watch-list UI are not implemented yet.
- [Collection commands, artifacts, and cursors](07-CLI命令矩阵与ADO落盘.md) · [Activity and Score rules](06-Activity重建与Score算法.md).
- [Deployment and Dashboard statistics](08-真实数据上线与Dashboard统计.md): deployment, queries, and reconciliation.
- [Helper CLIs](cli/README.md) · [Logo usage](09-logo-usage.md) · [Brand presentation](https://hexly.ai/logos/signoff-now).

## License

[MIT](../LICENSE)
