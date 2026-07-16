# CLI Tools

First-class CLI packages in the signoff.now monorepo. Both are Bun-native TypeScript tools with JSON-first output.

| Tool | Package | Description |
|:-----|:--------|:------------|
| [gitinfo](./gitinfo.md) | `@signoff/gitinfo` | Local git repository insight (metadata, branches, status, logs, contributors, tags, files, config) |
| [pulse](./pulse.md) | `@signoff/pulse` | Remote GitHub collaboration data (PRs, detail, diff, search, repo) |

## Quick start

```bash
# From monorepo root
bun run apps/gitinfo/src/main.ts --help
bun run apps/pulse/src/main.ts --help

# Or via package scripts
bun run --cwd apps/gitinfo dev -- --help
bun run --cwd apps/pulse dev -- --help
```

## Shared conventions

| Concern | Convention |
|:--------|:-----------|
| Runtime | Bun (`#!/usr/bin/env bun`) |
| Default output | Compact JSON (stdout) |
| Human output | `--pretty` |
| Errors | stderr + non-zero exit |
| Target dir | `--cwd <path>` (default: process cwd) |
| Platform | macOS and Linux only |
| Lint | Biome (`--error-on-warnings`) |
| Tests | Vitest unit tests + coverage thresholds |

## Historical drafts

Earlier design iterations live under [`docs/archive/cli-history/`](../archive/cli-history/) and desktop-era PR UI notes under [`docs/archive/cli-desktop/`](../archive/cli-desktop/). Prefer the docs in this directory as the source of truth.
