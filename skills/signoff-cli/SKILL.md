---
name: signoff-cli
description: Query cached SignOff PR status and maintain the shared web/CLI watch list from another local project. Use for SignOff PR readiness, checks, watch membership, explicit discovery or refresh, and integrating a local app with SignOff without publishing the CLI.
---

# SignOff local CLI

Use the existing SignOff Worker and its published cache. Queries never wait for ADO or require Azure/GitHub authentication. The persistent watch list is shared with the webpage; only the daemon performs provider collection.

## Readiness contract

Use `watch list` (observations schemaVersion 2) for daily inspection. Each item has `watch`, `pr`, `readiness`, `nextAction`, `checks`, `builds`, `reviews`. Read `readiness.state` as the last category and `isCurrent` as consistency with cached evidence/current rules, **not source freshness**. Pending/error updates retain the previous category; `readiness.update` describes scheduling, collection blocking, errors and earliest eligibility (`notBefore`). No judgment means null state/action. Never treat `watch.active:false` as proof of merge; inspect lifecycle and stopReason/generation.

Non-main targets (`main`/`master`, optional `refs/heads/` prefix, case-sensitive) are Skipped. Main-target provider conflicts are Conflict. Other watched categories are saved Jev judgments: Attention, Review Needed (`review_needed`), Warning, Running, Ready, Waiting. Build failure means Attention but SignOff does not choose rerun versus repair. Review Needed is for unmet review policies after successful unexpired builds with no more serious blocker; its `request_review` advice includes following up on pending reviews. Waiting is for queued non-review work (`wait_ci`); active builds are Running. PoP is last. Ready cannot override provider merge requirements. `nextAction` is coarse advice, never write authorization; current Jev selects no evidence items, so `evidenceRefs` is empty. No rule-based fallback or hidden first-blocker authority.

Assess PR and checks `observedAt`, coverage, missing reasons and lastAttempt errors independently. SHA comparisons are match/mismatch/unknown with both SHAs; unknown expiry/applicability flags are null. Review personal/group counts do not replace individual review policies. The persistent collector daemon initiates independent changed watched PR requests even when the dashboard is hidden or closed, with a default 5-minute completion cooldown per PR. Keep the daemon running; unchanged fingerprints do not re-evaluate; identical evidence and effective rules reuse a project-isolated SQLite judgment cache. Queries never invoke inference or ADO. AI Settings owns credentials and common/project instructions; System → Policy instructions owns policy descriptions/priority. State machines visualizes cached lifecycle, policy evidence, Jev judgments and observed transitions.

The richer `pr list` / `pr get` dashboard contract remains schemaVersion 1 (`readiness.kind/status/current/previous`); observations v2 deliberately omits duplicated project configuration, raw model inputs and probabilities. Do not mix these shapes. See `docs/18-cli-query-contract.md` for the field contract.

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

Default source is Live; Sample requires explicit `--source sample`. Never substitute Sample for unavailable live data. `pr list` defaults to open PRs with Draft excluded; `watch list` includes all active references and may have null PR facts before collection. Terminal PRs retire from active watching but remain cached and in `--include-stopped`.

stdout is one JSON document (`schemaVersion: 2` for watch queries; other query families remain version 1); errors go to stderr and nonzero exit codes. Check exit status before replacing a consumer snapshot. Preserve full provider, org, project, repository ID, PR number, URL and observation generation; PR number alone is not unique. For watch inspection, assess `pr.collection` and `checks` observation times, coverage and errors before reporting readiness. `generatedAt` is query time, not collection time.

Project discovery defaults to 600 seconds after each project's completed attempt and refreshes all list-provided PR states. Watched PRs independently collect full state, policies, builds and stages, then cool down for 300 seconds per PR. Both settings are configurable; manual commands also respect cooldown. There is no separate 30-second status lane. Query cadence does not trigger provider work. Terminal PRs retire after validated publication; cached results remain available.

ADO `pr.targetSha` is the PR's `lastMergeTargetCommit`, with explicit `targetShaSource`; it is not a separately read target ref tip. `checks.validity=valid` cannot authorize current-target CI acceptance or a stage retry. Checks retain provider evaluation/configuration IDs, nullable `isExpired` and `buildIsNotCurrent`, scope and review requirements. Builds retain definition/source commit/branch; stages retain identifier and attempt. Reviewer approval revision is null when unavailable. Full task timelines, logs and comment bodies require on-demand source investigation. Consumers perform necessary authorized pre-action verification without adding a second background collector.

Use the emitted URLs directly. Resolved ADO repository/PR URLs use the provider repository ID so that a renamed or reused repository name cannot point a command at another identity; do not rebuild them from display names. Unresolved references retain their configured names, and GitHub uses owner/repository URLs.

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
```

Registration itself does not collect or watch; the daemon automatically discovers enabled projects when due. Unresolved repository identity requires successful explicit discovery before adding a PR URL; known repositories can watch a PR whose snapshot is not cached yet. Draft can be watched. Already-cached terminal PRs cannot be added again. Bare PR numbers require `--repo`; never guess the repo or project.

Every discovery paginates all accessible PR history and states, including changes to old PRs. There is no incremental creation-time cursor or discovery `--full` option. A queued receipt is not completion. Use `job get` for phases, progress and returned details; authentication expiry belongs to the daemon, not the query consumer.

`status` includes `listCooldownSeconds` and `detailCooldownSeconds`. Zero disables periodic work for that task type; explicit commands remain available. The job preview is bounded; the grouped history endpoint provides paginated attempt records. Refresh receipts always refer to full PR collection.

Removal uses the observed generation. A conflict must not silently delete a newly re-added watch. Batch item failures retain ordered results and continue independent targets with a nonzero exit. A fatal service/transport error stops later removal requests but preserves confirmed prefix receipts; verify the unacknowledged current item before retrying. Live GitHub workbench collection is not implemented; do not replace it with the separate `pulse` CLI's direct GitHub queries.

## Detailed contract

Read `<checkout>/docs/18-cli-query-contract.md` for HTTP routes, JSON, exit codes, development paths and Node.js integration. `<checkout>/docs/16-scheduler-state-machine.md` defines concurrency and retirement; `17-query-cadence.md` defines freshness. This skill is versioned with the CLI under `<checkout>/skills/signoff-cli/SKILL.md`; the local `~/.codex/skills/signoff-cli` link points here.

See `<checkout>/docs/21-readiness-architecture.md` for the unified evidence model, cache and concurrency. `readiness.phase` exposes collection/queue/evaluation/decision/error/stopped state. `model`, `rubric`, `fingerprint` and `reusedAt` describe the displayed judgment; `evaluatedAt` stays the original inference time. Stage details and observation clocks alone never trigger inference.
