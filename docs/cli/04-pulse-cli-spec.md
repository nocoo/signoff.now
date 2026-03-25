# 04 — Pulse CLI: Command & Interface Specification

## Overview

This document is the **target specification** for pulse CLI's command structure, public interface naming, and output data model. It defines the canonical naming conventions (aligned with GitHub GraphQL schema) and the full command surface, covering both existing implementations and planned additions.

> **All non-ADO phases are implemented.** The CLI exposes `prs`, `pr show`, `pr diff`, `pr search`, and `repo` commands. Output types and fields are aligned with GitHub GraphQL naming. Nested pagination is implemented for all high-risk connections. ADO support remains blocked.

### Naming Conventions

| Category | Convention | Example |
|----------|-----------|---------|
| CLI subcommands | `<resource>` or `<resource> <action>` | `prs`, `pr show`, `pr diff`, `repo` |
| CLI flags | `--kebab-case` | `--state`, `--no-cache` |
| Output interface names | `PascalCase`, `PullRequest` prefix for PR-domain | `PullRequestInfo`, `PullRequestDetail` |
| Output field names | **Match GitHub GraphQL field names** unless unwrapping nested objects | `isDraft` not ~~`draft`~~, `headRefName` not ~~`headBranch`~~ |
| Enum values | **UPPER_CASE**, match GraphQL verbatim | `"OPEN"`, `"MERGED"`, `"APPROVED"` |
| Internal types (GraphQL raw) | `GraphQL` prefix + `Node` suffix | `GraphQLPullRequestNode`, `GraphQLPullRequestDetailNode` |
| API client methods | `fetch` + resource name | `fetchPullRequests`, `fetchPullRequestDetail` |
| Collect functions | `collect` + resource name | `collectPullRequests`, `collectPullRequestDetail` |
| Report wrappers | resource + `Report` | `PullRequestsReport`, `PullRequestDetailReport` |

---

## Command Structure

### Design Principle: Resource-Oriented, Orthogonal

Commands follow a `<resource> [action]` pattern. Each resource has a default action (list or show) and optional sub-actions:

```
pulse <command> [flags]

Commands:
  prs                List pull requests for the current repository
  pr show            Show detailed information for a single PR
  pr diff            Show diff and changed files for a single PR
  pr search          Search pull requests by time window or query
  repo               Show repository metadata

Global Flags:
  --cwd <path>       Target directory (default: cwd)
  --pretty           Human-readable output (default: compact JSON)
  --no-cache         Skip identity cache
  --help, -h         Show help
  --version, -v      Show version
```

### Command Matrix

| Command | Resource | Action | GitHub API | Status |
|---------|----------|--------|------------|--------|
| `prs` | PullRequest (collection) | list | GraphQL `repository.pullRequests` | ✅ Implemented |
| `pr show` | PullRequest (single) | detail | GraphQL `repository.pullRequest(number:)` | ✅ Implemented |
| `pr diff` | PullRequest (single) | diff | REST `GET .../pulls/{N}/files` + `Accept: diff` | ✅ Implemented |
| `pr search` | PullRequest (collection) | search | GraphQL `search(type: ISSUE)` | ✅ Implemented |
| `repo` | Repository | show | GraphQL `repository` | ✅ Implemented |

### Subcommand Flags

#### `prs`

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--state` | `open \| closed \| merged \| all` | `open` | Filter by PR state. Maps to GraphQL `PullRequestState` |
| `--limit` | `number` | `0` (all) | Max PRs to return (0 = paginate to exhaustion) |
| `--author` | `string` | — | Filter by author login (client-side) |

> **State mapping change:** Current implementation maps `--state closed` to GraphQL `[CLOSED, MERGED]` and collapses `MERGED` into `state: "closed"` in output. New behavior: `--state merged` is a distinct filter mapping to GraphQL `[MERGED]`, and `--state closed` maps to `[CLOSED]` only. `--state all` maps to `[OPEN, CLOSED, MERGED]`.

#### `pr show`

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--number` | `number` | Yes | PR number |

> **Rename:** `--pr` → `--number` to match the GitHub GraphQL field `pullRequest(number:)`.

#### `pr diff`

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--number` | `number` | Yes | PR number |

#### `pr search`

| Flag | Type | Required | Description |
|------|------|----------|-------------|
| `--query` | `string` | Yes | Search qualifier (e.g., `created:2026-03-01..2026-03-31`) |
| `--limit` | `number` | `100` | Max results |

#### `repo`

No subcommand-specific flags.

---

## Output Data Model

All output types use field names aligned with GitHub GraphQL. The mapping layer (`mapPullRequestNode`) handles the structural unwrapping (e.g., `author: { login } → author: string`) but preserves field names where possible.

### Naming Changes from Current Implementation

| Current Name | New Name | Reason |
|-------------|----------|--------|
| `PullRequestInfo` | `PullRequestInfo` | ✅ Keep (concise, unambiguous) |
| `PrDetail` | `PullRequestDetail` | Align with full `PullRequest` prefix |
| `PrsReport` | `PullRequestsReport` | Consistent full prefix |
| `PrDetailReport` | `PullRequestDetailReport` | Consistent full prefix |
| `PrReview` | `PullRequestReview` | Align with GraphQL `PullRequestReview` type |
| `PrReviewComment` | `PullRequestReviewComment` | Align with GraphQL `PullRequestReviewComment` type |
| `PrComment` | `IssueComment` | Align with GraphQL `IssueComment` type (PR comments are issue comments) |
| `PrCommit` | `PullRequestCommit` | Align with GraphQL `PullRequestCommit` type |
| `PrFile` | `PullRequestChangedFile` | Align with GraphQL `PullRequestChangedFile` type |
| `CheckRun` | `CheckRun` | ✅ Keep (already matches GraphQL) |
| `PrDiffReport` | `PullRequestDiffReport` | Consistent full prefix |
| `PrFileWithPatch` | `PullRequestChangedFileWithPatch` | Consistent full prefix |

### Field Name Changes

| Type | Current Field | New Field | Reason |
|------|--------------|-----------|--------|
| `PullRequestInfo` | `draft` | `isDraft` | Match GraphQL `PullRequest.isDraft` |
| `PullRequestInfo` | `headBranch` | `headRefName` | Match GraphQL `PullRequest.headRefName` |
| `PullRequestInfo` | `baseBranch` | `baseRefName` | Match GraphQL `PullRequest.baseRefName` |
| `PullRequestInfo` | `state` (`"open" \| "closed"`) | `state` (`"OPEN" \| "CLOSED" \| "MERGED"`) | Match GraphQL `PullRequestState` enum; preserve `MERGED` as distinct state |
| `PullRequestDetail` | `requestedReviewers` | `reviewRequests` | Match GraphQL field name `PullRequest.reviewRequests` |
| `PullRequestCommit` | `oid` | `abbreviatedOid` | Match GraphQL `Commit.abbreviatedOid` (it IS abbreviated, not full OID) |
| `PullRequestCommit` | `statusCheckRollup` (string enum) | `statusCheckRollup` (object or null) | Match GraphQL structure: `{ state, contexts }` not flattened string |

### `PullRequestsReport` (output of `prs`)

```typescript
interface PullRequestsReport {
  generatedAt: string;                    // ISO 8601
  durationMs: number;
  repository: RepositoryRef;
  identity: IdentityRef;
  filters: {
    state: PullRequestStateFilter;
    author: string | null;
    limit: number;
  };
  totalCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
  pullRequests: PullRequestInfo[];
}

interface RepositoryRef {
  owner: string;
  name: string;                           // was `repo`; match GraphQL `Repository.name`
  url: string;
}

interface IdentityRef {
  resolvedUser: string;
  resolvedVia: "direct" | "org" | "fallback";
}

type PullRequestStateFilter = "open" | "closed" | "merged" | "all";
```

### `PullRequestInfo` (list-level item)

```typescript
interface PullRequestInfo {
  number: number;
  title: string;
  state: PullRequestState;               // "OPEN" | "CLOSED" | "MERGED"
  isDraft: boolean;                       // was `draft`
  merged: boolean;
  mergedAt: string | null;
  author: string;                         // unwrapped from { login }
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  headRefName: string;                    // was `headBranch`
  baseRefName: string;                    // was `baseBranch`
  url: string;
  labels: string[];                       // unwrapped from nodes[].name
  reviewDecision: PullRequestReviewDecision | null;
  additions: number;
  deletions: number;
  changedFiles: number;
}

type PullRequestState = "OPEN" | "CLOSED" | "MERGED";

type PullRequestReviewDecision =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REVIEW_REQUIRED";
```

### `PullRequestDetailReport` (output of `pr show`)

```typescript
interface PullRequestDetailReport {
  generatedAt: string;
  durationMs: number;
  repository: RepositoryRef;
  pullRequest: PullRequestDetail;         // was `pr`
}
```

### `PullRequestDetail` (extends `PullRequestInfo`)

```typescript
interface PullRequestDetail extends PullRequestInfo {
  body: string;
  mergeable: MergeableState;
  mergeStateStatus: MergeStateStatus;
  mergedBy: string | null;                // unwrapped from { login }
  totalCommentsCount: number;             // GraphQL nullable → default 0
  participants: string[];                 // unwrapped from nodes[].login
  reviewRequests: string[];               // was `requestedReviewers`; unwrapped login|slug
  assignees: string[];                    // unwrapped from nodes[].login
  milestone: string | null;               // unwrapped from { title }
  headRefOid: string;
  baseRefOid: string;
  isCrossRepository: boolean;

  reviews: PullRequestReview[];
  comments: IssueComment[];               // was `PrComment`; match GraphQL type name
  commits: PullRequestCommit[];
  files: PullRequestChangedFile[];
}

type MergeableState = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

type MergeStateStatus =
  | "BEHIND" | "BLOCKED" | "CLEAN" | "DIRTY"
  | "DRAFT" | "HAS_HOOKS" | "UNKNOWN" | "UNSTABLE";
```

### `PullRequestReview`

```typescript
interface PullRequestReview {
  author: string;
  state: PullRequestReviewState;
  body: string;
  submittedAt: string | null;
  comments: PullRequestReviewComment[];
}

type PullRequestReviewState =
  | "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED"
  | "DISMISSED" | "PENDING";
```

### `PullRequestReviewComment`

```typescript
interface PullRequestReviewComment {
  author: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  diffHunk: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}
```

### `IssueComment` (was `PrComment`)

```typescript
interface IssueComment {
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}
```

### `PullRequestCommit`

```typescript
interface PullRequestCommit {
  abbreviatedOid: string;                 // was `oid`
  message: string;
  author: string;
  authoredDate: string;
  statusCheckRollup: StatusCheckRollup | null;
}

/** Matches GraphQL StatusCheckRollup type structure. */
interface StatusCheckRollup {
  state: StatusState;
  checkRuns: CheckRun[];                  // filtered from contexts (CheckRun nodes only)
}

type StatusState =
  | "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | "EXPECTED";
```

> **Change from current:** Current code flattens `statusCheckRollup` to a bare `StatusState | null` string and puts `checkRuns` as a sibling field on `PullRequestCommit`. New structure nests `checkRuns` inside `statusCheckRollup` to match GraphQL's `StatusCheckRollup { state, contexts }` shape. When `statusCheckRollup` is `null` (no checks configured), there are no check runs to report.

### `CheckRun`

```typescript
interface CheckRun {
  name: string;
  status: CheckStatusState;
  conclusion: CheckConclusionState | null;
  detailsUrl: string | null;
}

type CheckStatusState =
  | "QUEUED" | "IN_PROGRESS" | "COMPLETED"
  | "WAITING" | "PENDING" | "REQUESTED";

type CheckConclusionState =
  | "SUCCESS" | "FAILURE" | "NEUTRAL" | "CANCELLED"
  | "TIMED_OUT" | "ACTION_REQUIRED" | "SKIPPED"
  | "STARTUP_FAILURE" | "STALE";
```

> **Note:** `STARTUP_FAILURE` added to match current GitHub GraphQL `CheckConclusionState` enum.

### `PullRequestChangedFile`

```typescript
interface PullRequestChangedFile {
  path: string;
  additions: number;
  deletions: number;
  changeType: PatchStatus;
}

type PatchStatus =
  | "ADDED" | "MODIFIED" | "DELETED"
  | "RENAMED" | "COPIED" | "CHANGED";
```

### `PullRequestDiffReport` (output of `pr diff`)

```typescript
interface PullRequestDiffReport {
  generatedAt: string;
  durationMs: number;
  repository: RepositoryRef;
  pullRequest: { number: number };
  diff: string;                           // full unified diff text
  files: PullRequestChangedFileWithPatch[];
}

interface PullRequestChangedFileWithPatch extends PullRequestChangedFile {
  patch: string | null;                   // REST-only; not in GraphQL
}
```

### `PullRequestSearchReport` (output of `pr search`)

```typescript
interface PullRequestSearchReport {
  generatedAt: string;
  durationMs: number;
  repository: RepositoryRef;
  identity: IdentityRef;
  query: string;
  totalCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
  pullRequests: PullRequestInfo[];
}
```

### `RepositoryReport` (output of `repo`)

```typescript
interface RepositoryReport {
  generatedAt: string;
  durationMs: number;
  repository: RepositoryInfo;
}

interface RepositoryInfo {
  owner: string;
  name: string;
  url: string;
  description: string | null;
  homepageUrl: string | null;
  stargazerCount: number;                 // match GraphQL; was `stars`
  forkCount: number;                      // match GraphQL; was `forks`
  isArchived: boolean;
  isPrivate: boolean;
  primaryLanguage: { name: string; color: string } | null;
  languages: Array<{ name: string; color: string }>;
  defaultBranchRef: string;               // match GraphQL; was `defaultBranch`
  licenseInfo: string | null;             // unwrapped from { spdxId }; match GraphQL field name
  topics: string[];                       // unwrapped from repositoryTopics
  pushedAt: string;
  createdAt: string;
  updatedAt: string;
}
```

---

## API Client Interface

### `GitHubApiClient`

```typescript
interface GitHubApiClient {
  /** List PRs with cursor pagination. */
  fetchPullRequests(
    owner: string,
    repo: string,
    opts: FetchPullRequestsOptions,
  ): Promise<FetchPullRequestsResult>;

  /** Fetch full detail for a single PR. */
  fetchPullRequestDetail(
    owner: string,
    repo: string,
    number: number,
  ): Promise<FetchPullRequestDetailResult>;

  /** Fetch changed files with patch content (REST). */
  fetchPullRequestFiles(
    owner: string,
    repo: string,
    number: number,
  ): Promise<FetchPullRequestFilesResult>;

  /** Fetch full unified diff (REST). */
  fetchPullRequestDiff(
    owner: string,
    repo: string,
    number: number,
  ): Promise<string>;

  /** Search PRs by query string (GraphQL search API). */
  searchPullRequests(
    owner: string,
    repo: string,
    opts: SearchPullRequestsOptions,
  ): Promise<SearchPullRequestsResult>;

  /** Fetch repository metadata. */
  fetchRepository(
    owner: string,
    repo: string,
  ): Promise<RepositoryInfo>;
}
```

### Input/Result Types

```typescript
interface FetchPullRequestsOptions {
  states: PullRequestState[];
  limit: number;
  author: string | null;
  cursor?: string | null;
}

interface FetchPullRequestsResult {
  pullRequests: PullRequestInfo[];
  totalCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
}

interface FetchPullRequestDetailResult {
  pullRequest: PullRequestDetail;        // was `pr`
}

interface FetchPullRequestFilesResult {
  files: PullRequestChangedFileWithPatch[];
}

interface SearchPullRequestsOptions {
  query: string;                          // GitHub search qualifier
  limit: number;
  cursor?: string | null;
}

interface SearchPullRequestsResult {
  pullRequests: PullRequestInfo[];
  totalCount: number;
  hasNextPage: boolean;
  endCursor: string | null;
}
```

---

## Collect Functions (Desktop Integration API)

```typescript
// Base options shared by all collect functions
interface CollectBaseOptions {
  exec: CommandExecutor;
  cwd: string;
  noCache?: boolean;
  cacheStore?: CacheStore;
  apiClient?: GitHubApiClient;            // DI override for testing
}

interface CollectPullRequestsOptions extends CollectBaseOptions {
  state: PullRequestStateFilter;
  limit: number;
  author: string | null;
  cursor?: string | null;
}

interface CollectPullRequestDetailOptions extends CollectBaseOptions {
  number: number;
}

interface CollectPullRequestDiffOptions extends CollectBaseOptions {
  number: number;
}

interface CollectPullRequestSearchOptions extends CollectBaseOptions {
  query: string;
  limit: number;
  cursor?: string | null;                 // support load-more pagination
}

interface CollectRepositoryOptions extends CollectBaseOptions {}

// Exported functions
function collectPullRequests(opts: CollectPullRequestsOptions): Promise<PullRequestsReport>;
function collectPullRequestDetail(opts: CollectPullRequestDetailOptions): Promise<PullRequestDetailReport>;
function collectPullRequestDiff(opts: CollectPullRequestDiffOptions): Promise<PullRequestDiffReport>;
function collectPullRequestSearch(opts: CollectPullRequestSearchOptions): Promise<PullRequestSearchReport>;
function collectRepository(opts: CollectRepositoryOptions): Promise<RepositoryReport>;
```

> **Rename:** `collectPrs` → `collectPullRequests`, `collectPrDetail` → `collectPullRequestDetail` for consistency.

---

## Package Exports

```jsonc
// apps/pulse/package.json "exports"
{
  ".":          "./src/commands/types.ts",     // All output types
  "./collect":  "./src/collect.ts",            // Desktop integration entry
  "./executor": "./src/executor/types.ts",     // CommandExecutor interface
  "./identity": "./src/identity/types.ts",     // RemoteInfo, ResolvedIdentity, etc.
  "./api":      "./src/api/types.ts"           // GitHubApiClient interface
}
```

> **Note:** `CacheStore` should be re-exported from `./identity` (currently only exported from `resolve-user.ts`, not reachable via the export map).

---

## Nested Pagination Strategy

Current pr-detail query uses fixed `first:N` limits without following `pageInfo.hasNextPage`:

| Nested Connection | Current Limit | Truncation Risk | Follow-up Pagination |
|-------------------|---------------|-----------------|---------------------|
| `labels` | `first:20` | Low (few PRs have >20 labels) | ❌ Not needed |
| `participants` | `first:100` | Low-Medium (large PRs in big orgs) | ✅ Implemented |
| `assignees` | `first:20` | Very low | ✅ Implemented |
| `reviewRequests` | `first:20` | Very low | ✅ Implemented |
| `reviews` | `first:100` | Low (rare to exceed) | ✅ Implemented |
| `reviews.comments` | `first:100` per review | Low | ✅ Implemented |
| `comments` (issue) | `first:100` | Medium (bot-heavy PRs can exceed) | ✅ Implemented |
| `commits` | `first:250` | Low-Medium (long-lived feature branches) | ✅ Implemented |
| `commits.statusCheckRollup.contexts` | `first:100` per commit | Low (only head commit typically matters) | ❌ Not needed |
| `files` | `first:100` | **Medium-High** (refactors, renames) | ✅ Implemented |

> **Highest risk:** `files` — repository-wide renames or refactors routinely touch >100 files. `comments` is next — PRs with CI bots posting status updates can accumulate many comments.

**Approach:** Add `pageInfo { hasNextPage endCursor }` to each nested connection in the detail query. When `hasNextPage` is true, issue follow-up queries targeting the specific connection:

```graphql
# Follow-up for reviews page 2+
query($owner: String!, $repo: String!, $number: Int!, $cursor: String!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviews(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes { ... }
      }
    }
  }
}
```

This is incremental — each connection can be paginated independently. For typical PRs (< 100 reviews, < 250 commits, < 100 files), zero follow-up queries are issued.

---

## Legacy Parity Matrix

### Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Fully implemented |
| 🔶 | Implemented with limitations (documented) |
| ❌ | Not yet implemented |

### PR Data Fetching

| Capability | Legacy | Pulse | Status | Notes |
|------------|--------|-------|--------|-------|
| List PRs (open/closed/all) | `gh pr list --json` | `prs --state` | ✅ | |
| List PRs (search / time-window) | `gh pr list --search "created:{range}"` | `pr search --query` | ✅ | |
| PR detail (scalar fields) | `gh pr view --json` | `pr show --number` | ✅ | |
| Reviews | `gh api .../reviews` (paginated to exhaustion) | Nested `reviews(first:100)` + follow-up pagination | ✅ | |
| Review comments | `gh api .../comments` (paginated to exhaustion) | Nested `reviews.comments(first:100)` + follow-up | ✅ | |
| Issue comments | `gh api .../issues/.../comments` (paginated to exhaustion) | Nested `comments(first:100)` + follow-up | ✅ | |
| Commits | `gh api .../commits` (paginated) | Nested `commits(first:250)` + follow-up | ✅ | |
| CI check runs | `gh api .../check-runs` | Nested `statusCheckRollup.contexts(first:100)` | 🔶 | No nested pagination for contexts |
| Changed files (metadata) | `gh api .../files` (paginated to exhaustion) | Nested `files(first:100)` + follow-up | ✅ | |
| File patches (diff content) | REST `.../files` `patch` field | REST `.../pulls/{N}/files` | ✅ | |
| Full PR diff | `gh pr diff` | REST `Accept: application/vnd.github.diff` | ✅ | |
| Mergeable status | `gh pr view --json mergeable` | GraphQL `mergeable` + `mergeStateStatus` | ✅ | |
| Review requests | Not in legacy | GraphQL `reviewRequests` | ✅ | Pulse-only; capped at `first:20` |
| Participants & assignees | Not in legacy | GraphQL `participants` + `assignees` | ✅ | Pulse-only; capped at `first:100` / `first:20` |
| Repo metadata | Not in legacy | `repo` | ✅ | |
| Azure DevOps | `az repos pr list/show` | — | ❌ | **Blocked:** no desktop ADO project |

### Identity & Auth

| Capability | Legacy | Pulse | Status |
|------------|--------|-------|--------|
| Multi-account auto-detection | Manual `gh auth switch` | `gh auth status --json` → owner→user map | ✅ |
| Concurrent safety | ❌ Global auth state | Per-process `GH_TOKEN` injection | ✅ |
| Identity cache | None | `~/.cache/pulse/identity-map.json` (24h TTL) | ✅ |

---

## Migration Checklist (Current → New Naming)

### Breaking Changes (require code migration)

| File | Change |
|------|--------|
| `src/commands/types.ts` | Rename types: `PrDetail` → `PullRequestDetail`, `PrsReport` → `PullRequestsReport`, etc. Rename fields: `draft` → `isDraft`, `headBranch` → `headRefName`, `baseBranch` → `baseRefName`, `oid` → `abbreviatedOid` |
| `src/commands/types.ts` | Change `state` type from `"open" \| "closed"` to `"OPEN" \| "CLOSED" \| "MERGED"` |
| `src/commands/types.ts` | Rename `PrComment` → `IssueComment`, `PrReview` → `PullRequestReview`, `PrReviewComment` → `PullRequestReviewComment`, `PrCommit` → `PullRequestCommit`, `PrFile` → `PullRequestChangedFile` |
| `src/commands/types.ts` | Add `"STARTUP_FAILURE"` to `CheckConclusionState` |
| `src/api/types.ts` | Rename `FetchPrsOptions` → `FetchPullRequestsOptions`, `FetchPrsResult` → `FetchPullRequestsResult`, `FetchPrDetailResult` → `FetchPullRequestDetailResult` |
| `src/api/types.ts` | Rename result field `pr` → `pullRequest` in `FetchPullRequestDetailResult` |
| `src/api/map-pr-node.ts` | Stop lowercasing `state`; stop renaming `isDraft`/`headRefName`/`baseRefName` |
| `src/api/map-pr-detail-node.ts` | Stop renaming `abbreviatedOid` → `oid`; rename output field `requestedReviewers` → `reviewRequests` |
| `src/cli/args.ts` | Rename subcommand `"pr-detail"` → `"pr show"`; rename flag `--pr` → `--number`; add `--state merged` as valid value |
| `src/collect.ts` | Rename `collectPrs` → `collectPullRequests`, `collectPrDetail` → `collectPullRequestDetail`, `CollectPrsOptions` → `CollectPullRequestsOptions`, `CollectPrDetailOptions` → `CollectPullRequestDetailOptions` |
| `apps/desktop/src/main/pulse/collect.ts` | Update function names to match renamed collect exports |
| `apps/desktop/src/lib/trpc/routers/pulse/` | Update type imports to new names |
| `packages/local-db/src/schema/schema.ts` | Column `state` changes from `"open" \| "closed"` to `"OPEN" \| "CLOSED" \| "MERGED"` (requires data migration) |

### Non-Breaking Additions

| File | Change |
|------|--------|
| `src/api/types.ts` | Add `fetchPullRequestFiles`, `fetchPullRequestDiff`, `searchPullRequests`, `fetchRepository` to `GitHubApiClient` |
| `src/cli/args.ts` | Add `"pr diff"`, `"pr search"`, `"repo"` subcommands |
| `src/collect.ts` | Add `collectPullRequestDiff`, `collectPullRequestSearch` |
| `src/identity/types.ts` | Re-export `CacheStore` (currently only in `resolve-user.ts`) |

---

## Implementation Phases

| Phase | Commands | Scope | Status |
|-------|----------|-------|--------|
| **Rename** (breaking) | All existing | Rename types/fields/subcommands to new spec; update all tests and consumers | ✅ Done |
| **Nested pagination** | `pr show` | Add `pageInfo` to nested connections; follow-up queries when `hasNextPage` | ✅ Done |
| **Diff** | `pr diff` | REST fallback for file patches and unified diff | ✅ Done |
| **Search** | `pr search` | GraphQL `search(type: ISSUE)` with qualifier string | ✅ Done |
| **Repo** | `repo` | GraphQL `repository` metadata query | ✅ Done |
| **ADO** | All | Platform abstraction + ADO REST client. **Blocked until desktop has ADO project.** | ❌ Blocked |

### Atomic Commits: Rename Phase

| # | Commit | Scope |
|---|--------|-------|
| 1 | `refactor(pulse): rename output types to match GraphQL naming` | `commands/types.ts` — all type/field renames |
| 2 | `refactor(pulse): update mappers and API types for new naming` | `api/types.ts`, `map-pr-node.ts`, `map-pr-detail-node.ts` |
| 3 | `refactor(pulse): rename CLI subcommand pr-detail to pr show` | `cli/args.ts`, `main.ts`, help text |
| 4 | `refactor(pulse): rename collect functions` | `collect.ts`, package export consumers |
| 5 | `refactor(desktop): update pulse type imports and DB state values` | tRPC router, schema, bridge, migration |

### Atomic Commits: Nested Pagination

| # | Commit | Scope |
|---|--------|-------|
| 1 | `feat(pulse): add pageInfo to detail query and follow-up pagination` | `github-client.ts`, `api/types.ts`, tests |
| 2 | `feat(pulse): update detail mapper for multi-page nested data` | `map-pr-detail-node.ts`, tests |

### Atomic Commits: Diff

| # | Commit | Scope |
|---|--------|-------|
| 1 | `feat(pulse): add fetchPullRequestFiles and fetchPullRequestDiff to API client` | `api/types.ts`, `github-client.ts`, `mock-client.ts`, tests |
| 2 | `feat(pulse): add pr diff subcommand` | `commands/pr-diff/`, `cli/args.ts`, `main.ts`, tests |
| 3 | `feat(pulse): add collectPullRequestDiff to collect export` | `collect.ts` |
| 4 | `feat(desktop): add PR diff tRPC procedures and cache` | router, db helpers, tests |

### Atomic Commits: Search

| # | Commit | Scope |
|---|--------|-------|
| 1 | `feat(pulse): add searchPullRequests to API client` | `api/types.ts`, `github-client.ts`, tests |
| 2 | `feat(pulse): add pr search subcommand` | `commands/pr-search/`, `cli/args.ts`, `main.ts`, tests |
| 3 | `feat(pulse): add collectPullRequestSearch to collect export` | `collect.ts` |

### Atomic Commits: Repo

| # | Commit | Scope |
|---|--------|-------|
| 1 | `feat(pulse): add fetchRepository to API client` | `api/types.ts`, `github-client.ts`, tests |
| 2 | `feat(pulse): add repo subcommand` | `commands/repo/`, `cli/args.ts`, `main.ts`, tests |

---

## Testing Strategy

| Phase | Layer | What | Coverage |
|-------|-------|------|----------|
| Rename | L1 UT | All existing tests updated for new names; no behavioral change | ≥95% |
| Rename | L2 Lint | Biome check | Pre-commit |
| Rename | L3 E2E | Desktop tRPC smoke tests pass with renamed types | Existing suite |
| Nested pagination | L1 UT | Follow-up query dispatch, page merging, no follow-up when `hasNextPage=false` | ≥95% |
| Diff | L1 UT | REST pagination, patch parsing, diff response handling, args parsing | ≥95% |
| Search | L1 UT | Search query construction, result parsing, args parsing | ≥95% |
| Repo | L1 UT | Repository field mapping, pretty formatter | ≥95% |
| All | L2 Lint | Biome check | Pre-commit |
| All | L3 E2E | Desktop tRPC smoke tests for new procedures | Per existing pattern |
