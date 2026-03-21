# 02 — From Skeleton to Usable Alpha

## Overview

01 完成了骨架搭建：monorepo 结构就位、12 个 tRPC router 定义完毕（6 真实 + 6 stub）、Electron boot 序列跑通、DB/settings/projects/workspaces/changes 等核心 router 后端可用。

**但用户打开 app 看到的是**：空的 sidebar（"No projects yet"）、placeholder pane（"Welcome to Signoff" 文字）、静态假文件树、空设置页面。所有后端能力都没有在前端呈现。

本文档将 skeleton 推进到 **Usable Alpha** —— 用户能打开 app → 添加项目 → 浏览文件 → 打开编辑器/终端 → 调整设置。

### Current State Matrix

| Layer | 状态 | 说明 |
|:------|:-----|:-----|
| **Runtime** | 🔴 Blocked | `better-sqlite3` ABI mismatch，`bun install` 后需手动 `node-gyp rebuild`，无自动化 |
| **DB + Migrations** | ✅ Real | better-sqlite3 WAL + Drizzle, 5 tables |
| **tRPC IPC Bridge** | ✅ Real | preload → ipcLink → main handler, superjson |
| **projects/workspaces/changes/settings/hotkeys router** | ✅ Real | DB 或 in-memory 实现 |
| **filesystem router** | ⚠️ Crash | 代码完整，但 `fsOps: {}` 导致所有调用 `TypeError` |
| **window/menu/config/external/autoUpdate/terminal router** | 🔴 Stub | 空 procedure，无任何 main process 基础设施 |
| **Renderer — Sidebar** | 🟡 Shell | resize/collapse 可用，数据层空白（零 tRPC 调用） |
| **Renderer — PaneContent** | 🔴 Placeholder | Welcome 文字 + 其余 tab type 全 fallthrough 到 `PlaceholderContent` |
| **Renderer — FileExplorer** | 🔴 Placeholder | 硬编码 `DEMO_TREE`，零 tRPC 调用 |
| **Renderer — Terminal** | 🔴 No component | 只有 helpers/config/types，无 `.tsx` React 组件 |
| **Renderer — Settings** | 🔴 Placeholder | 6 个页面各只有标题 + 一行描述文字，零表单控件 |
| **`@signoff/ui`** | ✅ Available | 56+ shadcn 组件就绪，renderer **几乎零消费** |

### Approach

每一步标注为：

- **🛠️ Fix** — 修复阻塞问题（build/runtime）
- **🔌 Wire** — 把已有模块/包连接到 skeleton
- **🧩 Consume** — renderer 侧消费已有组件/hooks/router
- **🔧 Implement** — 需要写新逻辑（尽量小范围）

---

## Phase 0: Unblock Runtime — better-sqlite3 ABI Rebuild

**目标**：`bun install` 后自动完成 native module rebuild，开发者不再需要手动执行 `node-gyp` 命令。

**当前状态**：

- `better-sqlite3@12.6.2` 编译时链接 Bun 的 Node headers（`NODE_MODULE_VERSION=137`）
- Electron 40 期望 `NODE_MODULE_VERSION=143`
- 启动 `bun run dev` 后 main process 立即 crash：`ERR_DLOPEN_FAILED`
- 唯一的修复文档在 `CLAUDE.md` 里，是手动 5 行 shell 命令
- 无 `postinstall` hook，无 rebuild 脚本，无 electron-builder `afterPack` hook
- `node-pty` 使用 prebuilds，不受影响

### 0.1 添加 rebuild 脚本

🛠️ Fix — 创建自动化脚本。

**文件**: `scripts/rebuild-native.sh` (new)

```bash
#!/usr/bin/env bash
set -euo pipefail

ELECTRON_VERSION=$(node -e "console.log(require('electron/package.json').version)")
ARCH=$(uname -m | sed 's/arm64/arm64/' | sed 's/x86_64/x64/')

echo "Rebuilding better-sqlite3 for Electron $ELECTRON_VERSION ($ARCH)..."

BETTER_SQLITE3_DIR=$(find node_modules -path '*/better-sqlite3' -name 'package.json' -exec dirname {} \; | head -1)

if [ -z "$BETTER_SQLITE3_DIR" ]; then
  echo "better-sqlite3 not found, skipping rebuild"
  exit 0
fi

cd "$BETTER_SQLITE3_DIR"
npx --yes node-gyp rebuild \
  --target="$ELECTRON_VERSION" \
  --arch="$ARCH" \
  --dist-url=https://electronjs.org/headers
```

### 0.2 注册 postinstall hook

🛠️ Fix — 修改 root `package.json`。

```diff
  "scripts": {
+   "postinstall": "bash scripts/rebuild-native.sh",
    "dev": "turbo run dev",
```

### 0.3 更新 CLAUDE.md

🛠️ Fix — 删除手动 rebuild 指南，替换为 `bun install` 自动处理的说明。

### Tests

| Layer | Test |
|:------|:-----|
| L1 (Unit) | `scripts/rebuild-native.sh` 在 CI 中 exit 0（无 better-sqlite3 时 skip） |
| G1 (Smoke) | `bun install && bun run dev` 不再 `ERR_DLOPEN_FAILED` |

### Commits

```
fix: automate better-sqlite3 rebuild for electron ABI compatibility
docs: update CLAUDE.md to reflect automated native rebuild
```

---

## Phase 1: Filesystem — 接通 workspace-fs

**目标**：`filesystem` router 的 7 个操作全部可用（listDirectory / readFile / writeFile / createDirectory / deletePath / movePath / getMetadata）。

**当前状态**：

- `@signoff/workspace-fs` 包已完整实现（`host/service.ts` 含全部 11 个 FS 操作）
- `filesystem/index.ts` 的 `createFilesystemTrpcRouter(fs)` 已写好，但 `FsOperations = any`
- `main/index.ts` 传入的是 `fsOps: {}`
- **接口鸿沟**：router 调用签名（`workspacePath` + `path`）与 `@signoff/workspace-fs` 的 `FsService` 接口（`absolutePath`）不匹配，需要 adapter 层

### 1.1 创建 workspace-fs adapter

🔌 Wire — 在 main process 中实例化 `FsHostService`，适配为 router 期望的调用签名。

**文件**: `apps/desktop/src/main/lib/workspace-fs/index.ts` (new)

```ts
import { createFsHostService } from "@signoff/workspace-fs/host";
import type { FsHostService } from "@signoff/workspace-fs/host";

/**
 * Per-workspace FsHostService factory.
 * Router 传入 { workspacePath, path } → adapter 拼接为 absolutePath 后委托给 FsHostService。
 */
export function createFsOpsFactory(): {
  getFsOps: (workspacePath: string) => FsHostService;
  closeAll: () => Promise<void>;
} {
  const instances = new Map<string, FsHostService>();

  function getFsOps(workspacePath: string): FsHostService {
    let fs = instances.get(workspacePath);
    if (!fs) {
      fs = createFsHostService({ rootPath: workspacePath });
      instances.set(workspacePath, fs);
    }
    return fs;
  }

  async function closeAll() {
    for (const fs of instances.values()) {
      await fs.close();
    }
    instances.clear();
  }

  return { getFsOps, closeAll };
}
```

> **关键决策**：`createFsHostService` 接受 `FsHostServiceOptions` 对象（含 `rootPath: string`），返回 `FsHostService`（含 `close(): Promise<void>`）。Router 的 `workspacePath` 参数需要在 adapter 中与 `path` 拼接为绝对路径再传给 `FsHostService`。

### 1.2 适配 filesystem router 调用签名

🔌 Wire — 修改 `filesystem/index.ts`，将 `FsOperations = any` 替换为明确的 adapter 接口。

**文件**: `apps/desktop/src/lib/trpc/routers/filesystem/index.ts`

Router 内部调用形如 `fs.listDirectory({ workspacePath, path })`。Adapter 需要：

```ts
// 将 router 的 { workspacePath, path } 转换为 FsHostService 的 absolutePath 调用
import { join } from "node:path";

export function createFsAdapter(getFsOps: (wp: string) => FsHostService) {
  return {
    listDirectory: ({ workspacePath, path }) =>
      getFsOps(workspacePath).listDirectory(join(workspacePath, path)),
    readFile: ({ workspacePath, path }) =>
      getFsOps(workspacePath).readFile(join(workspacePath, path)),
    // ... 同理 7 个方法
  };
}
```

### 1.3 替换空对象占位

🔌 Wire — 修改 `apps/desktop/src/main/index.ts`。

```diff
+ import { createFsOpsFactory } from "./lib/workspace-fs";

+ const { getFsOps, closeAll: closeFsOps } = createFsOpsFactory();

  const deps: AppRouterDeps = {
    getDb,
    getGit: (cwd?) => simpleGit(cwd),
-   fsOps: {},   // real wiring in Phase 9+
+   fsOps: createFsAdapter(getFsOps),
    hotkeyStore: createInMemoryHotkeyStore(),
    settingsDb: createSettingsDbOps(),
  };

  app.on("will-quit", () => {
    closeLocalDb();
+   closeFsOps();
  });
```

### Tests

| Layer | Test | File |
|:------|:-----|:-----|
| L1 (Unit) | `createFsOpsFactory` 缓存 + close | `apps/desktop/src/main/lib/workspace-fs/__tests__/index.test.ts` |
| L1 (Unit) | `createFsAdapter` 正确拼接路径并委托 | `apps/desktop/src/main/lib/workspace-fs/__tests__/adapter.test.ts` |
| L2 (Integration) | filesystem tRPC router → adapter → 真实 FS → 读写 tmp 目录 | `apps/desktop/src/lib/trpc/routers/filesystem/__tests__/integration.test.ts` |

### Commits

```
feat: create workspace-fs adapter bridging router to FsHostService
feat: wire filesystem router to real workspace-fs host
test: add filesystem adapter and integration tests
```

---

## Phase 2: UI Components — 消费 @signoff/ui

**目标**：renderer 中的手写 HTML 替换为 `@signoff/ui` 的 shadcn 组件，建立消费模式。

**当前状态**：

- `@signoff/ui` 通过 wildcard exports 导出 56+ 组件（`@signoff/ui/button` → `packages/ui/src/components/ui/button.tsx`）
- `apps/desktop/package.json` 已声明 `@signoff/ui` 依赖
- Renderer 几乎没有导入 `@signoff/ui`，Sidebar / TabBar / 设置页面全部手写 `<div>` + Tailwind

### 2.1 验证 import 路径可解析

🧩 Consume — 确认 renderer 侧 import 路径可解析。

在任意 renderer 文件中添加 `import { Button } from "@signoff/ui/button"` 并运行 `bun run dev`。确认 electron-vite 的 `tsconfigPaths` 插件能正确解析到 `packages/ui/src/components/ui/button.tsx`。如果不行，需在 `tsconfig.json` 的 `paths` 中添加映射。

### 2.2 Sidebar 组件替换

🧩 Consume — `WorkspaceSidebar.tsx` 当前全部手写 `<button>` + `<div>`。

| 手写元素 | 替换为 | Import |
|:---------|:-------|:-------|
| `<button className="...">` | `<Button variant="ghost" size="icon">` | `@signoff/ui/button` |
| `<div className="overflow-auto">` | `<ScrollArea>` | `@signoff/ui/scroll-area` |
| Divider `<div className="h-px">` | `<Separator />` | `@signoff/ui/separator` |
| 悬浮提示 (title attr) | `<Tooltip>` | `@signoff/ui/tooltip` |

**文件**: `apps/desktop/src/renderer/components/Sidebar/WorkspaceSidebar.tsx`

### 2.3 ContentSidebar 组件替换

🧩 Consume — 同理替换 ContentSidebar 中的手写元素。

**文件**: `apps/desktop/src/renderer/components/Sidebar/ContentSidebar.tsx`

### 2.4 Settings 页面组件引入

🧩 Consume — Settings 页面是表单密集区，引入 shadcn form 组件基础设施。

| 场景 | 组件 |
|:-----|:-----|
| 文本输入 | `Input` from `@signoff/ui/input` |
| 下拉选择 | `Select` from `@signoff/ui/select` |
| 开关切换 | `Switch` from `@signoff/ui/switch` |
| 标签页 | `Tabs` from `@signoff/ui/tabs` |
| 表单标签 | `Label` from `@signoff/ui/label` |
| 卡片容器 | `Card` from `@signoff/ui/card` |

> 注意：这里只是引入组件、替换手写 HTML。Settings 表单绑定到 tRPC router 在 Phase 8 中完成。

**文件**: `apps/desktop/src/renderer/routes/_dashboard/settings/` 下所有页面

### 2.5 Dialog / Sheet 全局基础设施

🧩 Consume — 建立统一的 Dialog/Sheet 使用模式：

| 场景 | 组件 |
|:-----|:-----|
| 确认删除 / 危险操作 | `AlertDialog` from `@signoff/ui/alert-dialog` |
| 新建 project | `Dialog` from `@signoff/ui/dialog` |
| 侧边属性面板 | `Sheet` from `@signoff/ui/sheet` |

### Tests

| Layer | Test | File |
|:------|:-----|:-----|
| L1 (Unit) | 替换后的 Sidebar render 不 crash | `apps/desktop/src/renderer/components/Sidebar/__tests__/WorkspaceSidebar.test.tsx` |
| L1 (Unit) | Settings 页面 render 不 crash | `apps/desktop/src/renderer/routes/settings/__tests__/appearance.test.tsx` |

### Commits

```
refactor: consume @signoff/ui Button and ScrollArea in WorkspaceSidebar
refactor: consume @signoff/ui in ContentSidebar
refactor: consume @signoff/ui form components in settings pages
refactor: consume @signoff/ui Dialog and Sheet globally
test: add render tests for refactored components
```

---

## Phase 3: Window & Menu Routers — 接通窗口控制

**目标**：window router 和 menu router 从 stub 变为真实实现。

**当前状态**：

- `window.ts` 是 static stub（空 procedure）
- `menu.ts` 是 static stub（空 procedure，含 `// TODO Phase 4+: onMenuAction subscription` 注释）
- **main process 中不存在任何原生菜单基础设施**（无 `Menu.buildFromTemplate()`，无 `app.applicationMenu`）
- `windows/main.ts` 有 BrowserWindow 创建逻辑

### 3.1 Window Router 实现

🔧 Implement — 把 `BrowserWindow` 操作暴露为 tRPC procedures。

**文件**: `apps/desktop/src/lib/trpc/routers/window.ts`

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `minimize` | mutation | `BrowserWindow.getFocusedWindow()?.minimize()` |
| `maximize` | mutation | toggle maximize/unmaximize |
| `close` | mutation | `win.close()` |
| `isMaximized` | query | 返回当前最大化状态 |
| `setTitle` | mutation | 设置窗口标题 |

**依赖注入**: 改为工厂函数 `createWindowRouter(getWindow: () => BrowserWindow | null)`，在 `AppRouterDeps` 中新增 `getWindow` 字段。

### 3.2 Menu 基础设施 + Router

🔧 Implement — 从零创建原生菜单，然后通过 router 暴露。

**新建文件**: `apps/desktop/src/main/lib/menu/index.ts`

```ts
import { Menu, type BrowserWindow } from "electron";

export function buildApplicationMenu(window: BrowserWindow): Menu {
  const template = [
    { role: "appMenu" },
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    // 自定义菜单项后续 phase 扩展
  ];
  return Menu.buildFromTemplate(template as any);
}
```

**修改文件**: `apps/desktop/src/lib/trpc/routers/menu.ts`

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `getMenu` | query | 返回当前菜单结构（序列化） |
| `triggerAction` | mutation | 触发菜单项 action（by id） |

### 3.3 更新 AppRouterDeps

🔌 Wire — 扩展依赖接口。

```diff
  export interface AppRouterDeps {
    getDb: () => any;
    getGit: (cwd?: string) => any;
    fsOps: any;
    hotkeyStore: any;
    settingsDb: any;
+   getWindow: () => BrowserWindow | null;
  }
```

### Tests

| Layer | Test | File |
|:------|:-----|:-----|
| L1 (Unit) | window router procedures 正确委托 BrowserWindow 方法 | `apps/desktop/src/lib/trpc/routers/__tests__/window.test.ts` |
| L1 (Unit) | menu router procedures 返回预期结构 | `apps/desktop/src/lib/trpc/routers/__tests__/menu.test.ts` |
| L1 (Unit) | `buildApplicationMenu` 返回合法 Menu | `apps/desktop/src/main/lib/menu/__tests__/index.test.ts` |

### Commits

```
feat: implement window tRPC router with BrowserWindow delegation
feat: create application menu infrastructure and tRPC router
refactor: extend AppRouterDeps with getWindow
test: add window and menu router unit tests
```

---

## Phase 4: Config & External Routers

**目标**：config router 提供应用配置读取，external router 提供外部编辑器/Finder 打开功能。

### 4.1 Config Router 实现

🔧 Implement — 暴露运行时配置（区别于 settings，config 是 read-only 系统信息）。

**文件**: `apps/desktop/src/lib/trpc/routers/config/index.ts`

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `getAppVersion` | query | `app.getVersion()` |
| `getPlatform` | query | `process.platform` |
| `getDataPath` | query | `app.getPath("userData")` |
| `getSystemFonts` | query | 列出可用系统字体（for terminal/editor） |

**依赖注入**: 改为工厂函数 `createConfigRouter(getAppInfo: () => AppInfo)`。

### 4.2 External Router 实现

🔧 Implement — 用 Electron `shell` API 打开外部应用。

**文件**: `apps/desktop/src/lib/trpc/routers/external/index.ts`

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `openInEditor` | mutation | 按用户 settings 中 `defaultApp` 调用指定编辑器 |
| `openInTerminal` | mutation | 在外部 terminal 中打开目录 |
| `openInFinder` | mutation | `shell.showItemInFolder(path)` |
| `openUrl` | mutation | `shell.openExternal(url)` |

### Tests

| Layer | Test | File |
|:------|:-----|:-----|
| L1 (Unit) | config router 返回正确的平台/版本信息 | `apps/desktop/src/lib/trpc/routers/__tests__/config.test.ts` |
| L1 (Unit) | external router 正确调用 shell API | `apps/desktop/src/lib/trpc/routers/__tests__/external.test.ts` |

### Commits

```
feat: implement config tRPC router
feat: implement external tRPC router with shell integration
test: add config and external router unit tests
```

---

## Phase 5: Terminal — 接通三层架构

**目标**：terminal router 从 stub 变为真实实现，连接 terminal-host daemon + pty-subprocess 架构，创建 Terminal React 组件。

**当前状态**：

- `terminal-host/index.ts` 和 `pty-subprocess.ts` 代码已存在（从 superset 复制）
- `main/lib/terminal/index.ts` 三个函数全空（`reconcileDaemonSessions` / `prewarmTerminalRuntime` / `restartDaemon`），标注 Phase 6+
- Terminal router 是 stub
- **`renderer/components/Terminal/` 只有 helpers/config/types，无 `.tsx` React 组件**（文件顶部标注 "🔴 Phase 5 trimmed: No Terminal.tsx React component yet"）

### 5.1 实现 Terminal Manager

🔧 Implement — 填充 `main/lib/terminal/index.ts` 的三个函数。

**文件**: `apps/desktop/src/main/lib/terminal/index.ts`

| 函数 | 实现 |
|:-----|:-----|
| `reconcileDaemonSessions()` | 查找已运行的 daemon 进程，清理孤儿 session |
| `prewarmTerminalRuntime()` | fork `terminal-host/index.ts` 作为子进程，建立 IPC 通道 |
| `restartDaemon()` | kill 现有 daemon → 重新 fork |

### 5.2 Terminal Router 实现

🔧 Implement — 把 terminal manager 暴露为 tRPC procedures。

**文件**: `apps/desktop/src/lib/trpc/routers/terminal/index.ts`

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `create` | mutation | 创建新 PTY session（spawn pty-subprocess） |
| `write` | mutation | 向指定 session 写入 |
| `resize` | mutation | 调整 PTY 大小 |
| `kill` | mutation | 终止 PTY session |
| `listSessions` | query | 列出活跃 session |

> **关于 Subscription**: `trpc-electron@0.1.2` 已安装，但代码库中零 subscription 使用。Terminal 数据流（`onData` / `onExit`）可先用 IPC event + invalidation 模式实现，后续验证 subscription 支持后再迁移。

### 5.3 创建 Terminal React 组件

🔧 Implement — **从零创建** `Terminal.tsx`（当前不存在），消费已有的 helpers/config/types。

**新建文件**: `apps/desktop/src/renderer/components/Terminal/Terminal.tsx`

```tsx
// 消费同目录已有模块：
import { defaultTerminalConfig } from "./config";
import { setupCopyHandler, setupPasteHandler } from "./helpers";
import type { TerminalProps } from "./types";
// 消费 xterm（已在 package.json 中）：
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
// 消费 tRPC：
import { trpc } from "../../lib/trpc";
```

**核心逻辑**：
1. `useRef` 持有 xterm 实例
2. `useEffect` 创建 xterm → attach FitAddon → mount 到 DOM
3. `trpc.terminal.create.useMutation()` 创建 PTY session
4. xterm `onData` → `trpc.terminal.write.mutate()`
5. PTY 输出 → 通过 IPC event 写入 xterm（先不用 subscription）
6. resize → `trpc.terminal.resize.mutate()`
7. cleanup → `trpc.terminal.kill.mutate()`

### 5.4 更新 AppRouterDeps

```diff
  export interface AppRouterDeps {
    // ... existing fields
+   getTerminalManager: () => TerminalManager;
  }
```

### Tests

| Layer | Test | File |
|:------|:-----|:-----|
| L1 (Unit) | Terminal manager 函数调用 child_process.fork | `apps/desktop/src/main/lib/terminal/__tests__/index.test.ts` |
| L1 (Unit) | Terminal router procedures 正确委托 manager | `apps/desktop/src/lib/trpc/routers/terminal/__tests__/index.test.ts` |
| L1 (Unit) | Terminal.tsx render 不 crash（mock xterm） | `apps/desktop/src/renderer/components/Terminal/__tests__/Terminal.test.tsx` |
| L2 (Integration) | 创建 session → 写入 → 接收输出 → kill | `apps/desktop/src/main/lib/terminal/__tests__/integration.test.ts` |

### Commits

```
feat: implement terminal manager (reconcile, prewarm, restart)
feat: implement terminal tRPC router with PTY lifecycle
feat: create Terminal.tsx React component with xterm integration
test: add terminal manager, router, and component tests
```

---

## Phase 6: Auto-Update Router

**目标**：接通 Electron auto-updater。

### 6.1 Auto-Update Router 实现

🔧 Implement — 包装 `electron-updater`。

**文件**: `apps/desktop/src/lib/trpc/routers/auto-update/index.ts`

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `checkForUpdates` | mutation | `autoUpdater.checkForUpdates()` |
| `downloadUpdate` | mutation | `autoUpdater.downloadUpdate()` |
| `installAndRestart` | mutation | `autoUpdater.quitAndInstall()` |
| `getUpdateInfo` | query | 返回当前更新状态/版本信息 |

### Tests

| Layer | Test |
|:------|:-----|
| L1 (Unit) | auto-update router 正确调用 autoUpdater API |

### Commits

```
feat: implement auto-update tRPC router
test: add auto-update router unit tests
```

---

## Phase 7: Hotkey Persistence

**目标**：hotkeys 从内存 store 改为 SQLite 持久化。

### 7.1 Hotkey Store 持久化

🔧 Implement — 修改 `createInMemoryHotkeyStore` 为 `createPersistentHotkeyStore(getDb)`。

**文件**: `apps/desktop/src/main/index.ts` (修改 store 创建)

**策略**: 在 settings 表中增加 `customHotkeys` JSON 字段（settings 表是单行设计，天然适合存全量 hotkey 配置）。

### Tests

| Layer | Test |
|:------|:-----|
| L1 (Unit) | 持久化 store 写入后重新读取能还原 |

### Commits

```
feat: persist hotkey customizations to SQLite settings table
test: add hotkey persistence tests
```

---

## Phase 8: Renderer Wiring — 从 Placeholder 到真实交互

**目标**：renderer 侧的 placeholder 组件全部接通后端 tRPC router，用户能完成完整工作流：添加项目 → 浏览文件 → 打开编辑器 → 使用终端 → 调整设置。

**当前状态**：

- Phase 1-7 完成后，所有 12 个 router 后端可用
- Phase 2 完成后，UI 组件库已消费
- 但 renderer 仍然是数据空白：sidebar 不调 tRPC，pane 渲染 placeholder，settings 无表单绑定

### 8.1 Project & Workspace 列表真实渲染

🧩 Consume — WorkspaceSidebar 接通 projects + workspaces router。

**文件**: `apps/desktop/src/renderer/components/Sidebar/WorkspaceSidebar.tsx`

| 当前 | 替换为 |
|:-----|:-------|
| 硬编码 "No projects yet" | `trpc.projects.list.useQuery()` 真实查询 |
| 空 "Add Project" 按钮 | `Dialog` + `trpc.projects.create.useMutation()` |
| 无 workspace 列表 | `trpc.workspaces.list.useQuery({ projectId })` |

**路由进入**: 点击 workspace → 更新 Zustand store 的 active workspace → MosaicLayout 根据 active workspace 渲染对应 pane。

### 8.2 File Explorer 消费 filesystem router

🧩 Consume — 替换硬编码 `DEMO_TREE`。

**文件**: `apps/desktop/src/renderer/components/FileExplorer/FileExplorer.tsx`

| 当前 | 替换为 |
|:-----|:-------|
| `DEMO_TREE` 常量 | `trpc.filesystem.listDirectory.useQuery({ workspacePath, path: "/" })` |
| 静态展开 | 惰性加载：点击文件夹 → `listDirectory` 子目录 |
| `onFileSelect` 未实现 | 打开文件 → `trpc.filesystem.readFile` → 推入 tab store → PaneContent 渲染 editor |

### 8.3 PaneContent 渲染真实组件

🧩 Consume — 替换 `PlaceholderContent`。

**文件**: `apps/desktop/src/renderer/components/MosaicLayout/PaneContent.tsx`

| TabType | 当前 | 替换为 |
|:--------|:-----|:-------|
| `Welcome` | ✅ "Welcome to Signoff" | 保持（后续可美化） |
| `Editor` | `PlaceholderContent` | `<CodeEditor>` 组件（已存在于 `components/Editor/CodeEditor.tsx`） |
| `Terminal` | `PlaceholderContent` | `<Terminal>` 组件（Phase 5 创建） |
| `Diff` | `PlaceholderContent` | Git diff viewer（消费 changes router） |

**CodeEditor 接通**: `CodeEditor.tsx` 已存在且有 CodeMirror 6 集成。需要把 tab 中的 `filePath` 传给 editor → `trpc.filesystem.readFile` 获取内容 → CodeMirror 渲染 → 保存时 `trpc.filesystem.writeFile`。

### 8.4 Settings 表单绑定 tRPC

🧩 Consume — 6 个 settings 页面绑定到 settings + hotkeys router。

**文件**: `apps/desktop/src/renderer/routes/_dashboard/settings/` 下所有页面

**通用模式**:

```tsx
function AppearanceSettings() {
  const { data: settings } = trpc.settings.get.useQuery();
  const update = trpc.settings.update.useMutation();

  return (
    <Card>
      <CardContent>
        <div className="space-y-4">
          <Field label="Font Family">
            <Select
              value={settings?.editorFontFamily}
              onValueChange={(v) => update.mutate({ editorFontFamily: v })}
            />
          </Field>
          <Field label="Font Size">
            <Input
              type="number"
              value={settings?.editorFontSize}
              onChange={(e) => update.mutate({ editorFontSize: +e.target.value })}
            />
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}
```

**6 个页面映射**:

| Page | Router | 关键字段 |
|:-----|:-------|:---------|
| Appearance | settings | editorFontFamily, editorFontSize, theme |
| Terminal | settings | terminalFontFamily, terminalFontSize, terminalLineHeight |
| Behavior | settings | fileOpenMode, executionMode, branchPrefixMode |
| Git | settings | defaultBranch, branchPrefix |
| Keyboard | hotkeys | 快捷键列表，支持编辑 |
| Presets | settings | terminalPresets (JSON) |

### Tests

| Layer | Test | File |
|:------|:-----|:-----|
| L1 (Unit) | WorkspaceSidebar 接 tRPC 后 render project list | `...Sidebar/__tests__/WorkspaceSidebar.test.tsx` |
| L1 (Unit) | FileExplorer 接 tRPC 后 render directory tree | `...FileExplorer/__tests__/FileExplorer.test.tsx` |
| L1 (Unit) | PaneContent 按 TabType 渲染正确组件 | `...MosaicLayout/__tests__/PaneContent.test.tsx` |
| L1 (Unit) | Settings 表单 onChange 触发 mutation | `...settings/__tests__/appearance.test.tsx` |
| L2 (Integration) | 添加项目 → sidebar 更新 → 点击 → 文件树加载 | `apps/desktop/src/renderer/__tests__/project-flow.test.tsx` |

### Commits

```
feat: wire WorkspaceSidebar to projects and workspaces tRPC router
feat: wire FileExplorer to filesystem tRPC router with lazy loading
feat: render CodeEditor and Terminal in PaneContent by TabType
feat: bind settings forms to settings and hotkeys tRPC router
test: add renderer wiring integration tests
```

---

## Execution Order & Dependencies

```
Phase 0 (Native Rebuild)      ← 无依赖，必须先做（否则 dev 无法启动）
    ↓
Phase 1 (Filesystem)  ┐
Phase 2 (UI Components)├──── 可并行，Phase 0 完成后立即开始
                       ┘
    ↓
Phase 3 (Window/Menu)     ← 依赖 Phase 1 的 AppRouterDeps 扩展模式
    ↓
Phase 4 (Config/External) ← 同理
    ↓
Phase 5 (Terminal)    ┐
Phase 6 (Auto-Update) ├──── 可并行
Phase 7 (Hotkey)      ┘
    ↓
Phase 8 (Renderer Wiring)     ← 依赖 Phase 1-7 全部完成（后端就绪）
                                 依赖 Phase 2（UI 组件已消费）
```

---

## AppRouterDeps 最终形态

完成所有 Phase 后，`AppRouterDeps` 应从 `any` 进化为类型安全接口：

```ts
export interface AppRouterDeps {
  getDb: () => BunSQLiteDatabase<typeof schema>;
  getGit: (cwd?: string) => SimpleGit;
  fsOps: FsAdapter;                              // Phase 1
  hotkeyStore: HotkeyStore;                      // Phase 7: persistent
  settingsDb: SettingsDbOps;
  getWindow: () => BrowserWindow | null;          // Phase 3
  getTerminalManager: () => TerminalManager;      // Phase 5
  getAppInfo: () => AppInfo;                      // Phase 4
}
```

---

## Risk & Assumptions

| # | Assumption | Impact if wrong | Mitigation |
|:--|:-----------|:----------------|:-----------|
| A1 | `createFsHostService({ rootPath })` 接受绝对路径作为 rootPath | Phase 1 adapter 拼接逻辑不对 | 读 `host/service.ts` 确认内部如何使用 rootPath |
| A2 | Filesystem router 的 `{ workspacePath, path }` 签名需要 adapter 拼接为绝对路径 | 若 FsHostService 自己拼接则 adapter 多此一举 | 对照 router Zod schema 和 FsService 方法签名 |
| A3 | terminal-host daemon IPC 协议已定义（从 superset 复制的代码） | Phase 5 需要匹配协议 | 读 `terminal-host/index.ts` 确认消息格式 |
| A4 | electron-vite 能解析 `@signoff/ui/*` wildcard exports | Phase 2 第一步就会暴露 | 2.1 验证步骤会立即发现 |
| A5 | `trpc-electron@0.1.2` 不支持 tRPC subscription | Terminal 数据流需用 IPC event 替代 | Phase 5 用 mutation + IPC event 模式，后续可迁移 |
| A6 | `postinstall` script 在 CI (`bun install`) 中也会执行 | CI 环境无 Electron headers 可能 fail | 脚本内检测 `better-sqlite3` 是否存在，不存在则 skip |
