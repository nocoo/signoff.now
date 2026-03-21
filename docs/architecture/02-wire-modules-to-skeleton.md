# 02 — From Skeleton to Usable Alpha

## Overview

01 产出了 skeleton：monorepo 结构就位、Electron boot 序列可跑、12 个 tRPC router 已声明（6 真实后端 + 6 空 stub）。但 skeleton 不等于 usable —— 用户打开 app 看到的是空 sidebar、placeholder pane、静态假文件树、无终端组件、空设置页面。

本文档将 skeleton 推进到 **Usable Alpha**。

### Alpha 验收标准

完成本文档后，用户能：

1. ✅ App 正常启动（无 ABI crash）
2. ✅ 看到真实 project/workspace 列表
3. ✅ 浏览和打开真实文件
4. ✅ 在编辑器中编辑文件并看到 diff
5. ✅ 开一个真实 terminal session
6. ✅ Settings 至少 2 个页面能真实保存和回读

### Current State（代码级）

| Layer | 状态 | 证据 |
|:------|:-----|:-----|
| **Runtime** | 🔴 Blocked | `better-sqlite3` ABI mismatch → `ERR_DLOPEN_FAILED`，无自动 rebuild 脚本，CLAUDE.md 里是手动 5 行命令 |
| **DB + Migrations** | ✅ Real | `main/lib/local-db/index.ts`: better-sqlite3 WAL + Drizzle, 5 tables |
| **tRPC IPC Bridge** | ✅ Real | `preload/index.ts` → `exposeElectronTRPC()` → `ipcLink` + superjson |
| **projects/workspaces/changes router** | ✅ Real | Factory pattern, `getDb` 注入 |
| **settings router** | ✅ Real | `createSettingsDbOps()` upsert SQLite |
| **hotkeys router** | 🟡 Memory-only | `createInMemoryHotkeyStore()` 10 个默认快捷键，无持久化 |
| **filesystem router** | ⚠️ Crash | `filesystem/index.ts` 代码完整，但 `main/index.ts:115` 传入 `fsOps: {}`。且 router 调用签名 (`{ workspacePath, path }`) 与 `FsService` 接口 (`{ absolutePath }`) **不匹配** |
| **terminal router** | 🔴 Stub | `terminal/index.ts:35` 空 router。但 daemon 层 **有真实代码**：`terminal-host.ts` (397行 TerminalHost class) + `session.ts` (681行 Session class + PTY subprocess 通信)。Manager 层 `lib/terminal/index.ts` 三个空函数 |
| **window/menu/config/external/autoUpdate router** | 🔴 Stub | 空 procedure，**menu 无任何原生基础设施**（无 `Menu.buildFromTemplate`） |
| **Renderer — WorkspaceSidebar** | 🟡 Shell | resize/collapse 可用，数据层空白：零 tRPC 调用，`"No projects yet"` 硬编码，"Add Project" 按钮无 handler |
| **Renderer — PaneContent** | 🔴 Placeholder | `WelcomeContent` 一行文字 + 所有其他 TabType fallthrough 到 `PlaceholderContent` 显示 `{tab.type} — {tab.label}` |
| **Renderer — FileExplorer** | 🔴 Placeholder | 硬编码 `DEMO_TREE`（6 个假节点），文件顶部标注 "Phase 7 #17 will connect this to the filesystem tRPC router" |
| **Renderer — Terminal** | 🔴 No component | `Terminal/index.ts` 标注 "🔴 Phase 5 trimmed: No Terminal.tsx React component yet"，只导出 helpers/config/types |
| **Renderer — CodeEditor** | ✅ Real | `CodeEditor.tsx` 121 行，CodeMirror 6 + 9 种语言检测 + one-dark 主题 + onChange callback。但**未被 PaneContent 消费** |
| **Renderer — Settings** | 🔴 Placeholder | 6 个页面各只有标题 + 一行描述文字（如 `appearance.tsx:14`），零表单控件，零 tRPC 调用。后端 `settingsTrpcRouter` + `useSettingsStore` 已就绪 |
| **Renderer — Tabs store** | ✅ Real | `tabs/index.ts` 332 行，完整的 pane/tab CRUD + mosaic layout 管理 |
| **`@signoff/ui`** | ✅ Available | 56+ shadcn 组件就绪，renderer **几乎零消费** |

### Approach

标注每一步的性质：

- **🛠️ Fix** — 修复阻塞问题
- **🔌 Wire** — 把已有模块连到骨架
- **🔧 Implement** — 写新逻辑
- **🧩 Consume** — renderer 侧消费后端/组件

---

## Phase 0: Unblock Runtime

**目标**：`bun install && bun run dev` 零手动步骤启动 Electron。

**当前状态**：

- `better-sqlite3@12.6.2` 被 Bun 编译为 `NODE_MODULE_VERSION=137`
- Electron 40 期望 `NODE_MODULE_VERSION=143`
- 启动 main process 立即 `ERR_DLOPEN_FAILED`
- 唯一修复文档在 CLAUDE.md 里（手动 `npx node-gyp rebuild --target=40.2.1`）
- 无 `postinstall` hook，无 rebuild 脚本，`scripts/` 只有 `check-coverage.ts`
- `node-pty` 使用 prebuilds，不受影响

### 0.1 创建自动 rebuild 脚本

🛠️ Fix

**新建**: `scripts/rebuild-native.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

# Find better-sqlite3 (Bun may hoist to different paths)
BETTER_SQLITE3_DIR=$(find node_modules -path '*/better-sqlite3/binding.gyp' -exec dirname {} \; 2>/dev/null | head -1)

if [ -z "$BETTER_SQLITE3_DIR" ]; then
  echo "[rebuild-native] better-sqlite3 not found, skipping"
  exit 0
fi

ELECTRON_VERSION=$(node -e "console.log(require('electron/package.json').version)")
ARCH=$(uname -m | sed 's/arm64/arm64/;s/x86_64/x64/')

echo "[rebuild-native] Rebuilding better-sqlite3 for Electron $ELECTRON_VERSION ($ARCH)..."
cd "$BETTER_SQLITE3_DIR"
npx --yes node-gyp rebuild \
  --target="$ELECTRON_VERSION" \
  --arch="$ARCH" \
  --dist-url=https://electronjs.org/headers
echo "[rebuild-native] Done"
```

### 0.2 注册 postinstall hook

🛠️ Fix — 修改 root `package.json`。

```diff
  "scripts": {
+   "postinstall": "bash scripts/rebuild-native.sh",
    "dev": "turbo run dev",
```

### 0.3 更新 CLAUDE.md

🛠️ Fix — 将手动 rebuild 指南替换为 "`bun install` automatically rebuilds native modules" 说明。

### 验收

- `bun install && bun run dev` → Electron 窗口正常打开，console 无 `ERR_DLOPEN_FAILED`

### Commits

```
fix: automate better-sqlite3 rebuild via postinstall
docs: update CLAUDE.md native rebuild section
```

---

## Phase 1: Wire Filesystem

**目标**：`filesystem` router 的 7 个操作可用（listDirectory / readFile / writeFile / createDirectory / deletePath / movePath / getMetadata）。

**当前状态**：

| 组件 | 文件 | 状态 |
|:-----|:-----|:-----|
| `FsService` 接口 | `packages/workspace-fs/src/core/service.ts` | ✅ 11 个方法，每个接受 `{ absolutePath: string }` 对象参数 |
| `createFsHostService` | `packages/workspace-fs/src/host/service.ts:133` | ✅ 接受 `FsHostServiceOptions { rootPath, watcherManager?, trashItem?, runRipgrep? }`，返回 `FsHostService extends FsService` + `close()` |
| filesystem router | `apps/desktop/src/lib/trpc/routers/filesystem/index.ts` | ⚠️ `FsOperations = any`，调用 `fs.listDirectory({ workspacePath, path })` — 与 `FsService` 的 `{ absolutePath }` **不匹配** |
| 传入的 fsOps | `apps/desktop/src/main/index.ts:115` | 🔴 `fsOps: {}` |

**关键决策**：router 使用 `{ workspacePath, relativePath }` → 自行 `join()` 为 `fullPath` → 传给 `fs.xxx({ workspacePath, path: fullPath })`。但 `FsHostService` 期望 `{ absolutePath }`。需要 adapter 层桥接。

### 1.1 创建 per-workspace FsHostService 工厂

🔌 Wire

**新建**: `apps/desktop/src/main/lib/workspace-fs/index.ts`

```ts
import { createFsHostService, type FsHostService } from "@signoff/workspace-fs/host";

const instances = new Map<string, FsHostService>();

/** Per-workspace FsHostService, lazily created and cached. */
export function getFsHostService(rootPath: string): FsHostService {
  let fs = instances.get(rootPath);
  if (!fs) {
    fs = createFsHostService({ rootPath });
    instances.set(rootPath, fs);
  }
  return fs;
}

export async function closeAllFsHostServices(): Promise<void> {
  for (const fs of instances.values()) {
    await fs.close();
  }
  instances.clear();
}
```

### 1.2 创建 adapter 桥接 router → FsHostService

🔌 Wire — 将 router 的 `{ workspacePath, path }` 调用签名转换为 `FsService` 的 `{ absolutePath }` 签名。

**新建**: `apps/desktop/src/main/lib/workspace-fs/adapter.ts`

Router 内部已经做了 `join(workspacePath, relativePath)` 生成 `fullPath`，然后传 `{ workspacePath, path: fullPath }`。Adapter 需要拦截这些调用，取出 `path`/`fullPath` 作为 `absolutePath` 委托给 `FsHostService`。

**真实类型参照**（`packages/workspace-fs/src/types.ts`）：

```ts
// FsEntry — listDirectory 返回值，仅 3 个字段
interface FsEntry { absolutePath: string; name: string; kind: FsEntryKind }
type FsEntryKind = "file" | "directory" | "symlink" | "other";

// FsReadResult — discriminated union，text 时 content: string
type FsReadResult =
  | { kind: "text"; content: string; byteLength: number; exceededLimit: boolean; revision: string }
  | { kind: "bytes"; content: Uint8Array; byteLength: number; exceededLimit: boolean; revision: string };

// FsWriteResult — ok/fail union
type FsWriteResult =
  | { ok: true; revision: string }
  | { ok: false; reason: "conflict" | "exists" | "not-found"; ... };

// FsMetadata — 无 name 字段，用 absolutePath + modifiedAt
interface FsMetadata {
  absolutePath: string; kind: FsEntryKind; size: number | null;
  createdAt: string | null; modifiedAt: string | null; accessedAt: string | null;
  symlinkTarget?: string | null; revision: string;
  // ... mode, permissions, owner, group (optional)
}
```

**新建**: `apps/desktop/src/main/lib/workspace-fs/adapter.ts`

```ts
import type { FsHostService } from "@signoff/workspace-fs/host";
import { basename } from "node:path";
import { getFsHostService } from "./index";

/**
 * Adapts the router's { workspacePath, path } call convention
 * to FsHostService's { absolutePath } interface.
 *
 * Type mappings:
 *   FsEntry { absolutePath, name, kind }  →  DirectoryEntry { name, isDirectory, isSymlink, size }
 *   FsReadResult { kind: "text", content }  →  FileContent { content, encoding }
 *   FsMetadata { absolutePath, kind, size, modifiedAt }  →  FileMetadata { name, isDirectory, isSymlink, size, mtime }
 */
export function createFsAdapter() {
  function getFs(workspacePath: string): FsHostService {
    return getFsHostService(workspacePath);
  }

  return {
    listDirectory: async (input: { workspacePath: string; path: string }) => {
      const result = await getFs(input.workspacePath).listDirectory({
        absolutePath: input.path,
      });
      // FsEntry → DirectoryEntry
      // FsEntry has no size/isSymlink — derive from kind, size requires getMetadata per-entry
      return result.entries.map((e) => ({
        name: e.name,
        isDirectory: e.kind === "directory",
        isSymlink: e.kind === "symlink",
        size: 0, // FsEntry doesn't carry size; enrichment deferred to getMetadata calls
      }));
    },

    readFile: async (input: { workspacePath: string; path: string }) => {
      const result = await getFs(input.workspacePath).readFile({
        absolutePath: input.path,
      });
      // FsReadResult is a discriminated union; for text files return content string
      if (result.kind === "text") {
        return { content: result.content, encoding: "utf-8" };
      }
      // Binary file: decode as latin1 to avoid data loss, renderer should detect and handle
      return {
        content: new TextDecoder("latin1").decode(result.content),
        encoding: "binary",
      };
    },

    writeFile: async (input: { workspacePath: string; path: string; content: string }) => {
      const result = await getFs(input.workspacePath).writeFile({
        absolutePath: input.path,
        content: input.content,
      });
      if ("ok" in result && !result.ok) {
        throw new Error(`writeFile failed: ${result.reason}`);
      }
    },

    createDirectory: async (input: { workspacePath: string; path: string }) => {
      await getFs(input.workspacePath).createDirectory({
        absolutePath: input.path,
      });
    },

    deletePath: async (input: { workspacePath: string; path: string; permanent?: boolean }) => {
      await getFs(input.workspacePath).deletePath({
        absolutePath: input.path,
        permanent: input.permanent,
      });
    },

    movePath: async (input: { workspacePath: string; sourcePath: string; destinationPath: string }) => {
      await getFs(input.workspacePath).movePath({
        sourceAbsolutePath: input.sourcePath,
        destinationAbsolutePath: input.destinationPath,
      });
    },

    getMetadata: async (input: { workspacePath: string; path: string }) => {
      const result = await getFs(input.workspacePath).getMetadata({
        absolutePath: input.path,
      });
      if (!result) throw new Error(`File not found: ${input.path}`);
      // FsMetadata → FileMetadata
      // FsMetadata has no `name` — extract from absolutePath via basename()
      // FsMetadata uses `modifiedAt: string | null` (ISO) — convert to epoch ms
      return {
        name: basename(result.absolutePath),
        isDirectory: result.kind === "directory",
        isSymlink: result.kind === "symlink" || !!result.symlinkTarget,
        size: result.size ?? 0,
        mtime: result.modifiedAt ? new Date(result.modifiedAt).getTime() : 0,
      };
    },
  };
}
```

### 1.2b 修复 getMetadata router schema

🔧 Implement — 当前 router 的 `getMetadata` Zod schema 只接受 `{ workspacePath, relativePath }`，但 `createFilesystemRouter` 内部只传 `{ path: fullPath }` 给 `fs.getMetadata`，**漏掉了 `workspacePath`**。

**修改**: `apps/desktop/src/lib/trpc/routers/filesystem/index.ts`

```diff
  // createFilesystemRouter 的 getMetadata 方法：
  async getMetadata(input: {
    workspacePath: string;
    relativePath: string;
  }): Promise<FileMetadata> {
    const fullPath = join(input.workspacePath, input.relativePath);
-   return fs.getMetadata({ path: fullPath });
+   return fs.getMetadata({ workspacePath: input.workspacePath, path: fullPath });
  },
```

这样 adapter 的 `getMetadata` 就能拿到 `workspacePath` 来获取正确的 `FsHostService` 实例。

### 1.3 替换空对象占位

🔌 Wire — 修改 `apps/desktop/src/main/index.ts`。

```diff
+ import { createFsAdapter } from "./lib/workspace-fs/adapter";
+ import { closeAllFsHostServices } from "./lib/workspace-fs";

  const deps: AppRouterDeps = {
    getDb,
    getGit: (cwd?) => require("simple-git").simpleGit(cwd),
-   fsOps: {},
+   fsOps: createFsAdapter(),
    hotkeyStore: createInMemoryHotkeyStore(),
    settingsDb: createSettingsDbOps(),
  };

  app.on("will-quit", () => {
    closeLocalDb();
+   closeAllFsHostServices();
  });
```

### 验收

- `trpc.filesystem.listDirectory({ workspacePath: "/tmp", relativePath: "" })` → 返回真实目录列表
- `trpc.filesystem.readFile({ workspacePath: "/tmp", relativePath: "test.txt" })` → 返回文件内容

### Tests

| Layer | Test | File |
|:------|:-----|:-----|
| L1 | `createFsAdapter` 正确映射签名并委托 | `apps/desktop/src/main/lib/workspace-fs/__tests__/adapter.test.ts` |
| L2 | filesystem tRPC router → adapter → 真实 FS → 读写 tmp 目录 | `apps/desktop/src/lib/trpc/routers/filesystem/__tests__/integration.test.ts` |

### Commits

```
feat: create workspace-fs adapter bridging router to FsHostService
feat: wire filesystem router to real workspace-fs host
test: add filesystem adapter and integration tests
```

---

## Phase 2: Wire Project/Workspace Data into Renderer

**目标**：WorkspaceSidebar 显示真实 project 列表，支持添加项目和切换 workspace。

**当前状态**：

- `projects` router (`createProjectsTrpcRouter(getDb)`) ✅ 真实，有 CRUD procedures
- `workspaces` router (`createWorkspacesTrpcRouter(getDb)`) ✅ 真实
- `WorkspaceSidebar.tsx:101` 硬编码 `"No projects yet"`，按钮无 handler，零 tRPC 调用

### 2.1 WorkspaceSidebar 接通 projects router

🧩 Consume

**修改**: `apps/desktop/src/renderer/components/Sidebar/WorkspaceSidebar.tsx`

| 当前 | 替换为 |
|:-----|:-------|
| `"No projects yet"` 文字 | `trpc.projects.list.useQuery()` → 渲染 project 列表 |
| 空 "Add Project" 按钮 | `Dialog` 表单 → `trpc.projects.create.useMutation()` |
| 无 workspace 列表 | 点击 project → `trpc.workspaces.list.useQuery({ projectId })` → 展开 workspace 列表 |

### 2.2 Workspace 选择驱动路由和 pane

🧩 Consume

点击 workspace → 更新 Zustand active workspace state → 触发 tabs store `addPane` (Welcome tab) → MosaicLayout 渲染。

需要新增一个轻量 store 或扩展现有 store 追踪 `activeProjectId` / `activeWorkspaceId`。

### 验收

- App 启动 → 数据库有 project 时 sidebar 渲染 project 名称
- 点击 "Add Project" → Dialog → 输入路径 → 创建成功 → sidebar 刷新
- 点击 workspace → 主区域从 "No open panes" 变为 Welcome pane

### Tests

| Layer | Test | File |
|:------|:-----|:-----|
| L1 | WorkspaceSidebar 接 tRPC 后 render project list (mock tRPC) | `...Sidebar/__tests__/WorkspaceSidebar.test.tsx` |
| L1 | "Add Project" dialog 触发 create mutation | 同上 |

### Commits

```
feat: wire WorkspaceSidebar to projects tRPC router
feat: add project creation dialog
feat: wire workspace selection to tabs store
test: add WorkspaceSidebar wiring tests
```

---

## Phase 3: Render Real Pane Content

**目标**：PaneContent 渲染 CodeEditor（文件）、FileExplorer 使用真实目录、Diff viewer 基础可用。

**当前状态**：

- `PaneContent.tsx:33` 所有非-Welcome tab fallthrough 到 `PlaceholderContent`
- `CodeEditor.tsx` 121 行 ✅ 完整可用，但未被 PaneContent 引用
- `FileExplorer.tsx:15` 硬编码 `DEMO_TREE`，`onFileSelect` prop 存在但无调用方传真实数据
- `tabs/types.ts` 定义 `TabType.Editor | Terminal | Diff | Welcome`

### 3.1 FileExplorer 接通 filesystem router

🧩 Consume

**修改**: `apps/desktop/src/renderer/components/FileExplorer/FileExplorer.tsx`

| 当前 | 替换为 |
|:-----|:-------|
| `DEMO_TREE` 常量 | `trpc.filesystem.listDirectory.useQuery({ workspacePath, relativePath: "" })` |
| 静态展开 | 惰性加载：点击文件夹 → `listDirectory` 子目录 |
| `onFileSelect` 未被消费 | 点击文件 → push 到 tabs store → PaneContent 渲染 editor |

FileExplorer 组件签名已支持 `tree` prop 注入（`FileExplorer({ tree = DEMO_TREE, rootId, onFileSelect })`），可以在外层 wrapper 中 fetch 真实 tree 传入。或直接改为内部 useQuery。

### 3.2 PaneContent 渲染 CodeEditor

🧩 Consume

**修改**: `apps/desktop/src/renderer/components/MosaicLayout/PaneContent.tsx`

```diff
  switch (tab.type) {
    case TabType.Welcome:
      return <WelcomeContent />;
+   case TabType.Editor:
+     return <EditorContent tab={tab} />;
+   case TabType.Diff:
+     return <DiffContent tab={tab} />;
    default:
      return <PlaceholderContent tab={tab} />;
  }
```

**EditorContent**：从 `tab.data.filePath` 取文件路径 → `trpc.filesystem.readFile.useQuery()` → 传入 `<CodeEditor value={content} filename={name} onChange={...} />`。保存：`trpc.filesystem.writeFile.useMutation()`。

**DiffContent**：从 `tab.data` 取文件路径 → `trpc.changes.diff.useQuery()` → 渲染 diff（可先用 CodeMirror diff extension，或简单文本对比）。

### 3.3 File open 流程串联

🧩 Consume — FileExplorer `onFileSelect` → ContentSidebar → tabs store `addTab({ type: TabType.Editor, data: { workspacePath, filePath } })` → PaneContent `EditorContent` → CodeEditor。

### 验收

- 点击 workspace → sidebar 显示文件树（来自 filesystem router）
- 点击 `.ts` 文件 → 新 tab 打开 → CodeMirror 渲染真实文件内容
- 编辑文件 → dirty 标记 → Cmd+S 保存
- Changes 面板打开 diff tab → 显示 git diff

### Tests

| Layer | Test | File |
|:------|:-----|:-----|
| L1 | PaneContent 按 TabType 分发到正确组件 | `...MosaicLayout/__tests__/PaneContent.test.tsx` |
| L1 | EditorContent 调用 readFile 并渲染 CodeEditor | `...MosaicLayout/__tests__/EditorContent.test.tsx` |
| L1 | FileExplorer useQuery → 渲染真实目录 (mock tRPC) | `...FileExplorer/__tests__/FileExplorer.test.tsx` |

### Commits

```
feat: wire FileExplorer to filesystem tRPC router
feat: render CodeEditor in PaneContent for Editor tabs
feat: add DiffContent with changes router integration
feat: connect file open flow (explorer → tab → editor)
test: add PaneContent and FileExplorer wiring tests
```

---

## Phase 4: Implement Terminal

**目标**：用户能在 pane 中打开真实 terminal session。

**当前状态**：

| 组件 | 文件 | 状态 |
|:-----|:-----|:-----|
| `TerminalHost` class | `main/terminal-host/terminal-host.ts` (397行) | ✅ 真实代码：session lifecycle, write/resize/kill, Socket-based attach/detach, Semaphore spawn limiter |
| `Session` class | `main/terminal-host/session.ts` (681行) | ✅ 真实代码：PTY subprocess 通信（binary frame protocol），spawn/write/resize/kill/attach/detach |
| Terminal Manager | `main/lib/terminal/index.ts` (37行) | 🔴 三个空函数（`reconcileDaemonSessions` / `prewarmTerminalRuntime` / `restartDaemon`） |
| Terminal Router | `lib/trpc/routers/terminal/index.ts` | 🔴 空 stub router |
| Terminal types | `main/lib/terminal/types.ts` + `renderer/components/Terminal/types.ts` | ✅ `CreateSessionParams`, `SessionResult`, `TerminalProps`, mutation 类型全部定义好 |
| Terminal config/helpers | `renderer/components/Terminal/config.ts` + `helpers.ts` | ✅ xterm options, copy/paste handlers, keyboard handler |
| Terminal React component | — | 🔴 **不存在**（`Terminal/index.ts` 标注 "No Terminal.tsx React component yet"） |

**关键洞察**：daemon 层（TerminalHost + Session）是完整的真实代码，不是 stub。但它通过 **Node.js `net.Socket`** 通信（不是 tRPC），架构是：main process 启动 terminal-host daemon 进程 → daemon 监听 Unix socket → renderer 通过 main process 代理连接 socket。

### 4.1 实现 Terminal Manager

🔧 Implement — 填充 `main/lib/terminal/index.ts`。

**修改**: `apps/desktop/src/main/lib/terminal/index.ts`

| 函数 | 实现 |
|:-----|:-----|
| `prewarmTerminalRuntime()` | fork `terminal-host/index.ts` 作为 daemon 子进程（`ELECTRON_RUN_AS_NODE=1`），建立 IPC 通道 |
| `reconcileDaemonSessions()` | 连接 daemon → `listSessions()` → kill orphan sessions（无对应 workspace 的） |
| `restartDaemon()` | 向 daemon 发送 `killAll` → 等待退出 → 重新 fork |

### 4.2 实现 Terminal Router

🔧 Implement — 改为工厂函数，通过 daemon Socket 连接代理所有操作。

**修改**: `apps/desktop/src/lib/trpc/routers/terminal/index.ts`

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `createOrAttach` | mutation | 通过 daemon socket 创建/附加 PTY session，返回 `SessionResult` |
| `write` | mutation | `daemon.write({ sessionId, data })` |
| `resize` | mutation | `daemon.resize({ sessionId, cols, rows })` |
| `kill` | mutation | `daemon.kill({ sessionId })` |
| `listSessions` | query | `daemon.listSessions()` |
| `detach` | mutation | `daemon.detach({ sessionId })` |

> **数据流方向**：PTY 输出通过 Socket 推送到 renderer，不走 tRPC query/subscription。renderer 直连 daemon Socket（通过 main process 转发 IPC）。这与 superset 的架构一致。

### 4.2b 实现 Terminal IPC Event Bridge

🔧 Implement — main → renderer 的实时数据推送通道。

**当前状态**：preload 已暴露 `App.ipcRenderer.on(channel, listener)` （`preload/index.ts:16`），renderer 可监听。但 main process 没有对应的 `webContents.send()` 调用——需要补全这个桥。

**新建**: `apps/desktop/src/main/lib/terminal/ipc-bridge.ts`

```ts
import type { BrowserWindow } from "electron";

/** IPC channel 约定 */
export const TERMINAL_IPC = {
  DATA: "terminal:data",        // main → renderer: PTY 输出
  EXIT: "terminal:exit",        // main → renderer: PTY 退出
  ERROR: "terminal:error",      // main → renderer: PTY 错误
} as const;

/**
 * 桥接 daemon Socket 事件到 renderer IPC.
 * 当 daemon 推送 session event 时，通过 webContents.send 转发到 renderer。
 */
export function createTerminalIpcBridge(getWindow: () => BrowserWindow | null) {
  return {
    onData(sessionId: string, data: string) {
      getWindow()?.webContents.send(TERMINAL_IPC.DATA, { sessionId, data });
    },
    onExit(sessionId: string, exitCode: number, signal?: number) {
      getWindow()?.webContents.send(TERMINAL_IPC.EXIT, { sessionId, exitCode, signal });
    },
    onError(sessionId: string, error: string) {
      getWindow()?.webContents.send(TERMINAL_IPC.ERROR, { sessionId, error });
    },
  };
}
```

**Renderer 侧消费**（在 Terminal.tsx 中）：

```ts
// 监听 main process 推送的 PTY 输出
useEffect(() => {
  const cleanup = window.App.ipcRenderer.on(
    "terminal:data",
    (payload: { sessionId: string; data: string }) => {
      if (payload.sessionId === currentSessionId) {
        xtermRef.current?.write(payload.data);
      }
    },
  );
  return cleanup; // App.ipcRenderer.on 返回 removeListener 函数
}, [currentSessionId]);
```

**需要修改的文件**：
- `apps/desktop/src/main/lib/terminal/ipc-bridge.ts` (new)
- `apps/desktop/src/main/lib/terminal/index.ts` — manager 在收到 daemon session event 时调用 bridge
- `apps/desktop/src/renderer/components/Terminal/Terminal.tsx` — 通过 `App.ipcRenderer.on` 监听

### 4.3 创建 Terminal React 组件

🔧 Implement — 从零创建。

**新建**: `apps/desktop/src/renderer/components/Terminal/Terminal.tsx`

消费同目录已有模块：

```ts
import { TERMINAL_OPTIONS, withEmojiFontFallback } from "./config";
import { setupCopyHandler, setupPasteHandler, setupKeyboardHandler } from "./helpers";
import type { TerminalProps } from "./types";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { trpc } from "../../lib/trpc";
```

**核心逻辑**：
1. `useRef` 持有 xterm 实例
2. `useEffect` mount：创建 XTerm → attach FitAddon → mount 到 DOM → setup copy/paste/keyboard handlers
3. `trpc.terminal.createOrAttach.useMutation()` 创建 PTY session
4. xterm `onData` → `trpc.terminal.write.mutate({ sessionId, data })`
5. PTY 输出 → `App.ipcRenderer.on("terminal:data", ...)` 接收 → `xterm.write(data)`（见 4.2b IPC bridge）
6. PTY 退出 → `App.ipcRenderer.on("terminal:exit", ...)` 处理退出状态
7. resize → debounced `trpc.terminal.resize.mutate()`
8. cleanup → `trpc.terminal.detach.mutate()` + xterm.dispose() + remove IPC listeners

### 4.4 PaneContent 接入 Terminal

🧩 Consume

**修改**: `apps/desktop/src/renderer/components/MosaicLayout/PaneContent.tsx`

```diff
+ case TabType.Terminal:
+   return <TerminalContent tab={tab} />;
```

### 4.5 更新 AppRouterDeps

```diff
  export interface AppRouterDeps {
    getDb: () => any;
    getGit: (cwd?: string) => any;
    fsOps: any;
    hotkeyStore: any;
    settingsDb: any;
+   terminalManager: TerminalManager;
  }
```

### 验收

- 点击 "New Terminal"（或 Cmd+T）→ 新 tab 打开 → xterm 渲染 → 可输入命令 → 看到输出
- 多个 terminal tab 独立 session
- 关闭 tab → session kill

### Tests

| Layer | Test | File |
|:------|:-----|:-----|
| L1 | Terminal manager fork/connect/write (mock child_process) | `main/lib/terminal/__tests__/index.test.ts` |
| L1 | IPC bridge 正确调用 webContents.send (mock BrowserWindow) | `main/lib/terminal/__tests__/ipc-bridge.test.ts` |
| L1 | Terminal router 正确委托 manager | `lib/trpc/routers/terminal/__tests__/index.test.ts` |
| L1 | Terminal.tsx render + IPC listener setup (mock xterm + IPC) | `renderer/components/Terminal/__tests__/Terminal.test.tsx` |
| L2 | 创建 session → 写入 → IPC 接收输出 → kill | `main/lib/terminal/__tests__/integration.test.ts` |

### Commits

```
feat: implement terminal manager (prewarm, reconcile, restart)
feat: implement terminal IPC event bridge (main → renderer)
feat: implement terminal tRPC router
feat: create Terminal.tsx React component with xterm integration
feat: render Terminal in PaneContent
test: add terminal stack tests
```

---

## Phase 5: Implement Remaining Stub Routers

**目标**：window / config / external / autoUpdate / menu 从 stub 变为真实实现。

这些 router 对 alpha 验收不关键，但对 app 完整性必要。按复杂度从低到高排列。

### 5.1 Config Router

🔧 Implement — 暴露 read-only 系统信息。

**修改**: `apps/desktop/src/lib/trpc/routers/config/index.ts`

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `getAppVersion` | query | `app.getVersion()` |
| `getPlatform` | query | `process.platform` |
| `getDataPath` | query | `app.getPath("userData")` |

改为工厂函数 `createConfigRouter(getAppInfo)`，在 `AppRouterDeps` 新增 `getAppInfo`。

### 5.2 External Router

🔧 Implement — Electron `shell` API 打开外部应用。

**修改**: `apps/desktop/src/lib/trpc/routers/external/index.ts`

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `openInFinder` | mutation | `shell.showItemInFolder(path)` |
| `openUrl` | mutation | `shell.openExternal(url)` |
| `openInEditor` | mutation | 按 settings `defaultApp` 调用指定编辑器 |

### 5.3 Window Router

🔧 Implement — BrowserWindow 控制。

**修改**: `apps/desktop/src/lib/trpc/routers/window.ts`

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `minimize` | mutation | `win.minimize()` |
| `maximize` | mutation | toggle maximize/unmaximize |
| `close` | mutation | `win.close()` |
| `isMaximized` | query | 返回最大化状态 |

改为工厂函数 `createWindowRouter(getWindow)`，在 `AppRouterDeps` 新增 `getWindow`。

### 5.4 Menu — 从零创建

🔧 Implement — **main process 当前无任何原生菜单基础设施**。

**新建**: `apps/desktop/src/main/lib/menu/index.ts`

```ts
import { Menu } from "electron";

export function buildApplicationMenu(): Menu {
  const template = [
    { role: "appMenu" },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  return Menu.buildFromTemplate(template as Electron.MenuItemConstructorOptions[]);
}
```

**修改**: `apps/desktop/src/lib/trpc/routers/menu.ts` — 暴露 `getMenu` query + `triggerAction` mutation。

### 5.5 Auto-Update Router

🔧 Implement — 包装 `electron-updater`。

**修改**: `apps/desktop/src/lib/trpc/routers/auto-update/index.ts`

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `checkForUpdates` | mutation | `autoUpdater.checkForUpdates()` |
| `getUpdateInfo` | query | 返回当前更新状态 |

### Tests

| Layer | Test |
|:------|:-----|
| L1 | 每个 router 的 procedures 正确委托底层 API |

### Commits

```
feat: implement config tRPC router
feat: implement external tRPC router
feat: implement window tRPC router
feat: create application menu and implement menu router
feat: implement auto-update tRPC router
test: add stub router implementation tests
```

---

## Phase 6: Bind Settings & Hotkeys UI to Routers

**目标**：至少 Appearance 和 Terminal 设置页面能真实保存和回读。

**当前状态**：

- 6 个 settings 页面（`appearance.tsx`, `terminal.tsx`, `behavior.tsx`, `git.tsx`, `keyboard.tsx`, `presets.tsx`）各只有标题 + 一行描述文字，零表单控件
- 后端已就绪：`settingsTrpcRouter` 有 `get` query + `update` mutation，Zod schema 完整
- `useSettingsStore` Zustand store 有完整 state 字段和 actions
- `createInMemoryHotkeyStore()` 有 `list` / `get` / `update` / `reset`

### 6.1 Appearance Settings 页面

🧩 Consume

**修改**: `apps/desktop/src/renderer/routes/_dashboard/settings/appearance.tsx`

```tsx
function AppearanceSettings() {
  const { data: settings } = trpc.settings.get.useQuery();
  const update = trpc.settings.update.useMutation({
    onSuccess: () => utils.settings.get.invalidate(),
  });

  return (
    <Card>
      <CardContent className="space-y-6">
        <Field label="Editor Font Family">
          <Input
            value={settings?.editorFontFamily ?? ""}
            onChange={(e) => update.mutate({ editorFontFamily: e.target.value })}
          />
        </Field>
        <Field label="Editor Font Size">
          <Input
            type="number"
            value={settings?.editorFontSize ?? 14}
            onChange={(e) => update.mutate({ editorFontSize: +e.target.value })}
          />
        </Field>
        {/* theme selector, etc. */}
      </CardContent>
    </Card>
  );
}
```

### 6.2 Terminal Settings 页面

🧩 Consume — 同模式绑定 `terminalFontFamily`, `terminalFontSize`, `terminalLineHeight` 等字段。

### 6.3 Keyboard Settings 页面

🧩 Consume — `trpc.hotkeys.list.useQuery()` → 渲染快捷键列表 → 点击编辑 → `trpc.hotkeys.update.useMutation()`。

### 6.4 其余页面

🧩 Consume — Behavior（`fileOpenMode`, `executionMode`）、Git（`defaultBranch`, `branchPrefix`）、Presets（`terminalPresets` JSON）。按同模式绑定。

### 验收

- 打开 Settings → Appearance → 修改 font size → 回到编辑器 → 字体变化
- 重启 app → 设置持久化

### Tests

| Layer | Test |
|:------|:-----|
| L1 | Settings 页面 onChange 触发 mutation (mock tRPC) |
| L2 | 修改 setting → query 返回新值 |

### Commits

```
feat: bind appearance settings page to settings tRPC router
feat: bind terminal settings page to settings tRPC router
feat: bind keyboard settings page to hotkeys tRPC router
feat: bind remaining settings pages
test: add settings UI binding tests
```

---

## Phase 7: Consume @signoff/ui

**目标**：统一 UI 组件，将手写 HTML 替换为 `@signoff/ui` shadcn 组件。

这是 polish phase，不影响功能验收，但提升一致性。

### 7.1 验证 import 路径

🧩 Consume — 确认 `import { Button } from "@signoff/ui/button"` 在 electron-vite renderer 中可解析。

### 7.2 Sidebar 组件替换

| 手写元素 | 替换为 |
|:---------|:-------|
| `<button className="...">` | `<Button variant="ghost" size="icon">` |
| `<div className="overflow-auto">` | `<ScrollArea>` |
| `<div className="h-px">` | `<Separator />` |
| `title` attr | `<Tooltip>` |

### 7.3 Settings 页面组件替换

Phase 6 中的表单已使用 shadcn 组件。这里补全：

| 场景 | 组件 |
|:-----|:-----|
| 确认危险操作 | `AlertDialog` |
| 新建 project | `Dialog` |
| 侧边属性面板 | `Sheet` |

### 7.4 MosaicLayout TabBar

🧩 Consume — TabBar 中的手写 tab 按钮替换为 shadcn Tabs 或保持自定义（视视觉需求）。

### Commits

```
refactor: consume @signoff/ui in WorkspaceSidebar
refactor: consume @signoff/ui in ContentSidebar
refactor: consume @signoff/ui in Settings pages
refactor: consume @signoff/ui Dialog/Sheet globally
```

---

## Phase 8: Persistence, Subscriptions, E2E

**目标**：补全非关键路径的持久化和通信优化。

### 8.1 Hotkey Persistence

🔧 Implement — `createInMemoryHotkeyStore` → `createPersistentHotkeyStore(getDb)`。

在 settings 表新增 `customHotkeys` JSON column（settings 表是单行设计，适合追加列）。

### 8.2 tRPC Subscription 评估

🔧 Implement — 验证 `trpc-electron@0.1.2` 对 subscription 的支持。如果支持：

- Terminal `onData` 从 IPC event 迁移到 subscription
- Window `onMaximizedChange` 用 subscription

如果不支持：保持 IPC event 模式，记录为 tech debt。

### 8.3 E2E Smoke Test

🔧 Implement — Playwright/Spectron 级别的 E2E：启动 app → 添加 project → 打开文件 → 编辑 → 保存 → 开 terminal。

### Commits

```
feat: persist hotkey customizations to SQLite
chore: evaluate trpc-electron subscription support
test: add e2e smoke test for alpha workflow
```

---

## Execution Order & Dependencies

```
Phase 0 (Unblock Runtime)           ← 必须先做，否则无法验证任何代码
    ↓
Phase 1 (Filesystem)          ┐
Phase 2 (Project/Workspace)   ├──── 可并行：sidebar 接 projects router 不依赖 filesystem
                              ┘
    ↓
Phase 3 (Real Pane Content)         ← 依赖 Phase 1 (filesystem for file tree/editor)
                                       依赖 Phase 2 (project context for workspace selection)
    ↓
Phase 4 (Terminal)                  ← 独立于 Phase 2/3，排在后面因为复杂度高
    ↓
Phase 5 (Stub Routers)       ┐
Phase 6 (Settings Binding)   ├──── 可并行，互不依赖
Phase 7 (UI Polish)          ┘
    ↓
Phase 8 (Persistence/E2E)          ← 最后做
```

**Alpha 验收点**: Phase 0-4 完成后，6 个验收标准中的前 5 个已满足。Phase 6 完成后满足第 6 个。

---

## AppRouterDeps 最终形态

```ts
export interface AppRouterDeps {
  getDb: () => BunSQLiteDatabase<typeof schema>;
  getGit: (cwd?: string) => SimpleGit;
  fsOps: FsAdapter;                              // Phase 1
  hotkeyStore: HotkeyStore;                      // Phase 8: persistent
  settingsDb: SettingsDbOps;
  getWindow: () => BrowserWindow | null;          // Phase 5
  terminalManager: TerminalManager;               // Phase 4
  getAppInfo: () => AppInfo;                      // Phase 5
}
```

---

## Risk & Assumptions

| # | Assumption | Impact if wrong | Mitigation |
|:--|:-----------|:----------------|:-----------|
| A1 | `FsEntry.kind` uses exact values `"file"` / `"directory"` / `"symlink"` / `"other"` (verified in `types.ts:1`) | Phase 1 adapter `isDirectory`/`isSymlink` mapping wrong | Already verified — `FsEntryKind` is a literal union |
| A2 | `FsReadResult.kind === "text"` for most source files; binary fallback via latin1 is acceptable | Phase 1 readFile returns garbled content for binary | Renderer should detect `encoding: "binary"` and show hex/binary view |
| A3 | Terminal daemon communicates via Node.js `net.Socket` (not tRPC), renderer needs IPC forwarding via `webContents.send` | Phase 4 architecture design wrong | Verified in `terminal-host.ts` — uses `socket.write(JSON.stringify(event))`. IPC bridge (4.2b) handles main→renderer forwarding |
| A4 | `postinstall` runs in CI during `bun install` | CI environment may lack Electron headers | Script checks for `binding.gyp` existence, skips if absent |
| A5 | electron-vite can resolve `@signoff/ui/*` wildcard exports | Phase 7 blocked | Phase 7 first step validates |
| A6 | `trpc-electron@0.1.2` does not support tRPC subscription | Terminal/window real-time events need IPC fallback | Phase 4 uses IPC bridge (4.2b); Phase 8 evaluates subscription support |
