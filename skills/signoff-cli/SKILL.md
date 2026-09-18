---
name: signoff-cli
description: Query cached SignOff PR status and maintain the shared web/CLI watch list from another local project. Use for SignOff PR readiness, checks, watch membership, explicit discovery or refresh, and integrating a local app with SignOff without publishing the CLI.
---

# SignOff local CLI

Use the existing SignOff Worker and its published cache. Queries never wait for ADO or require Azure/GitHub authentication. The persistent watch list is shared with the webpage; only the daemon performs provider collection.

## Find the entrypoint

Current development checkout: `/Users/nocoo/workspace/personal/signoff.now`.
CLI: `<checkout>/apps/collect/src/main.ts`, also declared by `apps/collect/package.json` under `bin.signoff`.
Runtime: Bun; `command -v bun` currently resolves to `/opt/homebrew/bin/bun`.

Use the consumer's configured checkout/CLI path if supplied. Otherwise verify the current path below. If the checkout moved, resolve the installed skill symlink to its real `skills/signoff-cli` directory; the repository root is two directories above it. Do not assume the consumer's current directory is SignOff or that a global `signoff` binary is installed.

```bash
SIGNOFF_REPO=/Users/nocoo/workspace/personal/signoff.now
SIGNOFF_CLI="$SIGNOFF_REPO/apps/collect/src/main.ts"
test -f "$SIGNOFF_CLI"
bun "$SIGNOFF_CLI" --help
bun "$SIGNOFF_CLI" status --pretty
```

Run from any directory. Dependencies must already be installed in that checkout. No npm publication, global linking of the executable, or web build is required to run queries. For App/cron processes with no Bun in PATH, use the absolute Bun executable. Pass subprocess arguments as an array.

Worker defaults to `http://127.0.0.1:37042`; `--api-base` or `SIGNOFF_QUERY_API_BASE` can select another loopback origin. Reuse the running Worker and daemon. If startup on a fresh checkout is part of the task, run `bun install --frozen-lockfile` and `bun run build:web` first: Wrangler's ASSETS binding requires `apps/web/dist`. Then `bun run dev:worker` applies local migrations and starts the Worker; `bun "$SIGNOFF_CLI" daemon` runs collection separately. Consumers reusing an existing Worker do not build or start the webpage. Do not seed or reset existing data. The webpage can be closed, and cached queries still work with the daemon stopped.

## Read cached facts

```bash
# Entire active watch list, including Draft and pending first results
bun "$SIGNOFF_CLI" watch list --all
# Watched PRs with saved snapshots; explicitly include Draft
bun "$SIGNOFF_CLI" pr list --watching --draft include --all
# All cached states in a repository, including Draft
bun "$SIGNOFF_CLI" pr list --repo '<repository URL>' --state all --draft include --all
bun "$SIGNOFF_CLI" pr get '<complete PR URL or SignOff PR id>'
bun "$SIGNOFF_CLI" repo list --all
bun "$SIGNOFF_CLI" watch list --include-stopped --all
```

Default source is Live; Sample requires explicit `--source sample`. Never substitute Sample for unavailable live data. `pr list` defaults to open PRs with Draft excluded; `watch list` includes all active references and may have `pull: null`. Terminal PRs retire from active watching but remain cached and in `--include-stopped`.

stdout is one JSON document (`schemaVersion: 1`); errors go to stderr and nonzero exit codes. Check exit status before replacing a consumer snapshot. Preserve full provider, org, project, repository ID, PR number, URL and observation generation; PR number alone is not unique. Assess `freshness.listObservedAt`, `checksObservedAt`, `checksValidity` and coverage before reporting readiness. `generatedAt` is query time, not collection time.

Consumers choose their own query cadence. `--all` reads all cached pages; it does not fetch from ADO. For large results use `--limit` / `--cursor`; `SNAPSHOT_CHANGED` means restart the paginated read rather than append mismatched pages. The built-in `--all` retries the complete read at most twice and otherwise fails without partial stdout.

## Explicit changes

When requested by the task, use these commands; ordinary status queries do not register repositories, discover, add watches or refresh.

```bash
bun "$SIGNOFF_CLI" repo add '<repository URL>'
bun "$SIGNOFF_CLI" discover --repo '<repository URL>'
bun "$SIGNOFF_CLI" job get '<job id from receipt>'
bun "$SIGNOFF_CLI" watch add '<PR URL>' '<another PR URL>'
bun "$SIGNOFF_CLI" watch remove '<PR URL>'
bun "$SIGNOFF_CLI" refresh --pr '<PR URL>'
# Optional manual reconciliation of old, unwatched history
bun "$SIGNOFF_CLI" discover --repo '<repository URL>' --full
```

Registration does not discover or watch. Unresolved repository identity requires successful explicit discovery before adding a PR URL; known repositories can watch a PR whose snapshot is not cached yet. Draft can be watched. Already-cached terminal PRs cannot be added again. Bare PR numbers require `--repo`; never guess the repo or project.

Discovery includes all states: first/full discovery covers accessible history, later discovery uses a successful overlapping creation-time boundary. Older unwatched PRs can retain older states until full discovery; watched PRs refresh independently. A queued receipt is not completion. Use `job get` for progress; authentication expiry is a daemon state, not a reason for the query consumer to run `az login`.

Removal uses the observed generation. A conflict must not silently delete a newly re-added watch. Batch failures retain successful items and return structured per-item results with a nonzero exit. Live GitHub workbench collection is not implemented; do not replace it with the separate `pulse` CLI's direct GitHub queries.

## Detailed contract

Read `<checkout>/docs/18-cli-query-contract.md` for HTTP routes, JSON, exit codes, development paths and Node.js integration. `<checkout>/docs/16-scheduler-state-machine.md` defines concurrency and retirement; `17-query-cadence.md` defines freshness. This skill is versioned with the CLI under `<checkout>/skills/signoff-cli/SKILL.md`; the local `~/.codex/skills/signoff-cli` link points here.
