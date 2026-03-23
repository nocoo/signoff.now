# 03 — GitInfo Dashboard

## Overview

Integrate `@signoff/gitinfo` collector pipeline into the desktop app as an in-process library call, enabling per-project Git repository insight with a rich visual dashboard. Data is collected by directly invoking gitinfo's collector functions from the Electron main process (using `simple-git` style exec under the hood), cached in-memory, and rendered in the MosaicLayout's empty-pane state as the default "home" view.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data source | In-process library call | See §2 — CLI child-process approach is not viable in packaged Electron |
| Data tier | Always `--full` equivalent | Desktop has time to compute; slow fields (commit frequency, file churn, author LOC) are the most valuable for visualization |
| Cache layer | Main-process in-memory `Map<projectId, { data, timestamp }>` | Simple, fast, survives renderer reloads; cleared on app quit |
| Cache TTL | None (manual refresh only) | GitInfo data is a snapshot; users refresh explicitly via sidebar button |
| Transport | New `gitinfo` tRPC router | Consistent with existing architecture (12 routers via `trpc-electron`) |
| Render location | MosaicLayout `layout === null` fallback | Replaces "No open panes" placeholder inside the existing component tree |
| Active project tracking | Zustand store, lifted from component-local state | Required for both collapsed and expanded sidebar states |

---

## 1. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Renderer (React)                                                │
│                                                                  │
│  WorkspaceSidebar          WorkspaceLayout                       │
│  ┌──────────────┐          ┌──────────────────────────────────┐  │
│  │ [🔄 Refresh] │          │  MosaicLayout                    │  │
│  │              │   tRPC   │  layout !== null → Mosaic tiles   │  │
│  │ Project A ●  │ ◄──────► │  layout === null → Dashboard     │  │
│  │   ws-1       │          │  ┌──────────┐ ┌──────────────┐  │  │
│  │   ws-2       │          │  │ Overview  │ │ Contributors │  │  │
│  │              │          │  │  Card     │ │  Card        │  │  │
│  │ Project B    │          │  ├──────────┤ ├──────────────┤  │  │
│  │              │          │  │ Branches  │ │ Files Card   │  │  │
│  └──────────────┘          │  └──────────┘ └──────────────┘  │  │
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
│  │    2. If miss → call collectAll(projectPath)  │                │
│  │    3. Store in cache                          │                │
│  │    4. Return GitInfoReport                    │                │
│  │                                               │                │
│  │  refresh({ projectId })                       │                │
│  │    1. Invalidate cache[projectId]             │                │
│  │    2. Same as getReport flow                  │                │
│  └──────────────────────────────────────────────┘                │
│                      │                                           │
│                      ▼                                           │
│              collectAll() — in-process, uses node:child_process  │
│              to run git commands (same as simple-git pattern)     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Data Source — In-Process Library (NOT CLI Spawn)

### Why CLI spawn fails in packaged Electron

The original plan (`execFile("bun", ["run", "gitinfo", ...])`) has three fatal issues:

1. **No Bun runtime in packaged app**: The desktop app ships as an Electron binary with Node.js runtime. Bun is a dev-time tool only — it's not bundled into the `electron-builder` output. `apps/desktop/package.json` has no mechanism to include Bun in the dist.

2. **No `@signoff/gitinfo` in runtime deps**: `@signoff/gitinfo` is not in desktop's `dependencies` or `devDependencies` (`apps/desktop/package.json:16`). It's a sibling workspace package. After packaging, the monorepo source tree and workspace links are gone.

3. **gitinfo bin points to raw TS**: `apps/gitinfo/package.json:6` defines `"bin": { "gitinfo": "./src/main.ts" }` — a TypeScript source file that needs Bun to execute. This cannot run under Node.js.

### Chosen approach: Rewrite collectors to use `node:child_process`

Port the gitinfo collector logic into a library that runs under Node.js (Electron's runtime). The key change: replace `Bun.spawn` executor with a `node:child_process.execFile` executor.

#### Implementation plan

1. **Create `apps/desktop/src/main/gitinfo/` directory** — a main-process module containing:
   - `executor.ts` — `createNodeExecutor()` that implements `CommandExecutor` using `node:child_process.execFile` instead of `Bun.spawn`
   - `fs-reader.ts` — `createNodeFsReader()` using `node:fs/promises` + `execFile("du", ...)` instead of `Bun.spawn("du", ...)`
   - `collect.ts` — `collectAll(projectPath)` function that:
     1. Bootstraps context (repoRoot, gitDir, hasHead) using git commands via the Node executor
     2. Runs all 8 collectors from `@signoff/gitinfo` with the Node-compatible executor
     3. Assembles and returns `GitInfoReport`

2. **Add `@signoff/gitinfo` as a devDependency of desktop** — for TYPE imports only (the types are the package's export). The actual collector code is copied/adapted into the main process module.

   Wait — `@signoff/gitinfo` exports only types (`commands/types.ts`). The collector functions use `Bun.spawn` internally. We have two options:

   **Option A (Recommended)**: Re-implement the `CommandExecutor` and `FsReader` interfaces using Node APIs, then import the collector functions directly. The collectors are pure async functions that receive a `CollectorContext` — they don't call Bun APIs themselves. Only the *executor* uses Bun.

   This works because:
   - All 8 collectors call `ctx.exec(cmd, args)` — they never call `Bun.spawn` directly
   - All filesystem operations go through `ctx.fs.*` — they never call Bun FS APIs directly
   - The collector architecture was designed for dependency injection

   **Changes needed**:
   - `@signoff/gitinfo` must export collector functions and types (new export paths)
   - `apps/desktop/package.json` adds `"@signoff/gitinfo": "workspace:*"` to dependencies
   - Desktop creates Node-compatible executor/fs-reader implementations
   - At build time, electron-vite bundles the collector code (pure TS, no native modules) into the main process bundle

   **Option B**: Shell out to system `git` directly using `simple-git` (already a dependency). But this would mean reimplementing all 40+ collector functions from scratch.

   **Decision**: Option A. The collector code is pure TypeScript that depends only on the injected `CommandExecutor` and `FsReader` interfaces. We provide Node.js implementations of these interfaces.

### New exports from `@signoff/gitinfo`

The actual directory structure is:
- Types: `src/commands/types.ts` (report types, CollectorTier, CollectorError)
- Executor interfaces: `src/executor/types.ts` (CommandExecutor, ExecResult, ExecOptions, FsReader)
- Collector types: `src/commands/collectors/types.ts` (CollectorContext, Collector<T>)
- Collector runners: `src/commands/collectors/run-collectors.ts` (runCollectors)
- Individual collectors: `src/commands/collectors/*.collector.ts` (8 files)
- Defaults: `src/commands/defaults.ts` (EMPTY_* constants)

```ts
// apps/gitinfo/package.json — updated exports
{
  "exports": {
    ".": {
      "types": "./src/commands/types.ts",
      "default": "./src/commands/types.ts"
    },
    "./executor": {
      "types": "./src/executor/types.ts",
      "default": "./src/executor/types.ts"
    },
    "./collectors": {
      "types": "./src/commands/collectors/types.ts",
      "default": "./src/commands/collectors/types.ts"
    },
    "./collectors/run": {
      "default": "./src/commands/collectors/run-collectors.ts"
    },
    "./collectors/all": {
      "default": "./src/commands/collectors/all.ts"
    },
    "./defaults": {
      "default": "./src/commands/defaults.ts"
    }
  }
}
```

New file `apps/gitinfo/src/commands/collectors/all.ts` (barrel re-export):
```ts
export { metaCollector } from "./meta.collector";
export { statusCollector } from "./status.collector";
export { branchesCollector } from "./branches.collector";
export { logsCollector } from "./logs.collector";
export { contributorsCollector } from "./contributors.collector";
export { tagsCollector } from "./tags.collector";
export { filesCollector } from "./files.collector";
export { configCollector } from "./config.collector";
```

Consumer imports in desktop:
```ts
import type { GitInfoReport } from "@signoff/gitinfo";
import type { CommandExecutor, ExecOptions, ExecResult, FsReader } from "@signoff/gitinfo/executor";
import type { CollectorContext } from "@signoff/gitinfo/collectors";
import { runCollectors } from "@signoff/gitinfo/collectors/run";
import { metaCollector, statusCollector, ... } from "@signoff/gitinfo/collectors/all";
import { EMPTY_META, EMPTY_STATUS, ... } from "@signoff/gitinfo/defaults";
```

### Node executor implementation

The `CommandExecutor` contract (`apps/gitinfo/src/executor/types.ts`) requires:
1. **Never throw on non-zero exit** — return `{ stdout, stderr, exitCode }` with the real exit code. Many collector functions branch on `exitCode !== 0` without try/catch (e.g., `getHead()` at `meta.ts:28`, `getHooks()` at `config.ts:89`, `getLargestBlobs()` at `files.ts:167`).
2. **Support `stdin`** — `files.ts:162` pipes SHA list via `opts.stdin` to `git cat-file --batch-check`.
3. **Support `timeoutMs`** — per-command timeout with process kill.
4. **Trim stdout/stderr** — match `Bun.spawn` executor behavior (`bun-executor.ts:33`).

`node:child_process.execFile` throws on non-zero exit by default. We must use `spawn` (lower level) or catch the error and extract exit code + stdout/stderr from it.

```ts
// apps/desktop/src/main/gitinfo/executor.ts
import { spawn } from "node:child_process";
import type { CommandExecutor, ExecOptions, ExecResult } from "@signoff/gitinfo/executor";

const DEFAULT_TIMEOUT_MS = 30_000;

export function createNodeExecutor(): CommandExecutor {
  return async (
    cmd: string,
    args: readonly string[],
    opts?: ExecOptions,
  ): Promise<ExecResult> => {
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    return new Promise((resolve) => {
      const proc = spawn(cmd, [...args], {
        cwd: opts?.cwd,
        env: opts?.env ? { ...process.env, ...opts.env } : undefined,
        stdio: [opts?.stdin != null ? "pipe" : "ignore", "pipe", "pipe"],
        timeout: timeoutMs,
      });

      // Write stdin if provided (e.g., SHA list for git cat-file --batch-check)
      if (opts?.stdin != null) {
        proc.stdin!.write(opts.stdin);
        proc.stdin!.end();
      }

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      proc.stdout!.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
      proc.stderr!.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

      proc.on("close", (code) => {
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString().trimEnd(),
          stderr: Buffer.concat(stderrChunks).toString().trimEnd(),
          exitCode: code ?? 1,
        });
      });

      proc.on("error", () => {
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString().trimEnd(),
          stderr: Buffer.concat(stderrChunks).toString().trimEnd(),
          exitCode: 1,
        });
      });
    });
  };
}
```

**Key differences from `createBunExecutor()`**:
- Uses `node:child_process.spawn` instead of `Bun.spawn`
- Resolves (never rejects) — matches the Bun executor's contract of always returning `ExecResult`
- Stdin piped via `proc.stdin.write()` + `.end()` instead of `Bun.spawn({ stdin: new Blob([...]) })`
- Timeout handled by `spawn`'s built-in `timeout` option (sends SIGTERM)

### Node FsReader implementation

The `FsReader` interface is already implemented using `node:fs/promises` in `bun-fs-reader.ts` (despite its name — it only uses `readdir`, `stat` from node:fs, and `du -sk` via the executor). We can either:

**Option A**: Import `createBunFsReader` directly — it has no Bun-specific code.
**Option B**: Copy it as `createNodeFsReader` for clarity.

**Decision**: Option A — just re-export. The function uses `node:fs/promises` (standard Node API) and `exec("du", ["-sk", ...])` via the injected executor. Zero Bun dependencies.

```ts
// apps/desktop/src/main/gitinfo/fs-reader.ts
// Re-export directly — createBunFsReader uses only node:fs/promises + exec("du")
export { createBunFsReader as createNodeFsReader } from "@signoff/gitinfo/executor/fs-reader";
```

Wait — this file isn't exported. Add to gitinfo exports:
```ts
// In package.json exports:
"./executor/fs-reader": {
  "default": "./src/executor/bun-fs-reader.ts"
}
```

Or simpler: just copy the 38-line file into desktop. It's trivial.

**Decision**: Copy the file. It's 38 lines of `node:fs/promises` + `exec("du")`. No maintenance burden, avoids complex export wiring for an internal utility.

```ts
// apps/desktop/src/main/gitinfo/fs-reader.ts
import { readdir, stat } from "node:fs/promises";
import type { CommandExecutor, FsReader } from "@signoff/gitinfo/executor";

export function createNodeFsReader(exec: CommandExecutor): FsReader {
  return {
    async exists(path: string): Promise<boolean> {
      try { await stat(path); return true; } catch { return false; }
    },
    async readdir(dirPath: string): Promise<string[]> {
      try { return await readdir(dirPath); } catch { return []; }
    },
    async fileSize(path: string): Promise<number> {
      return (await stat(path)).size;
    },
    async dirSizeKiB(path: string): Promise<number> {
      const result = await exec("du", ["-sk", path]);
      if (result.exitCode !== 0) return 0;
      const sizeStr = result.stdout.split("\t")[0];
      return sizeStr ? Number.parseInt(sizeStr, 10) : 0;
    },
  };
}
```

### Dependency in desktop package.json

```json
{
  "dependencies": {
    "@signoff/gitinfo": "workspace:*",
    // ... existing deps
  }
}
```

Note: `@signoff/gitinfo` contains no native modules — it's pure TypeScript that electron-vite can bundle into the main process output. No rebuild or externalization needed.

---

## 3. tRPC Router — `gitinfo`

### File: `apps/desktop/src/lib/trpc/routers/gitinfo/index.ts`

New router #13. Follows the existing dual-layer pattern (pure logic + tRPC wrapper).

```ts
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
// apps/desktop/src/lib/trpc/routers/gitinfo/cache.ts
import type { GitInfoReport } from "@signoff/gitinfo";

const cache = new Map<string, { report: GitInfoReport; fetchedAt: number }>();

export function getCached(projectId: string): GitInfoReport | null {
  return cache.get(projectId)?.report ?? null;
}

export function setCached(projectId: string, report: GitInfoReport): void {
  cache.set(projectId, { report, fetchedAt: Date.now() });
}

export function invalidate(projectId: string): void {
  cache.delete(projectId);
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

## 4. Active Project Store

### Problem: `expandedProjectId` is component-local state

Currently `expandedProjectId` is a `useState` inside `WorkspaceSidebar` (`WorkspaceSidebar.tsx:57`). This means:
- It's lost on component remount
- It's invisible to `MosaicLayout` (which needs it for the dashboard fallback)
- Collapsed sidebar (`CollapsedProjectList` at line 134) has no project selection behavior at all

### Solution: Lift to Zustand store

Add `activeProjectId` and lift `expandedProjectId` into `useActiveWorkspaceStore` (the existing store, not a new one):

```ts
// apps/desktop/src/renderer/stores/active-workspace.ts
interface ActiveWorkspaceState {
  activeWorkspace: ActiveWorkspace | null;
  activeProjectId: string | null;                      // NEW — which project's dashboard to show
  expandedProjectId: string | null;                    // NEW — lifted from useState at WorkspaceSidebar.tsx:57
  setActiveWorkspace: (workspace: ActiveWorkspace | null) => void;
  setActiveProjectId: (id: string | null) => void;    // NEW
  setExpandedProjectId: (id: string | null) => void;  // NEW — replaces onToggleProject prop
  reset: () => void;
}
```

**Why lift `expandedProjectId`?** Currently it is `useState` inside `WorkspaceSidebar` (`WorkspaceSidebar.tsx:57`). Problems:
1. Lost on component remount or sidebar collapse/expand cycle
2. Invisible to `CollapsedProjectList` (which renders independently)
3. Invisible to `MosaicLayout` (which needs `activeProjectId`, set in the same click)

After lifting, both `ExpandedProjectList` and `CollapsedProjectList` read from the same store. The `expandedProjectId` controls the sidebar tree expand/collapse, while `activeProjectId` controls which project's dashboard is displayed.

**Migration**: Remove the `useState` at `WorkspaceSidebar.tsx:57` and `onToggleProject` prop. Replace with:
```tsx
const expandedProjectId = useActiveWorkspaceStore((s) => s.expandedProjectId);
const setExpandedProjectId = useActiveWorkspaceStore((s) => s.setExpandedProjectId);
```

**State transitions:**

| Action | `activeProjectId` | `expandedProjectId` | `activeWorkspace` |
|--------|-------------------|---------------------|-------------------|
| Click project (expand) | Set to project.id | Set to project.id | Unchanged |
| Click project (collapse) | Keep (dashboard stays) | Set to null | Unchanged |
| Click collapsed project icon | Set to project.id | Unchanged (N/A in collapsed view) | Unchanged |
| Click workspace | Derived from workspace.projectId | Unchanged | Set to workspace |
| Workspace activated | Set to workspace.projectId | Set to workspace.projectId | Set to workspace |

**Key rule**: `activeProjectId` is always set when a workspace is active — derived from `activeWorkspace.projectId`. The dashboard only shows when `activeProjectId` is set AND `activeWorkspace` is null (or mosaic layout has no panes). `expandedProjectId` is purely a sidebar UI concern — it controls which project's workspace subtree is visible in the expanded sidebar.

### Sidebar collapsed state — project selection

`CollapsedProjectList` (`WorkspaceSidebar.tsx:147`) currently renders a `<button>` per project with only a tooltip — no onClick behavior. Update it to:

```tsx
<button onClick={() => setActiveProjectId(project.id)}>
  ...
</button>
```

Add a visual "selected" indicator: ring or highlight when `project.id === activeProjectId`.

---

## 5. Sidebar Refresh Button

### File: `apps/desktop/src/renderer/components/Sidebar/WorkspaceSidebar.tsx`

Add a refresh icon button in the sidebar header area, between the "New Workspace" plus button and the collapse toggle.

```tsx
// In the sidebar header — visible in BOTH expanded and collapsed states
{activeProjectId && (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground hover:text-foreground"
        onClick={handleRefresh}
        disabled={isRefreshing}
      >
        <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
      </Button>
    </TooltipTrigger>
    <TooltipContent side="right">Refresh Git Info</TooltipContent>
  </Tooltip>
)}
```

**Behavior:**
- Calls `trpc.gitinfo.refresh.useMutation()` with `activeProjectId`
- Invalidates `trpc.gitinfo.getReport` query cache via `utils.gitinfo.getReport.invalidate()`
- Shows spinning animation during fetch
- Visible in **both** expanded and collapsed sidebar states (gated on `activeProjectId !== null`)

---

## 6. Dashboard Render Location — MosaicLayout Fallback

### Problem: page.tsx is the wrong integration point

The "No open panes" text is rendered inside `MosaicLayout` at `components/MosaicLayout/index.tsx:47`, which is nested inside `WorkspaceLayout` → `page.tsx`. If we put the dashboard conditional in `page.tsx`, it replaces the *entire* `WorkspaceLayout` (including the right sidebar). The correct integration point is `MosaicLayout`'s `layout === null` branch.

### File: `apps/desktop/src/renderer/components/MosaicLayout/index.tsx`

Replace the empty state in `MosaicLayout`:

```tsx
export function MosaicLayout() {
  const layout = useTabsStore((s) => s.layout);
  const setLayout = useTabsStore((s) => s.setLayout);
  const activeProjectId = useActiveWorkspaceStore((s) => s.activeProjectId);

  if (layout === null) {
    // Show GitInfo dashboard if a project is selected, otherwise empty state
    if (activeProjectId) {
      return <GitInfoDashboard projectId={activeProjectId} />;
    }
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Select a project to view repository info</p>
      </div>
    );
  }

  return (
    <Mosaic<PaneId> ... />
  );
}
```

This way:
- `page.tsx` stays unchanged (`<WorkspaceLayout />`)
- `WorkspaceLayout` continues wrapping MosaicLayout + RightSidebar
- When no panes are open, MosaicLayout renders the dashboard *inside* the existing layout frame
- RightSidebar (Changes/Files) remains accessible alongside the dashboard

### File: `apps/desktop/src/renderer/routes/_dashboard/page.tsx` — NO CHANGES

```tsx
// Stays as-is:
function DashboardPage() {
  return <WorkspaceLayout />;
}
```

---

## 7. Dashboard Component — GitInfoDashboard

### File: `apps/desktop/src/renderer/components/GitInfoDashboard/index.tsx`

```tsx
export function GitInfoDashboard({ projectId }: { projectId: string }) {
  const { data: report, isLoading, error } = trpc.gitinfo.getReport.useQuery(
    { projectId },
    { enabled: !!projectId, staleTime: Infinity }
  );

  if (isLoading) return <DashboardSkeleton />;
  if (error) return <DashboardError error={error} />;
  if (!report) return null;

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl grid grid-cols-2 gap-4">
        <OverviewCard meta={report.meta} logs={report.logs} status={report.status} config={report.config} />
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

Data is treated as a static snapshot. Only the explicit refresh button triggers re-fetch:
- Navigating away and back shows cached data instantly
- No background polling
- React Query won't refetch on window focus

---

## 8. Dashboard Cards — Detailed Design

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

### 8.1 OverviewCard

**Data source**: `meta` + `logs` + `status` + `config`

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
| Repo state | `status.repoState` | Badge — see state mapping below |
| Has conflicts | `status.conflicted.length > 0` | Red "Conflicts" badge when true |
| Shallow | `meta.isShallow` | Warning badge if true |
| Git dir size | `config.gitDirSizeKiB` | Formatted ("142 MB") |

**Repo state badge mapping** (based on `RepoState` type from `apps/gitinfo/src/commands/types.ts:58`):

| `status.repoState` value | Color | Label |
|---------------------------|-------|-------|
| `"clean"` | Green | Clean |
| `"merge"` | Yellow | Merging |
| `"rebase-interactive"` | Yellow | Interactive Rebase |
| `"rebase"` | Yellow | Rebasing |
| `"cherry-pick"` | Yellow | Cherry-picking |
| `"bisect"` | Yellow | Bisecting |
| `"revert"` | Yellow | Reverting |

**Conflict indicator** is separate from `repoState` because the type system distinguishes them: `repoState` reflects the *operation* in progress, while `status.conflicted: string[]` reflects *unresolved merge conflicts*. A repo can be in `"merge"` state with zero conflicts (all resolved) or with conflicts (unresolved). The red badge is driven by `status.conflicted.length > 0`, independent of `repoState`.

### 8.2 BranchesCard

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

### 8.3 ActivityCard (slow-tier)

**Data source**: `logs.commitFrequency` + `logs.conventionalTypes`

| Element | Source | Display |
|---------|--------|---------|
| Commits by day of week | `commitFrequency.byDayOfWeek` | Bar chart (7 bars, Mon–Sun) |
| Commits by hour | `commitFrequency.byHour` | Heatmap or bar chart (24 slots) |
| Commits by month | `commitFrequency.byMonth` | Timeline area chart (last 12 months) |
| Conventional types | `conventionalTypes` | Horizontal bar chart (feat, fix, chore, etc.) |

**Charting approach**: Simple CSS/SVG bars — no chart library dependency. Each bar is a `<div>` with dynamic `height` or `width` based on percentage of max value. Tooltips via Radix `<Tooltip>`.

### 8.4 ContributorsCard

**Data source**: `contributors`

| Element | Source | Display |
|---------|--------|---------|
| Total authors | `contributors.totalAuthors` | Stat number |
| Active (90d) | `contributors.activeRecent` | Stat number |
| Author list | `contributors.authors` | Top 10, sorted by commits |
| Per author: name | `authors[].name` | Text |
| Per author: commits | `authors[].commits` | Number + relative bar |
| Per author: LOC (slow) | `authorStats[].linesAdded/Deleted` | `+N / -M` with color |

### 8.5 FilesCard

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

### 8.6 TagsCard

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

### 8.7 StatusCard

**Data source**: `status`

| Element | Source | Display |
|---------|--------|---------|
| Repo state | `status.repoState` | Status badge (same mapping as OverviewCard) |
| Staged files | `status.staged` | Count + expandable list |
| Modified files | `status.modified` | Count + expandable list |
| Untracked files | `status.untracked` | Count + expandable list |
| Conflicted files | `status.conflicted` | Count + expandable list (red highlight) |
| Stash count | `status.stashCount` | Number |

### 8.8 ConfigCard

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

## 9. File Structure

```
apps/gitinfo/
├── package.json              # Updated exports (add ./collectors, ./core/*)
└── src/commands/
    └── types.ts              # Existing — types + executor interfaces

apps/desktop/
├── package.json              # Add @signoff/gitinfo to dependencies
└── src/
    ├── main/gitinfo/
    │   ├── executor.ts       # createNodeExecutor() — node:child_process
    │   ├── fs-reader.ts      # createNodeFsReader() — node:fs/promises
    │   └── collect.ts        # collectAll(projectPath) — orchestrator
    ├── lib/trpc/routers/
    │   ├── gitinfo/
    │   │   ├── index.ts      # tRPC router (getReport, refresh)
    │   │   └── cache.ts      # In-memory cache Map
    │   └── index.ts          # + gitinfo router registration
    └── renderer/
        ├── components/
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
        │   ├── MosaicLayout/
        │   │   └── index.tsx            # Modified — dashboard fallback in layout===null
        │   └── Sidebar/
        │       └── WorkspaceSidebar.tsx  # + refresh button, activeProjectId integration
        └── stores/
            └── active-workspace.ts      # + activeProjectId field
```

---

## 10. Integration Points

### 10.1 MosaicLayout — Dashboard fallback (PRIMARY integration point)

**File**: `apps/desktop/src/renderer/components/MosaicLayout/index.tsx`

Current code at line 47:
```tsx
if (layout === null) {
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <p className="text-sm">No open panes</p>
    </div>
  );
}
```

Replaced with:
```tsx
if (layout === null) {
  if (activeProjectId) {
    return <GitInfoDashboard projectId={activeProjectId} />;
  }
  return (
    <div className="flex h-full items-center justify-center text-muted-foreground">
      <p className="text-sm">Select a project to view repository info</p>
    </div>
  );
}
```

### 10.2 page.tsx — NO CHANGES

`routes/_dashboard/page.tsx` stays as-is. It renders `<WorkspaceLayout />` which contains `<MosaicLayout />`.

### 10.3 WorkspaceSidebar — Project click + Collapsed state

**Expanded state** (`ExpandedProjectList`):
- Remove `useState<string | null>(null)` at line 57 and the `onToggleProject` prop chain
- Read `expandedProjectId` / `setExpandedProjectId` from `useActiveWorkspaceStore`
- On project click: call both `setExpandedProjectId(...)` (toggle) and `setActiveProjectId(project.id)` (always set)

**Collapsed state** (`CollapsedProjectList`, line 147):
- Add `onClick={() => setActiveProjectId(project.id)}` to project icon buttons
- Add visual selected indicator: `ring-2 ring-primary` when `project.id === activeProjectId`

**Workspace activation** (existing `handleActivate` in `WorkspaceList`):
- After setting `activeWorkspace`, also set `activeProjectId` to `workspace.projectId`
- Also set `expandedProjectId` to `workspace.projectId` (ensures the parent project tree stays open)

### 10.4 Router deps

```ts
// AppRouterDeps — no new deps needed
// getDb already exists, reused by gitinfo router for project.mainRepoPath lookup
```

---

## 11. Error Handling

| Scenario | Handling |
|----------|----------|
| Git not installed | `errors` array in report contains collector errors; dashboard cards show inline "collector failed" |
| Project path doesn't exist | tRPC error, caught by React Query, dashboard shows error state |
| Collector timeout (>30s per command) | Node executor kills child process, collector error captured |
| Overall timeout (>60s total) | Add timeout wrapper around `collectAll()` |
| Partial failures | `GitInfoReport.errors[]` — cards for failed sections show inline error with collector name |
| Empty repo (no commits) | Collectors handle gracefully (return zero-values); dashboard shows available data |

---

## 12. Implementation Order

| Step | Task | Files |
|------|------|-------|
| 1 | Update `@signoff/gitinfo` exports — expose collector functions, executor/fs interfaces | `apps/gitinfo/package.json`, new barrel exports |
| 2 | Add `@signoff/gitinfo` to desktop dependencies | `apps/desktop/package.json` |
| 3 | Create Node executor + fs-reader | `main/gitinfo/executor.ts`, `main/gitinfo/fs-reader.ts` |
| 4 | Create `collectAll()` orchestrator | `main/gitinfo/collect.ts` |
| 5 | Create gitinfo tRPC router with cache | `routers/gitinfo/index.ts`, `routers/gitinfo/cache.ts` |
| 6 | Register router in root | `routers/index.ts` |
| 7 | Add `activeProjectId` + lift `expandedProjectId` to store | `stores/active-workspace.ts` |
| 8 | Update WorkspaceSidebar — both collapsed/expanded project click, add refresh button | `Sidebar/WorkspaceSidebar.tsx` |
| 9 | Create DashboardCard shell + StatNumber + BarChart utilities | `GitInfoDashboard/DashboardCard.tsx`, `StatNumber.tsx`, `BarChart.tsx` |
| 10 | Create OverviewCard | `GitInfoDashboard/OverviewCard.tsx` |
| 11 | Create BranchesCard | `GitInfoDashboard/BranchesCard.tsx` |
| 12 | Create ActivityCard (charts) | `GitInfoDashboard/ActivityCard.tsx` |
| 13 | Create ContributorsCard | `GitInfoDashboard/ContributorsCard.tsx` |
| 14 | Create FilesCard | `GitInfoDashboard/FilesCard.tsx` |
| 15 | Create TagsCard | `GitInfoDashboard/TagsCard.tsx` |
| 16 | Create StatusCard | `GitInfoDashboard/StatusCard.tsx` |
| 17 | Create ConfigCard | `GitInfoDashboard/ConfigCard.tsx` |
| 18 | Create DashboardSkeleton | `GitInfoDashboard/DashboardSkeleton.tsx` |
| 19 | Create main GitInfoDashboard index | `GitInfoDashboard/index.tsx` |
| 20 | Integrate into MosaicLayout fallback | `MosaicLayout/index.tsx` |
| 21 | Verify lint + typecheck + tests | — |
