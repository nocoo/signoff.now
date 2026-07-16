# pulse CLI

Fetches remote collaboration data for a local git repository’s GitHub remote: pull requests, PR detail, diffs, search, and repository metadata. Resolves the correct GitHub identity per-repo (multi-account safe) without calling `gh auth switch`.

| | |
|:--|:--|
| **Package** | `@signoff/pulse` |
| **Entry** | `apps/pulse/src/main.ts` |
| **Version** | from `apps/pulse/package.json` |
| **Platform** | macOS / Linux |
| **Remote** | GitHub only (Azure DevOps detected and rejected) |

---

## Prerequisites

- [Bun](https://bun.sh)
- `git` on `PATH`
- [GitHub CLI](https://cli.github.com/) (`gh`) authenticated (`gh auth login`)
  - Used for **token retrieval** (`gh auth token`, `gh auth status`) and org membership when building the identity map
  - Subsequent data APIs use HTTPS `fetch()` with the resolved token (not `gh api` for PR payloads)

---

## Install & run

```bash
bun install

bun run apps/pulse/src/main.ts --help
bun run apps/pulse/src/main.ts --version

bun run --cwd apps/pulse dev -- repo --pretty
```

The `bin` field maps `pulse` → `./src/main.ts` when linked as a workspace binary.

---

## Usage

```
pulse <command> [flags]

Commands:
  prs             List pull requests for the current repository
  pr show         Show detailed info for a single pull request
  pr diff         Show diff and changed files for a single PR
  pr search       Search pull requests by query
  repo            Show repository metadata

Global Flags:
  --cwd <path>    Target directory (default: cwd)
  --pretty        Human-readable output (default: compact JSON)
  --no-cache      Skip identity map cache
  --help, -h      Show help
  --version, -v   Show version

prs Flags:
  --state <s>     Filter: open, closed, merged, all (default: open)
  --limit <n>     Max PRs to return (default: 0 = unlimited)
  --author <u>    Filter by author login

pr show Flags:
  --number <n>    PR number (required)

pr diff Flags:
  --number <n>    PR number (required)

pr search Flags:
  --query <q>     Search qualifier (required, e.g. "created:2026-03-01..2026-03-31")
  --limit <n>     Max results (default: 100)
```

### Examples

```bash
# Open PRs (JSON)
bun run apps/pulse/src/main.ts prs

# All states, pretty
bun run apps/pulse/src/main.ts prs --state all --pretty

# Single PR detail / diff
bun run apps/pulse/src/main.ts pr show --number 12
bun run apps/pulse/src/main.ts pr diff --number 12

# Search within the repo
bun run apps/pulse/src/main.ts pr search --query "is:merged author:@me"

# Repo metadata
bun run apps/pulse/src/main.ts repo --pretty

# Other checkout
bun run apps/pulse/src/main.ts prs --cwd /path/to/repo

# Fresh identity resolution
bun run apps/pulse/src/main.ts prs --no-cache
```

---

## Architecture

```
CLI (main.ts)
  → parseArgs
  → git remote get-url origin → parseRemoteUrl
  → resolveIdentity (gh auth + org map, optional cache)
  → GitHubClient (GraphQL / REST)
  → command fetch + format
```

| Layer | Path | Role |
|:------|:-----|:-----|
| CLI | `src/cli/` | argv, JSON/pretty output |
| Identity | `src/identity/` | remote parse, multi-user token resolution, FS cache |
| API | `src/api/` | GraphQL/REST client, node mappers, pagination |
| Commands | `src/commands/*/` | `fetch-*` + `format-*` per resource |
| Collect | `src/collect.ts` | library orchestration (same flow as CLI, DI-friendly) |
| Executor | `src/executor/` | `CommandExecutor` for git/gh subprocesses |

### Identity resolution

1. Read `origin` remote URL.
2. Parse host / owner / repo (HTTPS or SSH). Reject Azure DevOps with a clear error.
3. Build owner → user map from `gh auth status` + per-user org membership.
4. Resolve token for the repo owner (`direct` | `org` | `fallback`).
5. Cache map at `~/.cache/pulse/identity-map.json` unless `--no-cache`.

All API calls use the resolved token; global `gh` default account is not mutated.

### Naming

Public CLI and JSON fields follow **GitHub GraphQL** naming where practical:

| Concept | Convention | Example |
|:--------|:-----------|:--------|
| Commands | `<resource>` / `<resource> <action>` | `prs`, `pr show` |
| Flags | `--kebab-case` | `--state`, `--number` |
| Output fields | GraphQL-aligned | `isDraft`, `headRefName`, `state: "OPEN"` |
| Enums | `UPPER_CASE` | `OPEN`, `MERGED`, `APPROVED` |

---

## Commands

### `prs`

Lists pull requests for the resolved repository.

| Flag | Default | Description |
|:-----|:--------|:------------|
| `--state` | `open` | `open` → OPEN; `closed` → CLOSED; `merged` → MERGED; `all` → all three |
| `--limit` | `0` | Max items; `0` = paginate to exhaustion (subject to API) |
| `--author` | — | Client-side filter by author login |

**Report:** `PullRequestsReport` — `pullRequests[]` of `PullRequestInfo`, plus `totalCount`, pagination cursors, `repository`, `identity`, `filters`.

### `pr show`

Full PR detail (body, reviews, comments, commits, files, merge state).

| Flag | Required | Description |
|:-----|:---------|:------------|
| `--number` | yes | PR number |

**Report:** `PullRequestDetailReport` — `pullRequest: PullRequestDetail`.

Nested connections (reviews, comments, commits, files, participants, …) use GraphQL pagination when `hasNextPage` is true.

### `pr diff`

Unified diff + per-file patches via REST (`Accept: application/vnd.github.diff` + files API).

| Flag | Required | Description |
|:-----|:---------|:------------|
| `--number` | yes | PR number |

**Report:** `PullRequestDiffReport` — `diff` string + `files[]` with optional `patch`.

### `pr search`

Search PRs with GitHub search qualifiers (scoped to the current repo).

| Flag | Default | Description |
|:-----|:--------|:------------|
| `--query` | required | Search string (e.g. `is:open label:bug`) |
| `--limit` | `100` | Max results |

**Report:** `PullRequestSearchReport`.

### `repo`

Repository metadata (stars, languages, license, topics, …).

**Report:** `RepositoryReport` — `repository: RepositoryInfo`.

Authoritative TypeScript definitions: `apps/pulse/src/commands/types.ts`.

---

## Exit behaviour

Failures print `error: …` to stderr and exit non-zero (typically `1`), for example:

- no command / bad flags
- not a git repo / unreadable remote
- Azure DevOps remote
- no authenticated GitHub user
- API errors (including rate limits)

---

## Development

```bash
cd apps/pulse

bun run typecheck
bun run lint
bun run test
bun run test:coverage
```

Coverage thresholds (vitest): statements/functions/lines ≥ 97%, branches ≥ 85%.

### Library API

| Export | Purpose |
|:-------|:--------|
| `.` | command types |
| `./collect` | `collectPullRequests`, `collectPullRequestDetail`, … |
| `./executor` | executor types |
| `./identity` | identity types |
| `./api` | API client types |

`collect*` functions mirror CLI orchestration with injectable `CommandExecutor` / optional `apiClient` for tests or host apps.

---

## Related

- [CLI index](./README.md)
- [gitinfo](./gitinfo.md) — local git insight for the same checkout
