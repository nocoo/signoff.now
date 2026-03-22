# 01 — gitinfo CLI

## Overview

`gitinfo` is a CLI tool that provides comprehensive information about a local git repository. It collects metadata, branch info, commit history, contributor stats, file statistics, working tree status, tags, and git configuration — using only git commands and OS-native CLI tools (zero npm runtime dependencies).

**Key design goals:**

- **JSON-first** — Default output is compact JSON (pipeable to `jq`/`gron`), `--pretty` for human-readable terminal output
- **Performance-tiered** — Instant and moderate commands run by default; slow commands opt-in via `--full`
- **Testable** — Command executor dependency injection; all core functions are pure and independently testable
- **Bun-only** — Leverages Bun.spawn for subprocess execution; runs directly as TypeScript

### Platform support

**macOS and Linux only.** The implementation depends on POSIX utilities (`du -sk` for directory sizing, `wc -l` for line counting) and assumes Unix path semantics. Windows is not supported — there is no planned fallback for missing POSIX commands, and paths are not normalized for Windows separators.

### Path encoding convention

Git commands that output file paths will quote and escape filenames containing tabs, newlines, double quotes, or bytes outside the printable ASCII range (e.g., `"tab\tname.txt"`). To avoid broken path parsing, **all commands that output paths or multi-value data must use `-z` (NUL-delimited) mode** where the option is available (`git status -z`, `git ls-files -z`, `git log -z --name-only`, `git rev-list --objects -z`, `git diff -z --numstat`, `git config --list -z`, `git worktree list --porcelain -z`). The TypeScript parser splits on `\0` instead of `\n`. This eliminates the need for Git's C-style dequoting and makes parsing unambiguous for any filename or value containing newlines.

### Scope

Supports **standard non-bare working tree repositories only**. The following layouts are explicitly unsupported:

- Bare repositories (`git init --bare`)
- Separate git-dir layouts (`--git-dir` / `GIT_DIR` pointing elsewhere)

**Git worktrees** (`git worktree add`) are **supported**. In a linked worktree, `.git` is a file (not a directory), so paths into the git directory must not be hardcoded as `join(repoRoot, ".git", ...)`. Instead, all git-directory paths are resolved at bootstrap via `git rev-parse --absolute-git-dir` (returns the worktree-specific git dir as an absolute path) and `git rev-parse --path-format=absolute --git-path <path>` (returns the correct absolute path for per-worktree files like `MERGE_HEAD`, or shared resources like `hooks`). The absolute variants are required because in the main worktree, `--git-dir` and `--git-path` return relative paths (`.git`, `.git/hooks`), which would violate the FsReader absolute path convention. See [Bootstrap](#bootstrap-before-collectors-run) for the `gitDir` and `gitPath()` pre-computation. The `config.worktreeCount` field reflects `git worktree list` output.

### Empty repository handling

An empty repo (`git init` with no commits) is a valid input. When HEAD does not exist:

- Fields that depend on commit history return a type-appropriate zero-value: `null` for nullable singular values (`string | null`, `GitCommitSummary | null`), `0` for numeric counts, `[]` for arrays, and empty collections (e.g., `{}`) for maps/records. Optional slow fields (`field?`) are **omitted** (`undefined`) when `--full` is not active — but when `--full` **is** active and the repo is empty, they return their own zero-value (e.g., empty map), not `undefined`. The exact return value per field is specified in the data model tables below
- The `meta`, `status`, `branches`, `config` sections still return meaningful data (git version, repo root, untracked files, config, etc.)
- The `logs`, `contributors`, `tags` sections return empty/zero/null values (not errors)
- The `files` section: all non-slow fields (`trackedCount`, `typeDistribution`, `totalLines`, `largestTracked`) work normally even without commits — `git ls-files` lists staged files, and working tree operations (`wc -l`, `FsReader.fileSize()`) operate on the actual files. These fields are **not zeroed out** in empty repos. Slow fields (`largestBlobs`, `mostChanged`, `binaryFiles`) are skipped (they depend on commit history via `hasHead` guard)
- Startup guards check `git rev-parse --verify HEAD` to detect this state; the result is passed to collectors via `CollectorContext.hasHead: boolean`
- Every command in the data model table that uses `HEAD` is annotated with its empty repo behavior

---

## Usage

```
gitinfo [section] [flags]

Sections:
  (none)          Full report (all sections)
  meta            Repository metadata
  branches        Branch information
  status          Working tree status
  logs            Commit history
  contributors    Author statistics
  tags            Tags & releases
  files           File statistics
  config          Git configuration

Flags:
  --full          Include slow-tier data (per-author LOC, blob sizes, file churn)
  --pretty        Human-readable output (default: compact JSON)
  --cwd <path>    Target directory (default: cwd)
  --help, -h      Show help
  --version, -v   Show version
```

### Examples

```bash
# Full report as JSON
gitinfo

# Pretty-print full report
gitinfo --pretty

# Only branch info
gitinfo branches

# Contributors with slow fields (per-author LOC stats)
gitinfo contributors --full

# Run against a different repo
gitinfo --cwd /path/to/repo

# Pipe to jq
gitinfo | jq '.meta.remotes'
gitinfo contributors | jq '.authors | sort_by(-.commits) | .[0:5]'
```

---

## Architecture

### Three-Layer Design

```
┌─────────────────────────────────────────────────────┐
│  CLI Layer                                          │
│  src/main.ts → src/cli/args.ts → src/cli/output.ts │
│  Parse argv, dispatch to command, format output     │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  Bootstrap (in command orchestrator, before collect) │
│  Resolve: repoRoot, hasHead, isBare guard           │
│  Build CollectorContext with pre-computed values     │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  Collectors Layer                                   │
│  src/commands/collectors/*.collector.ts              │
│  Orchestrate core functions into typed sections      │
│  run-collectors.ts: parallel execution + error      │
│  isolation per collector                            │
│  Each collector gates slow fields via activeTiers   │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  Core Layer                                         │
│  src/commands/core/*.ts                             │
│  Pure functions: exec commands → typed results       │
│  All I/O goes through injected interfaces:           │
│  CommandExecutor (git/OS commands) + FsReader (files) │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  Executor (DI Boundary)                             │
│  src/executor/types.ts    → interface               │
│  src/executor/bun-executor.ts → Bun.spawn           │
│  src/executor/mock-executor.ts → test helper        │
└─────────────────────────────────────────────────────┘
```

### Directory Structure

```
apps/gitinfo/
├── package.json                          # @signoff/gitinfo, bin: gitinfo
├── tsconfig.json                         # extends @signoff/typescript/internal-package.json
├── bunfig.toml                           # [test] pathIgnorePatterns for integration test isolation
└── src/
    ├── main.ts                           # #!/usr/bin/env bun — entry point
    ├── cli/
    │   ├── args.ts                       # Argument parser (zero-dep, hand-rolled)
    │   ├── args.test.ts
    │   ├── output.ts                     # JSON + pretty formatters
    │   └── output.test.ts
    ├── executor/
    │   ├── types.ts                      # CommandExecutor + FsReader interfaces
    │   ├── bun-executor.ts               # Real CommandExecutor via Bun.spawn
    │   ├── bun-fs-reader.ts              # Real FsReader via node:fs/promises + du (POSIX)
    │   ├── mock-executor.ts              # Deterministic fake for unit tests
    │   └── mock-fs-reader.ts             # Deterministic fake for fs-dependent tests
    ├── commands/
    │   ├── types.ts                      # GitInfoReport + all section interfaces
    │   ├── core/
    │   │   ├── meta.ts                   # Repo root, name, remotes, HEAD, git version
    │   │   ├── meta.test.ts
    │   │   ├── status.ts                 # Working tree: staged/modified/untracked, stash, repo state
    │   │   ├── status.test.ts
    │   │   ├── branches.ts               # Branch list, tracking, ahead/behind, merged
    │   │   ├── branches.test.ts
    │   │   ├── logs.ts                   # Commit count, last commit, frequency histograms
    │   │   ├── logs.test.ts
    │   │   ├── contributors.ts           # Authors, commit counts, LOC (slow)
    │   │   ├── contributors.test.ts
    │   │   ├── tags.ts                   # Tag list, annotated vs lightweight, details
    │   │   ├── tags.test.ts
    │   │   ├── files.ts                  # Tracked count, type dist, largest, churn (slow)
    │   │   ├── files.test.ts
    │   │   ├── config.ts                 # .git size, objects, hooks, worktrees, config
    │   │   └── config.test.ts
    │   ├── collectors/
    │   │   ├── types.ts                  # Collector<T> interface, CollectorTier
    │   │   ├── meta.collector.ts
    │   │   ├── status.collector.ts
    │   │   ├── branches.collector.ts
    │   │   ├── logs.collector.ts
    │   │   ├── contributors.collector.ts
    │   │   ├── tags.collector.ts
    │   │   ├── files.collector.ts
    │   │   ├── config.collector.ts
    │   │   ├── run-collectors.ts         # Parallel orchestrator + error isolation
    │   │   └── run-collectors.test.ts
    │   └── pretty/
    │       ├── format.ts                 # KV + table pretty renderer (ANSI colors)
    │       └── format.test.ts
    └── utils/
        ├── parse.ts                      # Shared: splitLines, parseKV, parseSize, trimOutput
        └── parse.test.ts
    └── __integration__/
        ├── executor.integration.test.ts  # Real Bun.spawn + git --version
        └── e2e.integration.test.ts       # Full report against temp git repo
```

---

## Data Model

### Full Report (`GitInfoReport`)

```typescript
interface GitInfoReport {
  generatedAt: string;        // ISO 8601
  tiers: CollectorTier[];     // which tiers were active
  durationMs: number;
  meta: GitMeta;
  status: GitStatus;
  branches: GitBranches;
  logs: GitLogs;
  contributors: GitContributors;
  tags: GitTags;
  files: GitFiles;
  config: GitConfig;
  errors: CollectorError[];   // non-fatal collector failures
}
```

### Section: Meta

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `gitVersion` | `string` | instant | `git --version` |
| `repoRoot` | `string` | instant | reads from `ctx.repoRoot` (pre-computed at bootstrap via `git rev-parse --show-toplevel`) |
| `repoName` | `string` | instant | Derived with the following priority: (1) If an `origin` remote exists, extract the repo name from its fetch URL — for both SSH (`git@host:org/repo.git`) and HTTPS (`https://host/org/repo.git`) formats, take the last path segment and strip a trailing `.git` suffix if present; (2) If no `origin` remote, use the basename of `ctx.repoRoot` (e.g., `/home/user/my-project` → `"my-project"`). No further normalization (lowercasing, slug conversion, etc.) is applied |
| `head` | `string \| null` | instant | `git rev-parse HEAD`; null in empty repo (no commits) |
| `headShort` | `string \| null` | instant | `git rev-parse --short HEAD`; null in empty repo |
| `currentBranch` | `string \| null` | instant | `git symbolic-ref --short HEAD`; exits non-zero when HEAD is detached → map non-zero exit code to `null` |
| `defaultBranch` | `string \| null` | instant | `git symbolic-ref refs/remotes/origin/HEAD` → strip `refs/remotes/origin/` prefix; null if no remote or origin/HEAD not set |
| `remotes` | `GitRemote[]` | instant | `git remote -v` → outputs one fetch line and one-or-more push lines per remote; parse and **group by remote name** into one `GitRemote` object per remote. See `GitRemote` in [Shared Types](#shared-types) |
| `isShallow` | `boolean` | instant | `git rev-parse --is-shallow-repository` |
| `firstCommitAuthorDate` | `string \| null` | instant | `git log <root-commit> -1 --format=%aI`; null in empty repo. **Caveat:** this is the root commit's author date, which can be rewritten or forged — it is not a reliable "repo creation timestamp" |

> **Note:** `isBare` is not a report field. It is checked at startup as a guard **before** resolving `repoRoot` — if `git rev-parse --is-bare-repository` returns `true`, gitinfo exits with an error message ("bare repositories are not supported"). This must run first because `git rev-parse --show-toplevel` (used for `repoRoot`) fatals in a bare repository. See [Scope](#scope) and [Bootstrap](#bootstrap-before-collectors-run).

### Section: Status

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `staged` | `GitStatusEntry[]` | instant | `git status --porcelain=v2 -z` |
| `modified` | `GitStatusEntry[]` | instant | `git status --porcelain=v2 -z` |
| `untracked` | `string[]` | instant | `git status --porcelain=v2 -z` |
| `conflicted` | `string[]` | instant | `git status --porcelain=v2 -z` |
| `stashCount` | `number` | instant | `git stash list` → count lines in TypeScript |
| `repoState` | `RepoState` | instant | `FsReader.exists()` checks for `await ctx.gitPath("MERGE_HEAD")`, `await ctx.gitPath("rebase-merge")`, `await ctx.gitPath("rebase-apply")`, `await ctx.gitPath("CHERRY_PICK_HEAD")`, `await ctx.gitPath("BISECT_LOG")`, `await ctx.gitPath("REVERT_HEAD")`. Uses `gitPath()` so per-worktree files resolve correctly in linked worktrees |

**`GitStatusEntry`** — parsed from `git status --porcelain=v2 -z`:

```typescript
interface GitStatusEntry {
  path: string;              // current path (new path for renames/copies)
  indexStatus: string;       // porcelain v2 X field (e.g., "M", "A", "R", "C", "D")
  workTreeStatus: string;    // porcelain v2 Y field
  sourcePath?: string;       // original path — present only for rename (R) and copy (C) entries
  renameScore?: number;      // similarity percentage (0–100) — present only for R/C entries
}
```

**Rename/copy parsing (porcelain v2 `-z`):** For ordinary changed entries, `git status` emits a single NUL-terminated record. For rename/copy entries (status `R` or `C`), it emits the main record followed by an **additional NUL-delimited token** containing the original path. The parser must detect `R`/`C` status codes and consume this extra token. The rename score is embedded in the main record's sub-field. Untracked (`?`) and ignored (`!`) entries are single-token records with just the path.

### Section: Branches

**Empty repo note:** In an empty repo (no commits), `current` returns the branch name from the symbolic ref (e.g., `"main"`) because `git branch --show-current` reads `HEAD` — which exists as a symbolic ref even without commits. However, `local` / `totalLocal` return `[]` / `0` because `git for-each-ref refs/heads/` only lists refs backed by actual commits. This means `current = "main"` with `totalLocal = 0` is a valid and expected state, not a bug. Consumers should not assume that `current` being non-null implies `totalLocal >= 1`.

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `current` | `string \| null` | instant | `git branch --show-current`; returns empty string when HEAD is detached → map empty string to `null` in TypeScript (consistent with `meta.currentBranch` null semantics) |
| `local` | `GitBranchInfo[]` | moderate | `git for-each-ref --format=... refs/heads/` |
| `remote` | `string[]` | moderate | `git for-each-ref --format='%(if)%(symref)%(then)%(else)%(refname:short)%(end)' refs/remotes/` → skip symbolic refs (e.g., `origin/HEAD`); filter empty lines in TypeScript |
| `totalLocal` | `number` | instant | `git for-each-ref --format='%(refname:short)' refs/heads/` → count lines in TypeScript |
| `totalRemote` | `number` | instant | same command as `remote` → count non-empty lines in TypeScript |

`GitBranchInfo` — see [Shared Types](#shared-types).

### Section: Logs

**Scope: HEAD-reachable history only.** All commands in this section use `HEAD` as the revision argument. This means they only count commits reachable from the current HEAD — commits on unmerged branches, orphaned refs, or other heads are **not** included. This is not "total repository" statistics; it is "current branch lineage" statistics.

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `totalCommits` | `number` | instant | `git rev-list --count HEAD`; 0 in empty repo (skip command, return 0) |
| `totalMerges` | `number` | instant | `git rev-list --merges --count HEAD`; 0 in empty repo |
| `firstCommitDate` | `string \| null` | instant | `git log <root-commit> -1 --format=%aI`; null in empty repo. **Caveat:** author date, can be forged |
| `lastCommit` | `GitCommitSummary \| null` | instant | `git log -1 --format=...`; null in empty repo |
| `commitFrequency?` | `CommitFrequency` | **slow** | `git log --format=%ad --date=format:... --since='1 year ago' HEAD`; empty maps in empty repo. **Optional:** omitted from JSON output when `--full` is not active |
| `conventionalTypes?` | `Record<string, number>` | **slow** | `git log --format=%s -n 1000 HEAD` + regex parse in TypeScript; empty map in empty repo. **Optional:** omitted when `--full` is not active |

### Section: Contributors

**Scope: HEAD-reachable history only.** Same as Logs — `git shortlog ... HEAD` only counts authors with commits reachable from HEAD. Authors who contributed exclusively to unmerged branches will not appear.

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `authors` | `GitAuthorSummary[]` | moderate | `git shortlog -sne --no-merges HEAD` (HEAD is required — without a revision, shortlog reads stdin instead of the log; in non-TTY contexts like Bun.spawn, stdin is empty so it silently returns zero results, producing incorrect output); guard: return `[]` when `!hasHead` |
| `totalAuthors` | `number` | moderate | derived from authors; 0 in empty repo |
| `activeRecent` | `number` | moderate | `git shortlog -sne --no-merges --since='90 days ago' HEAD`; guard: return 0 when `!hasHead` |
| `authorStats?` | `GitAuthorStats[]` | **slow** | `git log --numstat --pretty=tformat:'%aN <%aE>' -n 1000 HEAD`; guard: skip when `!hasHead`. **Identity key is `name <email>`** — must match the `shortlog -sne` granularity used by `authors`, so that stats can be joined to author entries without false merges. **Optional:** omitted when `--full` is not active |

### Section: Tags

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `count` | `number` | instant | `git tag -l` → count lines in TypeScript |
| `tags` | `GitTagInfo[]` | moderate | `git for-each-ref --format=... refs/tags/` |
| `latestReachableTag` | `string \| null` | instant | `git describe --tags --abbrev=0`; null when no tags exist or no tag is reachable from HEAD (exit code 128). This is the nearest tag **reachable from HEAD**, not the newest tag in the repo — on branched histories, tags on other branches are invisible |
| `commitsSinceTag` | `number \| null` | instant | Only computed when `latestReachableTag` is non-null: `git rev-list <latestReachableTag>..HEAD --count`. null when `latestReachableTag` is null (no tag or empty repo) |

### Section: Files

All fields in this section use the **working tree** (via `git ls-files`) as their basis, not HEAD. This means staged-but-uncommitted files are included. All four non-slow fields share the same `git ls-files` source, but they intentionally diverge on certain edge cases: deleted-but-tracked files, submodule (gitlink) entries, and merge-conflict multi-stage records each receive special handling documented below. The slow fields (`largestBlobs`, `mostChanged`, `binaryFiles`) necessarily use commit history and may not cover staged-only files — this difference is documented per field.

**Deleted-but-tracked files:** When a tracked file has been deleted from the working tree but not yet `git rm`'d, `git ls-files` still lists it. Operations that access the file on disk (`wc -l` for line counting, `FsReader.fileSize()` for size) will fail. The implementation must **silently skip** such files — they contribute to `trackedCount` and `typeDistribution` (which only need the filename), but are excluded from `totalLines` and `largestTracked` (which need file content/size). No error is reported for these files.

**Submodule (gitlink) entries:** `git ls-files -z` also lists submodule paths (git mode `160000`). In the working tree, a submodule path is a directory, not a regular file — `wc -l` reports "Is a directory" and `FsReader.fileSize()` returns the directory inode size, not the content size. The implementation must **silently skip gitlink entries** from all four non-slow fields. Detection: use `git ls-files -z --stage` and filter out entries where the mode is `160000`. Do **not** use a "skip if not regular file" heuristic — that would incorrectly exclude symlinks (mode `120000`), which are valid tracked entries where `wc -l` and `fileSize()` operate correctly on the link target. Submodule entries should not contribute to `trackedCount`, `typeDistribution`, `totalLines`, or `largestTracked`.

**Conflict (multi-stage) deduplication:** During a merge conflict, `git ls-files --stage` emits up to 3 entries per path (stage 1 = common ancestor, stage 2 = ours, stage 3 = theirs). The stage number is the second field in the `--stage` output (`<mode> <sha> <stage> <path>`). If not deduplicated, a conflicted file would be counted 2–3× in `trackedCount`, appear multiple times in `typeDistribution`, and be processed multiple times by `totalLines`/`largestTracked`. The implementation must **deduplicate by path** — keep only one entry per unique path (any stage). Since all stages share the same path and extension, which stage is kept does not affect counting or extension parsing; for `totalLines` and `largestTracked`, the working tree file is the same regardless of stage.

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `trackedCount` | `number` | instant | `git ls-files -z --stage` → split on `\0`, **exclude gitlink entries** (mode `160000`), **deduplicate by path** (conflict stages), count remaining unique paths in TypeScript |
| `typeDistribution` | `Record<string, number>` | moderate | `git ls-files -z --stage` → split on `\0`, **exclude gitlink entries** (mode `160000`), **deduplicate by path** (conflict stages), parse extensions from remaining unique paths in TypeScript |
| `totalLines` | `number` | moderate | `git ls-files -z --stage` → exclude gitlinks (mode `160000`), deduplicate by path (conflict stages), then `wc -l -- <file>` per remaining file via exec (the `--` is required to prevent filenames starting with `-` from being parsed as options), sum in TypeScript. Uses working tree files; silently skips deleted-but-tracked files (see above) |
| `largestTracked` | `FileSizeInfo[]` | moderate | `git ls-files -z --stage` → exclude gitlinks (mode `160000`), deduplicate by path (conflict stages), then `FsReader.fileSize()` per remaining file, sort in TypeScript. Uses working tree file sizes; silently skips deleted-but-tracked files (see above) |
| `largestBlobs?` | `GitBlobInfo[]` | **slow** | **Two-step:** (1) `git rev-list --objects -z --all` → NUL-delimited token stream: each object emits a `<sha>` token; blobs with an associated path emit an additional `path=<filename>` token immediately after. Commits and trees have no `path=` token. Split on `\0` and correlate SHA with its following `path=` token if present; (2) feed SHAs to `git cat-file --batch-check` → outputs `<sha> <type> <size>` per object; **filter to `type == "blob"` only** — discard commit/tree/tag objects. Sort by size descending in TypeScript. **History-based** — shows largest objects ever committed, not current working tree. **Optional:** omitted when `--full` is not active |
| `mostChanged?` | `GitFileChurn[]` | **slow** | `git log -z --pretty=format: --name-only -n 1000 HEAD` → split on `\0`, count occurrences in TypeScript; guard: skip when `!hasHead`. **History-based.** **Known limitation:** rename commits emit both the old and new path, so a single rename counts as one change to each path. This means a frequently renamed file's churn is split across its historical names, and the old path receives an inflated count. `--follow` cannot be used here because it only works for a single file, not a bulk log scan. **Optional:** omitted when `--full` is not active |
| `binaryFiles?` | `string[]` | **slow** | **Two-step** (no shell substitution — see [CommandExecutor](#commandexecutor--subprocess-spawning)): (1) `git hash-object -t tree /dev/null` → returns the empty tree SHA; (2) `git diff -z --numstat <empty-tree-sha> HEAD --` → NUL-delimited; lines with `-\t-` prefix are binary. Guard: skip when `!hasHead`. **HEAD-based** — only detects binaries committed to HEAD. **Optional:** omitted when `--full` is not active |

### Section: Config

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `gitDirSizeKiB` | `number` | instant | `FsReader.dirSizeKiB(ctx.gitDir)` (wraps `du -sk` internally). In linked worktrees, `gitDir` points to the worktree-specific git dir (e.g., `.git/worktrees/<name>`), so this measures the worktree's git state, not the entire shared `.git` |
| `objectStats` | `GitObjectStats` | instant | `git count-objects -v`. **Scope: shared object store** — unlike `gitDirSizeKiB` (which is worktree-specific in linked worktrees), `count-objects` always reports from the shared object database. In linked worktrees, these two fields have different scopes: `gitDirSizeKiB` measures the worktree-specific git dir, while `objectStats` reflects the entire repository's object store. Consumers should not compare these values as if they describe the same thing |
| `worktreeCount` | `number` | instant | `git worktree list --porcelain -z` → NUL-delimited token stream; count tokens that start with `worktree ` prefix. **Includes the main working tree** — a repo with no linked worktrees returns 1, not 0. **Also includes prunable (stale) worktrees** — if a linked worktree's directory has been manually deleted but not `git worktree remove`'d, Git still lists it. This field reflects the Git registry as-is; it is not filtered to "currently valid" worktrees |
| `hooks` | `string[]` | instant | First check `git config core.hooksPath`: if set, use that directory (resolved against `repoRoot` if relative); if not set, fall back to `await ctx.gitPath("hooks")` (resolves correctly in both main and linked worktrees — hooks are shared). Read **only the effective directory** via `FsReader.readdir()` → filter out `.sample` files. Do **not** merge both directories — Git ignores the default hooks dir when `core.hooksPath` is configured |
| `localConfig` | `Record<string, string[]>` | instant | `git config --local --list -z` → NUL-delimited `key\nvalue` pairs; split on `\0`, then split each entry on first `\n` to separate key from value. Group by key; values array to preserve multi-value keys. The `-z` flag is required because config values may contain newlines |

### Shared Types

All types referenced in the data model tables above. Section-level interfaces (`GitMeta`, `GitStatus`, etc.) are not listed — their shape is defined by the corresponding field table.

```typescript
// --- Meta ---

interface GitRemote {
  name: string;                // remote name (e.g., "origin")
  fetchUrl: string;            // fetch URL
  pushUrls: string[];          // one or more push URLs (git allows multiple via set-url --add --push)
}

// --- Status ---

// GitStatusEntry is defined above in Section: Status

type RepoState =
  | "clean"                    // none of the state files exist
  | "merge"                    // MERGE_HEAD present
  | "rebase-interactive"       // rebase-merge present
  | "rebase"                   // rebase-apply present
  | "cherry-pick"              // CHERRY_PICK_HEAD present
  | "bisect"                   // BISECT_LOG present
  | "revert";                  // REVERT_HEAD present

// --- Branches ---

interface GitBranchInfo {
  name: string;                // branch short name
  upstream: string | null;     // e.g., "origin/main"; null if no tracking branch
  aheadBehind: { ahead: number; behind: number } | null; // null if no upstream
  lastCommitDate: string;      // ISO 8601 author date of branch tip
  isMerged: boolean;           // true if fully merged into HEAD
}

// --- Logs ---

interface GitCommitSummary {
  sha: string;                 // full SHA
  shaShort: string;            // abbreviated SHA
  author: string;              // "Name <email>"
  date: string;                // ISO 8601 author date
  subject: string;             // first line of commit message
}

interface CommitFrequency {
  byDayOfWeek: Record<string, number>;  // "Mon"–"Sun" → count
  byHour: Record<string, number>;       // "00"–"23" → count
  byMonth: Record<string, number>;      // "2025-01"–... → count
}

// --- Contributors ---

interface GitAuthorSummary {
  name: string;
  email: string;
  commits: number;
}

interface GitAuthorStats {
  name: string;
  email: string;
  linesAdded: number;
  linesDeleted: number;
}

// --- Tags ---

interface GitTagInfo {
  name: string;                // tag name (e.g., "v1.0.0")
  type: "annotated" | "lightweight";
  sha: string;                 // tag object SHA (annotated) or commit SHA (lightweight)
  date: string | null;         // tagger date (annotated only); null for lightweight
  message: string | null;      // tag message (annotated only); null for lightweight
}

// --- Files ---

interface FileSizeInfo {
  path: string;                // relative to repoRoot
  sizeBytes: number;
}

interface GitBlobInfo {
  sha: string;
  path: string;                // path at time of commit (may differ from current)
  sizeBytes: number;
}

interface GitFileChurn {
  path: string;
  count: number;               // number of commits touching this path
}

// --- Config ---

interface GitObjectStats {
  count: number;               // number of loose objects
  size: number;                // size of loose objects in KiB
  inPack: number;              // number of objects stored in pack files
  packs: number;               // number of pack files
  sizePackKiB: number;         // total size of pack files in KiB
  prunePackable: number;       // loose objects also in packs (prunable)
  garbage: number;             // unreachable garbage files
  sizeGarbageKiB: number;
}

// --- Report-level ---

interface CollectorError {
  collector: string;           // collector name (e.g., "meta", "files")
  message: string;             // error message
  stack?: string;              // stack trace (optional, omitted in production)
}
```

---

## Performance Tiers

| Tier | Latency | Behavior | Example Data |
|------|---------|----------|-------------|
| **instant** | < 100ms | Always run | git version, HEAD, commit count, status, stash |
| **moderate** | 100ms–2s | Default on | branch details, shortlog, tag details, file type dist |
| **slow** | 2s–30s+ | Opt-in (`--full`) | per-author LOC, largest blobs in history, file churn, commit frequency |

### Mitigation strategies for slow commands

1. **Parallel execution** — All collectors run concurrently via `Promise.all`
2. **Tier gating** — Slow fields use optional types (`field?: Type`) and are omitted from the TypeScript object (and thus from JSON output) when `--full` is not active. This ensures JSON schema stability: default mode always produces the same set of keys; `--full` mode adds additional keys
3. **Limit by default** — Slow log-based commands use `-n 1000` or `--since='1 year ago'` to bound traversal
4. **Early exit** — Check `git rev-list --count HEAD`; if > 50k, emit a warning to **stderr** (never stdout — stdout is reserved for the JSON/pretty report and must remain pipe-safe). The warning is informational only and does not change the exit code or skip any fields. Example: `⚠ Large repository (52341 commits) — slow fields may take a while`

---

## Executor Interface

All I/O in core functions goes through two injected interfaces — no direct `Bun.spawn`, `fs`, or shell pipeline calls in core code.

### CommandExecutor — subprocess spawning

Real implementation uses `Bun.spawn`; tests inject a mock with deterministic output. Each invocation runs **a single command** (no shell pipelines). When a git command's output needs post-processing (e.g., counting lines), the parsing happens in TypeScript, not via piping to `wc`/`sort`/`grep`.

```typescript
// src/executor/types.ts

interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;          // default 30_000
  env?: Record<string, string>;
}

interface ExecResult {
  stdout: string;              // trimmed
  stderr: string;              // trimmed (diagnostic only — see failure rule below)
  exitCode: number;
}

type CommandExecutor = (
  cmd: string,
  args: readonly string[],
  opts?: ExecOptions,
) => Promise<ExecResult>;
```

**Failure determination rule:** A command is considered failed **if and only if `exitCode !== 0`**. `stderr` content alone does **not** indicate failure — many git commands write warnings or informational messages to stderr while exiting 0 (e.g., `git count-objects -v` may emit warnings in linked worktrees). Core functions must check `exitCode` first; `stderr` is available for diagnostic logging but must never be used as a success/failure signal. Individual fields that need to handle specific non-zero exit codes (e.g., `git describe` returning 128 when no tags exist) document their exit-code mapping in the data model table.

### FsReader — filesystem access

A small interface for the few operations that read the filesystem directly (repo state detection, hooks listing, .git directory size). Tests inject a mock; real implementation uses `node:fs/promises` for file operations and `Bun.spawn` + `du -sk` for directory sizing (POSIX-only, see [Platform support](#platform-support)).

**Path convention:** All paths passed to `FsReader` methods are **absolute**. For git-internal paths (hooks, state files, git dir size), callers must use `ctx.gitDir` or `ctx.gitPath()` — **never** hardcode `join(repoRoot, ".git", ...)`, which breaks in linked worktrees. For working-tree file paths (e.g., `largestTracked`), resolve against `ctx.repoRoot`. The `CommandExecutor` also receives `cwd: ctx.repoRoot` in its `ExecOptions` to ensure git commands run in the correct directory.

```typescript
// src/executor/types.ts

interface FsReader {
  /** Check if a file or directory exists (absolute path) */
  exists(path: string): Promise<boolean>;
  /** List files in a directory, non-recursive (absolute path) */
  readdir(path: string): Promise<string[]>;
  /** Get file size in bytes (absolute path) */
  fileSize(path: string): Promise<number>;
  /** Get directory size in KiB, wraps du -sk (absolute path) */
  dirSizeKiB(path: string): Promise<number>;
}
```

**Why two interfaces?** The data model table (below) marks each field's I/O source. Most fields use only `CommandExecutor` (git commands). A few use `FsReader`:

| Field | Uses FsReader | Reason |
|-------|:---:|--------|
| `repoState` | ✅ | `exists(await ctx.gitPath("MERGE_HEAD"))`, etc. |
| `hooks` | ✅ | `readdir()` on the effective hooks dir: `core.hooksPath` (resolved) or `await ctx.gitPath("hooks")` |
| `gitDirSizeKiB` | ✅ | `dirSizeKiB(ctx.gitDir)` |
| `largestTracked` | ✅ | `fileSize(join(repoRoot, filePath))` per tracked file |

Everything else is pure `CommandExecutor`.

### Mock helpers for tests

```typescript
// src/executor/mock-executor.ts

function createMockExecutor(
  responses: Map<string, MockResponse>,
): CommandExecutor {
  return async (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    const match = responses.get(key);
    if (!match) throw new Error(`No mock for: ${key}`);
    return { stdout: match.stdout, stderr: match.stderr ?? "", exitCode: match.exitCode ?? 0 };
  };
}

// src/executor/mock-fs-reader.ts

function createMockFsReader(opts: {
  files?: Map<string, string[]>;   // path → readdir result
  exists?: Map<string, boolean>;   // path → exists result
  fileSizes?: Map<string, number>; // path → fileSize result (bytes)
  sizes?: Map<string, number>;     // path → dirSizeKiB result
}): FsReader { /* ... */ }
```

**Pattern:** Each core function test injects the appropriate mock(s). Most tests only need `createMockExecutor` since they only call git commands. Tests for `repoState`, `hooks`, and `gitDirSizeKiB` additionally inject `createMockFsReader`. Tests for `largestTracked` inject `createMockFsReader` with `fileSizes` to mock per-file `stat` calls.

---

## Collector Framework

### Bootstrap (before collectors run)

Some values are prerequisites for the collector system, not outputs of it. These are resolved **before** any collector runs, in `main.ts` or the command orchestrator:

```typescript
// Resolved at startup, NOT by a collector:
// Bootstrap commands use cwd = --cwd flag value or process.cwd()
// After repoRoot is resolved, all subsequent commands use cwd = repoRoot
const targetDir = opts.cwd ?? process.cwd();

// 1. Bare guard FIRST — git rev-parse --show-toplevel fatals in bare repos,
//    so we must detect and reject bare repos before calling it.
await guardNotBare(exec, targetDir);               // git rev-parse --is-bare-repository (cwd = targetDir); exit if "true"

// 2. Now safe to resolve working tree root and git directory
const repoRoot = await getRepoRoot(exec, targetDir); // git rev-parse --show-toplevel (cwd = targetDir)
const hasHead = await checkHasHead(exec, repoRoot);  // git rev-parse --verify HEAD (cwd = repoRoot)

// IMPORTANT: --absolute-git-dir and --path-format=absolute are required.
// In the main worktree, --git-dir returns ".git" (relative) and --git-path
// returns ".git/hooks" (relative). Only linked worktrees get absolute paths
// by default. Using the absolute variants guarantees absolute paths in both
// layouts, satisfying the FsReader absolute path convention.
const gitDir = await getGitDir(exec, repoRoot);       // git rev-parse --absolute-git-dir (cwd = repoRoot)

// 3. Helper for per-worktree path resolution
//    gitPath("MERGE_HEAD") → absolute path in both main and linked worktrees
//    gitPath("hooks")      → absolute shared hooks dir (same for all worktrees)
const gitPath = async (name: string) =>
  (await exec("git", ["rev-parse", "--path-format=absolute", "--git-path", name], { cwd: repoRoot })).stdout;
```

`repoRoot`, `hasHead`, `gitDir`, and `gitPath` are then passed into `CollectorContext` as pre-computed values. The `meta` collector still *reports* `repoRoot` in its output, but it reads it from `ctx.repoRoot` — it does not re-compute it. All `FsReader` calls resolve paths via `ctx.gitDir` or `ctx.gitPath()` — **never** via hardcoded `join(repoRoot, ".git", ...)`, which breaks in linked worktrees where `.git` is a file. All `CommandExecutor` calls in collectors pass `{ cwd: ctx.repoRoot }` in options.

### Tier model: collector-level gate, field-level branching

Each collector has a `tier` that acts as its **entry gate** — the *minimum* tier required to run the collector at all. The orchestrator skips collectors whose tier is not in `activeTiers`.

Within a collector, individual fields may require a *higher* tier. The collector checks `ctx.activeTiers.has("slow")` internally and omits slow fields when that tier is inactive. This keeps the Collector interface simple (one `tier` field) while allowing mixed-tier sections.

```typescript
// src/commands/collectors/types.ts

type CollectorTier = "instant" | "moderate" | "slow";

interface CollectorContext {
  exec: CommandExecutor;
  fs: FsReader;
  repoRoot: string;              // pre-computed at bootstrap
  gitDir: string;                // pre-computed: git rev-parse --absolute-git-dir (always absolute)
  gitPath: (name: string) => Promise<string>; // git rev-parse --path-format=absolute --git-path <name>
  hasHead: boolean;              // false in empty repos (no commits)
  activeTiers: Set<CollectorTier>;
}

interface Collector<T> {
  name: string;
  tier: CollectorTier;           // minimum tier to START this collector
  collect(ctx: CollectorContext): Promise<T>;
}
```

**Example: logs collector (entry tier = instant, has slow fields)**

```typescript
const logsCollector: Collector<GitLogs> = {
  name: "logs",
  tier: "instant",               // always runs (totalCommits, lastCommit are instant)
  async collect(ctx) {
    const totalCommits = ctx.hasHead
      ? /* git rev-list --count HEAD */ : 0;
    const lastCommit = ctx.hasHead
      ? /* git log -1 ... */ : null;

    // slow fields: only computed when --full is active
    const commitFrequency = ctx.activeTiers.has("slow")
      ? /* git log --format=%ad ... */ : undefined;

    return { totalCommits, totalMerges, firstCommitDate, lastCommit, commitFrequency, conventionalTypes };
  },
};
```

### Tier assignment per collector

| Collector | Entry tier | Has slow fields? |
|-----------|:----------:|:---:|
| meta | instant | no |
| status | instant | no |
| branches | moderate | no |
| logs | instant | yes (`commitFrequency`, `conventionalTypes`) |
| contributors | moderate | yes (`authorStats`) |
| tags | instant | no |
| files | instant | yes (`largestBlobs`, `mostChanged`, `binaryFiles`) |
| config | instant | no |

### Orchestrator (`run-collectors.ts`)

- Filters collectors by entry tier: skip if `!activeTiers.has(collector.tier)`
- Default mode (`activeTiers = {instant, moderate}`): runs all 8 collectors; slow fields within them return `undefined`
- Full mode (`activeTiers = {instant, moderate, slow}`): runs all 8 collectors; slow fields are computed
- All matching collectors run in parallel via `Promise.all`
- Isolates errors: a failing collector produces a `CollectorError` entry, report section falls back to sensible defaults
- Returns `{ results, errors }`

---

## Test Strategy

### Four-Layer Testing

| Layer | Content | Threshold | Husky Stage |
|-------|---------|-----------|-------------|
| **L1 Unit Test** | All core functions, collectors, arg parser, formatters | ≥ 95% line coverage (when coverage data exists; pass-through if no test files or no coverable code — see `check-coverage.ts`) | pre-commit |
| **L2 Lint** | Biome strict (correctness/suspicious/complexity/style all error) | 0 warnings | pre-commit |
| **L3 Typecheck** | `tsc --noEmit` | 0 errors | pre-push |
| **L4 Integration** | `*.integration.test.ts` files in `src/__integration__/`; run manually via `bun test src/__integration__/` | Pass | manual |

### Unit test approach

- **Co-located**: `*.test.ts` alongside source files
- **Framework**: `bun:test` (`describe`, `it`, `expect`)
- **Mock pattern**: `createMockExecutor()` for git commands + `createMockFsReader()` for filesystem access (needed by `repoState`, `hooks`, `gitDirSizeKiB`, and `largestTracked` tests — see [FsReader usage table](#fsreader--filesystem-access))
- **Edge cases**: empty repo, detached HEAD, no remotes, Unicode author names, zero tags, merge-in-progress, Windows-style line endings in git output
- **Integration test isolation**: Integration tests (real git commands, temp repos) live in `src/__integration__/` with `.integration.test.ts` suffix. Isolation is handled via `bunfig.toml` at the package level:

```toml
# apps/gitinfo/bunfig.toml
[test]
pathIgnorePatterns = ["**/__integration__/**"]
```

This ensures both `bun test` (direct) and `check-coverage.ts` (which runs bare `bun test --coverage`) automatically skip integration tests — no CLI flags needed. Integration tests run explicitly via `bun test src/__integration__/`.

### Coverage enforcement

```jsonc
// package.json scripts
"test:ci": "bun run ../../scripts/check-coverage.ts --threshold 95"
```

Runs `bun test --coverage`, parses the "All files" summary line, and fails if line coverage < 95%. **Caveat:** if no coverage data is present (no test files or no coverable code), the script passes through without enforcing the threshold — see `scripts/check-coverage.ts`.

---

## Lint: Biome Strict Override

Add to root `biome.jsonc` overrides array:

```jsonc
{
  "includes": ["apps/gitinfo/**"],
  "linter": {
    "rules": {
      "correctness": { "recommended": true, "all": "error" },
      "suspicious": { "recommended": true, "all": "error" },
      "complexity": { "recommended": true, "all": "error" },
      "style": { "recommended": true, "all": "error" }
    }
  }
}
```

---

## Package Configuration

### `apps/gitinfo/package.json`

```jsonc
{
  "name": "@signoff/gitinfo",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "gitinfo": "./src/main.ts"
  },
  "exports": {
    ".": {
      "types": "./src/commands/types.ts",
      "default": "./src/commands/types.ts"
    }
  },
  "scripts": {
    "dev": "bun run src/main.ts",
    "typecheck": "tsc --noEmit --emitDeclarationOnly false",
    "test": "bun test --pass-with-no-tests",
    "test:ci": "bun run ../../scripts/check-coverage.ts --threshold 95",
    "test:integration": "bun test src/__integration__/",
    "clean": "git clean -xdf .cache .turbo dist node_modules"
  },
  "devDependencies": {
    "@signoff/typescript": "workspace:*",
    "bun-types": "^1.3.1",
    "typescript": "^5.9.3"
  }
}
```

**Zero runtime dependencies.** All git operations via `Bun.spawn`, argument parsing hand-rolled, formatting with template literals + ANSI escape codes.

### `apps/gitinfo/tsconfig.json`

```jsonc
{
  "extends": "@signoff/typescript/internal-package.json",
  "compilerOptions": {
    "types": ["bun-types"]
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

### `apps/gitinfo/bunfig.toml`

```toml
[test]
pathIgnorePatterns = ["**/__integration__/**"]
```

Bun reads `bunfig.toml` from the package's `cwd` automatically. This applies to both direct `bun test` invocations and the shared `check-coverage.ts` script (which runs bare `bun test --coverage` in the package directory).

---

## Implementation Order (Atomic Commits)

| # | Type | Commit Message | Content |
|---|------|---------------|---------|
| 1 | docs | `docs: add gitinfo cli design document` | `docs/cli/01-gitinfo.md`, `docs/cli/README.md`, update `docs/README.md` |
| 2 | feat | `feat: scaffold apps/gitinfo package` | `package.json`, `tsconfig.json`, `bunfig.toml`, empty `src/main.ts`, `bun install` |
| 3 | chore | `chore: add biome strict override for apps/gitinfo` | Root `biome.jsonc` override |
| 4 | feat | `feat(gitinfo): add command executor` | `executor/types.ts`, `bun-executor.ts`, `bun-fs-reader.ts`, `mock-executor.ts`, `mock-fs-reader.ts`, `__integration__/executor.integration.test.ts` |
| 5 | feat | `feat(gitinfo): add cli argument parser` | `cli/args.ts`, `cli/args.test.ts` |
| 6 | feat | `feat(gitinfo): add report type definitions` | `commands/types.ts` |
| 7 | feat | `feat(gitinfo): add parse utilities` | `utils/parse.ts`, `utils/parse.test.ts` |
| 8 | feat | `feat(gitinfo): add core/meta` | `core/meta.ts`, `core/meta.test.ts` |
| 9 | feat | `feat(gitinfo): add core/status` | `core/status.ts`, `core/status.test.ts` |
| 10 | feat | `feat(gitinfo): add core/branches` | `core/branches.ts`, `core/branches.test.ts` |
| 11 | feat | `feat(gitinfo): add core/logs` | `core/logs.ts`, `core/logs.test.ts` |
| 12 | feat | `feat(gitinfo): add core/contributors` | `core/contributors.ts`, `core/contributors.test.ts` |
| 13 | feat | `feat(gitinfo): add core/tags` | `core/tags.ts`, `core/tags.test.ts` |
| 14 | feat | `feat(gitinfo): add core/files` | `core/files.ts`, `core/files.test.ts` |
| 15 | feat | `feat(gitinfo): add core/config` | `core/config.ts`, `core/config.test.ts` |
| 16 | feat | `feat(gitinfo): add collector framework` | `collectors/types.ts`, `run-collectors.ts`, `run-collectors.test.ts` |
| 17 | feat | `feat(gitinfo): add all collectors` | 8 × `*.collector.ts` |
| 18 | feat | `feat(gitinfo): add output formatters` | `cli/output.ts`, `cli/output.test.ts` |
| 19 | feat | `feat(gitinfo): add pretty formatter` | `pretty/format.ts`, `pretty/format.test.ts` |
| 20 | feat | `feat(gitinfo): wire up main entry point` | `src/main.ts` full dispatch |
| 21 | chore | `chore(gitinfo): verify 95% coverage` | Ensure `test:ci` passes |
