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

- Desktop tests require preload mocks (`apps/desktop/test-setup.ts`, loaded via `vitest.config.ts` `setupFiles`)
- `bun run test:coverage` from monorepo root runs each workspace's `test:coverage` script (vitest), enforcing per-package coverage thresholds
- Inside `apps/desktop/` and `packages/local-db/`, tests run via `bun --bun vitest` because of bun:sqlite / electron preload requirements; `test:coverage` in those two packages skips the `--coverage` flag because neither the v8 nor the istanbul vitest provider works under the bun runtime — see the comment block in their `vitest.config.ts`. Coverage is enforced by the other packages (gitinfo, pulse, shared, workspace-fs).
- Husky pre-commit runs `bun run test:coverage` (vitest with coverage gate)

## Retrospective

### 2024-03-24: PR Cache SQLite Migration

**Migration runner 只执行了第一个文件**
- `initLocalDb()` 硬编码了 `0000_plain_kabuki.sql`，后续 migration（0001、0002）从未执行，导致运行时 `no such table: pull_requests`。
- 修复：改为 `readdirSync` 扫描整个 `drizzle/` 目录，按文件名排序执行所有 `.sql`。

**幂等 migration catch 不全**
- `ALTER TABLE ADD COLUMN` 重复执行时 SQLite 报 `"duplicate column name"`，但 catch 只过滤了 `"already exists"`，导致 app 启动崩溃。
- 教训：SQLite 的幂等错误模式不止一种，`CREATE` 系列报 `already exists`，`ALTER ADD COLUMN` 报 `duplicate column name`。两者都要 catch。

**Drizzle better-sqlite3 `db.transaction()` 用法**
- 回调必须接收 `tx` 参数，内部操作用 `tx` 而非外层 `db`，否则写操作在事务外执行且回调行为异常。
- `db.transaction((tx) => { upsertPrs(tx, ...); })` 才是正确写法。

**PrDetailPanel null detail 状态遗漏**
- `hasSelection=true` + `detail=null` + `isLoading=false` + `error=null`（mutation 在飞但还没 settle）这个状态没被任何 early return 捕获，导致 `detail as PrDetail` 解引用 null crash。
- 教训：穷举所有状态组合，不要用 `as` 强转绕过 null check。
