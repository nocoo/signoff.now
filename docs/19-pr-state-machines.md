# Jev developer readiness

AI Settings (`/ai-settings`, directly above Settings) configures the encrypted Jev key and editable common/project rules. State machines (`/sm`) edits policy explanations and full priority ordering, including repository overrides. Readiness asks: **as this PR's developer, what should I do now?** It applies only to watched PRs.

## Classification contract

| Kind | Color | Meaning |
| --- | --- | --- |
| `skipped` | Cyan | Target is not `main` or `master`; no Jev request, regardless of watch membership. |
| `conflict` | Red | Provider merge conflicts; determined directly, excluded from Jev requests. |
| `attention` | Light red | Human inspection/action needed. Build failure belongs here; SignOff does not choose rerun versus code repair. |
| `warning` | Yellow | Observe a known issue with evidence of possible automatic recovery. |
| `running` | Blue | Work is progressing, or insufficient signal warrants waiting for more evidence. Includes ordinary queued policies. |
| `ready` | Green | Mergeable with passed, unexpired applicable checks; the configured PoP-only final-step convention is an explicit exception. Confirm provider requirements before merging. |
| `waiting` | Purple | Waiting for external reviewers after successful, unexpired builds. Not author changes, queued builds or PoP. |
| `unknown` | Gray | Operational pending/evaluating or not evaluated, not a model choice. |
| `error` | Red | Inference/configuration failure, not a failed CI build. |

Each watched, main-target, non-conflicted PR gets one Jev Choice: Attention, Warning, Running, Ready or Waiting. There is no separate action question, generated explanation, severity override or rule fallback. Displayed next actions are category templates. Build failures are model evidence; code does not replace valid judgments. The configured common rules instruct Jev to classify failures as Attention. PoP comes last, after valid successful builds and reviews. Whiteboard's default project rule states that expired builds do not automatically rerun and require Attention when no replacement is underway.

`readiness.status` is `not_watched`, `pending`, `running`, `complete` or `error`. Operational `running` means evaluating; business `kind=running` means the PR is progressing. Pending/evaluating/error may retain `previous`, explicitly historical; `current` contains only a completed current Jev result. Direct Skipped and Conflict have `status=complete` and `current=null`, with no invented model judgment. Unwatched main-target PRs are Not evaluated. Skipped takes precedence over conflicts and any historical Jev result. Branch matching is case-sensitive, accepts an optional `refs/heads/` prefix, and uses the names `main`/`master`, not the provider default-branch setting. Retargeting invalidates in-flight answers; returning to a main target resumes normal changed-state scheduling and cooldown. Lifecycle, draft and provider merge requirements remain independent.

Readiness column sorting follows the visible badge: a pending, running or failed reevaluation retains the ordering of its previous judgment. Ascending order is Conflict, Error, Attention, Warning, Unknown, Running, Waiting, Ready, Skipped, then Not evaluated; descending reverses the groups, with stable PR identity ordering within a group. Main-target merged/closed history belongs to Not evaluated, and non-main history to Skipped. This presentation rule does not promote historical evidence to current or change operational statuses.

API filters accept the nine kinds above. Counts use the same camel-free keys (`skipped`, `conflict`, `attention`, `warning`, `running`, `ready`, `waiting`, `unknown`, `error`). The obsolete `on_track`, `onTrack`, action Choice fields and `readiness.ready` boolean are removed. Web and cached CLI read the same persisted result. No merge, approval, rerun or bypass is performed.

Results persist model `jev-1.13.0`, rubric `signoff-developer-v4`, canonical input fingerprint, evaluation time, observation provenance and Choice probabilities/confidence. Confidence measures distribution concentration, not accuracy. Old-rubric results are invalidated by the local schema upgrade without resetting collected data or watches.

## State and fixed policy numbers

A project request shares a `definitions` dictionary and deduplicated common/project/repository contexts. `ruleSets`, `policyInstructions`, `policyFacts`, `stageFacts`, `reviewerFacts` and `scopes` are shared once; index references reconstruct per-PR facts without losing duplicate or conflicting evaluations. Individual PRs refer to policy numbers, group policy outcomes in `policyStates`, and retain the underlying evaluation evidence separately. Names match exactly across projects; similar names are not merged. The approved C1–C13, W1–W12 and V1–V14 assignments never renumber. Newly discovered policies get persistent P numbers. Project/gate/source aliases preserve numbers after rediscovery or rename. Priority order remains separate from identity; moving a policy never changes its number. The State machines editor displays these fixed codes.

Non-main-target PRs, conflict PRs and the C1 definition are not sent to Jev. Shared numbering does not share project explanations: descriptions, priority and scopes remain project/repository specific. Each underlying policy evaluation, expiry flag, required/enabled/applicable status, provider message, scope and build association remains available. A same-named policy can therefore have conflicting evaluations without losing evidence.

Other state includes PR lifecycle/mergeability and identity relationships, exact approval counts/requirements, reviewers, builds/stages/attempts, coverage and freshness. Code computes counts, hash comparisons and freshness boundaries. Generated collector action summaries are omitted. `isExpired` differs from `buildIsNotCurrent` and an older target. ADO target identity is lastMergeTargetCommit, not an independent target-ref lookup. Stage required flags are explicitly described as derived, not provider guarantees. Auto-complete is not assumed.

## Configuration and credentials

The API key is server-side AES-256-GCM ciphertext in D1. The encryption master is the separate `SIGNOFF_AI_ENCRYPTION_KEY` secret; local development loads the ignored `.dev.vars`. Neither secret appears in API reads, browser storage, URLs, model state or logs. Saving does not claim validity; Test connection makes one bounded synthetic request. It never reclassifies the watch list.

Local authorized endpoints:

- `GET/PUT /api/ai/settings`: metadata / `{revision,apiKey}`; null clears. Revision CAS.
- `POST /api/ai/test`: bounded explicit synthetic connection test.
- `GET /api/ai/rules`: common instructions and project-specific modules.
- `PUT /api/ai/rules`: `{scope,revision,text}`; `common` or a live project ID. Revision CAS, project validation. Only affected watched PRs are invalidated, including responses already in flight.
- `POST /api/ai/retry`: queue failed evaluations, respecting cooldown.
- `POST /api/ai/tick`: `{source}` invokes one bounded scheduler pass. The local collector daemon supplies `cli`; Sample evaluation requires an explicit `demo` tick.
- `GET/PUT /api/ai/schedule`: project timings/usage and `{revision,cooldownSeconds}` (60–3600 seconds).

Policy explanations and priorities retain existing project-wide revision CAS and repository scopes. New policies append after saved order. Editing rules or policy descriptions schedules new classification even when provider facts do not change.

## Foreground scheduling

The persistent collector daemon initiates inference independently of browser presence, including when the dashboard is hidden or closed. Keep `bun run dev:collector` running. Cached CLI queries remain read-only. Each project independently waits 300 seconds after completion by default; configure it in Connector details. Only changed watched PRs are included. The daemon checks for eligible work every 3 seconds after its previous tick completes, with a 10-second backoff after transport errors. Discovery remains 10 minutes/project; full watched detail collection remains 5 minutes/PR, both counted after completion.

Pending means evidence changed and is waiting for evaluation; it does not mean a Jev request started. A build/stage change can mark a result Pending immediately after an evaluation, but dispatch still waits for the project's completion-based cooldown. Unchanged siblings keep their saved classification and evaluation time, even when the project sends another batch. Observation/summary/check timestamps and `updatedAt` alone no longer invalidate an evaluation or cancel an in-flight response. Explicitly losing or recovering check availability still invalidates it; meaningful freshness boundaries are checked by the scheduler.

The PR list keeps the last successful Jev badge visible while an update is pending, running or failed. A compact `Last result` line identifies it as historical and shows the estimated request delay, queued/running status or failure. Hover, keyboard focus or tapping that line reveals the previous evaluation time and scheduling details. ETA is the project's earliest request time, subject to daemon availability and queued work, not a promised completion time. An initial evaluation without history still shows Pending. The API/CLI and detail inspector retain separate current/previous results; list presentation does not promote history to current evidence or change filters and inference scheduling.

The browser never sends inference ticks or presence heartbeats. The daemon uses an independent loop so slow inference does not block ADO collection. Worker leases deduplicate concurrent ticks; project cooldowns, fingerprint deduplication, bounded retries and watch-generation/input-revision fences remain authoritative. Migration 0035 removes the obsolete presence table. No query GET initiates inference.

Canonical fingerprints cover facts, relevant editable rules, model and rubric. Poll clocks, request IDs, avatar URLs and ticking durations do not trigger repeated inference. Freshness changes when summary/check age exceeds max(20 minutes, three detail cooldowns). Exact-equal facts reuse results. Watch generation, input revision and lease token reject late responses after new facts/instructions/key, unwatch or rewatch. One runner lease bounds concurrency. Transient failures get at most three attempts with backoff, still subject to project cooldown. Operational Error remains distinct from business Attention.

The HTTP request is `POST https://api.typesafe.ai/v1/systemone` with Bearer authentication and `{model,state,questions}`. Timeout is 30 seconds; redirects are refused. State/request budgets are 56,000/80,000 UTF-8 bytes. Oversized projects split across cooldown intervals; individually oversized PRs fail explicitly. Provider evidence is not silently truncated. PR title/body, event IDs and event times are excluded from this policy-state decision; raw snapshots retain them. Validity, expiry, current attempts and source/merge comparisons remain explicit. Returned usage provides actual tokens; bytes are not token estimates. A malformed sibling answer does not discard valid siblings.

## Validation

Deterministic tests exercise credential masking/CAS, watched-only scheduling, identical-state dedupe, conflict exclusion, common/project rule changes, fixed numbers and rename aliases, expiry/failed/queued/advisory evidence, bounded retries and stale-response fences. Mocked Choice outputs verify application behavior, not model accuracy.

Cooldown regressions simulate a 12-second request: changed facts remain Pending through second 311, and the next request can start at second 312 (300 seconds after completion). Repeated observation-only updates preserve both in-flight leases and completed results across multiple cooldowns without another model call. A two-PR batch followed by one changed PR verifies outgoing membership and preserves the unchanged sibling's full evaluation record.

Browser tests use an isolated database and synthetic credentials. The browser test launches a real window with Playwright focus emulation disabled (`connectOverCDP` with `noDefaults`): foreground, background, return and reload send no inference or presence requests. Daemon tests verify independent scheduling and transport-error backoff; scheduler tests verify no-browser evaluation, source isolation, project cooldowns and unchanged-state deduplication. Settings tests cover reload persistence and 390px layout. Local live-model evidence is recorded separately from mocks in the delivery report.

Official references: [TypeSafe skill](https://docs.typesafe.ai/llms.txt), [Choice](https://docs.typesafe.ai/primitives/choice), [state](https://docs.typesafe.ai/concepts/state), [HTTP API](https://docs.typesafe.ai/api). The offline [Jev Input Lab](../apps/web/public/learn/jev-input.html) demonstrates state efficiency and makes no model calls.

Validation on 2026-09-21: lint, typecheck, build, all seven coverage tasks and all eight isolated browser tests passed. The local configured credential passed the explicit synthetic connection test. A real project request classified 13 non-conflicted watched PRs together (28,721 input tokens, 695 output tokens); one provider-conflicted PR was excluded. The sampled expired-build and failed-build PRs returned Attention. This validates integration and those cases, not general accuracy. Another review-pending example returned Running and remains a calibration case. Desktop/mobile reloads and a real background tab check were verified; no new ticks occurred during the measured background interval. Runtime observation snapshots and provider responses remain outside Git.

## Compact PR list

Repository, author, target branch, Jev evaluated, PR updated, state checked and checks collected are separate sortable columns. Columns size to their unwrapped content, including full target branches and next actions. Checks/stages alone expands into the remaining width, with a readable minimum. Titles no longer absorb unused space. Headers, titles and readiness labels use 12px; auxiliary text uses 11px. Jev evaluated shows the age of the last successful current or historical answer, updates with the page clock, and exposes the exact time on hover. Skipped and never-evaluated PRs show a dash. Sorting uses the successful evaluation timestamp, not polling or request times. Loading placeholders mirror all 13 columns, with neutral token-based title, avatar, badge, segmented-stage and timestamp shapes. Placeholder and populated rows share a 64px minimum height. Horizontal scrolling stays inside the table on narrow screens. API `sort` additionally accepts `repository`, `author`, `target`, `evaluated`, `stateChecked`, and `checksChecked` in either direction; timestamp sorting uses actual timestamps, not relative labels. Missing checks sort before collected checks in ascending order.

Skipped is a direct classification with no model identity or previous-result badge. API status filtering and PR/repository counts include it. Deterministic tests cover exclusion from mixed watched batches, retargeting during inference, resuming a main target, and consistent query output. No provider write is involved.

Validation for the compact-list/Skipped change: lint, typecheck, build, all seven coverage tasks and all ten isolated E2E cases passed. Desktop and mobile reloads, full target text, all five new sortable columns, cyan styling, retained history and strict foreground ticks were verified. A read-only local cache check returned identical Web/CLI readiness for 14 watches, including one Skipped PR. Scheduler exclusion and retarget races use mocked inference; the live UI verification intercepted inference ticks and spent no Jev credits.

## Background scheduler validation

The background-scheduling change passes all seven repository coverage tasks, lint, typecheck, build and all 11 isolated browser E2E cases. Mocked Jev tests cover evaluation without browser presence, unchanged-state deduplication, independent completion cooldowns, source isolation and late-response fencing. Daemon tests cover concurrent ADO progress, inference transport backoff and prompt shutdown during idle waits. Desktop and 390px local-browser reloads show the updated Connector settings without sending inference/presence requests. Local migration 0035 preserves credentials, watches and cached judgments; the restarted daemon polls successfully. The 13 live watched PRs retained current cached judgments without forced reclassification. These runtime checks do not claim a new live-model classification or model accuracy.
