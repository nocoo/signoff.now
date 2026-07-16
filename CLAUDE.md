# signoff.now

Local-first workspace tooling. **Electron desktop has been removed**; the product is being re-platformed onto a Vite web frontend.

## Tech Stack (current direction)

- **Monorepo**: Turborepo + Bun workspaces (`bun@1.3.6`)
- **Frontend**: Vite + React 19 + TypeScript 7 + Tailwind v4
- **Lint/Format**: Biome
- **Design**: Basalt template (3-tier luminance hierarchy, shadcn-style tokens)
- **Test**: vitest (per-workspace via turbo)

## Workspace Layout

```
apps/web/              # Vite SPA (primary UI)
apps/gitinfo/          # Git collector CLI (legacy; re-scope later)
apps/pulse/            # GitHub collaboration CLI (legacy; re-scope later)
packages/*             # Shared libs (legacy; re-scope later)
docs/                  # Active docs
docs/archive/          # Electron-era architecture & CLI design docs
tooling/typescript/    # Shared tsconfig presets
```

## Commands

```bash
bun run dev            # turbo run dev
bun run build          # Production build
bun run test           # Run all tests via turbo (vitest)
bun run lint           # Biome check
bun run lint:fix       # Biome check --write --unsafe
bun run typecheck      # tsc --noEmit + turbo typecheck
```

## Notes

- Reference monorepo patterns: sibling project `../bat`
- Reference design system: sibling project `../basalt`
- Do not reintroduce Electron unless product requirements explicitly call for it

## Retrospective

### 2024-03-24: PR Cache SQLite Migration (Electron era)

Historical lessons from the retired desktop app — kept for migration awareness if SQLite returns.

**Migration runner 只执行了第一个文件**
- `initLocalDb()` 硬编码了 `0000_plain_kabuki.sql`，后续 migration（0001、0002）从未执行。
- 修复：`readdirSync` 扫描整个 `drizzle/` 目录，按文件名排序执行所有 `.sql`。

**幂等 migration catch 不全**
- `ALTER TABLE ADD COLUMN` 重复执行时报 `"duplicate column name"`，需与 `"already exists"` 一并 catch。

**Drizzle better-sqlite3 `db.transaction()` 用法**
- 回调必须接收 `tx`，内部操作用 `tx` 而非外层 `db`。

**PrDetailPanel null detail 状态遗漏**
- 穷举所有状态组合，不要用 `as` 强转绕过 null check。
