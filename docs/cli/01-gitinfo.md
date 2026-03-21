# 01 — gitinfo CLI

## Overview

`gitinfo` is a CLI tool that provides comprehensive information about a local git repository. It collects metadata, branch info, commit history, contributor stats, file statistics, working tree status, tags, and git configuration — using only git commands and OS-native CLI tools (zero npm runtime dependencies).

**Key design goals:**

- **JSON-first** — Default output is compact JSON (pipeable to `jq`/`gron`), `--pretty` for human-readable terminal output
- **Performance-tiered** — Instant and moderate commands run by default; slow commands opt-in via `--full`
- **Testable** — Command executor dependency injection; all core functions are pure and independently testable
- **Bun-only** — Leverages Bun.spawn for subprocess execution; runs directly as TypeScript

### Scope

Supports **standard non-bare working tree repositories only**. The following layouts are explicitly unsupported:

- Bare repositories (`git init --bare`)
- Separate git-dir layouts (`--git-dir` / `GIT_DIR` pointing elsewhere)
- Git worktrees (`git worktree add`) — the tool runs against the repo it's invoked in, but does not traverse or aggregate across linked worktrees

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

# Branch info with slow fields (stale detection, etc.)
gitinfo branches --full

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
│  Collectors Layer                                   │
│  src/commands/collectors/*.collector.ts              │
│  Orchestrate core functions into typed sections      │
│  run-collectors.ts: parallel execution + error      │
│  isolation per collector                            │
└────────────────────┬────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────┐
│  Core Layer                                         │
│  src/commands/core/*.ts                             │
│  Pure functions: one git command → one typed result  │
│  Each accepts CommandExecutor via dependency         │
│  injection                                          │
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
└── src/
    ├── main.ts                           # #!/usr/bin/env bun — entry point
    ├── cli/
    │   ├── args.ts                       # Argument parser (zero-dep, hand-rolled)
    │   ├── args.test.ts
    │   ├── output.ts                     # JSON + pretty formatters
    │   └── output.test.ts
    ├── executor/
    │   ├── types.ts                      # CommandExecutor interface + ExecResult
    │   ├── bun-executor.ts               # Real implementation via Bun.spawn
    │   ├── bun-executor.test.ts          # Integration test (runs real git --version)
    │   └── mock-executor.ts              # Deterministic fake for unit tests
    ├── commands/
    │   ├── types.ts                      # GitInfoReport + all section interfaces
    │   ├── core/
    │   │   ├── meta.ts                   # Repo root, name, remotes, HEAD, git version
    │   │   ├── meta.test.ts
    │   │   ├── status.ts                 # Working tree: staged/modified/untracked, repo state
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
    │   │   ├── config.ts                 # .git size, objects, hooks, stash, worktrees, config
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
| `repoRoot` | `string` | instant | `git rev-parse --show-toplevel` |
| `repoName` | `string` | instant | derived from root path or remote URL |
| `head` | `string` | instant | `git rev-parse HEAD` |
| `headShort` | `string` | instant | `git rev-parse --short HEAD` |
| `currentBranch` | `string \| null` | instant | `git symbolic-ref --short HEAD` (null if detached) |
| `defaultBranch` | `string \| null` | instant | `git symbolic-ref refs/remotes/origin/HEAD` → strip `refs/remotes/origin/` prefix; null if no remote or origin/HEAD not set |
| `remotes` | `GitRemote[]` | instant | `git remote -v` |
| `isShallow` | `boolean` | instant | `git rev-parse --is-shallow-repository` |
| `isBare` | `boolean` | instant | `git rev-parse --is-bare-repository` |
| `createdAt` | `string` | instant | `git log <root-commit> -1 --format=%aI` |

### Section: Status

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `staged` | `GitStatusEntry[]` | instant | `git status --porcelain=v2` |
| `modified` | `GitStatusEntry[]` | instant | `git status --porcelain=v2` |
| `untracked` | `string[]` | instant | `git status --porcelain=v2` |
| `conflicted` | `string[]` | instant | `git status --porcelain=v2` |
| `stashCount` | `number` | instant | `git stash list \| wc -l` |
| `repoState` | `RepoState` | instant | check `.git/MERGE_HEAD`, `.git/rebase-merge`, etc. |

### Section: Branches

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `current` | `string \| null` | instant | `git branch --show-current` |
| `local` | `GitBranchInfo[]` | moderate | `git for-each-ref --format=... refs/heads/` |
| `remote` | `string[]` | moderate | `git branch -r --format=...` |
| `totalLocal` | `number` | instant | `git branch --format=... \| wc -l` |
| `totalRemote` | `number` | instant | `git branch -r --format=... \| wc -l` |

`GitBranchInfo` includes: `name`, `upstream`, `aheadBehind`, `lastCommitDate`, `isMerged`.

### Section: Logs

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `totalCommits` | `number` | instant | `git rev-list --count HEAD` |
| `totalMerges` | `number` | instant | `git rev-list --merges --count HEAD` |
| `firstCommitDate` | `string` | instant | `git log <root-commit> -1 --format=%aI` |
| `lastCommit` | `GitCommitSummary` | instant | `git log -1 --format=...` |
| `commitFrequency` | `CommitFrequency` | **slow** | `git log --format=%ad --date=format:...` |
| `conventionalTypes` | `Record<string, number>` | **slow** | `git log --format=%s` + regex parse |

### Section: Contributors

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `authors` | `GitAuthorSummary[]` | moderate | `git shortlog -sne --no-merges` |
| `totalAuthors` | `number` | moderate | derived from authors |
| `activeRecent` | `number` | moderate | `git shortlog -sne --since='90 days ago'` |
| `authorStats` | `GitAuthorStats[]` | **slow** | `git log --numstat --pretty=tformat:'%aN'` |

### Section: Tags

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `count` | `number` | instant | `git tag -l \| wc -l` |
| `tags` | `GitTagInfo[]` | moderate | `git for-each-ref --format=... refs/tags/` |
| `latestTag` | `string \| null` | instant | `git describe --tags --abbrev=0` |
| `commitsSinceTag` | `number \| null` | instant | `git rev-list <tag>..HEAD --count` |

### Section: Files

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `trackedCount` | `number` | instant | `git ls-files \| wc -l` |
| `typeDistribution` | `Record<string, number>` | moderate | `git ls-files` + extension parse |
| `totalLines` | `number` | moderate | `git ls-files -z \| xargs -0 wc -l` |
| `largestTracked` | `FileSizeInfo[]` | moderate | `git ls-files -z \| xargs -0 wc -c \| sort -rn` |
| `largestBlobs` | `GitBlobInfo[]` | **slow** | `git rev-list --objects --all \| git cat-file --batch-check` |
| `mostChanged` | `GitFileChurn[]` | **slow** | `git log --pretty=format: --name-only \| sort \| uniq -c` |
| `binaryFiles` | `string[]` | **slow** | `git diff --numstat $(git hash-object -t tree /dev/null) HEAD --` → lines with `-\t-` prefix are binary |

### Section: Config

| Field | Type | Tier | Git Command |
|-------|------|------|-------------|
| `gitDirSizeKiB` | `number` | instant | `du -sk .git` → parse first field as KiB integer |
| `objectStats` | `GitObjectStats` | instant | `git count-objects -v` |
| `worktreeCount` | `number` | instant | `git worktree list \| wc -l` |
| `hooks` | `string[]` | instant | `ls .git/hooks/ \| grep -v .sample` or custom `hooksPath` |
| `localConfig` | `Record<string, string[]>` | instant | `git config --local --list` → group by key; values array to preserve multi-value keys |

---

## Performance Tiers

| Tier | Latency | Behavior | Example Data |
|------|---------|----------|-------------|
| **instant** | < 100ms | Always run | git version, HEAD, commit count, status, stash |
| **moderate** | 100ms–2s | Default on | branch details, shortlog, tag details, file type dist |
| **slow** | 2s–30s+ | Opt-in (`--full`) | per-author LOC, largest blobs in history, file churn, commit frequency |

### Mitigation strategies for slow commands

1. **Parallel execution** — All collectors run concurrently via `Promise.all`
2. **Tier gating** — Slow fields are `undefined` unless `--full` is active
3. **Limit by default** — Slow commands use `-n 1000` or `--since='1 year ago'`
4. **Early exit** — Check `git rev-list --count HEAD`; if > 50k, warn for expensive ops

---

## Executor Interface

The dependency injection boundary. Real implementation uses `Bun.spawn`; tests inject a mock that returns deterministic output.

```typescript
// src/executor/types.ts

interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;          // default 30_000
  env?: Record<string, string>;
}

interface ExecResult {
  stdout: string;              // trimmed
  stderr: string;              // trimmed
  exitCode: number;
}

type CommandExecutor = (
  cmd: string,
  args: readonly string[],
  opts?: ExecOptions,
) => Promise<ExecResult>;
```

### Mock executor for tests

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
```

**Pattern:** Each core function test creates a mock executor with hardcoded git stdout for that specific command, then asserts the parsed output. No filesystem or network access required.

---

## Collector Framework

```typescript
// src/commands/collectors/types.ts

type CollectorTier = "instant" | "moderate" | "slow";

interface CollectorContext {
  exec: CommandExecutor;
  repoRoot: string;
  activeTiers: Set<CollectorTier>;
}

interface Collector<T> {
  name: string;
  tier: CollectorTier;         // minimum tier to run
  collect(ctx: CollectorContext): Promise<T>;
}
```

### Orchestrator (`run-collectors.ts`)

- Filters collectors by active tier
- Runs all matching collectors via `Promise.all`
- Isolates errors: a failing collector produces a `CollectorError` entry, report section falls back to sensible defaults
- Returns `{ results, errors }`

---

## Test Strategy

### Four-Layer Testing

| Layer | Content | Threshold | Husky Stage |
|-------|---------|-----------|-------------|
| **L1 Unit Test** | All core functions, collectors, arg parser, formatters | ≥ 95% line coverage | pre-commit |
| **L2 Lint** | Biome strict (correctness/suspicious/complexity/style all error) | 0 warnings | pre-commit |
| **L3 Typecheck** | `tsc --noEmit` | 0 errors | pre-push |
| **L4 Integration** | `bun-executor.test.ts` runs real `git --version`; optional e2e in temp repo | Pass | manual |

### Unit test approach

- **Co-located**: `*.test.ts` alongside source files
- **Framework**: `bun:test` (`describe`, `it`, `expect`)
- **Mock pattern**: `createMockExecutor()` with pre-programmed `Map<commandString, response>`
- **Edge cases**: empty repo, detached HEAD, no remotes, Unicode author names, zero tags, merge-in-progress, Windows-style line endings in git output

### Coverage enforcement

```jsonc
// package.json scripts
"test:ci": "bun run ../../scripts/check-coverage.ts --threshold 95"
```

Runs `bun test --coverage`, parses "All files" line, fails if line coverage < 95%.

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

---

## Implementation Order (Atomic Commits)

| # | Type | Commit Message | Content |
|---|------|---------------|---------|
| 1 | docs | `docs: add gitinfo cli design document` | `docs/cli/01-gitinfo.md`, `docs/cli/README.md`, update `docs/README.md` |
| 2 | feat | `feat: scaffold apps/gitinfo package` | `package.json`, `tsconfig.json`, empty `src/main.ts`, `bun install` |
| 3 | chore | `chore: add biome strict override for apps/gitinfo` | Root `biome.jsonc` override |
| 4 | feat | `feat(gitinfo): add command executor` | `executor/types.ts`, `bun-executor.ts`, `mock-executor.ts`, `bun-executor.test.ts` |
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
