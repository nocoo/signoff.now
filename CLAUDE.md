# signoff.now

Desktop-first Electron workspace tool, trimmed from internal "superset" codebase.
Integrates terminal, code editor (CodeMirror 6), Git diff viewer, and file explorer.

## Tech Stack

- **Monorepo**: Turborepo + Bun workspaces (`bun@1.3.6`)
- **App**: Electron 40 + electron-vite (3 targets: main, preload, renderer)
- **Frontend**: React 19, TanStack Router (file-based), Zustand, Tailwind v4
- **IPC**: tRPC over Electron IPC (`trpc-electron`)
- **DB**: better-sqlite3 + Drizzle ORM (local-only, WAL mode)
- **Terminal**: node-pty + xterm.js (daemon architecture: host → subprocess per PTY)
- **Editor**: CodeMirror 6 (multi-language)
- **Lint/Format**: Biome 2.4
- **Test**: `bun test` (per-workspace via turbo)
- **CI**: GitHub Actions

## Workspace Layout

```
apps/desktop/          # Electron app (sole app)
packages/ui/           # shadcn/radix component library
packages/local-db/     # SQLite schema (Drizzle ORM)
packages/shared/       # Constants, types, utilities
packages/workspace-fs/ # Filesystem abstraction (host/server)
tooling/typescript/    # Shared tsconfig presets
```

## Commands

```bash
bun run dev            # Electron dev mode (electron-vite dev)
bun run build          # Production build
bun test               # Run all tests via turbo
bun run lint           # Biome check
bun run lint:fix       # Biome check --write --unsafe
bun run typecheck      # tsc --noEmit + turbo typecheck
bun run db:generate:desktop  # Drizzle schema generation
```

## Architecture Notes

- tRPC routers live at `apps/desktop/src/lib/trpc/routers/` (shared between main/renderer)
- 12 routers: window, projects, workspaces, terminal, changes, filesystem, settings, config, menu, hotkeys, external, autoUpdate
- Renderer restricted: no `node:*` imports, no `@signoff/workspace-fs/host` or `/server` (enforced by Biome)
- Terminal uses 3-tier process model: main → terminal-host daemon → pty-subprocess per session
- App state persisted via lowdb (`app-state.json`), window bounds via `window-state.json`
- Custom protocols: `signoff-icon://` (project icons), `signoff-font://` (system fonts for terminal/editor)
- Design docs in `docs/architecture/`

## Native Module Rebuild

`better-sqlite3` must be compiled against Electron's Node headers (not Bun's).
`bun install` automatically rebuilds via `postinstall` → `scripts/rebuild-native.sh`.

If the rebuild fails or you need to run it manually: `bash scripts/rebuild-native.sh`

Symptoms of stale build: `ERR_DLOPEN_FAILED` with `NODE_MODULE_VERSION` mismatch (Bun=137, Electron 40=143).
`node-pty` uses prebuilds and does NOT need rebuilding.

## Test Notes

- Desktop tests require preload mocks (`apps/desktop/test-setup.ts` via `bunfig.toml`)
- Running `bun test` from monorepo root skips mock-dependent tests gracefully (`describe.if`)
- Running `bun test` from `apps/desktop/` runs full suite with mocks
- Husky pre-commit runs `turbo test:ci` (per-workspace, with preload)

## Retrospective
