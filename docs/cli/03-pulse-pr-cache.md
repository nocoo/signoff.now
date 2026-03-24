# 03 — PR Cache (SQLite Persistence)

## Overview

Replace the current in-memory `Map<projectId, PrsReport>` cache with **SQLite tables** in `@signoff/local-db`. This enables instant display of previously fetched PRs on app launch, with background refresh updating the view reactively.

> **Status:** Not started.

**Design goals:**

- **Instant first paint** — Show cached PRs immediately on tab mount, no waiting for GitHub API
- **Background refresh** — Simultaneously fetch fresh data; UI merges new results reactively
- **Offline resilience** — Previously loaded PRs remain visible even without network
- **Two-layer data model** — Lightweight list data cached eagerly; heavy detail data cached on demand
- **MVVM separation** — ViewModel owns merge logic; View is purely presentational

---

## Current State

### In-Memory Cache (`apps/desktop/src/lib/trpc/routers/pulse/cache.ts`)

```typescript
const cache = new Map<string, { report: PrsReport; fetchedAt: number }>();
```

**Problems:**

1. Lost on app quit — user must re-scan every session
2. No persistence across Electron restarts
3. "Load more" pagination state lost on restart
4. No way to show stale data while refreshing
5. PR detail data not cached at all — every click re-fetches from GitHub

---

## Data Model Design

### Two-Layer Architecture

PR data splits naturally into two tiers with different access patterns:

| Layer | Source | When cached | Volume | Access pattern |
|-------|--------|-------------|--------|----------------|
| **List** (`PullRequestInfo`) | `pulse.fetchPrs` | On scan / load more | ~20 per page, ~800 total | Batch upsert, query by project+state |
| **Detail** (`PrDetail`) | `pulse.fetchPrDetail` | On user click | 1 at a time | Single row upsert, query by project+number |

The detail layer extends the list layer — a detail row also updates the corresponding list row's scalar fields (e.g., updated labels, review decision). The heavy sub-data (reviews, comments, commits, files) lives in the detail row as JSON columns, since they are read-only display data that never needs SQL-level querying.

### Data Shape Reference (from studio project research)

Typical PR in `infinity-microsoft/studio` (~776 open PRs):

```
List fields:  20 scalar/array fields (title, state, author, labels[], etc.)
Detail adds:  body (0-2KB), mergeable, mergeStateStatus, mergedBy, etc.
  reviews:    2-6 items (author, state, body, submittedAt)
  comments:   3-5 items (mostly bots: claude-code-mai, mai-studio-pr-management)
  commits:    1-4 items (oid, message, author, statusCheckRollup)
  files:      4-10 items (path, additions, deletions, changeType)
```

---

## Database Schema

### Table 1: `pull_requests` — List-level cache

Stores every PR seen during list scans. Upserted in batches of 20 per page.

```typescript
export const pullRequests = sqliteTable(
  "pull_requests",
  {
    id: text("id").primaryKey().$defaultFn(() => uuidv4()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),

    // PR metadata (mirrors PullRequestInfo — 18 fields)
    title: text("title").notNull(),
    state: text("state").notNull(),           // "open" | "closed"
    draft: integer("draft", { mode: "boolean" }).notNull(),
    merged: integer("merged", { mode: "boolean" }).notNull(),
    mergedAt: text("merged_at"),              // ISO 8601 | null
    author: text("author").notNull(),
    createdAtIso: text("created_at_iso").notNull(), // ISO 8601 (PR creation)
    updatedAtIso: text("updated_at_iso").notNull(), // ISO 8601 (PR update)
    closedAtIso: text("closed_at_iso"),       // ISO 8601 | null
    headBranch: text("head_branch").notNull(),
    baseBranch: text("base_branch").notNull(),
    url: text("url").notNull(),
    labels: text("labels", { mode: "json" }).$type<string[]>().notNull(),
    reviewDecision: text("review_decision"),  // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
    additions: integer("additions").notNull(),
    deletions: integer("deletions").notNull(),
    changedFiles: integer("changed_files").notNull(),

    // Cache bookkeeping
    fetchedAt: integer("fetched_at").notNull().$defaultFn(() => Date.now()),
  },
  (table) => [
    index("pull_requests_project_id_idx").on(table.projectId),
    index("pull_requests_project_number_idx").on(table.projectId, table.number),
    index("pull_requests_state_idx").on(table.projectId, table.state),
  ],
);
```

**Upsert key:** `(projectId, number)` — ON CONFLICT UPDATE all mutable fields.

### Table 2: `pull_request_details` — Detail-level cache

Stores the heavy payload fetched on demand when user clicks a PR. One row per PR.

```typescript
export const pullRequestDetails = sqliteTable(
  "pull_request_details",
  {
    id: text("id").primaryKey().$defaultFn(() => uuidv4()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),

    // Detail-only scalar fields (not in list)
    body: text("body").notNull(),             // PR description markdown
    mergeable: text("mergeable").notNull(),    // MERGEABLE | CONFLICTING | UNKNOWN
    mergeStateStatus: text("merge_state_status").notNull(),
    mergedBy: text("merged_by"),              // login | null
    totalCommentsCount: integer("total_comments_count").notNull(),
    headRefOid: text("head_ref_oid").notNull(),
    baseRefOid: text("base_ref_oid").notNull(),
    isCrossRepository: integer("is_cross_repository", { mode: "boolean" }).notNull(),

    // Array fields as JSON
    participants: text("participants", { mode: "json" }).$type<string[]>().notNull(),
    requestedReviewers: text("requested_reviewers", { mode: "json" }).$type<string[]>().notNull(),
    assignees: text("assignees", { mode: "json" }).$type<string[]>().notNull(),
    milestone: text("milestone"),             // title string | null

    // Sub-entity arrays as JSON (read-only display, no SQL querying needed)
    reviews: text("reviews", { mode: "json" }).$type<PrReview[]>().notNull(),
    comments: text("comments", { mode: "json" }).$type<PrComment[]>().notNull(),
    commits: text("commits", { mode: "json" }).$type<PrCommit[]>().notNull(),
    files: text("files", { mode: "json" }).$type<PrFile[]>().notNull(),

    // Cache bookkeeping
    fetchedAt: integer("fetched_at").notNull().$defaultFn(() => Date.now()),
  },
  (table) => [
    index("pr_details_project_id_idx").on(table.projectId),
    index("pr_details_project_number_idx").on(table.projectId, table.number),
  ],
);
```

**Upsert key:** `(projectId, number)` — full row replace on each detail fetch.

**Why JSON columns for sub-entities?**

- Reviews, comments, commits, and files are **read-only display data** — we never query "find all PRs with a failing check" or "find all reviews by bob"
- Typical payload: 2-6 reviews, 3-5 comments, 1-4 commits, 4-10 files — small enough for JSON
- No N+1 query problem — detail always loads the full blob in one SELECT
- Adding separate `pr_reviews`, `pr_comments`, `pr_commits`, `pr_files` tables would add 4 tables + 4 FK indexes + complex batch insert/delete logic for no querying benefit
- JSON columns use Drizzle's `{ mode: "json" }` which auto-serializes/deserializes

### Table 3: `pull_request_scans` — Pagination & scan metadata

Tracks scan state per project per filter, enabling "Load more" to resume across sessions.

```typescript
export const pullRequestScans = sqliteTable(
  "pull_request_scans",
  {
    id: text("id").primaryKey().$defaultFn(() => uuidv4()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    // Scan parameters (composite key for upsert)
    state: text("state").notNull(),           // "open" | "closed" | "all"
    author: text("author"),                   // null = no filter

    // Pagination state
    endCursor: text("end_cursor"),            // GitHub GraphQL cursor
    hasNextPage: integer("has_next_page", { mode: "boolean" }).notNull(),

    // Identity info (for display)
    resolvedUser: text("resolved_user"),
    resolvedVia: text("resolved_via"),        // "direct" | "org" | "fallback"

    // Repository info
    repoOwner: text("repo_owner"),
    repoName: text("repo_name"),

    // Timestamps
    scannedAt: integer("scanned_at").notNull().$defaultFn(() => Date.now()),
  },
  (table) => [
    index("pr_scans_project_id_idx").on(table.projectId),
    index("pr_scans_project_state_idx").on(table.projectId, table.state),
  ],
);
```

**Upsert key:** `(projectId, state)` — one scan record per project per state filter.

### Migration

New migration file: `0002_*.sql` via `bun run db:generate:desktop`.

---

## Data Flow (MVVM)

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│  View (React Components)                                  │
│  PullRequestsTab → PrListPanel + PrDetailPanel            │
│  Purely presentational: renders whatever ViewModel exposes │
└────────────────────┬─────────────────────────────────────┘
                     │ subscribes to
┌────────────────────▼─────────────────────────────────────┐
│  ViewModel (usePrViewModel hook)                          │
│  - Exposes: prs[], selectedPr, isLoading, isRefreshing,   │
│    scanError, hasNextPage, stateFilter, scan(), loadMore()│
│  - On mount: load from DB (instant) + trigger background  │
│    refresh via fetchPrs                                   │
│  - On PR select: load detail from DB (instant if cached)  │
│    + trigger background fetchPrDetail                     │
│  - On scan result: merge into DB, re-query, update view   │
└────────────────────┬─────────────────────────────────────┘
                     │ reads/writes
┌────────────────────▼─────────────────────────────────────┐
│  Model (tRPC Router + SQLite)                             │
│  Procedures:                                              │
│  - getCachedPrs(projectId, state) → PullRequestInfo[]     │
│    SELECT from pull_requests                              │
│  - getCachedPrDetail(projectId, number) → PrDetail | null │
│    JOIN pull_requests + pull_request_details               │
│  - getScanMeta(projectId, state) → scan metadata          │
│    SELECT from pull_request_scans                         │
│  - fetchPrs(projectId, state, cursor?) → PrsReport        │
│    GitHub API → upsert pull_requests + scan meta          │
│  - fetchPrDetail(projectId, number) → PrDetailReport      │
│    GitHub API → upsert pull_requests + pull_request_details│
│  - clearCache(projectId) → void                           │
│    DELETE from all 3 tables WHERE project_id              │
└──────────────────────────────────────────────────────────┘
```

### Mount Sequence (PR List)

```
1. Tab mounts
2. ViewModel: query getCachedPrs(projectId, "open")
   → SQLite returns cached PRs (instant, may be stale)
   → View renders immediately with cached data
3. ViewModel: query getScanMeta(projectId, "open")
   → Get endCursor, hasNextPage from last scan
4. ViewModel: auto-trigger fetchPrs(projectId, "open")
   → UI shows subtle "Refreshing..." indicator (not skeleton)
   → On success: upsert PRs into DB, invalidate getCachedPrs query
   → View updates reactively with fresh data
```

### PR Select Sequence (Detail)

```
1. User clicks PR #42 in the list
2. ViewModel: query getCachedPrDetail(projectId, 42)
   → If cached: show detail instantly
   → If not cached: show skeleton in detail panel
3. ViewModel: trigger fetchPrDetail(projectId, 42)
   → UI shows subtle "Refreshing..." on detail panel
   → On success:
     a. Upsert pull_request_details row (detail data)
     b. Upsert pull_requests row (list fields refreshed)
     c. Invalidate getCachedPrDetail + getCachedPrs queries
   → Detail panel updates with fresh data
```

### Scan Flow

```
User clicks "Scan PRs":
1. ViewModel: mutate fetchPrs(projectId, state, cursor=null)
2. Router: DELETE FROM pull_requests WHERE project_id = ? AND state matches
3. Router: call collectProjectPrs() → GitHub API
4. Router: INSERT INTO pull_requests (...) ON CONFLICT(project_id, number) DO UPDATE
5. Router: UPSERT INTO pull_request_scans (...)
6. Router: return PrsReport
7. ViewModel: invalidate getCachedPrs → tRPC re-fetches from DB
8. View: re-renders with fresh data
```

### Load More Flow

```
User clicks "Load more":
1. ViewModel: mutate fetchPrs(projectId, state, cursor=endCursor)
2. Router: call collectProjectPrs() with cursor
3. Router: INSERT INTO pull_requests (...) ON CONFLICT DO UPDATE (append, no delete)
4. Router: UPDATE pull_request_scans SET end_cursor=?, has_next_page=?
5. Router: return PrsReport
6. ViewModel: invalidate getCachedPrs → DB now has all pages
7. View: list grows with new PRs appended
```

---

## tRPC Router Changes

### File: `apps/desktop/src/lib/trpc/routers/pulse/index.ts`

Replace in-memory cache with DB operations:

| Procedure | Type | Input | Behavior |
|-----------|------|-------|----------|
| `getCachedPrs` | query | `{ projectId, state }` | SELECT from `pull_requests` WHERE project_id + state, ORDER BY created_at_iso DESC |
| `getCachedPrDetail` | query | `{ projectId, number }` | JOIN `pull_requests` + `pull_request_details`, return combined PrDetail or null |
| `getScanMeta` | query | `{ projectId, state }` | SELECT from `pull_request_scans` WHERE project_id + state |
| `fetchPrs` | mutation | `{ projectId, state, cursor?, author? }` | GitHub API → upsert DB → return report |
| `fetchPrDetail` | mutation | `{ projectId, number }` | GitHub API → upsert both tables → return report |
| `clearCache` | mutation | `{ projectId }` | DELETE from all 3 tables WHERE project_id |

### File: `apps/desktop/src/lib/trpc/routers/pulse/cache.ts`

**Delete this file.** Replace with DB-backed operations in the router.

---

## ViewModel Hook

### File: `apps/desktop/src/renderer/hooks/usePrViewModel.ts` (new)

```typescript
export function usePrViewModel(projectId: string) {
  const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">("open");
  const [authorFilter, setAuthorFilter] = useState("");
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);

  // ── List Layer ──

  // Cached list from DB (instant on mount)
  const { data: cachedPrs } = trpc.pulse.getCachedPrs.useQuery(
    { projectId, state: stateFilter },
  );

  // Scan metadata (pagination cursor)
  const { data: scanMeta } = trpc.pulse.getScanMeta.useQuery(
    { projectId, state: stateFilter },
  );

  // List fetch mutation
  const scanMutation = trpc.pulse.fetchPrs.useMutation({
    onSuccess: () => {
      utils.pulse.getCachedPrs.invalidate({ projectId });
      utils.pulse.getScanMeta.invalidate({ projectId });
    },
  });

  // Auto-refresh on mount
  useEffect(() => {
    if (cachedPrs !== undefined) {
      scanMutation.mutate({ projectId, state: stateFilter });
    }
  }, [projectId, stateFilter]);

  // ── Detail Layer ──

  // Cached detail from DB
  const { data: cachedDetail } = trpc.pulse.getCachedPrDetail.useQuery(
    { projectId, number: selectedPrNumber! },
    { enabled: selectedPrNumber !== null },
  );

  // Detail fetch mutation
  const detailMutation = trpc.pulse.fetchPrDetail.useMutation({
    onSuccess: () => {
      utils.pulse.getCachedPrDetail.invalidate({ projectId });
      utils.pulse.getCachedPrs.invalidate({ projectId }); // list fields also refreshed
    },
  });

  // Auto-fetch detail on selection
  useEffect(() => {
    if (selectedPrNumber !== null) {
      detailMutation.mutate({ projectId, number: selectedPrNumber });
    }
  }, [projectId, selectedPrNumber]);

  return {
    // List
    prs: clientSideAuthorFilter(cachedPrs ?? [], authorFilter),
    isLoading: !cachedPrs && scanMutation.isPending,
    isRefreshing: !!cachedPrs && scanMutation.isPending,
    scanError: scanMutation.error?.message ?? null,
    hasNextPage: scanMeta?.hasNextPage ?? false,
    stateFilter,
    setStateFilter,
    authorFilter,
    setAuthorFilter,
    scan: () => scanMutation.mutate({ projectId, state: stateFilter, cursor: null }),
    loadMore: () => scanMutation.mutate({
      projectId, state: stateFilter,
      cursor: scanMeta?.endCursor ?? null,
    }),

    // Detail
    selectedPrNumber,
    selectPr: setSelectedPrNumber,
    selectedPrDetail: cachedDetail ?? null,
    isDetailLoading: selectedPrNumber !== null && !cachedDetail && detailMutation.isPending,
    isDetailRefreshing: !!cachedDetail && detailMutation.isPending,
    detailError: detailMutation.error?.message ?? null,
  };
}
```

### Key Loading States

| State | Condition | UI Treatment |
|-------|-----------|--------------|
| `isLoading` | No cached list, first fetch in progress | Skeleton placeholders in list panel |
| `isRefreshing` | Cached list shown, background refresh active | Subtle spinner on scan button |
| `isDetailLoading` | PR selected, no cached detail, fetching | Skeleton in detail panel |
| `isDetailRefreshing` | Cached detail shown, background refresh active | Subtle spinner on detail panel |

---

## Files to Change

| File | Action | Description |
|------|--------|-------------|
| `packages/local-db/src/schema/schema.ts` | Modify | Add `pullRequests` + `pullRequestDetails` + `pullRequestScans` tables |
| `packages/local-db/drizzle/0002_*.sql` | New | Migration for 3 new tables |
| `packages/local-db/src/schema/schema-migration-consistency.test.ts` | Modify | Add assertions for 3 new tables |
| `apps/desktop/src/lib/trpc/routers/pulse/index.ts` | Rewrite | Replace in-memory cache with DB operations |
| `apps/desktop/src/lib/trpc/routers/pulse/cache.ts` | Delete | No longer needed |
| `apps/desktop/src/lib/trpc/routers/pulse/db.ts` | New | DB read/write helpers for PR cache |
| `apps/desktop/src/renderer/hooks/usePrViewModel.ts` | New | ViewModel hook with list + detail merge logic |
| `apps/desktop/src/renderer/components/GitInfoDashboard/tabs/PullRequestsTab.tsx` | Modify | Use `usePrViewModel` instead of inline state |
| `apps/desktop/src/renderer/components/GitInfoDashboard/tabs/pr/PrListPanel.tsx` | Modify | Accept `isRefreshing` prop for subtle indicator |
| `apps/desktop/src/renderer/components/GitInfoDashboard/tabs/pr/PrDetailPanel.tsx` | Modify | Accept `isDetailLoading` / `isDetailRefreshing` props, render full detail |

---

## Atomic Commits

| # | Commit | Scope |
|---|--------|-------|
| 1 | `feat: add pull_requests, pull_request_details, and pull_request_scans tables` | schema.ts + migration + consistency test |
| 2 | `feat: add DB-backed PR cache read/write helpers` | pulse/db.ts + unit tests |
| 3 | `refactor: replace in-memory PR cache with SQLite persistence` | pulse/index.ts rewrite, delete cache.ts |
| 4 | `feat: add usePrViewModel hook with list + detail merge logic` | usePrViewModel.ts + unit tests |
| 5 | `refactor: wire PullRequestsTab to usePrViewModel` | PullRequestsTab + PrListPanel + PrDetailPanel props update |

---

## Testing

| Layer | What | Where |
|-------|------|-------|
| L1 UT | DB helpers: upsert PRs, upsert detail, query, delete, pagination merge | `pulse/db.test.ts` |
| L1 UT | ViewModel: loading states, merge logic, auto-refresh, detail layer | `usePrViewModel.test.ts` |
| L2 Lint | Biome check passes | Pre-commit hook |
| L3 E2E | tRPC smoke: fetchPrs → getCachedPrs, fetchPrDetail → getCachedPrDetail | `e2e-smoke.test.ts` |
| L3 E2E | Migration consistency: 3 new tables match schema | `schema-migration-consistency.test.ts` |

Coverage target: maintain ≥90% for desktop, ≥95% for pulse.
