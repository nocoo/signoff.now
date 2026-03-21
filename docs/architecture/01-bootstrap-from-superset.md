# 01 — Bootstrap from Superset Architecture

## Overview

Bootstrap signoff.now as a **desktop-first** Electron application by **裁剪** superset 参考项目的代码。不是从零搭建，而是直接复制 superset 源码后删除不需要的功能模块，保留 workspace、terminal、code editor、diff viewer、layout system 和 settings。

### Approach: Trim, Not Rewrite

本文档的策略是**裁剪**（trim）而非重写（rewrite）。每一处改动标注为以下两类之一：

- **🟢 Aligned** — 与 superset 结构完全一致，直接复制
- **🔴 Trimmed** — 有意移除的模块/代码，标注移除原因

如未特别标注，默认为 🟢 Aligned。

---

## 1. Monorepo Structure

从 superset 裁剪后保留的目录结构：

```
signoff.now/
├── apps/
│   └── desktop/                 # 🟢 Electron app (唯一 app)
├── packages/
│   ├── ui/                      # 🟢 shadcn/radix component library
│   ├── local-db/                # 🟢 SQLite schema (Drizzle ORM), 删除 synced tables
│   ├── shared/                  # 🟢 Constants, types, utilities
│   └── workspace-fs/            # 🟢 Workspace filesystem abstraction
├── tooling/
│   └── typescript/              # 🟢 Shared tsconfig presets
├── turbo.jsonc                  # 🟢 Turborepo pipeline (裁剪 globalEnv)
├── biome.jsonc                  # 🟢 Linting & formatting (裁剪 mobile 排除项)
├── package.json                 # 🟢 Monorepo root (bun workspaces)
├── bunfig.toml                  # 🟢 Bun configuration
└── bun.lock
```

### What We Keep (🟢 Aligned)

| superset path | signoff.now | Notes |
|:---|:---|:---|
| `apps/desktop/` | `apps/desktop/` | 核心 app — 删除 cloud/chat/analytics/metrics 相关代码 |
| `packages/ui/` | `packages/ui/` | 完整保留 shadcn 组件库 |
| `packages/local-db/` | `packages/local-db/` | 保留 local tables，删除 synced tables |
| `packages/shared/` | `packages/shared/` | 保留 constants, types, hotkeys, terminal-link-parsing |
| `packages/workspace-fs/` | `packages/workspace-fs/` | **必须保留** — `filesystem` router 和 `workspace-fs-service.ts` 直接依赖此包 |
| `tooling/typescript/` | `tooling/typescript/` | `base.json`, `electron.json`, `internal-package.json` |

### What We Remove (🔴 Trimmed)

| Removed | Reason |
|:---|:---|
| `apps/web/`, `apps/api/`, `apps/admin/` | 🔴 No cloud web interface |
| `apps/mobile/` | 🔴 No mobile |
| `apps/marketing/`, `apps/docs/` | 🔴 Not needed for bootstrap |
| `apps/electric-proxy/`, `apps/streams/` | 🔴 No Electric SQL sync |
| `packages/db/` | 🔴 No cloud Postgres |
| `packages/auth/` | 🔴 No remote auth (local-only) |
| `packages/trpc/` (shared) | 🔴 Desktop 内部自带 tRPC router，不需要共享 trpc 包 |
| `packages/chat/` | 🔴 No AI chat |
| `packages/host-service/` | 🔴 No multi-org local HTTP service |
| `packages/mcp/`, `packages/desktop-mcp/` | 🔴 No MCP protocol |
| `packages/macos-process-metrics/` | 🔴 No OS metrics |
| `packages/email/` | 🔴 No email |
| `packages/scripts/` | 🔴 Evaluate later |
| `Caddyfile.example` | 🔴 No reverse proxy needed (no Electric SQL streams) |

---

## 2. Root Configuration

### `package.json`

🟢 Aligned with superset structure, 🔴 trimmed filters to desktop only.

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
    "husky": "^9.0.0",
    "turbo": "^2.8.7"
  },
  "scripts": {
    "dev": "turbo run dev --filter=@signoff/desktop",
    "build": "turbo build --filter=@signoff/desktop",
    "test": "turbo test",
    "test:ci": "turbo test:ci",
    "lint": "bunx @biomejs/biome check .",
    "lint:fix": "bunx @biomejs/biome check --write --unsafe .",
    "format": "bunx @biomejs/biome format --write .",
    "typecheck": "turbo typecheck",
    "prepare": "husky",
    "clean": "git clean -xdf node_modules",
    "clean:workspaces": "turbo clean",
    "db:generate:desktop": "bun run --cwd packages/local-db generate"
  }
}
```

### `turbo.jsonc`

🟢 Aligned structure, 🔴 trimmed `globalEnv` (removed cloud-related env vars).

```jsonc
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "globalPassThroughEnv": ["NODE_ENV", "CI"],
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

🟢 Aligned with superset `biome.jsonc` 的实际配置。以下是裁剪版（移除 mobile 排除项，保留 workspace-fs 限制）：

```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.4.2/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "includes": [
      "**",
      "!**/drizzle",
      "!**/*.template.js",
      "!**/*.template.sh"
    ]
  },
  "formatter": {
    "formatWithErrors": true
  },
  "css": {
    "parser": {
      "cssModules": true,
      "tailwindDirectives": true
    }
  },
  "linter": {
    "rules": {
      "recommended": true
    }
  },
  "overrides": [
    {
      "includes": ["apps/desktop/src/renderer/**"],
      "linter": {
        "rules": {
          "style": {
            "noRestrictedImports": {
              "level": "error",
              "options": {
                "paths": {
                  "@signoff/workspace-fs/host": "Renderer code must stay browser-compatible. Import Node filesystem helpers from the desktop server/host layer instead.",
                  "@signoff/workspace-fs/server": "Renderer code must stay browser-compatible. Import Node filesystem helpers from the desktop server/host layer instead."
                },
                "patterns": [
                  {
                    "group": ["node:*"],
                    "message": "Renderer code must not import Node builtins."
                  }
                ]
              }
            }
          }
        }
      }
    }
  ]
}
```

**与 superset 实际配置的差异：**

- 🔴 `files.includes` 移除了 `!apps/mobile/uniwind-types.d.ts`（无 mobile）
- 🟢 `noRestrictedImports` 挂在 `style` 下（与 superset 一致，不是 `nursery`）
- 🟢 保留 `workspace-fs/host` 和 `workspace-fs/server` 的 renderer 导入限制
- 🟢 保留 `node:*` 模式限制

### `tooling/typescript/`

🟢 Aligned — 直接从 superset 复制：
- `base.json` — ES2022, strict, bundler resolution, `noUncheckedIndexedAccess`
- `electron.json` — ESNext target, DOM libs, JSX react-jsx
- `internal-package.json` — `emitDeclarationOnly: true` for packages

---

## 3. Desktop App (`apps/desktop/`)

### Build System

🟢 Aligned — **electron-vite** with 3 targets: `main`, `preload`, `renderer`.

```
apps/desktop/
├── electron.vite.config.ts       # 🟢 3-target Vite config
├── electron-builder.ts           # 🟢 Packaging config (TypeScript, not yml)
├── package.json
├── tsconfig.json                 # 🟢 extends @signoff/typescript/electron.json
├── tsr.config.json               # 🟢 TanStack Router file-based config
├── src/
│   ├── main/                     # Electron main process
│   │   ├── index.ts              # 🟢 Entry: boot sequence (trimmed)
│   │   ├── windows/main.ts       # 🟢 BrowserWindow creation (trimmed)
│   │   ├── lib/                  # 🟢 Main process subsystems
│   │   │   ├── local-db/         # 🟢 SQLite init + Drizzle
│   │   │   ├── terminal/         # 🟢 PTY session management
│   │   │   ├── app-state/        # 🟢 Persistent state (lowdb)
│   │   │   ├── window-state/     # 🟢 Window bounds persistence
│   │   │   ├── menu.ts           # 🟢 Application menu
│   │   │   └── workspace-runtime/# 🟢 Workspace lifecycle
│   │   ├── terminal-host/
│   │   │   ├── index.ts          # 🟢 Terminal daemon process
│   │   │   └── pty-subprocess.ts # 🟢 Per-terminal PTY child
│   │   └── git-task-worker.ts    # 🟢 Worker thread for git ops
│   ├── preload/
│   │   └── index.ts              # 🟢 Expose IPC + tRPC channel
│   ├── lib/                      # 🟢 Shared between main/renderer
│   │   └── trpc/                 # 🟢 tRPC router 定义 + assembly
│   │       ├── index.ts          # 🟢 router/publicProcedure 定义
│   │       ├── routers/          # 🟢 所有 router 在此目录
│   │       │   ├── index.ts      # 🟢 createAppRouter 组装点
│   │       │   ├── workspace-fs-service.ts  # 🟢 依赖 @signoff/workspace-fs/host
│   │       │   ├── filesystem/   # 🟢 文件系统 router
│   │       │   ├── changes/      # 🟢 Git changes router
│   │       │   ├── terminal/     # 🟢 Terminal router
│   │       │   ├── projects/     # 🟢 Projects router
│   │       │   ├── workspaces/   # 🟢 Workspaces router
│   │       │   ├── settings/     # 🟢 Settings router
│   │       │   ├── config/       # 🟢 Config router
│   │       │   ├── hotkeys/      # 🟢 Hotkeys router
│   │       │   ├── external/     # 🟢 External editor router
│   │       │   ├── auto-update/  # 🟢 Auto-updater router
│   │       │   ├── menu.ts       # 🟢 Menu router
│   │       │   └── window.ts     # 🟢 Window router
│   │       └── workers/          # 🟢 Worker task protocol
│   └── renderer/
│       ├── index.html
│       ├── index.tsx              # 🟢 React entry
│       ├── routes/               # 🟢 TanStack Router file-based
│       ├── screens/              # 🟢 Screen components (workspace views)
│       ├── components/           # 🟢 App-level components
│       ├── stores/               # 🟢 Zustand stores
│       └── lib/                  # 🟢 Client-side utilities
│   └── resources/                # 🟢 Icons, assets (at src/resources/, not root)
│       ├── build/                # 🟢 App icons for electron-builder
│       ├── public/               # 🟢 Static assets served by renderer
│       ├── sounds/               # 🔴 Trimmed (notification ringtones)
│       └── tray/                 # 🟢 System tray icons
└── scripts/                      # 🟢 Build scripts (generate-file-icons, copy-native-modules, etc.)
```

> **注意：** `resources` 在 `package.json` 中声明为 `"resources": "src/resources"`，electron-builder 通过此路径定位打包资源。

**关键路径对齐说明：** tRPC 路径是 `src/lib/trpc/`（不是 `src/main/lib/trpc/`）。这是 superset 的实际结构 — `src/lib/` 位于 main/preload/renderer 的同级目录，使得 main window 可以通过 `import { createAppRouter } from "lib/trpc/routers"` 直接引用，renderer 也可以共享类型定义。

### Main Process Entry Points

🟢 Aligned — 保留 superset 的 3 个入口点（🔴 去掉 `host-service/index.ts`）：

| Entry | Purpose |
|:---|:---|
| `src/main/index.ts` | 🟢 Main app — DB init, window creation, menu |
| `src/main/terminal-host/index.ts` | 🟢 Terminal daemon (separate process) |
| `src/main/terminal-host/pty-subprocess.ts` | 🟢 PTY child per terminal |
| `src/main/git-task-worker.ts` | 🟢 Worker thread for git operations |

### Boot Sequence

🟢 Aligned with superset `src/main/index.ts`，🔴 trimmed cloud/analytics steps：

```
1. Initialize local SQLite DB (WAL mode, Drizzle migrations)
2. Apply shell environment to process.env (shell-env)
3. Register custom protocols as privileged (before app.whenReady):
   a. 🟢 signoff-icon:// — bypassCSP, supportFetchAPI (project icons in renderer/CSP)
   b. 🟢 signoff-font:// — bypassCSP, supportFetchAPI (system fonts like SF Mono)
4. Register protocol client (signoff://) for deep linking
5. Request single instance lock
6. app.whenReady() →
   a. 🟢 Register icon protocol handler (serve project icons from local disk)
   b. 🟢 Register font protocol handler (serve /System/Library/Fonts/*.otf on macOS)
   c. 🟢 Ensure project icons directory exists
   d. 🟢 Init app state (lowdb)
   e. 🟢 Reconcile daemon terminal sessions
   f. 🟢 Pre-warm terminal runtime
   g. 🟢 makeAppSetup(() => MainWindow()) — create BrowserWindow
   h. 🟢 Setup auto-updater
   i. 🟢 Init system tray
   j. 🟢 Process pending deep links
   k. 🔴 Removed: initSentry, loadWebviewBrowserExtension, setupAgentHooks,
             registerWithMacOSNotificationCenter, requestAppleEventsAccess,
             setWorkspaceDockIcon, outlit, getHostServiceManager
```

**为什么保留 icon/font 协议：** 这两个自定义协议与云功能无关。`signoff-icon://` 让 renderer 在 CSP 限制下加载项目图标；`signoff-font://` 让 renderer 使用 macOS 系统字体（如 SF Mono）作为终端/编辑器字体。不保留这两步会导致项目图标显示空白、系统字体不可用。

### tRPC Router (Desktop IPC)

🟢 Aligned path: `src/lib/trpc/routers/index.ts` → `createAppRouter(getWindow)`.

**Superset 的 `main.ts` 通过 `import { createAppRouter } from "lib/trpc/routers"` 引用此文件。** 我们保持完全相同的导入路径。

保留的 routers（🔴 从 superset 的 27 个裁剪到 12 个）：

| Router | Purpose | Source file |
|:---|:---|:---|
| `window` | 🟢 Window state, minimize, maximize, close | `routers/window.ts` |
| `projects` | 🟢 CRUD for local projects | `routers/projects/` |
| `workspaces` | 🟢 Workspace management | `routers/workspaces/` |
| `terminal` | 🟢 PTY session lifecycle | `routers/terminal/` |
| `changes` | 🟢 Git diff, stage, commit | `routers/changes/` |
| `filesystem` | 🟢 File read, write, watch (依赖 `workspace-fs-service.ts`) | `routers/filesystem/` |
| `settings` | 🟢 User preferences | `routers/settings/` |
| `config` | 🟢 App configuration | `routers/config/` |
| `menu` | 🟢 Application menu events | `routers/menu.ts` |
| `hotkeys` | 🟢 Keyboard shortcut registration | `routers/hotkeys/` |
| `external` | 🟢 Open in external editor | `routers/external/` |
| `autoUpdate` | 🟢 Auto-updater | `routers/auto-update/` |

🔴 Removed routers: `chatRuntimeService`, `chatService`, `analytics`, `browser`, `browserHistory`, `auth`, `cache`, `modelProviders`, `notifications`, `permissions`, `ports`, `resourceMetrics`, `ringtone`, `hostServiceManager`, `uiState`.

**`workspace-fs-service.ts`** 🟢 保留 — 此文件位于 `src/lib/trpc/routers/workspace-fs-service.ts`，被 `filesystem` router 直接导入。它依赖 `@signoff/workspace-fs/host` 包提供的 `createFsHostService`、`FsWatcherManager` 等能力。

### Renderer Architecture

**Provider stack** — 🟢 superset 的 `routes/-layout.tsx` 裁剪版：

```tsx
// 🟢 Aligned: ElectronTRPCProvider (from superset's -layout.tsx)
<ElectronTRPCProvider>
  {children}
  <ThemedToaster />              {/* 🟢 sonner */}
</ElectronTRPCProvider>
```

🔴 Trimmed from superset: `PostHogProvider`, `AuthProvider`, `OutlitProvider`.

**Routing** — 🟢 Aligned with TanStack Router file-based convention.

superset 实际 route 结构使用 `_authenticated/_dashboard/` 嵌套布局。我们的裁剪版移除了 auth guard 但保持 dashboard 布局模式：

```
routes/
├── __root.tsx                     # 🟢 Root layout wrapper
├── -layout.tsx                    # 🟢 Provider stack (superset convention)
├── page.tsx                       # 🟢 "/" — redirect to last workspace
├── not-found.tsx                  # 🟢 404 page
├── _dashboard/                    # 🟢 Main app layout (sidebar + content)
│   ├── layout.tsx                 # 🟢 Dashboard sidebar + top bar
│   ├── workspace/
│   │   └── $workspaceId/
│   │       └── page.tsx           # 🟢 Workspace view (terminal, code, diff)
│   ├── workspaces/
│   │   └── page.tsx               # 🟢 Workspace list
│   └── project/
│       └── $projectId/
│           └── page.tsx           # 🟢 Project view
└── settings/                      # 🟢 Settings (superset has 20+ sections)
    ├── layout.tsx                 # 🟢 Settings layout with nav
    ├── appearance/page.tsx        # 🟢
    ├── behavior/page.tsx          # 🟢
    ├── terminal/page.tsx          # 🟢
    ├── keyboard/page.tsx          # 🟢
    ├── git/page.tsx               # 🟢
    └── presets/page.tsx           # 🟢 Terminal presets
```

🔴 Trimmed routes: `_authenticated/` (no auth), `_onboarding/`, `sign-in/`, `create-organization/`, `tasks/`, `v2-workspace/`, `v2-workspaces/`, and settings pages: `account`, `api-keys`, `billing`, `devices`, `integrations`, `members`, `models`, `organization`, `permissions`, `projects`, `ringtones`, `team`.

Convention: `page.tsx` = index route, `layout.tsx` = layout wrapper — 🟢 matches superset's `tsr.config.json` (`routeToken: "layout"`, `indexToken: "page"`).

**State management (Zustand stores)** — 🟢 Aligned：

| Store | Purpose |
|:---|:---|
| `tabs/` | 🟢 Tab/pane management (mosaic layout) |
| `changes/` | 🟢 Git changes state |
| `hotkeys/` | 🟢 Keyboard shortcuts |
| `theme/` | 🟢 Dark/light theme |
| `sidebar-state.ts` | 🟢 Sidebar collapsed state |
| `settings-state.ts` | 🟢 General settings |
| `file-explorer.ts` | 🟢 File tree state |

🔴 Trimmed stores: `chat-preferences/`, `ports/`, `ringtone/`, `workspace-init.ts`, `v2-*.ts`, `search-dialog-state.ts`.

---

## 4. Core Features

### 4.1 Workspace System

🟢 Aligned with superset `packages/local-db/src/schema/schema.ts` 的实际定义。

以下 schema 是 superset 实际 schema 的裁剪版（用 Drizzle ORM 语法表示，因为这是 superset 的实际定义方式）：

```typescript
// packages/local-db/src/schema/schema.ts
// 🟢 Aligned with superset schema field names and types

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey().$defaultFn(() => uuidv4()),
  mainRepoPath: text("main_repo_path").notNull(),           // 🟢 superset uses mainRepoPath, NOT path
  name: text("name").notNull(),
  color: text("color").notNull(),
  tabOrder: integer("tab_order"),                            // 🟢 superset field
  lastOpenedAt: integer("last_opened_at").notNull().$defaultFn(() => Date.now()),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  configToastDismissed: integer("config_toast_dismissed", { mode: "boolean" }),
  defaultBranch: text("default_branch"),
  workspaceBaseBranch: text("workspace_base_branch"),
  githubOwner: text("github_owner"),
  branchPrefixMode: text("branch_prefix_mode").$type<BranchPrefixMode>(),
  branchPrefixCustom: text("branch_prefix_custom"),
  worktreeBaseDir: text("worktree_base_dir"),
  hideImage: integer("hide_image", { mode: "boolean" }),
  iconUrl: text("icon_url"),
  defaultApp: text("default_app").$type<ExternalApp>(),
  // 🔴 Trimmed: neonProjectId (cloud feature)
}, (table) => [
  index("projects_main_repo_path_idx").on(table.mainRepoPath),
  index("projects_last_opened_at_idx").on(table.lastOpenedAt),
]);

export const worktrees = sqliteTable("worktrees", {
  id: text("id").primaryKey().$defaultFn(() => uuidv4()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  branch: text("branch").notNull(),
  baseBranch: text("base_branch"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  gitStatus: text("git_status", { mode: "json" }).$type<GitStatus>(),
  githubStatus: text("github_status", { mode: "json" }).$type<GitHubStatus>(),
}, (table) => [
  index("worktrees_project_id_idx").on(table.projectId),
  index("worktrees_branch_idx").on(table.branch),
]);

export const workspaces = sqliteTable("workspaces", {
  id: text("id").primaryKey().$defaultFn(() => uuidv4()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  worktreeId: text("worktree_id").references(() => worktrees.id, { onDelete: "cascade" }),
  type: text("type").notNull().$type<WorkspaceType>(),     // 🟢 "worktree" | "branch"
  branch: text("branch").notNull(),                          // 🟢 superset field
  name: text("name").notNull(),
  tabOrder: integer("tab_order").notNull(),                  // 🟢 NOT sort_order
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
  updatedAt: integer("updated_at").notNull().$defaultFn(() => Date.now()),
  lastOpenedAt: integer("last_opened_at").notNull().$defaultFn(() => Date.now()),
  isUnread: integer("is_unread", { mode: "boolean" }).default(false),
  isUnnamed: integer("is_unnamed", { mode: "boolean" }).default(false),
  deletingAt: integer("deleting_at"),                        // 🟢 soft-delete marker
  portBase: integer("port_base"),                            // 🟢 multi-worktree port allocation
  sectionId: text("section_id").references(() => workspaceSections.id, { onDelete: "set null" }),
}, (table) => [
  index("workspaces_project_id_idx").on(table.projectId),
  index("workspaces_worktree_id_idx").on(table.worktreeId),
  index("workspaces_last_opened_at_idx").on(table.lastOpenedAt),
  index("workspaces_section_id_idx").on(table.sectionId),
  // NOTE: Migration 0006 creates partial unique index:
  // workspaces_unique_branch_per_project ON workspaces(project_id) WHERE type = 'branch'
]);

export const workspaceSections = sqliteTable("workspace_sections", {
  id: text("id").primaryKey().$defaultFn(() => uuidv4()),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tabOrder: integer("tab_order").notNull(),                  // 🟢 NOT sort_order
  isCollapsed: integer("is_collapsed", { mode: "boolean" }).default(false),
  color: text("color"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
}, (table) => [
  index("workspace_sections_project_id_idx").on(table.projectId),
]);
```

🔴 **Trimmed tables** (synced from cloud, 完整删除):
- `users` — cloud user profiles
- `organizations` — cloud orgs
- `organizationMembers` — cloud org membership
- `tasks` — cloud task management
- `browserHistory` — embedded browser history (no browser feature)

### 4.2 Layout System

🟢 Aligned with superset's mosaic layout pattern：

- **Sidebar** (left) — Project list, workspace list, grouped by sections
- **Content area** — Mosaic-based resizable panels
  - Terminal panes
  - Code editor panes (CodeMirror 6)
  - Diff viewer panes
- **Split support** — Horizontal and vertical splits
- **Tab bar** — Each pane can have multiple tabs

**Key dependencies** (🟢 Aligned versions)：

| Dep | superset version | Purpose |
|:---|:---|:---|
| `react-mosaic-component` | `^6.1.1` | Tiling window manager for panes |
| `react-resizable-panels` | `^3.0.6` | Resizable panel system |
| `@dnd-kit/core` | `^6.3.1` | Drag and drop for tabs/panes |
| `@dnd-kit/sortable` | `^10.0.0` | Sortable lists |

### 4.3 Terminal

🟢 Aligned — 完整保留 superset's terminal architecture：

- **Terminal daemon** runs as a separate Electron process (`terminal-host/index.ts`)
- Each terminal spawns a **PTY subprocess** via `node-pty`
- **Renderer** uses `@xterm/xterm` with WebGL renderer
- Terminal sessions persist across app restarts (reconciliation on boot)
- Tab management via Zustand store

**Key dependencies** (🟢 Aligned with superset's actual package names and versions)：

| Dep | superset version | Purpose |
|:---|:---|:---|
| `@xterm/xterm` | `6.1.0-beta.195` | 🟢 Terminal emulator (注意：包名是 `@xterm/xterm`，不是 `xterm`) |
| `@xterm/addon-webgl` | `0.20.0-beta.194` | GPU-accelerated rendering |
| `@xterm/addon-fit` | `0.12.0-beta.195` | Auto-fit to container |
| `@xterm/addon-search` | `0.17.0-beta.195` | Search in terminal |
| `@xterm/addon-ligatures` | `0.11.0-beta.195` | Font ligature support |
| `@xterm/addon-clipboard` | `0.3.0-beta.195` | Clipboard integration |
| `@xterm/addon-image` | `0.10.0-beta.195` | Image display in terminal |
| `@xterm/addon-unicode11` | `0.10.0-beta.195` | Unicode 11 support |
| `@xterm/addon-serialize` | `0.15.0-beta.195` | Terminal serialization |
| `@xterm/headless` | `6.1.0-beta.195` | Headless terminal (daemon) |
| `node-pty` | `1.1.0` | Native PTY for process spawning |

**Import path 注意：** Renderer 代码中的 import 是 `from "@xterm/xterm"`（不是 `from "xterm"`），addon 也全部使用 `@xterm/` 前缀。

### 4.4 Code Editor

🟢 Aligned — CodeMirror 6 with language support：

| Dep | Purpose |
|:---|:---|
| `@codemirror/view` | Editor view |
| `@codemirror/state` | Editor state |
| `@codemirror/commands` | Editor commands |
| `@codemirror/language` | Language infrastructure |
| `@codemirror/search` | Search functionality |
| `@codemirror/lang-javascript` | JavaScript/TypeScript |
| `@codemirror/lang-python` | Python |
| `@codemirror/lang-json` | JSON |
| `@codemirror/lang-markdown` | Markdown |
| `@codemirror/lang-html` | HTML |
| `@codemirror/lang-css` | CSS |
| `@codemirror/lang-go` | Go |
| `@codemirror/lang-rust` | Rust |
| `@codemirror/lang-yaml` | YAML |
| `@codemirror/lang-sql` | SQL |
| `@codemirror/lang-xml` | XML |
| `@codemirror/lang-cpp` | C/C++ |
| `@codemirror/lang-java` | Java |
| `@codemirror/lang-php` | PHP |
| `@codemirror/legacy-modes` | Legacy language modes |
| `@codemirror/theme-one-dark` | Dark theme |

### 4.5 Diff Viewer

🟢 Aligned：

- `simple-git` (`^3.30.0`) for git operations in main process
- `@pierre/diffs` (`^1.0.10`) for diff rendering (🟢 superset 实际使用此库)
- Exposed via tRPC `changes` router
- Supports staging individual hunks / lines
- File tree showing changed files (added, modified, deleted)

### 4.6 Settings

🟢 Aligned with superset `schema.ts` 中 settings 表的实际定义：

```typescript
// 🟢 Aligned: integer PK with default 1, NOT text PK

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey().default(1),                 // 🟢 integer PK, NOT text
  lastActiveWorkspaceId: text("last_active_workspace_id"),
  // Terminal presets (JSON array)
  terminalPresets: text("terminal_presets", { mode: "json" }).$type<TerminalPreset[]>(),
  terminalPresetsInitialized: integer("terminal_presets_initialized", { mode: "boolean" }),
  // Confirm on quit
  confirmOnQuit: integer("confirm_on_quit", { mode: "boolean" }),
  // Terminal behavior
  terminalLinkBehavior: text("terminal_link_behavior").$type<TerminalLinkBehavior>(),
  terminalPersistence: integer("persist_terminal", { mode: "boolean" }).default(true),
  autoApplyDefaultPreset: integer("auto_apply_default_preset", { mode: "boolean" }),
  // Branch naming
  branchPrefixMode: text("branch_prefix_mode").$type<BranchPrefixMode>(),
  branchPrefixCustom: text("branch_prefix_custom"),
  // File/editor preferences
  fileOpenMode: text("file_open_mode").$type<FileOpenMode>(),
  defaultEditor: text("default_editor").$type<ExternalApp>(),
  // Terminal font
  terminalFontFamily: text("terminal_font_family"),
  terminalFontSize: integer("terminal_font_size"),
  // Editor font
  editorFontFamily: text("editor_font_family"),
  editorFontSize: integer("editor_font_size"),
  // UI preferences
  showPresetsBar: integer("show_presets_bar", { mode: "boolean" }),
  useCompactTerminalAddButton: integer("use_compact_terminal_add_button", { mode: "boolean" }),
  deleteLocalBranch: integer("delete_local_branch", { mode: "boolean" }),
  openLinksInApp: integer("open_links_in_app", { mode: "boolean" }),
  worktreeBaseDir: text("worktree_base_dir"),
  // 🔴 Trimmed fields (cloud/metrics features):
  //   agentPresetOverrides, agentCustomDefinitions, selectedRingtoneId,
  //   activeOrganizationId, notificationSoundsMuted, showResourceMonitor
});
```

**Zod types** (from `packages/local-db/src/schema/zod.ts`, 🟢 Aligned):
- `TerminalPreset` — id, name, description, cwd, commands, pinnedToBar, isDefault, executionMode
- `WorkspaceType` — `"worktree" | "branch"`
- `ExternalApp` — 30+ editor/tool types (vscode, cursor, zed, etc.)
- `TerminalLinkBehavior` — `"external-editor" | "file-viewer"`
- `BranchPrefixMode` — `"none" | "github" | "author" | "custom"`
- `FileOpenMode` — `"split-pane" | "new-tab"`
- `GitStatus`, `GitHubStatus` — Git/GitHub status JSON types
- `ExecutionMode` — `"split-pane" | "new-tab" | "new-tab-split-pane"`

---

## 5. Dependency Summary

### `apps/desktop/package.json` (key dependencies)

🟢 All versions aligned with superset `apps/desktop/package.json`：

```jsonc
{
  "name": "@signoff/desktop",
  "dependencies": {
    // Electron
    "electron-updater": "^6.7.3",

    // React + Routing
    "react": "19.2.0",
    "react-dom": "19.2.0",
    "@tanstack/react-router": "^1.147.3",
    "@tanstack/react-query": "^5.90.19",

    // State
    "zustand": "^5.0.8",

    // IPC — 🟢 trpc-electron is ^0.1.2, NOT ^3.3.0
    "@trpc/server": "^11.7.1",
    "@trpc/client": "^11.7.1",
    "@trpc/react-query": "^11.7.1",
    "trpc-electron": "^0.1.2",

    // Terminal — 🟢 @xterm/ scoped packages, NOT bare xterm
    "@xterm/xterm": "6.1.0-beta.195",
    "@xterm/headless": "6.1.0-beta.195",
    "@xterm/addon-webgl": "0.20.0-beta.194",
    "@xterm/addon-fit": "0.12.0-beta.195",
    "@xterm/addon-search": "0.17.0-beta.195",
    "@xterm/addon-ligatures": "0.11.0-beta.195",
    "@xterm/addon-clipboard": "0.3.0-beta.195",
    "@xterm/addon-image": "0.10.0-beta.195",
    "@xterm/addon-unicode11": "0.10.0-beta.195",
    "@xterm/addon-serialize": "0.15.0-beta.195",
    "node-pty": "1.1.0",

    // Editor
    "@codemirror/view": "^6.39.16",
    "@codemirror/state": "^6.5.4",
    "@codemirror/commands": "^6.10.2",
    "@codemirror/language": "^6.12.2",
    "@codemirror/search": "^6.6.0",
    "@codemirror/lang-javascript": "^6.2.5",
    "@codemirror/lang-python": "^6.2.1",
    "@codemirror/lang-json": "^6.0.2",
    "@codemirror/lang-markdown": "^6.5.0",
    "@codemirror/lang-html": "^6.4.11",
    "@codemirror/lang-css": "^6.3.1",
    "@codemirror/lang-yaml": "^6.1.2",
    "@codemirror/lang-sql": "^6.10.0",
    "@codemirror/theme-one-dark": "^6.1.3",

    // Git
    "simple-git": "^3.30.0",
    "@pierre/diffs": "^1.0.10",

    // Layout
    "react-mosaic-component": "^6.1.1",
    "react-resizable-panels": "^3.0.6",
    "@dnd-kit/core": "^6.3.1",
    "@dnd-kit/sortable": "^10.0.0",
    "@dnd-kit/utilities": "^3.2.2",

    // Tree view
    "@headless-tree/core": "^1.6.3",
    "@headless-tree/react": "^1.6.3",

    // Styling
    "tailwindcss": "^4.1.18",
    "tailwind-merge": "^3.4.0",
    "tw-animate-css": "^1.4.0",
    "framer-motion": "^12.23.26",
    "lucide-react": "^0.563.0",
    "clsx": "^2.1.1",

    // DB
    "better-sqlite3": "12.6.2",
    "drizzle-orm": "0.45.1",

    // Validation
    "zod": "^4.3.5",

    // Persistent state
    "lowdb": "^7.0.1",

    // Search
    "fuse.js": "^7.1.0",

    // Utilities
    "uuid": "^13.0.0",
    "execa": "^9.6.0",
    "nanoid": "^5.1.6",
    "date-fns": "^4.1.0",
    "lodash": "^4.17.21",
    "shell-env": "^4.0.3",
    "shell-quote": "^1.8.3",
    "default-shell": "^2.2.0",
    "strip-ansi": "^7.1.2",
    "superjson": "^2.2.5",

    // Filesystem watching
    "@parcel/watcher": "^2.5.6",
    "fast-glob": "^3.3.3",

    // Internal packages
    "@signoff/ui": "workspace:*",
    "@signoff/local-db": "workspace:*",
    "@signoff/shared": "workspace:*",
    "@signoff/workspace-fs": "workspace:*"
  },
  "devDependencies": {
    "electron": "40.2.1",
    "electron-vite": "^4.0.0",
    "electron-builder": "^26.4.0",
    "vite": "^7.1.3",
    "@tailwindcss/vite": "^4.0.9",
    "@vitejs/plugin-react": "^5.0.1",
    "vite-tsconfig-paths": "^5.1.4",
    "@tanstack/router-cli": "^1.149.0",
    "@tanstack/router-plugin": "^1.149.0",
    "drizzle-kit": "^0.30.0",
    "cross-env": "^10.0.0",
    "rimraf": "^6.0.1",
    "tsx": "^4.19.3",
    "typescript": "^5.9.3",
    "@types/better-sqlite3": "^7.6.13",
    "@types/bun": "^1.2.17",
    "@types/lodash": "^4.17.20",
    "@types/node": "^24.9.1",
    "@types/react": "~19.2.2",
    "@types/react-dom": "^19.2.3",
    "@types/shell-quote": "^1.7.5",
    "@signoff/typescript": "workspace:*"
  }
}
```

🔴 **Trimmed dependencies** (not in our package.json):
- AI: `ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/react`, `@mastra/core`, `mastracode`
- Cloud sync: `@electric-sql/client`, `@tanstack/db`, `@tanstack/electric-db-collection`, `@durable-streams/client`
- Analytics: `posthog-js`, `posthog-node`, `@sentry/electron`, `@sentry/vite-plugin`
- Auth: `better-auth`, `@better-auth/stripe`, `jose`
- Chat/Editor: `@tiptap/*` (all 20+ extensions), `tiptap-markdown`
- Browser: `@outlit/browser`, `@outlit/node`
- MCP: `@superset/desktop-mcp`, `@superset/mcp`
- Metrics: `@superset/macos-process-metrics`, `pidusage`, `pidtree`
- Cloud services: `@superset/db`, `@superset/auth`, `@superset/chat`, `@superset/host-service`, `@superset/trpc` (shared), `@vercel/blob`
- Embedded browser deps: `http-proxy`, `express`, `@types/express`

### Native Modules to Externalize

🟢 Aligned — these must be listed in `electron.vite.config.ts` as externals：

- `better-sqlite3`
- `node-pty`
- `@parcel/watcher`

---

## 6. Atomic Commits Plan

### TDD Protocol

**每一个 commit 都必须通过 L1 + L2 gate，无例外。**

```
L1 (UT):   bun run test:ci     ← pre-commit hook 自动执行 (含 coverage threshold)
L2 (Lint): bun run lint        ← pre-commit hook 自动执行 (Biome only, 不含 typecheck)
L3 (Type): bun run typecheck   ← pre-push hook 自动执行 (tsc --noEmit)
L4 (E2E):  按需手动执行         ← Phase Gate 时执行
```

> **L2 只是 Biome lint+format，不包含 TypeScript 检查。** TypeScript strict mode 由 L3 独立负责。
> 二者分开的原因：Biome 是毫秒级检查，适合 pre-commit；tsc 在大项目中可能需要数秒，放在 pre-push。

**TDD 节奏：** 每个功能 commit 的工作顺序是 **test → impl → verify**：
1. 先写 `*.test.ts`（fail）
2. 写实现代码让测试通过（pass）
3. husky pre-commit 自动跑 L1 + L2
4. Commit

**Phase Gate：** 每个 Phase 完成后执行全量验证：
- `bun run test:ci` (L1, 含 coverage ≥ 90%) + `bun run lint` (L2) + `bun run typecheck` (L3)
- 标记有 🚪 的 Phase 额外执行 `bun run dev` 验证 Electron 启动

---

### Phase 1: Monorepo Foundation + Test Infrastructure

> 第一个 commit 就建立完整的 L1 + L2 gate。从此刻起每次 `git commit` 都会自动运行 UT + Lint。

| # | Commit | Key Files | TDD |
|:---|:---|:---|:---|
| 1 | `chore: init monorepo with bun + turborepo + biome + husky` | `package.json` (含 `test`, `test:ci`, `lint`, `prepare` scripts), `turbo.jsonc`, `biome.jsonc`, `bunfig.toml`, `.gitignore`, `.husky/pre-commit` (`bun run test:ci && bun run lint`), `.husky/pre-push` (`bun run typecheck`), `scripts/check-coverage.ts` | L1: `bun test:ci` pass（零测试 → 0/0 lines → pass-through）; L2: `bun run lint` 零错误 |
| 2 | `chore: add shared typescript configs` | `tooling/typescript/{base,electron,internal-package}.json`, `package.json`, `tsconfig.json` | L1+L2 gate; L3: `bun run typecheck` 通过 |

**Phase 1 Gate:** `bun run test:ci && bun run lint && bun run typecheck`

---

### Phase 2: Shared Packages

> TDD: 每个包先带着从 superset 裁剪的测试文件落地，确保测试先通过。

| # | Commit | Key Files | TDD |
|:---|:---|:---|:---|
| 3 | `feat: add shared package with constants and types` | `packages/shared/package.json`, `src/`, `tsconfig.json` — 含裁剪自 superset 的 7 个 `*.test.ts` | Test first: 7 个测试全部 pass |
| 4 | `feat: add workspace-fs package` | 🟢 Copy from superset — `src/{client,core,host}/`, `resource-uri.ts` — 含 6 个 `*.test.ts` | Test first: 6 个测试全部 pass |
| 5 | `feat: add local-db package with sqlite schema` | Schema (trimmed synced tables), migrations, Drizzle config, `zod.ts` | L2+L3: lint + typecheck pass |
| 6 | `feat: add ui package with base shadcn setup` | `packages/ui/package.json`, `src/components/ui/`, `globals.css`, `components.json` | L2+L3: lint + typecheck pass |

**Phase 2 Gate:** `bun run test:ci` (13 tests pass, coverage ≥ 90%) + `bun run lint` + `bun run typecheck`

---

### Phase 3: Desktop App Scaffold 🚪

> TDD: 先建立 `test-setup.ts` mock 层，再搭 Electron 壳。从此 commit 起 desktop 包也有 UT gate。

| # | Commit | Key Files | TDD |
|:---|:---|:---|:---|
| 7 | `feat: scaffold desktop app with electron-vite and test setup` | `electron.vite.config.ts`, `electron-builder.ts`, `tsconfig.json`, `tsr.config.json`, `bunfig.toml` (`[test]` preload), `test-setup.ts` (mock Electron APIs, `@signoff/local-db`), `src/main/index.ts` (boot skeleton, 含 `signoff-icon://` + `signoff-font://` 协议注册), `src/preload/index.ts`, `src/renderer/index.html` + `index.tsx`, `src/resources/`, project-icons utils | Test first: `test-setup.ts` + 1 个 smoke test pass; L1+L2 gate |

**Phase 3 Gate 🚪:** `bun run test:ci && bun run lint && bun run typecheck` + `bun run dev` (Electron 窗口启动)

---

### Phase 4: Core Infrastructure

> TDD: 先写 tRPC router 的 test，再写 router 实现。

| # | Commit | Key Files | TDD |
|:---|:---|:---|:---|
| 8 | `feat: add tRPC IPC layer` | `src/lib/trpc/index.ts`, `src/lib/trpc/routers/index.ts` (createAppRouter), `workspace-fs-service.ts`, preload bridge | Test first: router assembly test → impl |
| 9 | `feat: add local-db initialization in main process` | `src/main/lib/local-db/` (SQLite WAL init, Drizzle instance), `src/main/lib/app-state/` (lowdb), `src/main/lib/window-state/` | Test first: DB init + window-state tests → impl |

**Phase 4 Gate:** `bun run test:ci && bun run lint && bun run typecheck`

---

### Phase 5: Terminal System 🚪

> TDD: terminal session management 先写 test，daemon/pty 可依赖 superset 已有测试。

| # | Commit | Key Files | TDD |
|:---|:---|:---|:---|
| 10 | `feat: add terminal daemon with node-pty` | `src/main/terminal-host/index.ts`, `pty-subprocess.ts`, `src/main/lib/terminal/` (session mgmt), `xterm-env-polyfill.ts` | Test first: terminal session tests → impl |
| 11 | `feat: add terminal renderer with @xterm/xterm` | `src/renderer/screens/.../Terminal/helpers.ts`, xterm component, addon setup (WebGL, fit, search, ligatures, clipboard) | Test first: helpers.test.ts → impl |

**Phase 5 Gate 🚪:** `bun run test:ci && bun run lint && bun run typecheck` + `bun run dev` (terminal 可输入)

---

### Phase 6: Workspace & Layout 🚪

> TDD: project/workspace router 先写 CRUD test，UI 组件跟进。

| # | Commit | Key Files | TDD |
|:---|:---|:---|:---|
| 12 | `feat: add project and workspace tRPC routers` | `src/lib/trpc/routers/projects/`, `routers/workspaces/`, Zustand `stores/sidebar-state.ts` | Test first: projects CRUD + workspaces CRUD tests → impl |
| 13 | `feat: add dashboard layout with sidebar` | `routes/_dashboard/layout.tsx`, sidebar components, `routes/page.tsx` (redirect) | L1+L2 gate |
| 14 | `feat: add mosaic layout with tab management` | Zustand `stores/tabs/`, `react-mosaic-component`, `react-resizable-panels`, `@dnd-kit` | Test first: tabs store tests → impl |

**Phase 6 Gate 🚪:** `bun run test:ci && bun run lint && bun run typecheck` + `bun run dev` (sidebar + split/tab 工作)

---

### Phase 7: Editor & Diff

> TDD: changes router 和 filesystem router 先写 test。

| # | Commit | Key Files | TDD |
|:---|:---|:---|:---|
| 15 | `feat: add code editor with codemirror 6` | CodeMirror view/state, language modes, theme-one-dark, `@headless-tree` file explorer | L1+L2 gate |
| 16 | `feat: add diff viewer with git integration` | `src/lib/trpc/routers/changes/`, `simple-git`, `@pierre/diffs`, Zustand `stores/changes/` | Test first: changes router tests → impl |
| 17 | `feat: add filesystem router with workspace-fs` | `src/lib/trpc/routers/filesystem/`, file explorer UI, `Fuse.js` search | Test first: filesystem router tests → impl |

**Phase 7 Gate:** `bun run test:ci && bun run lint && bun run typecheck`

---

### Phase 8: Settings & Polish 🚪

> TDD: settings router 和 hotkeys store 先写 test。

| # | Commit | Key Files | TDD |
|:---|:---|:---|:---|
| 18 | `feat: add settings system` | `src/lib/trpc/routers/settings/`, `routes/settings/` (appearance, terminal, keyboard, git, behavior, presets), settings Zustand store | Test first: settings router tests → impl |
| 19 | `feat: add keyboard shortcuts system` | Zustand `stores/hotkeys/`, hotkeys tRPC router, keyboard settings page | Test first: hotkeys store tests → impl |
| 20 | `chore: add github actions ci workflow` | `.github/workflows/ci.yml` (lint → test:ci → typecheck, parallel jobs) | Push 触发 CI |

**Phase 8 Gate 🚪:** `bun run test:ci && bun run lint && bun run typecheck` + `bun run dev` (全功能验证)

---

### L4 E2E Checkpoints

L4 (Playwright Electron E2E) 在以下时机手动执行：

| Checkpoint | Trigger | E2E Scope |
|:---|:---|:---|
| Phase 5 完成 | Terminal 可用 | 启动 app → 打开 terminal → 执行命令 → 验证输出 |
| Phase 6 完成 | Workspace 可用 | 创建 project → 创建 workspace → split pane → 切换 tab |
| Phase 8 完成 | 全功能 | 完整主干流程：open project → terminal → edit file → view diff → change settings → 验证项目图标/系统字体加载 |

---

## 7. Testing Strategy

### Four-Layer Verification (adapted for Electron desktop app)

| Layer | Command | Content | Trigger | Gate |
|:---|:---|:---|:---|:---|
| **L1 — UT** | `bun run test:ci` | `bun test --coverage` + `scripts/check-coverage.sh` (threshold 90%) | **每次 commit** (husky pre-commit) | Coverage ≥ 90% 否则 exit 1 |
| **L2 — Lint** | `bun run lint` | Biome check (lint + format)。**不含** TypeScript 检查 | **每次 commit** (husky pre-commit) | 零 diagnostic |
| **L3 — Type** | `bun run typecheck` | `tsc --noEmit` — Full TypeScript strict type check | **每次 push** (husky pre-push) + Phase Gate | 零 type error |
| **L4 — E2E** | `bun run test:e2e` | Playwright Electron — 核心主干流程 | Phase 5/6/8 完成时手动执行 | 核心流程通过 |

**Coverage enforcement 实现：**

```jsonc
// package.json scripts
{
  "test": "turbo test",                          // 普通测试（无 coverage）
  "test:ci": "turbo test:ci",                    // 含 coverage + threshold
  "lint": "bunx @biomejs/biome check .",         // Biome only
  "typecheck": "turbo typecheck"                 // tsc --noEmit
}
```

```jsonc
// apps/desktop/package.json scripts
{
  "test": "bun test",
  "test:ci": "bun test --coverage && bun run check-coverage",
  "check-coverage": "bun run scripts/check-coverage.ts"
}
```

`scripts/check-coverage.ts` 解析 `bun test --coverage` 的输出，逻辑如下：
- **零测试 / 0 total lines**: 视为 pass（无代码可覆盖，不阻塞 commit）
- **有测试但覆盖率 < 90%**: `process.exit(1)`，阻塞 commit
- 这保证 commit #1（空 monorepo）和纯配置 commit 不会被误拦，同时有代码后立即生效

每个有测试的 package 都有对应的 `test:ci` script。

**与标准四层的适配说明：**

- **L2 ≠ L3**: Biome (L2) 和 TypeScript (L3) 严格分开。pre-commit 只跑 L1+L2（秒级），pre-push 跑 L3（可能数秒）。二者不交叉
- **L3** 不叫 "API E2E" 因为没有 REST API。Desktop app 的 "API" 是 tRPC IPC router — L3 通过 `tsc --noEmit` 确保 router 的 input/output 类型完整性
- **L1 coverage** 通过 `bun test --coverage` + `scripts/check-coverage.ts` 硬性执行（零测试放行，有代码则 ≥ 90%），不是口号
- **L4** 使用 Playwright 的 [Electron support](https://playwright.dev/docs/api/class-electron) 而非 HTTP server
- 🔴 Superset 当前没有 E2E、husky 和 coverage gate，但我们从 commit #1 起就建立完整 gate

### Test Runner & Convention

🟢 Aligned with superset:

| Aspect | Convention |
|:---|:---|
| **Runner** | `bun test` (Bun built-in test runner) |
| **File pattern** | `*.test.ts` / `*.test.tsx` (co-located with source) |
| **No** `*.spec.ts`, **no** `__tests__/` directories |
| **Test setup** | `apps/desktop/test-setup.ts` — mock Electron APIs, `@signoff/local-db` |
| **Test preload** | `apps/desktop/bunfig.toml` → `[test] preload` |
| **Test env** | `NODE_ENV=test`, `SKIP_ENV_VALIDATION=1` |

### `apps/desktop/bunfig.toml`

🟢 Aligned with superset:

```toml
[test]
preload = ["./src/main/terminal-host/xterm-env-polyfill.ts", "./test-setup.ts"]

[test.env]
NODE_ENV = "test"
SKIP_ENV_VALIDATION = "1"
```

### `apps/desktop/test-setup.ts`

🟢 Aligned — Mock these Electron APIs so `bun test` can run without a real Electron process:

- `electron` — `app`, `dialog`, `BrowserWindow`, `ipcMain`, `shell`, `clipboard`, `screen`
- `document` / `electronTRPC` browser globals
- `@signoff/local-db` — Drizzle schema objects (mock with zod)
- `main/lib/local-db` — better-sqlite3 instance (not available in Bun)

### husky Hooks (from Commit #1)

🔴 **Intentional divergence** — superset 没有 husky，我们从第一个 commit 就安装：

```
.husky/
├── pre-commit     # bun run test:ci && bun run lint
└── pre-push       # bun run typecheck
```

**pre-commit (L1 + L2):**
```bash
#!/bin/sh
bun run test:ci    # L1: bun test --coverage + threshold check (90%)
bun run lint       # L2: Biome check only (NOT typecheck)
```

**pre-push (L3):**
```bash
#!/bin/sh
bun run typecheck  # L3: tsc --noEmit
```

### CI Pipeline

🟢 Aligned with superset's GitHub Actions structure:

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run lint              # L2: Biome only

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run test:ci           # L1: bun test --coverage + 90% threshold

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run typecheck         # L3: tsc --noEmit
```

### Test Coverage by Package

| Package | Existing superset tests | Bootstrap target |
|:---|:---|:---|
| `packages/shared` | 7 `*.test.ts` (agent-command, names, terminal-link-parsing, auth) | 🟢 直接保留 |
| `packages/workspace-fs` | 6 `*.test.ts` (client, fs, host/service, resource-uri, search, watch) | 🟢 直接保留 |
| `packages/local-db` | 0 (mock at integration layer) | 保持不变 |
| `packages/ui` | 0 | 按需添加 |
| `apps/desktop` | ~90+ `*.test.ts` (裁剪后保留相关测试) | 🟢 保留与保留模块对应的测试 |

---

## 8. Key Architectural Decisions

### Q1: Why keep Electron (not Tauri)?

Superset uses Electron 40 with `node-pty` for native PTY access. Tauri would require rewriting the terminal layer in Rust. 保持 Electron 使得我们可以直接复用 superset 的 terminal 代码。

### Q2: Why electron-vite instead of vanilla Vite?

`electron-vite` handles the complexity of bundling 3 targets (main, preload, renderer) with proper externalization of native modules. 这是 superset 的构建方式。

### Q3: Why TanStack Router instead of React Router?

Superset uses TanStack Router with file-based routing and code splitting. TanStack Router 也与 TanStack Query（tRPC cache 层）紧密集成。

### Q4: Why tRPC over Electron IPC?

`trpc-electron` (`^0.1.2`) provides type-safe RPC over IPC. Renderer 通过 typed tRPC hooks 调用 main process，从不直接使用 `ipcRenderer.invoke()`。

### Q5: Why separate terminal daemon?

Running PTY sessions in the main process would block the event loop. Superset 的架构使用独立 daemon 进程，再由 daemon 为每个终端 fork PTY subprocess。这保证了 main process 的响应性并支持终端会话跨重启持久化。

### Q6: Why keep workspace-fs as a package?

`filesystem` tRPC router 通过 `workspace-fs-service.ts` 直接依赖 `@signoff/workspace-fs/host`（`createFsHostService`, `FsWatcherManager`, `toErrorMessage`）。内联这个包会导致与 superset 代码的大量偏离。保留为独立 package 确保 `filesystem` router 和 biome renderer import restriction 可以直接沿用。

### Q7: What about auth?

Bootstrap has **no auth**. App is local-only. `_authenticated/` route guard 层被移除，直接使用 `_dashboard/` 作为顶层布局。

---

## References

- Source: `../superset` (local clone, commit at time of writing)
- Superset README: https://github.com/superset-sh/superset
- electron-vite docs: https://electron-vite.org
- TanStack Router: https://tanstack.com/router
- tRPC: https://trpc.io
- Drizzle ORM: https://orm.drizzle.team
- xterm.js: https://xtermjs.org
