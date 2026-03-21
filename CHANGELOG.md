# Changelog

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
