# signoff.now

Local-first workspace tooling monorepo.

## First-class CLIs

| Tool | Package | Docs |
|:-----|:--------|:-----|
| **gitinfo** | `@signoff/gitinfo` | [docs/cli/gitinfo.md](./docs/cli/gitinfo.md) |
| **pulse** | `@signoff/pulse` | [docs/cli/pulse.md](./docs/cli/pulse.md) |

```bash
bun install

# Local git insight
bun run apps/gitinfo/src/main.ts --help
bun run apps/gitinfo/src/main.ts meta --pretty

# GitHub collaboration data (requires `gh auth login`)
bun run apps/pulse/src/main.ts --help
bun run apps/pulse/src/main.ts repo --pretty
```

## Web frontend

Vite + React SPA at `apps/web` (hello-world scaffold; product requirements TBD).

```bash
bun run dev   # http://localhost:7010
```

## Workspace layout

```
apps/
  gitinfo/     # Local git repository insight CLI
  pulse/       # GitHub PR / repo data CLI
  web/         # Vite SPA
packages/      # Shared libraries (may be re-scoped)
docs/
  cli/         # Active CLI documentation
  archive/     # Historical design docs
```

## Commands

```bash
bun run test
bun run test:coverage
bun run lint
bun run typecheck
bun run dev          # web SPA
bun run dev:all      # all workspace dev scripts
```

## Docs

- Active: [docs/cli/](./docs/cli/)
- Archive: [docs/archive/](./docs/archive/)
