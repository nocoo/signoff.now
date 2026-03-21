# 02 — Wire Existing Modules to Skeleton

## Overview

01 完成了骨架搭建：monorepo 结构就位、12 个 tRPC router 定义完毕（6 真实 + 6 stub）、Electron boot 序列跑通、DB/settings/projects/workspaces/changes 等核心 router 真实可用。

**但骨架和模块之间存在 gap**：

| Gap | 症状 |
|:----|:-----|
| `fsOps: {}` | filesystem router 7 个操作全部 runtime crash (`TypeError`) |
| `@signoff/ui` 未消费 | Sidebar/TabBar/Dialog 全部手写 `<div>` + Tailwind，56+ shadcn 组件闲置 |
| Terminal 全链路空 | `reconcileDaemonSessions()` / `prewarmTerminalRuntime()` 是空函数，terminal router 是 stub |
| 6 个 stub routers | window / menu / config / external / autoUpdate / terminal 返回空值 |
| Hotkeys 无持久化 | 内存 store，重启后回到默认 10 个快捷键 |

**本文档的目标**：分阶段把已存在的代码模块接入骨架，使 skeleton 变成 **可交互的桌面工具**。

### Approach: Wire, Not Rewrite

每一步只做接线（import → 传参 → 调用），不重写已有模块。标注为：

- **🔌 Wire** — 把已有模块/包连接到 skeleton
- **🧩 Consume** — renderer 侧消费已有组件/hooks
- **🔧 Implement** — stub router 需要写真实逻辑（代码量小，单文件级别）

---

## Phase 1: Filesystem — 接通 workspace-fs

**目标**：`filesystem` router 的 7 个操作全部可用（listDirectory / readFile / writeFile / createDirectory / deletePath / movePath / getMetadata）。

**当前状态**：

- `@signoff/workspace-fs` 包已完整实现（`host/service.ts` 含全部 FS 操作 + search + watch）
- `filesystem/index.ts` 的 `createFilesystemTrpcRouter(fs)` 已写好，只需传入真实 `fs` 对象
- `main/index.ts` 传入的是 `fsOps: {}`

### 1.1 创建 workspace-fs host bridge

🔌 Wire — 在 main process 中实例化 `FsService`，转换为 `FsOperations` 接口。

**文件**: `apps/desktop/src/main/lib/workspace-fs/index.ts` (new)

```ts
import { createFsHost } from "@signoff/workspace-fs/host";
import type { FsOperations } from "../../lib/trpc/routers/filesystem";

export function createFsOperations(rootPath: string): FsOperations {
  const host = createFsHost(rootPath);
  return {
    listDirectory: (path) => host.listDirectory(path),
    readFile: (path) => host.readFile(path),
    writeFile: (path, content) => host.writeFile(path, content),
    createDirectory: (path) => host.createDirectory(path),
    deletePath: (path) => host.deletePath(path),
    movePath: (from, to) => host.movePath(from, to),
    getMetadata: (path) => host.getMetadata(path),
  };
}
```

> **假设**: `@signoff/workspace-fs/host` 的 `createFsHost` 方法签名与此一致。实际接线时需确认 host 的工厂函数名和参数。如果 host 导出的是 `FsService` class，改为实例化即可。

### 1.2 替换空对象占位

🔌 Wire — 修改 `apps/desktop/src/main/index.ts`。

```diff
- fsOps: {},   // real wiring in Phase 9+
+ fsOps: createFsOperations(app.getPath("home")),
```

**注意**: 初始 rootPath 用 `home`，后续通过 workspace 切换时动态更新。需要确认 `FsOperations` 是否需要 per-workspace 实例（如果是，需要改为工厂模式 `getFsOps: (cwd) => createFsOperations(cwd)`）。

### 1.3 导出 FsOperations 类型

🔧 Implement — 确保 `filesystem/index.ts` 导出 `FsOperations` 接口供 main 使用。

```ts
// apps/desktop/src/lib/trpc/routers/filesystem/index.ts
export interface FsOperations {
  listDirectory: (path: string) => Promise<DirectoryEntry[]>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  createDirectory: (path: string) => Promise<void>;
  deletePath: (path: string) => Promise<void>;
  movePath: (from: string, to: string) => Promise<void>;
  getMetadata: (path: string) => Promise<FileMetadata>;
}
```

### Tests

| Layer | Test | File |
|:------|:-----|:-----|
| L1 (Unit) | `createFsOperations` 正确委托 host 方法 | `apps/desktop/src/main/lib/workspace-fs/__tests__/index.test.ts` |
| L2 (Integration) | filesystem tRPC router → 真实 FS 操作 → 读写 tmp 目录 | `apps/desktop/src/lib/trpc/routers/filesystem/__tests__/integration.test.ts` |

### Commits

```
feat: wire workspace-fs host to filesystem router
test: add filesystem wiring unit and integration tests
```

---

## Phase 2: UI Components — 消费 @signoff/ui

**目标**：renderer 中的手写 HTML 替换为 `@signoff/ui` 的 shadcn 组件，建立消费模式。

**当前状态**：

- `@signoff/ui` 导出 56+ 组件，通过 `@signoff/ui/button` 等路径消费
- `apps/desktop/package.json` 已声明 `@signoff/ui` 依赖
- Renderer 几乎没有导入 `@signoff/ui`，Sidebar / TabBar / 设置页面全部手写

### 2.1 建立导入约定

🧩 Consume — 确认 renderer 侧 import 路径可解析。

**验证步骤**：在任意 renderer 文件中添加：

```ts
import { Button } from "@signoff/ui/button";
```

确认 electron-vite 的 `tsconfigPaths` 插件能正确解析到 `packages/ui/src/components/ui/button.tsx`。如果不行，需在 `tsconfig.json` 的 `paths` 中添加映射。

### 2.2 Sidebar 组件替换

🧩 Consume — `WorkspaceSidebar.tsx` 是最佳起点，当前全部手写。

**替换清单**:

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

### 2.4 Settings 页面组件替换

🧩 Consume — Settings 页面是表单密集区，最适合用 shadcn 组件。

| 场景 | 组件 |
|:-----|:-----|
| 文本输入 | `Input` from `@signoff/ui/input` |
| 下拉选择 | `Select` from `@signoff/ui/select` |
| 开关切换 | `Switch` from `@signoff/ui/switch` |
| 标签页 | `Tabs` from `@signoff/ui/tabs` |
| 表单标签 | `Label` from `@signoff/ui/label` |
| 卡片容器 | `Card` from `@signoff/ui/card` |

**文件**: `apps/desktop/src/renderer/routes/settings/` 下所有 `page.tsx`

### 2.5 Dialog / Sheet 全局替换

🧩 Consume — 项目中任何确认对话框、侧滑面板统一用 shadcn：

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

- `window.ts` 和 `menu.ts` 是 static stub（空 procedure）
- Main process 的 `windows/main.ts` 和 `lib/menu.ts` 已有窗口/菜单逻辑，但未暴露给 tRPC

### 3.1 Window Router 实现

🔧 Implement — 把 `BrowserWindow` 操作暴露为 tRPC procedures。

**文件**: `apps/desktop/src/lib/trpc/routers/window.ts`

**Procedures**:

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `minimize` | mutation | `BrowserWindow.getFocusedWindow()?.minimize()` |
| `maximize` | mutation | toggle maximize/unmaximize |
| `close` | mutation | `win.close()` |
| `isMaximized` | query | 返回当前最大化状态 |
| `setTitle` | mutation | 设置窗口标题 |
| `onMaximizedChange` | subscription | 窗口最大化状态变化事件 |

**依赖注入**: 改为工厂函数 `createWindowRouter(getWindow: () => BrowserWindow | null)`，在 `AppRouterDeps` 中新增 `getWindow` 字段。

### 3.2 Menu Router 实现

🔧 Implement — 把应用菜单操作暴露为 tRPC procedures。

**文件**: `apps/desktop/src/lib/trpc/routers/menu.ts`

**Procedures**:

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `getMenu` | query | 返回当前菜单结构 |
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

### Commits

```
feat: implement window tRPC router with BrowserWindow delegation
feat: implement menu tRPC router
refactor: extend AppRouterDeps with getWindow
test: add window and menu router unit tests
```

---

## Phase 4: Config & External Routers

**目标**：config router 提供应用配置读取，external router 提供外部编辑器打开功能。

### 4.1 Config Router 实现

🔧 Implement — 暴露运行时配置（区别于 settings，config 是 read-only 系统信息）。

**文件**: `apps/desktop/src/lib/trpc/routers/config/index.ts`

**Procedures**:

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `getAppVersion` | query | `app.getVersion()` |
| `getPlatform` | query | `process.platform` |
| `getDataPath` | query | `app.getPath("userData")` |
| `getSystemFonts` | query | 列出可用系统字体（for terminal/editor） |

**依赖注入**: 改为工厂函数 `createConfigRouter(getAppInfo: () => AppInfo)`。

### 4.2 External Router 实现

🔧 Implement — 用外部编辑器打开文件。

**文件**: `apps/desktop/src/lib/trpc/routers/external/index.ts`

**Procedures**:

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `openInEditor` | mutation | `shell.openPath(path)` 或按用户设置调用指定编辑器 |
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

**目标**：terminal router 从 stub 变为真实实现，连接已有的 terminal-host daemon + pty-subprocess 架构。

**当前状态**：

- `terminal-host/index.ts` 和 `pty-subprocess.ts` 代码已存在（从 superset 复制）
- `main/lib/terminal/index.ts` 三个函数全空（`reconcileDaemonSessions` / `prewarmTerminalRuntime` / `restartDaemon`）
- Terminal router 是 stub

### 5.1 实现 Terminal Manager

🔧 Implement — 填充 `main/lib/terminal/index.ts` 的三个函数。

**文件**: `apps/desktop/src/main/lib/terminal/index.ts`

| 函数 | 实现 |
|:-----|:-----|
| `reconcileDaemonSessions()` | 查找已运行的 daemon 进程，清理孤儿 session |
| `prewarmTerminalRuntime()` | fork `terminal-host/index.ts` 作为子进程，建立 IPC 通道 |
| `restartDaemon()` | kill 现有 daemon → 重新 fork |

### 5.2 Terminal Router 实现

🔌 Wire — 把 terminal manager 暴露为 tRPC procedures。

**文件**: `apps/desktop/src/lib/trpc/routers/terminal/index.ts`

**Procedures**:

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `create` | mutation | 创建新 PTY session（spawn pty-subprocess） |
| `write` | mutation | 向指定 session 写入 |
| `resize` | mutation | 调整 PTY 大小 |
| `kill` | mutation | 终止 PTY session |
| `listSessions` | query | 列出活跃 session |
| `onData` | subscription | PTY 输出流（tRPC subscription） |
| `onExit` | subscription | PTY 退出事件 |

**依赖注入**: 改为工厂函数 `createTerminalRouter(getTerminalManager: () => TerminalManager)`，在 `AppRouterDeps` 中新增 `getTerminalManager`。

### 5.3 Renderer Terminal 组件接通

🔌 Wire — `renderer/components/Terminal/` 已有 xterm.js 渲染逻辑，需接通 tRPC 调用。

**文件**: `apps/desktop/src/renderer/components/Terminal/Terminal.tsx`

- `onData` → `trpc.terminal.write.mutate({ sessionId, data })`
- `onResize` → `trpc.terminal.resize.mutate({ sessionId, cols, rows })`
- `useEffect` 订阅 → `trpc.terminal.onData.subscribe({ sessionId })`

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
| L2 (Integration) | 创建 session → 写入 → 接收输出 → kill | `apps/desktop/src/main/lib/terminal/__tests__/integration.test.ts` |

### Commits

```
feat: implement terminal manager (reconcile, prewarm, restart)
feat: implement terminal tRPC router with PTY lifecycle
feat: wire Terminal component to tRPC terminal router
test: add terminal manager and router tests
```

---

## Phase 6: Auto-Update Router

**目标**：接通 Electron auto-updater。

### 6.1 Auto-Update Router 实现

🔧 Implement — 包装 `electron-updater`。

**文件**: `apps/desktop/src/lib/trpc/routers/auto-update/index.ts`

**Procedures**:

| Procedure | Type | 作用 |
|:----------|:-----|:-----|
| `checkForUpdates` | mutation | `autoUpdater.checkForUpdates()` |
| `downloadUpdate` | mutation | `autoUpdater.downloadUpdate()` |
| `installAndRestart` | mutation | `autoUpdater.quitAndInstall()` |
| `getUpdateInfo` | query | 返回当前更新状态/版本信息 |
| `onUpdateAvailable` | subscription | 有新版本事件 |
| `onDownloadProgress` | subscription | 下载进度事件 |

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

**策略**: 在 settings 表中增加 `customHotkeys` JSON 字段，或新增 `hotkeys` 表。推荐复用 settings 表（一行数据，新增 column）。

### Tests

| Layer | Test |
|:------|:-----|
| L1 (Unit) | 持久化 store 写入后重启能读回 |

### Commits

```
feat: persist hotkey customizations to SQLite
test: add hotkey persistence tests
```

---

## Execution Order & Dependencies

```
Phase 1 (Filesystem)     ← 无依赖，最高优先级（当前 crash）
    ↓
Phase 2 (UI Components)  ← 无依赖，可与 Phase 1 并行
    ↓
Phase 3 (Window/Menu)    ← 依赖 Phase 1 的 AppRouterDeps 扩展模式
    ↓
Phase 4 (Config/External) ← 同理
    ↓
Phase 5 (Terminal)        ← 最复杂，依赖 Phase 3/4 的模式稳定
    ↓
Phase 6 (Auto-Update)    ← 独立，可与 Phase 5 并行
    ↓
Phase 7 (Hotkey Persist) ← 小改动，最后做
```

**可并行的组合**：
- Phase 1 + Phase 2（互不依赖）
- Phase 5 + Phase 6（互不依赖）

---

## AppRouterDeps 最终形态

完成所有 Phase 后，`AppRouterDeps` 应从 `any` 进化为类型安全接口：

```ts
export interface AppRouterDeps {
  getDb: () => BunSQLiteDatabase<typeof schema>;
  getGit: (cwd?: string) => SimpleGit;
  fsOps: FsOperations;                        // Phase 1
  hotkeyStore: HotkeyStore;                   // Phase 7: persistent
  settingsDb: SettingsDbOps;
  getWindow: () => BrowserWindow | null;       // Phase 3
  getTerminalManager: () => TerminalManager;   // Phase 5
  getAppInfo: () => AppInfo;                   // Phase 4
}
```

---

## Risk & Assumptions

| # | Assumption | Impact if wrong | Mitigation |
|:--|:-----------|:----------------|:-----------|
| A1 | `@signoff/workspace-fs/host` exports a factory accepting `rootPath` | Phase 1 接线失败 | 先读 host 源码确认 API |
| A2 | `FsOperations` 需要 per-workspace 实例（不是全局单例） | `fsOps` 需改为工厂 `getFsOps(cwd)` | Phase 1 调研时确认 |
| A3 | terminal-host daemon IPC 协议已定义 | Phase 5 需要匹配协议 | 读 `terminal-host/index.ts` 确认消息格式 |
| A4 | electron-vite 能解析 `@signoff/ui/*` wildcard exports | Phase 2 第一步就会暴露 | 2.1 验证步骤会立即发现 |
| A5 | tRPC subscription 在 Electron IPC 上正常工作 | Terminal `onData` / window `onMaximizedChange` 依赖此 | 需验证 `trpc-electron` 对 subscription 的支持 |
