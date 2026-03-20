# 01 — Bootstrap from Superset Architecture

## Overview

Bootstrap signoff.now as a **desktop-first** Electron application, inheriting the monorepo structure and core architecture from the [superset](https://github.com/superset-sh/superset) reference project. The goal is a lean local-only app with **workspace**, **terminal**, **code editor**, **diff viewer**, **layout system**, and **settings** — without cloud services, mobile, tasks, or OS metrics.

### Design Principles

1. **Monorepo parity** — Keep the same workspace/tooling structure so future upstream merges are painless
2. **Local-first** — No cloud DB, no Electric SQL sync, no remote auth; all data lives in local SQLite
3. **Minimal surface** — Only bring in packages and dependencies that serve the core feature set
4. **Same conventions** — File naming, routing tokens, tRPC IPC pattern, Zustand stores all follow superset patterns

---

## 1. Monorepo Structure

Mirror superset's top-level layout exactly, but with a reduced set of apps and packages:

```
signoff.now/
├── apps/
│   └── desktop/                 # Electron app (only app for now)
├── packages/
│   ├── ui/                      # shadcn/radix component library
│   ├── local-db/                # SQLite schema (Drizzle ORM)
│   └── shared/                  # Constants, types, utilities
├── tooling/
│   └── typescript/              # Shared tsconfig presets
├── turbo.jsonc                  # Turborepo pipeline
├── biome.jsonc                  # Linting & formatting
├── package.json                 # Monorepo root (bun workspaces)
├── bunfig.toml                  # Bun configuration
└── bun.lock
```

### What We Keep from Superset

| superset path | signoff.now | Notes |
|:---|:---|:---|
| `apps/desktop/` | `apps/desktop/` | Core app — heavily trimmed |
| `packages/ui/` | `packages/ui/` | Shared UI components (shadcn) |
| `packages/local-db/` | `packages/local-db/` | SQLite schema, stripped of synced tables |
| `packages/shared/` | `packages/shared/` | Constants, types |
| `tooling/typescript/` | `tooling/typescript/` | `base.json`, `electron.json`, `internal-package.json` |
| `turbo.jsonc` | `turbo.jsonc` | Simplified pipeline |
| `biome.jsonc` | `biome.jsonc` | Same lint/format rules |

### What We Remove

| Removed | Reason |
|:---|:---|
| `apps/web/`, `apps/api/`, `apps/admin/` | No cloud web interface |
| `apps/mobile/` | No mobile |
| `apps/marketing/`, `apps/docs/` | Not needed for bootstrap |
| `apps/electric-proxy/`, `apps/streams/` | No Electric SQL sync |
| `packages/db/` | No cloud Postgres |
| `packages/auth/` | No remote auth (local-only) |
| `packages/trpc/` (shared) | Desktop has its own tRPC router internally |
| `packages/chat/` | No AI chat in bootstrap |
| `packages/host-service/` | No multi-org local HTTP service |
| `packages/mcp/`, `packages/desktop-mcp/` | No MCP protocol |
| `packages/macos-process-metrics/` | No OS metrics |
| `packages/email/` | No email |
| `packages/workspace-fs/` | Evaluate later; initially inline filesystem logic in desktop |
| `packages/scripts/` | Evaluate later |
| `Caddyfile.example` | No reverse proxy needed (no Electric SQL streams) |

---

## 2. Root Configuration

### `package.json`

```jsonc
{
  "name": "@signoff/repo",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.3.6",
  "workspaces": ["packages/*", "apps/*", "tooling/*"],
  "devDependencies": {
    "@biomejs/biome": "2.4.2",
    "turbo": "^2.8.7"
  },
  "scripts": {
    "dev": "turbo run dev --filter=@signoff/desktop",
    "build": "turbo build --filter=@signoff/desktop",
    "test": "turbo test",
    "lint": "bunx @biomejs/biome check .",
    "lint:fix": "bunx @biomejs/biome check --write --unsafe .",
    "format": "bunx @biomejs/biome format --write .",
    "typecheck": "turbo typecheck",
    "clean": "git clean -xdf node_modules",
    "clean:workspaces": "turbo clean",
    "db:generate": "bun run --cwd packages/local-db generate"
  }
}
```

### `turbo.jsonc`

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "release/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "lint": {}
  }
}
```

### `biome.jsonc`

Inherit superset's biome config with the critical renderer import restriction:

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.4.2/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "formatter": { "formatWithErrors": true },
  "css": { "parser": { "cssModules": true, "tailwindDirectives": true } },
  "linter": { "rules": { "recommended": true } },
  "overrides": [
    {
      "includes": ["apps/desktop/src/renderer/**"],
      "linter": {
        "rules": {
          "nursery": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "paths": {
                  "node:*": "Renderer code must not import Node.js builtins."
                }
              }
            }
          }
        }
      }
    }
  ]
}
```

### `tooling/typescript/`

Copy directly from superset:
- `base.json` — ES2022, strict, bundler resolution, `noUncheckedIndexedAccess`
- `electron.json` — ESNext target, DOM libs, JSX react-jsx
- `internal-package.json` — `emitDeclarationOnly: true` for packages

---

## 3. Desktop App (`apps/desktop/`)

### Build System

**electron-vite** with 3 targets: `main`, `preload`, `renderer`.

```
apps/desktop/
├── electron.vite.config.ts       # 3-target Vite config
├── electron-builder.yml          # Packaging config
├── package.json
├── tsconfig.json                 # extends @signoff/typescript/electron.json
├── tsr.config.json               # TanStack Router file-based config
├── src/
│   ├── main/                     # Electron main process
│   │   ├── index.ts              # Entry: boot sequence
│   │   ├── windows/main.ts       # BrowserWindow creation
│   │   ├── lib/
│   │   │   ├── local-db/         # SQLite init + Drizzle
│   │   │   ├── terminal/         # PTY session management
│   │   │   ├── trpc/             # tRPC IPC router
│   │   │   ├── app-state/        # Persistent state (lowdb)
│   │   │   ├── window-state/     # Window bounds persistence
│   │   │   └── menu.ts           # Application menu
│   │   ├── terminal-host/
│   │   │   ├── index.ts          # Terminal daemon process
│   │   │   └── pty-subprocess.ts # Per-terminal PTY child
│   │   └── git-task-worker.ts    # Worker thread for git ops
│   ├── preload/
│   │   └── index.ts              # Expose IPC + tRPC channel
│   └── renderer/
│       ├── index.html
│       ├── index.tsx              # React entry
│       ├── routes/               # TanStack Router file-based
│       ├── components/           # App-level components
│       ├── stores/               # Zustand stores
│       └── lib/                  # Client-side utilities
└── resources/                    # Icons, assets
```

### Main Process Entry Points

Keep **3** of superset's 4 entry points (drop host-service):

| Entry | Purpose | Source |
|:---|:---|:---|
| `src/main/index.ts` | Main app — DB init, window creation, menu, tRPC | superset `index.ts` trimmed |
| `src/main/terminal-host/index.ts` | Terminal daemon (separate process) | superset as-is |
| `src/main/terminal-host/pty-subprocess.ts` | PTY child per terminal | superset as-is |

Optional: `git-task-worker.ts` for background git operations.

### Boot Sequence (Simplified from Superset)

```
1. Initialize local SQLite DB (WAL mode, Drizzle migrations)
2. Apply shell environment to process.env
3. Register custom protocol (signoff://) for deep linking
4. Register single instance lock
5. app.whenReady() →
   a. Create BrowserWindow (frameless, traffic lights at {x:16, y:16})
   b. Register tRPC IPC handler
   c. Start terminal daemon
   d. Reconcile terminal sessions
   e. Init auto-updater (optional)
```

### tRPC Router (Desktop IPC)

Trimmed from superset's 27 routers to ~12:

| Router | Purpose | superset origin |
|:---|:---|:---|
| `window` | Window state, minimize, maximize, close | Keep |
| `projects` | CRUD for local projects | Keep |
| `workspaces` | Workspace management | Keep |
| `terminal` | PTY session lifecycle | Keep |
| `changes` | Git diff, stage, commit | Keep |
| `filesystem` | File read, write, watch | Keep |
| `settings` | User preferences | Keep |
| `config` | App configuration | Keep |
| `menu` | Application menu events | Keep |
| `hotkeys` | Keyboard shortcut registration | Keep |
| `external` | Open in external editor | Keep |
| `autoUpdate` | Auto-updater | Keep |

**Removed routers:** `chatRuntimeService`, `chatService`, `analytics`, `browser`, `browserHistory`, `auth`, `cache`, `modelProviders`, `notifications`, `permissions`, `ports`, `resourceMetrics`, `ringtone`, `hostServiceManager`, `uiState`.

### Renderer Architecture

**Provider stack:**

```tsx
<TRPCProvider>                    {/* tRPC + React Query */}
  <ThemeProvider>                  {/* Light/dark mode */}
    {children}
    <ThemedToaster />              {/* sonner notifications */}
  </ThemeProvider>
</TRPCProvider>
```

**Removed from superset:** `PostHogProvider`, `AuthProvider`, `OutlitProvider`.

**Routing (TanStack Router — file-based):**

```
routes/
├── __root.tsx                     # Root layout
├── page.tsx                       # "/" — redirect to last workspace
├── _app/
│   ├── layout.tsx                 # Main app shell (sidebar + content)
│   ├── workspace/
│   │   └── $workspaceId/
│   │       └── page.tsx           # Workspace view (terminal, code, diff)
│   ├── workspaces/
│   │   └── page.tsx               # Workspace list
│   └── project/
│       └── $projectId/
│           └── page.tsx           # Project view
└── settings/
    ├── layout.tsx                 # Settings layout with nav
    ├── appearance/page.tsx        # Theme, font, density
    ├── terminal/page.tsx          # Terminal preferences
    ├── keyboard/page.tsx          # Keyboard shortcuts
    ├── git/page.tsx               # Git preferences
    └── general/page.tsx           # General settings
```

Convention: `page.tsx` = index route, `layout.tsx` = layout wrapper (matches superset's `tsr.config.json`).

**State management (Zustand stores):**

| Store | Purpose | superset origin |
|:---|:---|:---|
| `tabs/` | Tab/pane management (mosaic layout) | Keep |
| `changes/` | Git changes state | Keep |
| `hotkeys/` | Keyboard shortcuts | Keep |
| `theme/` | Dark/light theme | Keep |
| `sidebar-state.ts` | Sidebar collapsed state | Keep |
| `settings-state.ts` | General settings | Keep |
| `file-explorer.ts` | File tree state | Keep |

**Removed:** `chat-preferences/`, `ports/`, `ringtone/`, `workspace-init.ts`, `v2-*.ts`.

---

## 4. Core Features

### 4.1 Workspace System

A workspace = a project directory (optionally a git worktree) with its own set of terminal tabs, code editors, and diff views.

**Data model (SQLite):**

```sql
-- projects: registered git repositories
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  default_branch TEXT DEFAULT 'main',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- workspaces: active workspace sessions
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  worktree_id TEXT REFERENCES worktrees(id),
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  section_id TEXT REFERENCES workspace_sections(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- worktrees: git worktrees per project
CREATE TABLE worktrees (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  path TEXT NOT NULL,
  branch TEXT NOT NULL,
  base_branch TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- workspace_sections: user-created grouping
CREATE TABLE workspace_sections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

### 4.2 Layout System

Inherit superset's **mosaic layout** pattern:

- **Sidebar** (left) — Project list, workspace list, grouped by sections
- **Content area** — Mosaic-based resizable panels
  - Terminal panes
  - Code editor panes (CodeMirror 6)
  - Diff viewer panes
- **Split support** — Horizontal and vertical splits via `react-mosaic-component` + `react-resizable-panels`
- **Tab bar** — Each pane can have multiple tabs

**Key dependencies:**

| Dep | Purpose |
|:---|:---|
| `react-mosaic-component` | Tiling window manager for panes |
| `react-resizable-panels` | Resizable panel system |
| `@dnd-kit/core` | Drag and drop for tabs/panes |

### 4.3 Terminal

Inherit superset's terminal architecture directly:

- **Terminal daemon** runs as a separate Electron process (`terminal-host/index.ts`)
- Each terminal spawns a **PTY subprocess** via `node-pty`
- **Renderer** uses `xterm.js` with WebGL renderer
- Terminal sessions persist across app restarts (reconciliation on boot)
- Tab management via Zustand store

**Key dependencies:**

| Dep | Purpose |
|:---|:---|
| `xterm` 6.x | Terminal emulator UI |
| `@xterm/addon-webgl` | GPU-accelerated rendering |
| `@xterm/addon-fit` | Auto-fit to container |
| `@xterm/addon-search` | Search in terminal |
| `@xterm/addon-ligatures` | Font ligature support |
| `node-pty` | Native PTY for process spawning |

### 4.4 Code Editor

CodeMirror 6 with language support:

| Dep | Purpose |
|:---|:---|
| `@codemirror/view` | Editor view |
| `@codemirror/state` | Editor state |
| `@codemirror/lang-*` | Language modes (javascript, typescript, python, css, html, json, markdown, etc.) |
| `@codemirror/theme-one-dark` | Dark theme |

### 4.5 Diff Viewer

Git diff integration:

- `simple-git` for git operations in main process
- Exposed via tRPC `changes` router
- Renderer displays diffs using CodeMirror merge view or a dedicated diff component
- Supports staging individual hunks / lines
- File tree showing changed files (added, modified, deleted)

### 4.6 Settings

Single-row `settings` table in SQLite (matching superset pattern):

```sql
CREATE TABLE settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  -- Appearance
  theme TEXT DEFAULT 'system',           -- 'light' | 'dark' | 'system'
  font_family TEXT DEFAULT 'JetBrains Mono',
  font_size INTEGER DEFAULT 13,
  -- Terminal
  terminal_font_size INTEGER DEFAULT 13,
  terminal_line_height REAL DEFAULT 1.2,
  terminal_cursor_style TEXT DEFAULT 'block',
  terminal_scrollback INTEGER DEFAULT 10000,
  -- Editor
  editor_tab_size INTEGER DEFAULT 2,
  editor_word_wrap INTEGER DEFAULT 0,
  -- Git
  git_auto_fetch INTEGER DEFAULT 1,
  git_auto_fetch_interval INTEGER DEFAULT 300,
  -- Keyboard
  keybindings_json TEXT DEFAULT '{}',
  -- General
  open_at_login INTEGER DEFAULT 0,
  confirm_on_close INTEGER DEFAULT 1
);
```

---

## 5. Dependency Summary

### `apps/desktop/package.json` (key dependencies)

```jsonc
{
  "name": "@signoff/desktop",
  "dependencies": {
    // Electron
    "electron-updater": "^6.3.0",

    // React + Routing
    "react": "^19.2.0",
    "react-dom": "^19.2.0",
    "@tanstack/react-router": "^1.147.0",
    "@tanstack/react-query": "^5.90.0",

    // State
    "zustand": "^5.0.0",

    // IPC
    "@trpc/server": "^11.7.0",
    "@trpc/client": "^11.7.0",
    "@trpc/react-query": "^11.7.0",
    "trpc-electron": "^3.3.0",

    // Terminal
    "xterm": "^6.1.0-beta.2",
    "@xterm/addon-webgl": "^0.19.0-beta.2",
    "@xterm/addon-fit": "^0.11.0-beta.2",
    "@xterm/addon-search": "^0.16.0-beta.2",
    "@xterm/addon-ligatures": "^0.10.0-beta.2",

    // Editor
    "@codemirror/view": "^6.0.0",
    "@codemirror/state": "^6.0.0",
    "@codemirror/lang-javascript": "^6.0.0",
    // ... more lang-* as needed

    // Git
    "simple-git": "^3.27.0",

    // Layout
    "react-mosaic-component": "^6.1.0",
    "react-resizable-panels": "^3.0.0",
    "@dnd-kit/core": "^6.3.0",

    // Styling
    "tailwindcss": "^4.1.0",
    "framer-motion": "^12.0.0",
    "lucide-react": "^0.500.0",

    // DB
    "better-sqlite3": "^12.6.0",
    "drizzle-orm": "^0.45.0",

    // Validation
    "zod": "^4.3.0",

    // Persistent state
    "lowdb": "^7.0.0",

    // Search
    "fuse.js": "^7.0.0",

    // Internal packages
    "@signoff/ui": "workspace:*",
    "@signoff/local-db": "workspace:*",
    "@signoff/shared": "workspace:*"
  },
  "devDependencies": {
    "electron": "^40.2.1",
    "electron-vite": "^4.0.0",
    "electron-builder": "^26.4.0",
    "vite": "^7.1.0",
    "@tailwindcss/vite": "^4.1.0",
    "drizzle-kit": "^0.30.0",
    "@types/better-sqlite3": "^7.0.0",
    "@signoff/typescript": "workspace:*"
  }
}
```

### Native Modules to Externalize

These must be listed in `electron.vite.config.ts` as externals and bundled separately by electron-builder:

- `better-sqlite3`
- `node-pty`

---

## 6. Atomic Commits Plan

| # | Commit | Scope | Files |
|:---|:---|:---|:---|
| 1 | `chore: init monorepo with bun + turborepo + biome` | Root | `package.json`, `turbo.jsonc`, `biome.jsonc`, `bunfig.toml`, `.gitignore` |
| 2 | `chore: add shared typescript configs` | `tooling/` | `tooling/typescript/{base,electron,internal-package}.json`, `tooling/typescript/package.json` |
| 3 | `feat: add shared package` | `packages/shared` | `packages/shared/{package.json,src/index.ts,tsconfig.json}` |
| 4 | `feat: add local-db package with sqlite schema` | `packages/local-db` | Schema, migrations, Drizzle config |
| 5 | `feat: add ui package with base shadcn setup` | `packages/ui` | `packages/ui/{package.json,src/,tailwind.css,components.json}` |
| 6 | `feat: scaffold desktop app with electron-vite` | `apps/desktop` | Electron config, main entry, preload, renderer shell |
| 7 | `feat: add tRPC IPC layer` | `apps/desktop` | tRPC router, electron-trpc setup, preload bridge |
| 8 | `feat: add terminal system with node-pty + xterm.js` | `apps/desktop` | Terminal daemon, PTY subprocess, xterm renderer |
| 9 | `feat: add workspace and project management` | `apps/desktop` | Zustand stores, tRPC routers, sidebar UI |
| 10 | `feat: add layout system with mosaic panels` | `apps/desktop` | Mosaic layout, tab management, resizable panels |
| 11 | `feat: add code editor with codemirror 6` | `apps/desktop` | CodeMirror integration, language modes |
| 12 | `feat: add diff viewer with git integration` | `apps/desktop` | simple-git, changes router, diff UI |
| 13 | `feat: add settings system` | `apps/desktop` | Settings schema, tRPC router, settings UI pages |
| 14 | `chore: add keyboard shortcuts system` | `apps/desktop` | Hotkeys store, shortcut registration |

---

## 7. Key Architectural Decisions

### Q1: Why keep Electron (not Tauri)?

Superset uses Electron 40 with `node-pty` for native PTY access. Tauri would require rewriting the terminal layer in Rust. Keeping Electron ensures merge compatibility and access to the mature `xterm.js` + `node-pty` stack.

### Q2: Why electron-vite instead of vanilla Vite?

`electron-vite` handles the complexity of bundling 3 targets (main, preload, renderer) with proper externalization of native modules. It's what superset uses, and switching would create merge conflicts.

### Q3: Why TanStack Router instead of React Router?

Superset uses TanStack Router with file-based routing and code splitting. Staying aligned avoids divergence. TanStack Router also integrates tightly with TanStack Query (used for tRPC cache).

### Q4: Why tRPC over Electron IPC?

`trpc-electron` provides type-safe RPC over IPC. The renderer calls main process functions with full TypeScript inference. This is superset's core pattern — the renderer never touches `ipcRenderer.invoke()` directly.

### Q5: Why separate terminal daemon?

Running PTY sessions in the main process would block the event loop. Superset's architecture spawns a dedicated daemon process, which in turn spawns individual PTY subprocesses. This keeps the main process responsive and enables terminal session persistence across app restarts.

### Q6: What about auth?

Bootstrap has **no auth**. The app is local-only. If cloud features are added later, we can bring in `@superset/auth` (better-auth) as a package.

---

## References

- Source: `../superset` (local clone)
- Superset README: https://github.com/superset-sh/superset
- electron-vite docs: https://electron-vite.org
- TanStack Router: https://tanstack.com/router
- tRPC: https://trpc.io
- Drizzle ORM: https://orm.drizzle.team
- xterm.js: https://xtermjs.org
