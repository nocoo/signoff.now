# signoff.now

Local-first workspace tooling monorepo. Electron desktop has been removed.

## First-class products

### CLIs (maintained)

| Package | Role |
|:--------|:-----|
| `@signoff/gitinfo` | Local git repository insight |
| `@signoff/pulse` | GitHub collaboration data (PRs, detail, diff, search, repo) |

Docs: `docs/cli/`. Run via `bun run apps/<name>/src/main.ts`.

### Web

`apps/web` — Vite + React 19 + TypeScript 7 + Tailwind v4 + Basalt design tokens (scaffold).

## Tech Stack

- **Monorepo**: Turborepo + Bun workspaces (`bun@1.3.6`)
- **CLI runtime**: Bun (TypeScript entrypoints)
- **Frontend**: Vite 8 + React 19 + TypeScript 7.0.2
- **Lint/Format**: Biome (`--error-on-warnings`)
- **Test**: Vitest + coverage thresholds (CLIs: ≥97% lines/statements/functions, ≥85% branches)

## Workspace Layout

```
apps/gitinfo/          # gitinfo CLI
apps/pulse/            # pulse CLI
apps/web/              # Vite SPA
packages/*             # shared libs (re-scope later)
docs/cli/              # active CLI docs
docs/archive/          # Electron-era + old drafts
tooling/typescript/    # shared tsconfig presets
```

## Commands

```bash
bun run dev            # web SPA
bun run test           # turbo test
bun run test:coverage  # turbo coverage (enforced thresholds)
bun run lint           # Biome check --error-on-warnings
bun run typecheck      # root tsc + turbo typecheck
```

CLI package scripts (from package dir):

```bash
bun run typecheck && bun run lint && bun run test:coverage
bun run test:integration   # gitinfo only — real git subprocess
```

## Notes

- CLI docs in `docs/cli/` are the source of truth; do not treat gitinfo/pulse as legacy.
- Reference monorepo patterns: sibling `../bat`
- Reference design system: sibling `../basalt`
- Do not reintroduce Electron unless product requirements explicitly call for it

## Retrospective

### 2024-03-24: PR Cache SQLite Migration (Electron era)

Historical lessons — kept if SQLite returns.

**Migration runner 只执行了第一个文件**
- 扫描整个 `drizzle/` 目录，按文件名排序执行所有 `.sql`。

**幂等 migration catch 不全**
- `ALTER TABLE ADD COLUMN` 的 `"duplicate column name"` 需与 `"already exists"` 一并 catch。

**Drizzle better-sqlite3 `db.transaction()`**
- 回调必须接收 `tx`，内部操作用 `tx`。

**PrDetailPanel null detail**
- 穷举状态组合，不要用 `as` 强转绕过 null check。
