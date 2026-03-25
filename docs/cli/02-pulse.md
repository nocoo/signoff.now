# 02 — pulse CLI

## Overview

`pulse` is a CLI tool that fetches remote collaboration data (pull requests, reviews, CI checks) for a local git repository from its GitHub remote. It automatically resolves the correct GitHub identity from the repository's origin URL — supporting multi-account setups without polluting global `gh` auth state.

> **Status:** Phase 1 (Identity Resolution), Phase 2 (`prs` Subcommand), and Phase 3 (`pr-detail` Subcommand) are implemented. Snapshot tests and integration test remain as follow-up items.
>
> **Naming note:** This document reflects the **current code** naming (`pr-detail`, `draft`, `headBranch`, `state: "open"`). The target naming spec (aligned with GitHub GraphQL: `pr show`, `isDraft`, `headRefName`, `state: "OPEN"`) is defined in [04-pulse-cli-spec.md](./04-pulse-cli-spec.md). Current names will be migrated in the Rename phase described there.

**Design goals:**

- **JSON-first** — Default output is compact JSON (pipeable to `jq`/`gron`), `--pretty` for human-readable terminal output
- **Identity-safe** — Resolves the correct GitHub user per-repository via `GH_TOKEN` env injection; never calls `gh auth switch`
- **Testable** — HTTP layer dependency injection; all identity resolution and response parsing are pure and independently testable
- **Bun-only** — Leverages Bun.spawn for subprocess execution; runs directly as TypeScript

### Platform support

**macOS and Linux only.** Depends on `git` for local repository inspection and `gh` CLI for token retrieval from the system keyring. Windows is not supported.

### Prerequisites

- `git` — local repository metadata
- `gh` CLI — used for two purposes: (1) token retrieval (`gh auth token --user <name>`, `gh auth status --json hosts`) from the system keyring, and (2) one-time org membership queries (`gh api /user/orgs`) during identity map construction. All subsequent GitHub data-fetching API calls (e.g., PR list) use direct HTTPS requests with `fetch()`, not `gh api`
- At least one authenticated GitHub account via `gh auth login`

### Scope

- **GitHub only (v1).** Azure DevOps repositories are detected and rejected with a clear message ("Azure DevOps is not supported yet"), not silently ignored
- Supports standard non-bare working tree repositories (same as gitinfo)
- Git worktrees are supported — origin URL is resolved via `git remote get-url origin` which works in any worktree

---

## Planned Usage

```
pulse <command> [flags]

Commands:
  prs             List pull requests for the current repository
  pr-detail       Show detailed information for a single PR

Global Flags:
  --cwd <path>    Target directory (default: cwd)
  --pretty        Human-readable output (default: compact JSON)
  --no-cache      Skip identity cache
  --help, -h      Show help
  --version, -v   Show version
```

### Examples

```bash
# List open PRs as JSON
pulse prs

# List all PRs (including closed/merged)
pulse prs --state all

# Pretty-print PR list
pulse prs --pretty

# Run against a different repo
pulse prs --cwd /path/to/repo

# Pipe to jq
pulse prs | jq '.prs[].title'
pulse prs | jq '.prs | sort_by(-.number) | .[0:5]'
```

---

## Planned Architecture

### Three-Layer Design

```
┌─────────────────────────────────────────────────────────┐
│  CLI Layer                                              │
│  src/main.ts → src/cli/args.ts → src/cli/output.ts     │
│  Parse argv, dispatch to subcommand, format output      │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│  Identity Resolution (before any API call)              │
│  1. git remote get-url origin → parse owner/repo        │
│  2. gh auth status --json hosts → all logged-in users   │
│  3. Per-user: GH_TOKEN=t gh api /user/orgs → org list   │
│  4. Build owner→user lookup table                       │
│  5. Match owner → resolve token                         │
│  All API calls use: GH_TOKEN=<token> (process-level)    │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│  Subcommands Layer                                      │
│  src/commands/prs/                                      │
│  Each subcommand: fetch from GitHub API → typed result   │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│  API Client (DI Boundary)                               │
│  src/api/types.ts         → interface                   │
│  src/api/github-client.ts → real HTTP via fetch()       │
│  src/api/mock-client.ts   → test helper                 │
└─────────────────────────────────────────────────────────┘
```

### Planned Directory Structure

```
apps/pulse/
├── package.json                          # @signoff/pulse, bin: pulse
├── tsconfig.json
├── bunfig.toml
└── src/
    ├── main.ts                           # #!/usr/bin/env bun — entry point
    ├── cli/
    │   ├── args.ts                       # Argument parser (zero-dep, hand-rolled)
    │   ├── args.test.ts
    │   ├── output.ts                     # JSON + pretty formatters
    │   └── output.test.ts
    ├── identity/
    │   ├── types.ts                      # GitHubIdentity, IdentityMap interfaces
    │   ├── resolve-remote.ts             # Parse git remote URL → {platform, owner, repo}
    │   ├── resolve-remote.test.ts
    │   ├── resolve-user.ts              # Build owner→user mapping, resolve token
    │   └── resolve-user.test.ts
    ├── api/
    │   ├── types.ts                      # GitHubApiClient interface
    │   ├── github-client.ts              # Real HTTP client (fetch + GH_TOKEN)
    │   └── mock-client.ts               # Deterministic fake for unit tests
    ├── commands/
    │   ├── types.ts                      # PulseReport + all subcommand result types
    │   └── prs/
    │       ├── fetch-prs.ts              # Core: call GitHub API → PullRequestInfo[]
    │       ├── fetch-prs.test.ts
    │       ├── format-prs.ts             # Pretty formatter for PR list
    │       └── format-prs.test.ts
    ├── executor/
    │   ├── types.ts                      # CommandExecutor interface (for git/gh commands)
    │   ├── bun-executor.ts               # Real executor via Bun.spawn
    │   └── mock-executor.ts              # Test helper
    └── __integration__/
        └── e2e.integration.test.ts       # Real API call against a known repo
```

---

## Identity Resolution

### Problem

A developer may have multiple GitHub accounts (personal + work). The CLI must select the correct account based on the repository being queried, without:

- Calling `gh auth switch` (global state mutation, concurrency-unsafe)
- Prompting the user for account selection
- Requiring per-repository configuration files

### Solution: Owner → User Mapping

#### Step 1: Parse remote URL

Extract `owner/repo` from `git remote get-url origin`, handling all formats:

| Format | Example | Extracted |
|--------|---------|-----------|
| HTTPS | `https://github.com/nocoo/signoff.now.git` | `nocoo/signoff.now` |
| SSH (standard) | `git@github.com:nocoo/repo.git` | `nocoo/repo` |
| SSH (host alias) | `git@gh-work:infinity-microsoft/studio.git` | `infinity-microsoft/studio` |
| Azure DevOps | `https://microsoft.visualstudio.com/...` | → **exit**: "Azure DevOps not supported" |

All GitHub formats (HTTPS and SSH) normalize to the same `{owner, repo}` pair. The SSH host alias is discarded — identity is determined by `owner`, not by SSH config.

#### Step 2: Build identity map

One-time setup (cacheable):

```
gh auth status --json hosts
→ [{login: "nocoo", ...}, {login: "nocoli_microsoft", ...}]

For each user:
  token = gh auth token --user <login>
  GH_TOKEN=<token> gh api /user/orgs → org logins[]

Result:
  Map {
    "nocoo" → "nocoo",
    "nocoli_microsoft" → "nocoli_microsoft",
    "infinity-microsoft" → "nocoli_microsoft",    // org membership
  }
```

#### Step 3: Lookup and resolve

```
owner from Step 1 → lookup in Map from Step 2
  ├─ Hit  → gh auth token --user <matched_user> → GH_TOKEN
  └─ Miss → use active user (fallback for public repos, collaborator access)
```

#### Concurrency Safety

`GH_TOKEN` is injected as a **process-level environment variable** — it only affects the current process and its children. Multiple pulse instances can run simultaneously with different tokens. No global config file is read or written during API calls.

### Caching Strategy

The owner→user mapping changes infrequently (only when org membership changes). Cache to `~/.cache/pulse/identity-map.json` with a TTL (default: 24h). Invalidate on:

- `--no-cache` flag
- Cache file missing or corrupt
- TTL expired

---

## Subcommand: `prs`

### Data Model

#### `PrsReport`

```typescript
interface PrsReport {
  generatedAt: string;           // ISO 8601
  durationMs: number;
  repository: {
    owner: string;
    repo: string;
    url: string;                 // https://github.com/{owner}/{repo}
  };
  identity: {
    resolvedUser: string;        // which gh user was used
    resolvedVia: "direct" | "org" | "fallback";
  };
  filters: {
    state: "open" | "closed" | "all";
  };
  totalCount: number;
  prs: PullRequestInfo[];
}
```

#### `PullRequestInfo`

```typescript
interface PullRequestInfo {
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  merged: boolean;
  mergedAt: string | null;       // ISO 8601
  author: string;                // login
  createdAt: string;             // ISO 8601
  updatedAt: string;             // ISO 8601
  closedAt: string | null;       // ISO 8601
  headBranch: string;
  baseBranch: string;
  url: string;                   // HTML URL for the PR
  labels: string[];
  reviewDecision: string | null; // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
  additions: number;
  deletions: number;
  changedFiles: number;
}
```

### GitHub API

v1 uses **GitHub GraphQL API** exclusively. GraphQL is chosen over REST because:

1. `reviewDecision` is only available via GraphQL (REST requires N+1 per-PR calls)
2. Cursor-based pagination is more reliable than REST's `Link` header page-number scheme
3. A single query returns all needed fields — no response joining

**Query:**

```graphql
query($owner: String!, $repo: String!, $states: [PullRequestState!], $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequests(states: $states, first: 100, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title state isDraft
        merged mergedAt
        author { login }
        createdAt updatedAt closedAt
        headRefName baseRefName
        url
        labels(first: 10) { nodes { name } }
        reviewDecision
        additions deletions changedFiles
      }
    }
  }
}
```

**Pagination:** Follow `pageInfo.hasNextPage` + `endCursor` to fetch all pages. A `--limit <n>` flag can cap the total number of results by stopping pagination early.

**Endpoint:** `POST https://api.github.com/graphql` with `Authorization: bearer <token>`.

**Merged status:** GraphQL provides a dedicated `merged: Boolean` field, unlike REST where merged PRs appear as `state: "closed"` and require checking `merged_at`.

### CLI Flags (`prs` subcommand)

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--state` | `open \| closed \| all` | `open` | Filter by PR state |
| `--limit` | `number` | `0` (all) | Max PRs to return (0 = unlimited) |
| `--author` | `string` | — | Filter by author login |

---

## Testing Strategy

Following the same rigor as gitinfo (95% coverage threshold).

### Unit Tests

| Module | Test File | What to test |
|--------|-----------|--------------|
| `cli/args.ts` | `args.test.ts` | Argument parsing: subcommands, flags, defaults, invalid input |
| `cli/output.ts` | `output.test.ts` | JSON serialization, pretty format layout |
| `identity/resolve-remote.ts` | `resolve-remote.test.ts` | URL parsing for all formats (HTTPS, SSH, SSH alias, Azure DevOps detection) |
| `identity/resolve-user.ts` | `resolve-user.test.ts` | Owner→user mapping: direct match, org match, fallback, empty orgs |
| `commands/prs/fetch-prs.ts` | `fetch-prs.test.ts` | Response parsing, pagination handling, merged status derivation |
| `commands/prs/format-prs.ts` | `format-prs.test.ts` | Pretty output format, column alignment, color codes |

### Snapshot Tests

Lock down JSON output format with snapshot tests:

- `PrsReport` structure with known fixtures → snapshot the full JSON output
- Ensures format stability across refactors

### Integration Tests

`__integration__/e2e.integration.test.ts`:

- Real API call to a known public repository (e.g., `octocat/Hello-World`)
- Validates response shape matches `PrsReport` interface
- Gated behind `--integration` flag, not run in normal `bun test`

### Mock Strategy

- `mock-client.ts`: Returns canned GraphQL responses; verifiable call recording
- `mock-executor.ts`: Returns canned `gh auth status` / `gh auth token` outputs

---

## Roadmap

### Phase 1: Identity Resolution (foundation)

> Automatically infer correct GitHub identity from any local repository.

- [x] Parse `git remote get-url origin` → `{platform, owner, repo}`
  - HTTPS format: `https://github.com/{owner}/{repo}.git`
  - SSH format: `git@{host}:{owner}/{repo}.git` (standard + host alias)
  - Azure DevOps detection → graceful exit
- [x] Query `gh auth status --json hosts` → enumerate all logged-in users
- [x] Per-user org resolution: `GH_TOKEN=<token> gh api /user/orgs`
- [x] Build `owner → ghUser` mapping table
- [x] Lookup: given an `owner`, resolve to the correct token
- [x] Cache mapping to `~/.cache/pulse/identity-map.json` (24h TTL)
- [x] Unit tests: all URL formats, mapping logic, cache hit/miss/expiry

### Phase 2: `prs` Subcommand (first feature)

> Fetch complete PR list with full metadata via GraphQL.

- [x] GraphQL query: fetch PRs with pagination (`pageInfo.hasNextPage` + cursor)
- [x] Parse response → `PullRequestInfo[]`
- [x] `--state` filter (open / closed / all)
- [x] `--limit` cap
- [x] `--author` filter
- [x] `--pretty` output formatter
- [ ] JSON output format locked by snapshot tests
- [x] Unit tests: response parsing, pagination, filter logic
- [ ] Integration test: real API call to a public repo

### Future Phases (not in v1)

- **`pr-detail` subcommand** — ~~Per-PR detail with reviews, comments, commits, files, CI status~~ **Implemented (Phase 3).** Nested collections use fixed `first:N` limits; full nested pagination is a follow-up
- **Desktop integration** — ~~In-process execution from Electron main~~ **Implemented.** See [03-pulse-pr-cache.md](./03-pulse-pr-cache.md)
- **Nested pagination** — Follow `pageInfo.hasNextPage` on nested GraphQL connections (reviews, comments, commits, files) to fetch beyond `first:N` limits
- **Time-window search** — `--search "created:{start}..{end}"` for incremental batch sync (legacy parity)
- **PR diff** — File patches + full unified diff via REST fallback
- **Repo metadata** — Repository-level info via GraphQL
- **Azure DevOps support** — `az repos pr list` equivalent
- **Identity map auto-refresh** — Watch `gh auth` changes, invalidate cache

> For detailed gap analysis, target naming, and implementation plans for these phases, see [04-pulse-cli-spec.md](./04-pulse-cli-spec.md).
