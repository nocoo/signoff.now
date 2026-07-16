# gitinfo CLI

Local git repository insight. Collects metadata, branches, working-tree status, commit history, contributors, tags, file statistics, and git configuration — using git and POSIX utilities only (no npm runtime dependencies).

| | |
|:--|:--|
| **Package** | `@signoff/gitinfo` |
| **Entry** | `apps/gitinfo/src/main.ts` |
| **Version** | from `apps/gitinfo/package.json` |
| **Platform** | macOS / Linux |

---

## Prerequisites

- [Bun](https://bun.sh) (workspace package manager)
- `git` on `PATH`
- POSIX tools used by collectors: `du`, `wc` (standard on macOS/Linux)

---

## Install & run

```bash
# From monorepo root
bun install

# Help / version
bun run apps/gitinfo/src/main.ts --help
bun run apps/gitinfo/src/main.ts --version

# Via package script
bun run --cwd apps/gitinfo dev -- meta --pretty
```

The `bin` field maps `gitinfo` → `./src/main.ts` when linked as a workspace binary.

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
# Full report (JSON)
bun run apps/gitinfo/src/main.ts

# Pretty full report
bun run apps/gitinfo/src/main.ts --pretty

# Single section
bun run apps/gitinfo/src/main.ts branches
bun run apps/gitinfo/src/main.ts contributors --full

# Against another repo
bun run apps/gitinfo/src/main.ts --cwd /path/to/repo meta

# Pipe to jq
bun run apps/gitinfo/src/main.ts | jq '.meta.remotes'
bun run apps/gitinfo/src/main.ts contributors | jq '.authors | sort_by(-.commits) | .[0:5]'
```

---

## Architecture

```
CLI (main.ts)
  → parseArgs / output
  → bootstrap (repo root, hasHead, gitDir, gitPath)
  → collectors (tiered: instant | moderate | slow)
  → CommandExecutor + FsReader (DI; Bun impl in production, mocks in tests)
```

| Layer | Path | Role |
|:------|:-----|:-----|
| CLI | `src/cli/` | argv parsing, JSON/pretty output |
| Collectors | `src/commands/collectors/` | section orchestration + tier selection |
| Core | `src/commands/core/` | pure git parsing / aggregation |
| Pretty | `src/commands/pretty/` | human-readable formatters |
| Executor | `src/executor/` | `CommandExecutor`, `FsReader` abstractions |
| Utils | `src/utils/parse.ts` | NUL-delimited and line parsers |

### Design rules

1. **JSON-first** — compact JSON by default; `--pretty` for terminals.
2. **Tiered collection** — instant/moderate always; slow only with `--full`.
3. **Dependency injection** — all git/fs I/O goes through `CommandExecutor` / `FsReader`.
4. **NUL-delimited git I/O** — prefer `-z` flags where available so paths with spaces/newlines stay unambiguous.
5. **Worktree-safe** — resolve git dir via `git rev-parse --absolute-git-dir` / `--git-path` (never hardcode `.git/...`).

### Scope

| Supported | Not supported |
|:----------|:--------------|
| Standard non-bare working trees | Bare repos (`git init --bare`) |
| Linked worktrees (`git worktree add`) | Separate `GIT_DIR` layouts |
| Empty repos (no commits) — zero values, no crash | Windows |

Empty repo: sections that need history return null/0/`[]`; `meta` / `status` / `branches` / `config` / non-slow `files` still produce useful data.

---

## Output model

Full report shape (`GitInfoReport`):

```ts
{
  generatedAt: string;       // ISO 8601
  tiers: CollectorTier[];    // "instant" | "moderate" | "slow"
  durationMs: number;
  meta: GitMeta;
  status: GitStatus;
  branches: GitBranches;
  logs: GitLogs;
  contributors: GitContributors;
  tags: GitTags;
  files: GitFiles;
  config: GitConfig;
  errors: CollectorError[];  // per-collector failures (non-fatal)
}
```

Single-section mode prints **only that section object** (not the full wrapper), except when pretty mode formats a human view.

### Sections (summary)

| Section | Highlights |
|:--------|:-----------|
| `meta` | git version, root, HEAD, branch, remotes, shallow, first commit date |
| `status` | staged / modified / untracked / conflicted, stash count, repo state (merge/rebase/…) |
| `branches` | current, local (+ upstream, ahead/behind, merged), remote names |
| `logs` | total commits/merges, last commit; with `--full`: frequency, conventional types |
| `contributors` | authors by commit count; with `--full`: per-author LOC added/deleted |
| `tags` | count, list (annotated/lightweight), latest reachable, commits since tag |
| `files` | tracked count, extension distribution, line counts, largest files; with `--full`: blobs, churn, binaries |
| `config` | git-dir size, object stats, worktree count, hooks, local config |

Authoritative TypeScript definitions: `apps/gitinfo/src/commands/types.ts`.

---

## Exit codes

| Code | Meaning |
|:-----|:--------|
| `0` | Success |
| `1` | Usage error, bare repo, or other operational failure |
| `128` | Not a git repository |

---

## Development

```bash
cd apps/gitinfo

bun run typecheck
bun run lint
bun run test
bun run test:coverage
bun run test:integration   # real git/pwd via bun-executor
```

Coverage thresholds (vitest): statements/functions/lines ≥ 97%, branches ≥ 85%.

### Library exports

Other packages can import collectors/types without spawning a process:

| Export | Path |
|:-------|:-----|
| `.` | command types |
| `./executor` | executor types |
| `./collectors` | collector types |
| `./collectors/run` | `runCollectors` |
| `./collectors/all` | collector registry |
| `./defaults` | empty section defaults |

---

## Related

- [CLI index](./README.md)
- [pulse](./pulse.md) — remote GitHub data for the same repo
