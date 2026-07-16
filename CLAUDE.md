# signoff.now

Developer + git-repo activity analytics platform (manager-facing).

Canonical product definition: **[docs/01-项目定位.md](./docs/01-项目定位.md)**.

## Shape

| Piece | Role |
|:------|:-----|
| **Web** | Vite SPA on CF Worker + Access; CRUD entities/settings; **read-only** Activity/Score |
| **CLI / Scripts / Skills** | Local ADO collection → JSON under `.data/` (gitignored) → validate → ingest D1 |
| **DB** | Cloudflare D1 (not Electron SQLite) |

## Layout

```
apps/gitinfo/   # quality-bar CLI (local git)
apps/pulse/     # quality-bar CLI (remote collab patterns)
apps/web/       # Vite frontend scaffold
docs/01-*.md    # product docs
.data/          # local payloads — never commit
```

## Commands

```bash
bun run dev
bun run test / test:coverage
bun run lint
bun run typecheck
bun run security   # osv-scanner (osv-scanner.toml) + gitleaks
bun run gitinfo -- --help
bun run pulse -- --help
```

## Quality

- TDD; Biome 0 warnings
- Coverage ≥95% on CLI/scripts/shared and web Model/ViewModel; Views excluded
- Do not reintroduce Electron or local better-sqlite3/drizzle for product data
