# 03 — GitInfo Dashboard

## Overview

Integrate `@signoff/gitinfo` CLI into the desktop app, enabling per-project Git repository insight with a rich visual dashboard. Data is fetched by spawning `gitinfo --full --cwd <projectPath>` from the main process, cached in-memory, and rendered in the main content area as the default "home" view when a project is selected.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data source | Spawn CLI as child process | `@signoff/gitinfo` is already a standalone Bun CLI; avoids duplicating collector logic into the main process |
| Invocation | `Bun.spawn` in main process | Electron main has full Node/Bun API access; renderer cannot spawn processes |
| Data tier | Always `--full` | Desktop has time to compute; slow fields (commit frequency, file churn, author LOC) are the most valuable for visualization |
| Cache layer | Main-process in-memory `Map<projectId, { data, timestamp }>` | Simple, fast, survives renderer reloads; cleared on app quit |
| Cache TTL | None (manual refresh only) | GitInfo data is a snapshot; users refresh explicitly via sidebar button |
| Transport | New `gitinfo` tRPC router | Consistent with existing architecture (12 routers via `trpc-electron`) |
| Render location | Default workspace page when no workspace pane is active | Replaces the empty "No open panes" placeholder |

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Renderer (React)                                                │
│                                                                  │
│  WorkspaceSidebar          Main Content Area                     │
│  ┌──────────────┐          ┌──────────────────────────────────┐  │
│  │ [🔄 Refresh] │          │  GitInfoDashboard                │  │
│  │              │   tRPC   │  ┌──────────┐ ┌──────────────┐  │  │
│  │ Project A ►  │ ◄──────► │  │ Overview  │ │ Contributors │  │  │
│  │   ws-1       │          │  │  Card     │ │  Card        │  │  │
│  │   ws-2       │          │  ├──────────┤ ├──────────────┤  │  │
│  │              │          │  │ Branches  │ │ Files Card   │  │  │
│  │ Project B    │          │  │  Card     │ │              │  │  │
│  │              │          │  ├──────────┤ ├──────────────┤  │  │
│  └──────────────┘          │  │ Activity  │ │ Tags Card    │  │  │
│                            │  │  Card     │ │              │  │  │
│                            │  └──────────┘ └──────────────┘  │  │
│                            └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
         │                              ▲
         │  IPC (trpc-electron)         │
         ▼                              │
┌─────────────────────────────────────────────────────────────────┐
│  Main Process                                                    │
│                                                                  │
│  gitinfo tRPC router                                             │
│  ┌──────────────────────────────────────────────┐                │
│  │  getReport({ projectId })                     │                │
│  │    1. Lookup cache[projectId]                 │                │
│  │    2. If miss → spawn `gitinfo --full --cwd`  │                │
│  │    3. Parse JSON stdout                       │                │
│  │    4. Store in cache                          │                │
│  │    5. Return GitInfoReport                    │                │
│  │                                               │                │
│  │  refresh({ projectId })                       │                │
│  │    1. Invalidate cache[projectId]             │                │
│  │    2. Same as getReport flow                  │                │
│  └──────────────────────────────────────────────┘                │
│                      │                                           │
│                      ▼                                           │
│              Bun.spawn("gitinfo", ["--full", "--cwd", path])     │
│                      │                                           │
│                      ▼                                           │
│              @signoff/gitinfo CLI (child process)                │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. tRPC Router — `gitinfo`

### File: `apps/desktop/src/lib/trpc/routers/gitinfo/index.ts`

New router #13. Follows the existing dual-layer pattern (pure logic + tRPC wrapper).

```ts
// Dependencies injected via AppRouterDeps
interface GitInfoRouterDeps {
  getDb: () => Database;  // to resolve project.mainRepoPath
}
```

### Procedures

| Procedure | Input | Output | Description |
|-----------|-------|--------|-------------|
| `getReport` | `{ projectId: string }` | `GitInfoReport` | Returns cached report or fetches fresh |
| `refresh` | `{ projectId: string }` | `GitInfoReport` | Invalidates cache, fetches fresh report |

### Cache Implementation

```ts
// Module-level cache — lives for the app's lifetime
const cache = new Map<string, { report: GitInfoReport; fetchedAt: number }>();

async function fetchReport(projectPath: string): Promise<GitInfoReport> {
  // Spawn: bunx gitinfo --full --cwd <path>
  // Parse stdout as JSON
  // Validate with Zod schema (optional, fail-safe)
}
```

**Why not `Bun.spawn("gitinfo", ...)`?** The `gitinfo` binary is a workspace package resolved via `bun run`, not a globally installed binary. Use `Bun.spawn("bun", ["run", "--cwd", monorepoRoot, "gitinfo", "--full", "--cwd", projectPath])` or resolve the bin path via the package's `bin` field. Alternative: directly import and call the collector pipeline from `@signoff/gitinfo` as a library — but the CLI approach is simpler and isolates crashes.

**Chosen approach**: Import and call directly as a library function. The `@signoff/gitinfo` package exports types from `commands/types.ts`. We'll add a programmatic entry point:

### File: `apps/gitinfo/src/commands/index.ts` (new export)

```ts
export { runCollectors } from "./collector";
export { ALL_COLLECTORS } from "../main"; // re-export collector array
export type { GitInfoReport, CollectorContext } from "./types";
```

Then the tRPC router calls the collectors directly in-process, no child process spawn needed. This avoids PATH resolution issues with Bun workspace binaries in packaged Electron.

**Revised approach**: Since `gitinfo` uses `Bun.spawn` internally (for git commands), and the Electron main process runs on Node (not Bun), we **must** spawn it as a child process. The main process will:

1. Resolve the `gitinfo` bin path from `@signoff/gitinfo` package
2. Use `node:child_process.execFile("bun", ["run", "gitinfo", ...])` since gitinfo requires Bun runtime
3. Parse JSON stdout

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function fetchReport(projectPath: string): Promise<GitInfoReport> {
  const { stdout } = await execFileAsync("bun", [
    "run", "--cwd", MONOREPO_ROOT,
    "gitinfo", "--full", "--cwd", projectPath,
  ], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
}
```

### Router Registration

```ts
// apps/desktop/src/lib/trpc/routers/index.ts
import { createGitInfoTrpcRouter } from "./gitinfo";

// In createAppRouter:
gitinfo: createGitInfoTrpcRouter(deps.getDb),
```

---

## 3. Sidebar Refresh Button

### File: `apps/desktop/src/renderer/components/Sidebar/WorkspaceSidebar.tsx`

Add a refresh icon button in the sidebar header area, next to the collapse toggle.

```tsx
// In the sidebar header (non-collapsed state)
<Button variant="ghost" size="icon-sm" onClick={handleRefresh}>
  <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
</Button>
```

**Behavior:**
- Calls `trpc.gitinfo.refresh.useMutation()` with the active project's ID
- Invalidates `trpc.gitinfo.getReport` query cache via `utils.gitinfo.getReport.invalidate()`
- Shows spinning animation during fetch
- Only visible when a project is selected

---

## 4. Dashboard Page — GitInfoDashboard

### Routing Strategy

The dashboard renders as the **default content** when a project is selected but no workspace tab is active (or in addition to the mosaic layout). It replaces the current "No open panes" empty state.

### File: `apps/desktop/src/renderer/components/GitInfoDashboard/index.tsx`

```tsx
export function GitInfoDashboard({ projectId }: { projectId: string }) {
  const { data: report, isLoading, error } = trpc.gitinfo.getReport.useQuery(
    { projectId },
    { enabled: !!projectId, staleTime: Infinity }  // never auto-refetch
  );

  if (isLoading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} />;
  if (!report) return null;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl grid grid-cols-2 gap-4">
        <OverviewCard meta={report.meta} logs={report.logs} config={report.config} />
        <BranchesCard branches={report.branches} />
        <ActivityCard logs={report.logs} />
        <ContributorsCard contributors={report.contributors} />
        <FilesCard files={report.files} />
        <TagsCard tags={report.tags} />
        <StatusCard status={report.status} />
        <ConfigCard config={report.config} />
      </div>
    </div>
  );
}
```

### `staleTime: Infinity`

Data is treated as a static snapshot. Only the explicit refresh button triggers re-fetch. This means:
- Navigating away and back shows cached data instantly
- No background polling
- React Query won't refetch on window focus

---

## 5. Dashboard Cards — Detailed Design

All cards share a common shell:

```tsx
function DashboardCard({ title, icon, children, className }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4", className)}>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}
```

### 5.1 OverviewCard

**Data source**: `meta` + `logs` + `config`

| Field | Source | Display |
|-------|--------|---------|
| Repository name | `meta.repoName` | Large title |
| Current branch | `meta.currentBranch` | Badge with git-branch icon |
| Default branch | `meta.defaultBranch` | Secondary text |
| HEAD commit | `meta.headShort` | Monospace badge, clickable (copy) |
| Remote | `meta.remotes[0].fetchUrl` | Truncated URL, clickable (open external) |
| Total commits | `logs.totalCommits` | Stat number |
| Total merges | `logs.totalMerges` | Stat number |
| First commit | `logs.firstCommitDate` | Relative date ("2 years ago") |
| Last commit | `logs.lastCommit.date` | Relative date + author |
| Repo state | `status.repoState` | Badge (green=clean, yellow=merge/rebase, red=conflict) |
| Shallow | `meta.isShallow` | Warning badge if true |
| Git dir size | `config.gitDirSizeKiB` | Formatted ("142 MB") |

### 5.2 BranchesCard

**Data source**: `branches`

| Element | Source | Display |
|---------|--------|---------|
| Local count | `branches.totalLocal` | Stat number |
| Remote count | `branches.totalRemote` | Stat number |
| Branch list | `branches.local` | Scrollable list, max 20 shown |
| Per branch: name | `local[].name` | Text, bold if current |
| Per branch: upstream | `local[].upstream` | Secondary text |
| Per branch: ahead/behind | `local[].aheadBehind` | `↑N ↓M` badges |
| Per branch: last commit | `local[].lastCommitDate` | Relative date |
| Per branch: merged | `local[].isMerged` | Checkmark icon if merged |

### 5.3 ActivityCard (slow-tier)

**Data source**: `logs.commitFrequency` + `logs.conventionalTypes`

| Element | Source | Display |
|---------|--------|---------|
| Commits by day of week | `commitFrequency.byDayOfWeek` | Bar chart (7 bars, Mon–Sun) |
| Commits by hour | `commitFrequency.byHour` | Heatmap or bar chart (24 slots) |
| Commits by month | `commitFrequency.byMonth` | Timeline area chart (last 12 months) |
| Conventional types | `conventionalTypes` | Horizontal bar chart or pie (feat, fix, chore, etc.) |

**Charting approach**: Use simple CSS/SVG bars — no chart library dependency. Each bar is a `<div>` with dynamic `height` or `width` based on percentage of max value. Tooltips via Radix `<Tooltip>`.

### 5.4 ContributorsCard

**Data source**: `contributors`

| Element | Source | Display |
|---------|--------|---------|
| Total authors | `contributors.totalAuthors` | Stat number |
| Active (90d) | `contributors.activeRecent` | Stat number |
| Author list | `contributors.authors` | Top 10, sorted by commits |
| Per author: name | `authors[].name` | Text |
| Per author: commits | `authors[].commits` | Number + relative bar |
| Per author: LOC (slow) | `authorStats[].linesAdded/Deleted` | `+N / -M` with color |

### 5.5 FilesCard

**Data source**: `files`

| Element | Source | Display |
|---------|--------|---------|
| Tracked files | `files.trackedCount` | Stat number |
| Total lines | `files.totalLines` | Stat number, formatted ("142K") |
| Type distribution | `files.typeDistribution` | Horizontal stacked bar or top 10 list |
| Largest files | `files.largestTracked` | Top 10 list (path + formatted size) |
| Most changed (slow) | `files.mostChanged` | Top 10 bar chart |
| Largest blobs (slow) | `files.largestBlobs` | Top 10 list |
| Binary files (slow) | `files.binaryFiles` | Count badge, expandable list |

### 5.6 TagsCard

**Data source**: `tags`

| Element | Source | Display |
|---------|--------|---------|
| Total tags | `tags.count` | Stat number |
| Latest tag | `tags.latestReachableTag` | Badge |
| Commits since tag | `tags.commitsSinceTag` | Number |
| Tag list | `tags.tags` | Scrollable, max 20 |
| Per tag: name | `tags[].name` | Text |
| Per tag: type | `tags[].type` | "annotated" / "lightweight" badge |
| Per tag: date | `tags[].date` | Relative date |
| Per tag: message | `tags[].message` | Truncated text |

### 5.7 StatusCard

**Data source**: `status`

| Element | Source | Display |
|---------|--------|---------|
| Repo state | `status.repoState` | Status badge |
| Staged files | `status.staged` | Count + expandable list |
| Modified files | `status.modified` | Count + expandable list |
| Untracked files | `status.untracked` | Count + expandable list |
| Conflicted files | `status.conflicted` | Count + expandable list (red) |
| Stash count | `status.stashCount` | Number |

### 5.8 ConfigCard

**Data source**: `config`

| Element | Source | Display |
|---------|--------|---------|
| Git dir size | `config.gitDirSizeKiB` | Formatted |
| Loose objects | `config.objectStats.count` | Number |
| Packed objects | `config.objectStats.inPack` | Number |
| Pack files | `config.objectStats.packs` | Number |
| Pack size | `config.objectStats.sizePackKiB` | Formatted |
| Garbage | `config.objectStats.garbage` | Number (warn if >0) |
| Worktrees | `config.worktreeCount` | Number |
| Hooks | `config.hooks` | Pill list |
| Key config | `config.localConfig` | Key-value table (filtered to interesting keys) |

---

## 6. File Structure

```
apps/desktop/src/
├── lib/trpc/routers/
│   ├── gitinfo/
│   │   ├── index.ts              # tRPC router (getReport, refresh)
│   │   └── cache.ts              # In-memory cache Map
│   └── index.ts                  # + gitinfo router registration
├── renderer/components/
│   ├── GitInfoDashboard/
│   │   ├── index.tsx             # Main dashboard layout + data fetching
│   │   ├── DashboardCard.tsx     # Shared card shell
│   │   ├── OverviewCard.tsx      # Repo overview
│   │   ├── BranchesCard.tsx      # Branch list + ahead/behind
│   │   ├── ActivityCard.tsx      # Commit frequency charts
│   │   ├── ContributorsCard.tsx  # Author list + LOC stats
│   │   ├── FilesCard.tsx         # File stats + type distribution
│   │   ├── TagsCard.tsx          # Tag list
│   │   ├── StatusCard.tsx        # Working tree status
│   │   ├── ConfigCard.tsx        # Git config + object stats
│   │   ├── StatNumber.tsx        # Reusable stat display component
│   │   ├── BarChart.tsx          # Simple CSS bar chart
│   │   └── DashboardSkeleton.tsx # Loading skeleton
│   └── Sidebar/
│       └── WorkspaceSidebar.tsx  # + refresh button
└── renderer/routes/
    └── _dashboard/
        └── page.tsx              # + GitInfoDashboard integration
```

---

## 7. Integration Points

### 7.1 page.tsx — Dashboard entry

```tsx
// apps/desktop/src/renderer/routes/_dashboard/page.tsx
function DashboardPage() {
  const activeWorkspace = useActiveWorkspaceStore((s) => s.activeWorkspace);
  const activeProjectId = useActiveWorkspaceStore((s) => s.activeProjectId);

  // If a workspace is active, show MosaicLayout (existing behavior)
  if (activeWorkspace) {
    return <WorkspaceLayout />;
  }

  // If a project is selected but no workspace, show GitInfo dashboard
  if (activeProjectId) {
    return <GitInfoDashboard projectId={activeProjectId} />;
  }

  // No project selected — show welcome/empty state
  return <EmptyState />;
}
```

### 7.2 Active Project Tracking

Need to track which project is currently selected (expanded) in the sidebar. Options:

**Option A**: Derive from `expandedProjectId` in WorkspaceSidebar state — the project whose tree is expanded is the "active" one.

**Option B**: Add `activeProjectId` to `useActiveWorkspaceStore` — set when user clicks a project in sidebar.

**Chosen**: Option B — explicit `activeProjectId` in the existing store. Set on project click, cleared when a workspace is activated (workspace already carries projectId implicitly).

### 7.3 WorkspaceSidebar — Project click behavior

Currently clicking a project toggles expand/collapse. New behavior:

1. Click project → expand tree AND set `activeProjectId`
2. Click workspace → activate workspace (existing) AND clear `activeProjectId` (dashboard hides)
3. Click expanded project → collapse tree, but keep `activeProjectId` (dashboard stays)

### 7.4 Router deps

```ts
// AppRouterDeps addition
interface AppRouterDeps {
  // ... existing deps
  getDb: () => Database;  // already exists, reused by gitinfo router
}
```

---

## 8. Error Handling

| Scenario | Handling |
|----------|----------|
| `gitinfo` not found in PATH | Fall back: show error card with "gitinfo CLI not available" |
| Git not installed | `errors` array in report will contain collector errors; show per-section error states |
| Project path doesn't exist | tRPC error, caught by React Query, shown in dashboard |
| JSON parse failure | Catch, log, return error to renderer |
| Timeout (>60s) | Kill child process, return timeout error |
| Partial failures | GitInfoReport includes `errors[]` — cards for failed sections show inline error |

---

## 9. Implementation Order

| Step | Task | Files |
|------|------|-------|
| 1 | Create gitinfo tRPC router with cache | `routers/gitinfo/index.ts`, `routers/gitinfo/cache.ts` |
| 2 | Register router in root | `routers/index.ts` |
| 3 | Add `activeProjectId` to workspace store | `stores/active-workspace.ts` |
| 4 | Update WorkspaceSidebar — project click sets activeProjectId, add refresh button | `Sidebar/WorkspaceSidebar.tsx` |
| 5 | Create DashboardCard shell + StatNumber + BarChart utilities | `GitInfoDashboard/DashboardCard.tsx`, `StatNumber.tsx`, `BarChart.tsx` |
| 6 | Create OverviewCard | `GitInfoDashboard/OverviewCard.tsx` |
| 7 | Create BranchesCard | `GitInfoDashboard/BranchesCard.tsx` |
| 8 | Create ActivityCard (charts) | `GitInfoDashboard/ActivityCard.tsx` |
| 9 | Create ContributorsCard | `GitInfoDashboard/ContributorsCard.tsx` |
| 10 | Create FilesCard | `GitInfoDashboard/FilesCard.tsx` |
| 11 | Create TagsCard | `GitInfoDashboard/TagsCard.tsx` |
| 12 | Create StatusCard | `GitInfoDashboard/StatusCard.tsx` |
| 13 | Create ConfigCard | `GitInfoDashboard/ConfigCard.tsx` |
| 14 | Create DashboardSkeleton | `GitInfoDashboard/DashboardSkeleton.tsx` |
| 15 | Create main GitInfoDashboard index | `GitInfoDashboard/index.tsx` |
| 16 | Integrate into page.tsx | `routes/_dashboard/page.tsx` |
| 17 | Verify lint + typecheck + tests | — |
