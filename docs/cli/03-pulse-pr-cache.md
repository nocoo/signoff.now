# 03 — PR Cache (SQLite Persistence)

## Overview

Replace the current in-memory `Map<projectId, PrsReport>` cache with a **SQLite table** in `@signoff/local-db`. This enables instant display of previously fetched PRs on app launch, with background refresh updating the view reactively.

> **Status:** Not started.

**Design goals:**

- **Instant first paint** — Show cached PRs immediately on tab mount, no waiting for GitHub API
- **Background refresh** — Simultaneously fetch fresh data; UI merges new results reactively
- **Offline resilience** — Previously loaded PRs remain visible even without network
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

---

## Database Schema

### New Table: `pull_requests`

Add to `packages/local-db/src/schema/schema.ts`:

```typescript
export const pullRequests = sqliteTable(
  "pull_requests",
  {
    // Composite natural key: project + PR number
    id: text("id").primaryKey().$defaultFn(() => uuidv4()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),

    // PR metadata (mirrors PullRequestInfo)
    title: text("title").notNull(),
    state: text("state").notNull(),           // "open" | "closed"
    draft: integer("draft", { mode: "boolean" }).notNull(),
    merged: integer("merged", { mode: "boolean" }).notNull(),
    mergedAt: text("merged_at"),              // ISO 8601 | null
    author: text("author").notNull(),
    createdAt: text("created_at_iso").notNull(), // ISO 8601 (PR creation)
    updatedAt: text("updated_at_iso").notNull(), // ISO 8601 (PR update)
    closedAt: text("closed_at_iso"),           // ISO 8601 | null
    headBranch: text("head_branch").notNull(),
    baseBranch: text("base_branch").notNull(),
    url: text("url").notNull(),
    labels: text("labels", { mode: "json" }).$type<string[]>().notNull(),
    reviewDecision: text("review_decision"),   // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
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

### New Table: `pull_request_scans`

Track scan metadata per project (pagination cursor, filter state):

```typescript
export const pullRequestScans = sqliteTable(
  "pull_request_scans",
  {
    id: text("id").primaryKey().$defaultFn(() => uuidv4()),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    // Scan parameters
    state: text("state").notNull(),          // "open" | "closed" | "all"
    author: text("author"),                  // null = no filter

    // Pagination state
    endCursor: text("end_cursor"),           // GitHub GraphQL cursor
    hasNextPage: integer("has_next_page", { mode: "boolean" }).notNull(),

    // Identity info
    resolvedUser: text("resolved_user"),
    resolvedVia: text("resolved_via"),       // "direct" | "org" | "fallback"

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

### Migration

New migration file: `0002_*.sql` via `bun run db:generate:desktop`.

---

## Data Flow (MVVM)

### Architecture

```
┌────────────────────────────────────────────────────────────┐
│  View (React Components)                                   │
│  PullRequestsTab → PrListPanel + PrDetailPanel             │
│  Purely presentational: renders whatever ViewModel exposes  │
└────────────────────┬───────────────────────────────────────┘
                     │ subscribes to
┌────────────────────▼───────────────────────────────────────┐
│  ViewModel (usePrViewModel hook)                           │
│  - Exposes: prs[], isLoading, isRefreshing, scanError,     │
│    hasNextPage, stateFilter, scan(), loadMore()            │
│  - On mount: load from DB (instant) + trigger background   │
│    refresh                                                 │
│  - On scan result: merge into DB, re-query DB, update view │
│  - On load more: append page to DB, re-query DB            │
└────────────────────┬───────────────────────────────────────┘
                     │ reads/writes
┌────────────────────▼───────────────────────────────────────┐
│  Model (tRPC Router + SQLite)                              │
│  Procedures:                                               │
│  - getCachedPrs(projectId, state) → PullRequestInfo[]      │
│    Reads from pull_requests table                          │
│  - getScanMeta(projectId, state) → scan metadata           │
│    Reads from pull_request_scans table                     │
│  - fetchPrs(projectId, state, cursor?) → PrsReport         │
│    Calls GitHub API → upserts pull_requests + scan meta    │
│  - clearCache(projectId) → void                            │
│    Deletes all cached PRs for a project                    │
└────────────────────────────────────────────────────────────┘
```

### Mount Sequence

```
1. Tab mounts
2. ViewModel: query getCachedPrs(projectId, "open")
   → SQLite returns cached PRs (instant, may be stale)
   → View renders immediately
3. ViewModel: query getScanMeta(projectId, "open")
   → Get endCursor, hasNextPage from last scan
4. ViewModel: auto-trigger fetchPrs(projectId, "open")
   → UI shows subtle "Refreshing..." indicator (not skeleton)
   → On success: upsert PRs into DB, invalidate getCachedPrs query
   → View updates reactively with fresh data
```

### Scan Flow

```
User clicks "Scan PRs":
1. ViewModel: mutate fetchPrs(projectId, state, cursor=null)
2. Router: DELETE FROM pull_requests WHERE project_id = ? AND state matches
3. Router: call collectProjectPrs() → GitHub API
4. Router: INSERT INTO pull_requests (...) VALUES (...)
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
3. Router: INSERT INTO pull_requests (new page, no delete)
4. Router: UPDATE pull_request_scans SET end_cursor=?, has_next_page=?
5. Router: return merged PrsReport
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
| `getScanMeta` | query | `{ projectId, state }` | SELECT from `pull_request_scans` WHERE project_id + state |
| `fetchPrs` | mutation | `{ projectId, state, cursor?, author? }` | Call GitHub API → upsert DB → return report |
| `clearCache` | mutation | `{ projectId }` | DELETE from both tables WHERE project_id |

### File: `apps/desktop/src/lib/trpc/routers/pulse/cache.ts`

**Delete this file.** Replace with DB-backed operations in the router.

---

## ViewModel Hook

### File: `apps/desktop/src/renderer/hooks/usePrViewModel.ts` (new)

```typescript
export function usePrViewModel(projectId: string) {
  const [stateFilter, setStateFilter] = useState<"open" | "closed" | "all">("open");
  const [authorFilter, setAuthorFilter] = useState("");

  // Layer 1: Cached data from DB (instant)
  const { data: cachedPrs } = trpc.pulse.getCachedPrs.useQuery(
    { projectId, state: stateFilter },
  );

  // Layer 2: Scan metadata (pagination state)
  const { data: scanMeta } = trpc.pulse.getScanMeta.useQuery(
    { projectId, state: stateFilter },
  );

  // Layer 3: Active mutation
  const scanMutation = trpc.pulse.fetchPrs.useMutation({
    onSuccess: () => {
      utils.pulse.getCachedPrs.invalidate({ projectId });
      utils.pulse.getScanMeta.invalidate({ projectId });
    },
  });

  // Auto-refresh on mount (if cache exists but may be stale)
  useEffect(() => {
    if (cachedPrs !== undefined) {
      scanMutation.mutate({ projectId, state: stateFilter });
    }
  }, [projectId, stateFilter]);

  return {
    prs: clientSideAuthorFilter(cachedPrs ?? [], authorFilter),
    isLoading: !cachedPrs && scanMutation.isPending,
    isRefreshing: cachedPrs && scanMutation.isPending,
    scanError: scanMutation.error?.message ?? null,
    hasNextPage: scanMeta?.hasNextPage ?? false,
    stateFilter,
    setStateFilter,
    authorFilter,
    setAuthorFilter,
    scan: () => scanMutation.mutate({ projectId, state: stateFilter, cursor: null }),
    loadMore: () => scanMutation.mutate({
      projectId,
      state: stateFilter,
      cursor: scanMeta?.endCursor ?? null,
    }),
  };
}
```

### Key Distinction: `isLoading` vs `isRefreshing`

| State | Meaning | UI Treatment |
|-------|---------|--------------|
| `isLoading` | No cached data, first fetch in progress | Show skeleton placeholders |
| `isRefreshing` | Cached data shown, background refresh in progress | Show subtle spinner on scan button |

---

## Files to Change

| File | Action | Description |
|------|--------|-------------|
| `packages/local-db/src/schema/schema.ts` | Modify | Add `pullRequests` + `pullRequestScans` tables |
| `packages/local-db/drizzle/0002_*.sql` | New | Migration for new tables |
| `packages/local-db/src/schema/schema-migration-consistency.test.ts` | Modify | Add assertions for new tables |
| `apps/desktop/src/lib/trpc/routers/pulse/index.ts` | Rewrite | Replace in-memory cache with DB operations |
| `apps/desktop/src/lib/trpc/routers/pulse/cache.ts` | Delete | No longer needed |
| `apps/desktop/src/lib/trpc/routers/pulse/db.ts` | New | DB read/write helpers for PR cache |
| `apps/desktop/src/renderer/hooks/usePrViewModel.ts` | New | ViewModel hook with merge logic |
| `apps/desktop/src/renderer/components/GitInfoDashboard/tabs/PullRequestsTab.tsx` | Modify | Use `usePrViewModel` instead of inline state |
| `apps/desktop/src/renderer/components/GitInfoDashboard/tabs/pr/PrListPanel.tsx` | Modify | Accept `isRefreshing` prop for subtle indicator |

---

## Atomic Commits

| # | Commit | Scope |
|---|--------|-------|
| 1 | `feat: add pull_requests and pull_request_scans tables` | schema.ts + migration + consistency test |
| 2 | `feat: add DB-backed PR cache read/write helpers` | pulse/db.ts + unit tests |
| 3 | `refactor: replace in-memory PR cache with SQLite persistence` | pulse/index.ts rewrite, delete cache.ts |
| 4 | `feat: add usePrViewModel hook with MVVM merge logic` | usePrViewModel.ts + unit tests |
| 5 | `refactor: wire PullRequestsTab to usePrViewModel` | PullRequestsTab + PrListPanel props update |

---

## Testing

| Layer | What | Where |
|-------|------|-------|
| L1 UT | DB helpers: upsert, query, delete, pagination merge | `pulse/db.test.ts` |
| L1 UT | ViewModel: loading states, merge logic, auto-refresh | `usePrViewModel.test.ts` |
| L2 Lint | Biome check passes | Pre-commit hook |
| L3 E2E | tRPC smoke test: fetchPrs → getCachedPrs round-trip | `e2e-smoke.test.ts` |
| L3 E2E | Migration consistency: new tables match schema | `schema-migration-consistency.test.ts` |

Coverage target: maintain ≥90% for desktop, ≥95% for pulse.
