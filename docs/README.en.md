<p align="center">
  <img src="../assets/brand/icon-rounded.png" width="128" alt="signoff.now logo" />
</p>
<h1 align="center">signoff.now</h1>
<p align="center">An Azure DevOps activity analytics console for managers.</p>
<p align="center">
  <a href="https://signoff.hexly.ai">Website</a> ·
  <a href="../README.md">简体中文</a>
</p>

## What it does

signoff.now brings registered developers' Azure DevOps pull requests, review votes, and work item activity into a web console. Managers run a local CLI, retain raw data, normalized files, and a manifest, then ingest the results through a Worker into Cloudflare D1. The web app manages people, teams, tags, repositories, and scoring settings, and displays daily scores and activity details.

The project is designed for a single instance. Its main collection pipeline currently supports Azure DevOps. Scores follow configurable weights and event-folding rules; use them alongside the underlying activity to understand participation. They do not independently measure code quality or individual output. The repository also contains the `gitinfo` and `pulse` helper CLIs; `pulse` queries GitHub separately from the main collection pipeline.

## Features

- **Define the analysis scope:** manage Developers, Teams, Tags, and Repos, including archive and restore. Match ADO identities using developer aliases and the email suffixes configured in Settings.
- **Keep the source data:** collect PRs, threads, and iterations per repository, plus work items and updates per project. Store raw data, normalized activities, and manifests in the local `.data/` directory.
- **Review activity over time:** the Dashboard offers 7 / 28 / 92 day summaries, daily trends, activity-type breakdowns, and developer score lists. The Activity page supports daily comparisons across developers and a paginated timeline for one developer.
- **Apply explicit scoring rules:** process eight PR and work item activity types and group them by the configured timezone. Same-day author events on a PR and updates to a work item are folded per developer. The UI flags stale configuration or unfinished writes and withholds affected figures.
- **Resume unfinished ingestion:** manifests track each artifact. A collection cursor advances only after its entire scope is ingested; replaying the original files resumes an interrupted ingest.

## Usage

Open the [website](https://signoff.hexly.ai) and authenticate through the deployment's Cloudflare Access application. Create developers and enabled ADO repository bindings, provide the repository and project GUIDs, and configure email suffixes, timezone, and weights in Settings. Entities can also be created through the management API using the Access Service Token described below.

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
bun run --cwd packages/worker wrangler d1 migrations apply signoff-db --config ../../wrangler.toml --local
bun run --cwd packages/worker dev --local-upstream localhost
```

In another terminal, start the frontend from the repository root:

```bash
bun run dev
```

Open `http://localhost:7042`. Vite proxies `/api` to the local Worker on `37042`. The commands above use Wrangler installed in the worker workspace; `--local-upstream localhost` keeps the local hostname so requests use the development authentication path. If you already have a trusted HTTPS reverse proxy, `https://signoff.dev.hexly.ai` is supported.

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
