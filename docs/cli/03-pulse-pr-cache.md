# 03 — PR Cache (SQLite Persistence)

## Overview

Replace the current in-memory `Map<projectId, PrsReport>` cache with **SQLite tables** in `@signoff/local-db`. This enables instant display of previously fetched PRs on app launch, with background refresh updating the view reactively.

> **Status:** Complete. All 5 atomic commits landed.
>
> **Breaking change:** This replaces the existing `getCachedReport` query + `fetchPrs` mutation + in-memory cache with a new set of DB-backed queries and mutations. All existing tRPC procedure signatures change.
>
> **Naming note:** This document reflects the **current code** naming (e.g., `PrsReport`, `PrDetail`, `state: "open" | "closed"`). The target naming spec (aligned with GitHub GraphQL) is defined in [04-pulse-cli-spec.md](./04-pulse-cli-spec.md). Type names, field names, and DB `state` column values will be migrated in the Rename phase described there.

**Design goals:**

- **Instant first paint** — Show cached PRs immediately on tab mount, no waiting for GitHub API
- **Background refresh** — Simultaneously fetch fresh data; UI merges new results reactively
- **Offline resilience** — Previously loaded PRs remain visible even without network
- **Two-layer data model** — Lightweight list data cached eagerly; heavy detail data cached on demand
- **Single source of truth** — Query (DB) is the only source the View reads; mutations only write DB + invalidate queries

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
6. Dual-source merge in ViewModel: `scanMutation.data ?? cachedReport ?? null` creates confusing data flow

---

## Data Model Design

### Two-Layer Architecture

PR data splits naturally into two tiers with different access patterns:

| Layer | Source | When cached | Volume | Access pattern |
|-------|--------|-------------|--------|----------------|
| **List** (`PullRequestInfo`) | `pulse.fetchPrs` | On scan / load more | ~20 per page, ~800 total | Batch upsert, query by project (state filter in SQL WHERE) |
| **Detail** (`PrDetail`) | `pulse.fetchPrDetail` | On user click | 1 at a time | Single row upsert, query by project+number |

The detail layer extends the list layer — a detail fetch also updates the corresponding list row's scalar fields (e.g., updated labels, review decision). The heavy sub-data (reviews, comments, commits, files) lives in the detail row as JSON columns, since they are read-only display data that never needs SQL-level querying.

### Canonical List — Single Scan Scope

The server always fetches with `state: "all"` from GitHub — one unified scan per project, one pagination chain. The `state` UI filter (open/closed/all) is purely client-side, applied in the `getCachedPrs` query via `WHERE pull_requests.state = ?` (or no condition for "all").

**Why not per-state scans?** The `pull_requests` table uses `(project_id, number)` as UNIQUE key with the PR's actual `state` as a column. If we maintained separate scan chains for "open", "closed", and "all", they would share the same rows but have independent pagination cursors. A scan of "all" would delete-and-replace rows that the "open" cursor was pointing at, corrupting that scan chain. A single canonical scan avoids this entirely.

**Filtering** — neither `state` nor `author` is sent to GitHub at scan time:

- `fetchPrs` mutation accepts only `{ projectId, cursor? }` — no filter parameters
- `stateFilter` is applied in SQL by `getCachedPrs` (`WHERE state = ?`, or no condition for "all")
- `authorFilter` is applied in the ViewModel via `Array.filter()` in a `useMemo`
- Switching either filter is instant (no GitHub re-fetch needed)

### Data Shape Reference

Typical PR in a large org monorepo (~800 open PRs):

```
List fields:  20 scalar/array fields (title, state, author, labels[], etc.)
Detail adds:  body (0-2KB), mergeable, mergeStateStatus, mergedBy, etc.
  reviews:    2-6 items (author, state, body, submittedAt)
  comments:   3-5 items (human + bot comments from CI/review automation)
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

    // PR metadata — field names align with PullRequestInfo from @signoff/pulse
    title: text("title").notNull(),
    state: text("state").notNull(),           // "open" | "closed"
    draft: integer("draft", { mode: "boolean" }).notNull(),
    merged: integer("merged", { mode: "boolean" }).notNull(),
    mergedAt: text("merged_at"),              // ISO 8601 | null
    author: text("author").notNull(),
    createdAt: text("created_at").notNull(),  // ISO 8601 (PR creation)
    updatedAt: text("updated_at").notNull(),  // ISO 8601 (PR update)
    closedAt: text("closed_at"),              // ISO 8601 | null
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
    uniqueIndex("pull_requests_project_number_uniq").on(table.projectId, table.number),
    index("pull_requests_project_state_idx").on(table.projectId, table.state),
  ],
);
```

**UNIQUE constraint:** `(project_id, number)` — enables `ON CONFLICT(project_id, number) DO UPDATE`.

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

    // Detail-only scalar fields (not in list) — names align with PrDetail from @signoff/pulse
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
    uniqueIndex("pr_details_project_number_uniq").on(table.projectId, table.number),
  ],
);
```

**UNIQUE constraint:** `(project_id, number)` — full row replace on each detail fetch via `ON CONFLICT DO UPDATE`.

**Why JSON columns for sub-entities?**

- Reviews, comments, commits, and files are **read-only display data** — we never query "find all PRs with a failing check" or "find all reviews by bob"
- Typical payload: 2-6 reviews, 3-5 comments, 1-4 commits, 4-10 files — small enough for JSON
- No N+1 query problem — detail always loads the full blob in one SELECT
- Adding separate `pr_reviews`, `pr_comments`, `pr_commits`, `pr_files` tables would add 4 tables + 4 FK indexes + complex batch insert/delete logic for no querying benefit
- JSON columns use Drizzle's `{ mode: "json" }` which auto-serializes/deserializes

### Table 3: `pull_request_scans` — Pagination & scan metadata

Tracks scan state per project. One row per project (single canonical scan chain).

```typescript
export const pullRequestScans = sqliteTable(
  "pull_request_scans",
  {
    id: text("id").primaryKey().$defaultFn(() => uuidv4()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    // Pagination state (from latest GitHub response)
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
    uniqueIndex("pr_scans_project_uniq").on(table.projectId),
  ],
);
```

**UNIQUE constraint:** `(project_id)` — one scan record per project. No `state` column because all scans use `state: "all"` from GitHub.

### Relations

Add to `packages/local-db/src/schema/relations.ts`:

```typescript
export const pullRequestsRelations = relations(pullRequests, ({ one }) => ({
  project: one(projects, {
    fields: [pullRequests.projectId],
    references: [projects.id],
  }),
}));

export const pullRequestDetailsRelations = relations(pullRequestDetails, ({ one }) => ({
  project: one(projects, {
    fields: [pullRequestDetails.projectId],
    references: [projects.id],
  }),
}));

export const pullRequestScansRelations = relations(pullRequestScans, ({ one }) => ({
  project: one(projects, {
    fields: [pullRequestScans.projectId],
    references: [projects.id],
  }),
}));
```

Also add to `projectsRelations`:

```typescript
export const projectsRelations = relations(projects, ({ many }) => ({
  worktrees: many(worktrees),
  workspaces: many(workspaces),
  workspaceSections: many(workspaceSections),
  pullRequests: many(pullRequests),
  pullRequestDetails: many(pullRequestDetails),
  pullRequestScans: many(pullRequestScans),
}));
```

### Migration

New migration file: `0002_*.sql` via `bun run db:generate:desktop`.

---

## Data Flow

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│  View (React Components)                                  │
│  PullRequestsTab → PrListPanel + PrDetailPanel            │
│  Purely presentational: renders whatever ViewModel exposes │
│  NEVER reads mutation result directly                      │
└────────────────────┬─────────────────────────────────────┘
                     │ subscribes to
┌────────────────────▼─────────────────────────────────────┐
│  ViewModel (usePrViewModel hook)                          │
│  - Exposes: prs[], selectedPr, isLoading, isRefreshing,   │
│    scanError, hasNextPage, stateFilter, authorFilter       │
│  - Single source: tRPC queries (DB-backed)                 │
│  - Mutations only write DB + invalidate queries            │
│  - Client-side author filter via Array.filter()            │
│  - State filter via SQL WHERE in getCachedPrs query        │
└────────────────────┬─────────────────────────────────────┘
                     │ reads/writes
┌────────────────────▼─────────────────────────────────────┐
│  Model (tRPC Router + SQLite)                             │
│  Queries (read from DB):                                  │
│  - getCachedPrs(projectId, state?) → PullRequestInfo[]    │
│    state filter applied in SQL WHERE; omit for all        │
│  - getCachedPrDetail(projectId, number) → PrDetail | null │
│  - getScanMeta(projectId) → scan metadata                 │
│  Mutations (write DB + invalidate):                       │
│  - fetchPrs(projectId, cursor?) → void                    │
│    GitHub API (state:"all") → upsert pull_requests + scan │
│  - fetchPrDetail(projectId, number) → void                │
│    GitHub API → upsert pull_requests + pull_request_details│
│  - clearCache(projectId) → void                           │
│    DELETE from all 3 tables WHERE project_id              │
└──────────────────────────────────────────────────────────┘
```

**Key principle:** Mutations write DB and invalidate queries. They do NOT return data to the View. The View only reads from tRPC queries. This eliminates the current dual-source merge (`scanMutation.data ?? cachedReport`).

### Mount Sequence (PR List)

```
1. Tab mounts
2. ViewModel: query getCachedPrs(projectId, stateFilter)
   → SQLite returns cached PRs filtered by state (instant, may be stale)
   → ViewModel applies client-side authorFilter
   → View renders immediately with cached data
3. ViewModel: query getScanMeta(projectId)
   → Get endCursor, hasNextPage from last scan
4. ViewModel: auto-trigger fetchPrs(projectId)
   → GitHub API fetches state:"all" — one canonical scan
   → UI shows subtle "Refreshing..." indicator (not skeleton)
   → On success: upsert PRs into DB, invalidate getCachedPrs query
   → tRPC auto-refetches getCachedPrs → View updates reactively
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
   → Both panels update reactively from DB
```

### Scan Flow (Fresh Scan)

```
User clicks "Scan PRs":
1. ViewModel: mutate fetchPrs(projectId, cursor=null)
2. Router: call collectProjectPrs({ ..., state: "all", limit: PAGE_SIZE, cursor: null })
   → PAGE_SIZE = 20 (hardcoded in router, not exposed to UI)
   → Always fetches state:"all" — single canonical scan scope
   → Fetches exactly one page from GitHub API, not all pages
3. Router: INSERT INTO pull_requests (...) ON CONFLICT(project_id, number) DO UPDATE
   → Pure upsert — no DELETE. PRs in the response get their fields
     updated (including state, which may have changed from open→closed).
     PRs NOT in the response remain untouched with their last-known data.
4. Router: UPSERT INTO pull_request_scans SET end_cursor = response.endCursor,
   has_next_page = response.hasNextPage, scanned_at = now()
   → Resets pagination: endCursor points to page 2,
     has_next_page = true, enabling Load More to continue.
5. Router: invalidate getCachedPrs + getScanMeta queries
6. View: re-renders with fresh data from DB

No DELETE step — this is intentional:
- pull_request_details depends on pull_requests via JOIN. A DELETE
  would orphan detail rows for PRs not in the current page, making
  previously cached detail data unreachable.
- Upsert naturally updates PRs whose state has changed (e.g., a PR
  that went from open→closed will get its state column updated when
  it appears in a subsequent scan page).
- PRs that are never re-scanned (e.g., very old closed PRs) remain
  in cache with stale data. This is acceptable — they are still
  valid display data. Use clearCache() for a full reset.

Note: `pull_requests.state` stores the PR's actual state ("open" or
"closed"), never "all". The UI's stateFilter is applied at query time
via `getCachedPrs(projectId, stateFilter)`.
```

### Load More Flow

```
User clicks "Load more":
1. ViewModel: mutate fetchPrs(projectId, cursor=endCursor)
2. Router: call collectProjectPrs({ ..., state: "all", limit: PAGE_SIZE, cursor: endCursor })
3. Router: INSERT INTO pull_requests (...) ON CONFLICT DO UPDATE (append, no delete)
4. Router: UPDATE pull_request_scans SET end_cursor=?, has_next_page=?
5. Router: invalidate getCachedPrs + getScanMeta queries
6. View: list grows with new PRs appended from DB
```

---

## tRPC Router Changes

### File: `apps/desktop/src/lib/trpc/routers/pulse/index.ts`

**API breaking change** — replaces `getCachedReport` query and `fetchPrs`/`fetchPrDetail` mutation signatures:

| Procedure | Type | Input | Behavior |
|-----------|------|-------|----------|
| `getCachedPrs` | query | `{ projectId, state? }` | SELECT from `pull_requests` WHERE project_id; if state is `"open"` or `"closed"`, add `AND state = ?`; if state is `"all"` or omitted, return all. ORDER BY created_at DESC |
| `getCachedPrDetail` | query | `{ projectId, number }` | JOIN `pull_requests` + `pull_request_details`, return combined `PrDetail` or null |
| `getScanMeta` | query | `{ projectId }` | SELECT from `pull_request_scans` WHERE project_id |
| `fetchPrs` | mutation | `{ projectId, cursor? }` | GitHub API (state:"all", limit=PAGE_SIZE internally) → upsert DB → invalidate queries → void |
| `fetchPrDetail` | mutation | `{ projectId, number }` | GitHub API → upsert both tables → invalidate queries → void |
| `clearCache` | mutation | `{ projectId }` | DELETE from all 3 tables WHERE project_id |

**Removed procedures:**
- `getCachedReport` — replaced by `getCachedPrs` + `getScanMeta`

**Changed signatures:**
- `fetchPrs` — no longer accepts `state`, `author`, or `limit` at the tRPC layer. The router internally calls `collectProjectPrs({ ..., state: "all", limit: PAGE_SIZE, cursor })` with a fixed page size (20) and always `state: "all"`. This is critical: the underlying collector treats `limit <= 0` as "fetch all pages until exhausted", which would defeat the Load More pagination design. The state filter is purely client-side (applied in `getCachedPrs` query). The underlying `collectProjectPrs()` bridge and `@signoff/pulse` `fetchPrs()` retain the `state`, `limit`, and `author` parameters for CLI and future use.
- `fetchPrs` — no longer returns `PrsReport` (writes DB, returns void)
- `fetchPrDetail` — no longer returns `PrDetailReport` (writes DB, returns void)

### File: `apps/desktop/src/lib/trpc/routers/pulse/cache.ts`

**Delete this file.** Replace with DB-backed operations in the router.

---

## ViewModel Hook

### File: `apps/desktop/src/renderer/hooks/usePrViewModel.ts` (new)

```typescript
export function usePrViewModel(projectId: string) {
  const utils = trpc.useUtils();
  const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">("open");
  const [authorFilter, setAuthorFilter] = useState("");
  const [selectedPrNumber, setSelectedPrNumber] = useState<number | null>(null);

  // ── List Layer (queries are the single source of truth) ──

  // Cached list from DB (instant on mount), filtered by state in SQL
  const cachedPrsQuery = trpc.pulse.getCachedPrs.useQuery(
    { projectId, state: stateFilter },
  );

  // Scan metadata — one record per project (no state dimension)
  const scanMetaQuery = trpc.pulse.getScanMeta.useQuery(
    { projectId },
  );

  // List fetch mutation — always fetches state:"all" from GitHub,
  // writes DB, invalidates queries, returns nothing.
  // State filter is applied at query time, not fetch time.
  const scanMutation = trpc.pulse.fetchPrs.useMutation({
    onSuccess: () => {
      // Invalidate all getCachedPrs queries (all projects, all state variants).
      // Broad invalidation is cheap — just marks queries stale for next access.
      utils.pulse.getCachedPrs.invalidate();
      utils.pulse.getScanMeta.invalidate({ projectId });
    },
  });

  // Auto-refresh on mount (not on stateFilter change — filter is client-side)
  useEffect(() => {
    scanMutation.mutate({ projectId });
  }, [projectId]);

  // Client-side author filter — instant, no re-fetch
  const filteredPrs = useMemo(() => {
    const prs = cachedPrsQuery.data ?? [];
    if (!authorFilter) return prs;
    const needle = authorFilter.toLowerCase();
    return prs.filter((pr) => pr.author.toLowerCase().includes(needle));
  }, [cachedPrsQuery.data, authorFilter]);

  // ── Detail Layer ──

  // Cached detail from DB
  const cachedDetailQuery = trpc.pulse.getCachedPrDetail.useQuery(
    { projectId, number: selectedPrNumber! },
    { enabled: selectedPrNumber !== null },
  );

  // Detail fetch mutation — writes DB, invalidates queries
  const detailMutation = trpc.pulse.fetchPrDetail.useMutation({
    onSuccess: (_data, variables) => {
      utils.pulse.getCachedPrDetail.invalidate({ projectId, number: variables.number });
      // Invalidate all getCachedPrs queries (all projects, all states).
      // The detail fetch refreshes list-level fields, and broad invalidation
      // is cheap (just marks queries stale for next access).
      utils.pulse.getCachedPrs.invalidate();
    },
  });

  // Auto-fetch detail on selection
  useEffect(() => {
    if (selectedPrNumber !== null) {
      detailMutation.mutate({ projectId, number: selectedPrNumber });
    }
  }, [projectId, selectedPrNumber]);

  // Derive loading states from unfiltered cache to avoid authorFilter affecting them
  const hasCachedData = (cachedPrsQuery.data?.length ?? 0) > 0;

  return {
    // List
    prs: filteredPrs,
    // First load: query has settled (empty or not) but DB has no data yet and mutation is running
    isLoading: cachedPrsQuery.isLoading || (!hasCachedData && scanMutation.isPending),
    isRefreshing: hasCachedData && scanMutation.isPending,
    scanError: scanMutation.error?.message ?? null,
    hasNextPage: scanMetaQuery.data?.hasNextPage ?? false,
    stateFilter,
    setStateFilter,      // Instant — just changes the SQL WHERE, no re-fetch
    authorFilter,
    setAuthorFilter,     // Instant — client-side Array.filter()
    scan: () => scanMutation.mutate({ projectId, cursor: null }),
    loadMore: () => scanMutation.mutate({
      projectId,
      cursor: scanMetaQuery.data?.endCursor ?? null,
    }),

    // Detail
    selectedPrNumber,
    selectPr: setSelectedPrNumber,
    selectedPrDetail: cachedDetailQuery.data ?? null,
    // First load: query settled with null + mutation running = still loading
    isDetailLoading: selectedPrNumber !== null
      && (cachedDetailQuery.isLoading || (!cachedDetailQuery.data && detailMutation.isPending)),
    isDetailRefreshing: !!cachedDetailQuery.data && detailMutation.isPending,
    detailError: detailMutation.error?.message ?? null,
  };
}
```

### Key Loading States

| State | Condition | UI Treatment |
|-------|-----------|--------------|
| `isLoading` | Query still loading, OR DB has no cached data (unfiltered) + mutation in flight | Skeleton placeholders in list panel |
| `isRefreshing` | DB has cached data (unfiltered) + mutation in flight | Subtle spinner on scan button |
| `isDetailLoading` | PR selected + (query loading OR query returned null + mutation in flight) | Skeleton in detail panel |
| `isDetailRefreshing` | Cached detail shown + mutation in flight (background re-fetch) | Subtle spinner on detail panel |

---

## Component Contract: PrDetailPanel

### Current Props

```typescript
interface PrDetailPanelProps {
  pr: PullRequestInfo | null;
}
```

### New Props

```typescript
interface PrDetailPanelProps {
  /** Full PR detail (list fields + detail fields). null = no selection. */
  detail: PrDetail | null;
  /** True when loading detail for a PR with no cache. */
  isLoading: boolean;
  /** True when refreshing an already-cached detail. */
  isRefreshing: boolean;
  /** Error message from detail fetch, if any. */
  error: string | null;
}
```

### New Sections (when `detail` is `PrDetail`)

The detail panel gains these additional sections beyond the existing list-level display:

| Section | Source fields | UI |
|---------|-------------|-----|
| **Description** | `detail.body` | Rendered markdown (or `<pre>` for v1) |
| **Merge Status** | `detail.mergeable`, `detail.mergeStateStatus` | Status badge: CLEAN ✓ / CONFLICTING ✗ / BLOCKED ⚠ |
| **Participants** | `detail.participants`, `detail.requestedReviewers`, `detail.assignees` | Avatar-style login lists grouped by role |
| **Reviews** | `detail.reviews[]` | List: author + state badge + body excerpt + submittedAt |
| **Comments** | `detail.comments[]` | List: author + body excerpt + createdAt |
| **Commits** | `detail.commits[]` | List: abbreviated OID + message + author + statusCheckRollup icon |
| **Files** | `detail.files[]` | List: path + changeType badge + additions/deletions stat |

**Loading behavior:** When `detail` is null and `isLoading` is true, show skeleton for the entire panel. When `detail` is non-null and `isRefreshing` is true, show current data with a subtle spinner. The `getCachedPrDetail` query JOINs `pull_requests` + `pull_request_details` and returns a complete `PrDetail` or null — there is no intermediate "list-only" shape reaching this component.

---

## Files to Change

| File | Action | Description |
|------|--------|-------------|
| `packages/local-db/src/schema/schema.ts` | Modify | Add `pullRequests` + `pullRequestDetails` + `pullRequestScans` tables with UNIQUE indexes |
| `packages/local-db/src/schema/relations.ts` | Modify | Add relations for 3 new tables + update `projectsRelations` |
| `packages/local-db/drizzle/0002_*.sql` | New | Migration for 3 new tables |
| `packages/local-db/src/schema/schema-migration-consistency.test.ts` | Modify | Add assertions for 3 new tables |
| `apps/desktop/src/lib/trpc/routers/pulse/index.ts` | Rewrite | Replace in-memory cache with DB operations; new procedure signatures |
| `apps/desktop/src/lib/trpc/routers/pulse/cache.ts` | Delete | No longer needed |
| `apps/desktop/src/lib/trpc/routers/pulse/db.ts` | New | DB read/write helpers for PR cache (upsert, query, delete) |
| `apps/desktop/src/renderer/hooks/usePrViewModel.ts` | New | ViewModel hook: queries as source, client-side author filter |
| `apps/desktop/src/renderer/components/GitInfoDashboard/tabs/PullRequestsTab.tsx` | Rewrite | Delegate to `usePrViewModel`, remove inline state + dual-source merge |
| `apps/desktop/src/renderer/components/GitInfoDashboard/tabs/pr/PrListPanel.tsx` | Modify | Accept `isRefreshing` prop for subtle indicator |
| `apps/desktop/src/renderer/components/GitInfoDashboard/tabs/pr/PrDetailPanel.tsx` | Rewrite | Accept `PrDetail`, add review/comment/commit/file sections |

---

## Atomic Commits

| # | Commit | Scope |
|---|--------|-------|
| 1 | `feat: add pull_requests, pull_request_details, and pull_request_scans tables` | schema.ts + relations.ts + migration + consistency test |
| 2 | `feat: add DB-backed PR cache read/write helpers` | pulse/db.ts + unit tests |
| 3 | `refactor: replace in-memory PR cache with SQLite persistence` | pulse/index.ts rewrite, delete cache.ts (API breaking) |
| 4 | `feat: add usePrViewModel hook with list + detail merge logic` | usePrViewModel.ts + unit tests |
| 5 | `refactor: wire PullRequestsTab to usePrViewModel` | PullRequestsTab + PrListPanel + PrDetailPanel props update |

---

## Testing

| Layer | What | Where |
|-------|------|-------|
| L1 UT | DB helpers: upsert PRs, upsert detail, query with state filter, query without state filter (all), delete by project, pagination cursor update | `pulse/db.test.ts` |
| L1 UT | DB helpers: ON CONFLICT upsert — duplicate (project_id, number) updates rather than inserts | `pulse/db.test.ts` |
| L1 UT | DB helpers: fresh scan upsert preserves rows not in current page (no orphaned details) | `pulse/db.test.ts` |
| L1 UT | DB helpers: clearCache deletes from all 3 tables for a project | `pulse/db.test.ts` |
| L1 UT | ViewModel: loading states, query-as-source (no mutation result in view), auto-refresh on mount | `usePrViewModel.test.ts` |
| L1 UT | ViewModel: client-side author filter — empty filter returns all, partial match filters, case insensitive | `usePrViewModel.test.ts` |
| L1 UT | ViewModel: state filter change is instant (no new mutation), only changes query key | `usePrViewModel.test.ts` |
| L1 UT | ViewModel: detail select → query + mutation, cache hit shows instant | `usePrViewModel.test.ts` |
| L2 Lint | Biome check passes | Pre-commit hook |
| L3 E2E | tRPC smoke: fetchPrs → getCachedPrs, fetchPrDetail → getCachedPrDetail | `e2e-smoke.test.ts` |
| L3 E2E | Migration consistency: 3 new tables match schema | `schema-migration-consistency.test.ts` |

Coverage target: maintain ≥90% for desktop, ≥95% for pulse.
