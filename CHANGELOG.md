# Changelog

## v0.3.0 — 2026-09-23

### Features

- Add a local Azure DevOps PR workbench with shared web/CLI watches, explicit repository discovery, independent lifecycle/check refreshes, and cached queries.
- Add configurable repository state machines, versioned rules, interactive graphs, and replay from retained provider evidence.
- Evaluate watched PR readiness through Jev in the background daemon, with editable policy instructions, per-PR evidence caching, and distinct review-needed status.
- Add PR collections with persistent filters, sorting, pagination, and bulk membership actions.
- Rebuild Insights around 90-day contributor and repository reports, with a global Calculate action and separate smart/deep discovery tasks per repository.
- Add author following from PR details, contributor profile cards with Follow/Hide actions, seven-day avatar caching, and bulk team member selection.

### Fixes and performance

- Index collector leases, watched PR identities, and report queries; expire completed collection history in bounded batches without deleting cached PRs.
- Preserve watches across repository renames and scope edits, reject stale publication, and retain visible rows during follow/hide/watch updates and connection recovery.
- Distinguish missing reviews, unmet policies, unresolved discussions, expired builds, and deferred final gates in readiness decisions; send Jev requests through the TypeScript SDK.
- Fix avatar registration conflicts that interrupted PR publication, modal picker scrolling and narrow-screen menus, long contributor names, and responsive PR tables.
- Derive frontend, API, and SignOff CLI runtime versions from the root manifest.

### Deployment

- Apply pending D1 migrations before deploying the matching Worker and frontend. This release includes migrations through `0044_avatar_cache.sql`.
- Migration `0041_repository_discovery_depth.sql` cancels existing discovery jobs so subsequent requests use the new repository/depth scope. Existing watches and cached PRs are retained.
- Real ADO collection remains local; GitHub workbench collection is not included in this release.

## v0.2.0 — 2026-09-13

### Maintenance

- Upgrade the Bun runtime contract and all compatible direct workspace dependencies, including React, Vite, Vitest, Wrangler, Hono, Jose, Zod, Commander, Tailwind CSS, Turbo, and development types.
- Keep Biome on 2.4.16 because 2.5 changes the configured nursery rule schema and requires a separate repository-wide lint migration.

### Accessibility

- Expose Settings validation, label inline controls, remove the duplicate mobile save action, and give repeated entity actions unique accessible names.
- Add accessible heatmap and activity-chart values and preserve readable text contrast for user-selected tag colours.

## v0.1.0 — 2026-09-13

### Features

- Adopt the official `@nocoo/basalt` 2.1.7 package, Tailwind token contract, application shell, navigation, controls, surfaces, statistics cards, and heatmap palette.
- Preserve responsive navigation, theme preferences, form accessibility, and entity workflows through application-owned adapters backed by Basalt components.

### Maintenance

- Remove copied UI primitives and their direct Radix dependencies.
- Update the Web architecture guide and project technology overview for package-based Basalt consumption.

## v0.0.1 — 2026-03-22

Bootstrap release. Desktop-first Electron app trimmed from superset codebase.

### Features

- **Monorepo scaffold** — Bun workspaces + Turborepo + Biome + Husky
- **Desktop app** — Electron 40 + electron-vite (main/preload/renderer)
- **tRPC IPC** — 12 routers (window, projects, workspaces, terminal, changes, filesystem, settings, config, menu, hotkeys, external, autoUpdate)
- **Local database** — better-sqlite3 + Drizzle ORM (WAL mode, migrations)
- **Terminal** — node-pty daemon with xterm.js renderer
- **Code editor** — CodeMirror 6 (multi-language)
- **Diff viewer** — Git integration with @pierre/diffs
- **File explorer** — Filesystem router with workspace-fs
- **Layout system** — Mosaic layout with tab management, resizable sidebars
- **Settings** — User preferences system
- **Keyboard shortcuts** — Configurable hotkey system
- **Sidebar stores** — Zustand-based project/workspace navigation

### Packages

- `@signoff/ui` — shadcn/radix component library
- `@signoff/local-db` — SQLite schema (Drizzle ORM)
- `@signoff/shared` — Constants, types, utilities
- `@signoff/workspace-fs` — Filesystem abstraction

### Infrastructure

- GitHub Actions CI workflow
- Husky pre-commit with turbo test:ci
- 925 tests passing across 38 files

### Bug Fixes

- Fix preload script path and CJS/ESM compatibility
- Fix factory routers wiring into createAppRouter
- Fix preload ipcRenderer.on listener leak
- Fix renderer publicDir for theme-boot.js
- Fix electron mock tests when preload is unavailable
