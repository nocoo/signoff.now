# signoff.now

Local-first workspace tooling, under large-scale rewrite.

> **Status:** Electron desktop has been retired. A Vite + React web frontend is being bootstrapped. Product requirements will be re-scoped next.

## Stack (target)

| Layer | Choice |
|:------|:-------|
| Package manager | Bun workspaces + Turborepo |
| Frontend | Vite + React + TypeScript 7 |
| Lint / format | Biome |
| Design | Basalt design template (3-tier luminance) |

## Workspace layout

```
apps/
  web/         # Vite SPA (primary UI)
  gitinfo/     # Git repo collector CLI (legacy, may be re-scoped)
  pulse/       # GitHub PR data CLI (legacy, may be re-scoped)
packages/      # Shared libraries (legacy, may be re-scoped)
docs/          # Active docs + archive/
```

## Commands

```bash
bun install
bun run dev      # turbo dev (web SPA)
bun run build
bun run lint
bun run typecheck
bun run test
```

## Docs

See [docs/](./docs/) for the index. Electron-era design docs live under [docs/archive/](./docs/archive/).
