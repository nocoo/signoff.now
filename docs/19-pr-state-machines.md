# Jev developer readiness

AI Settings (`/ai-settings`, directly above Settings) configures the encrypted Jev key and editable common/project rules. System → Policy instructions (`/policy-instructions`) edits policy explanations and full priority ordering, including repository overrides. State machines (`/sm`) is the interactive evidence and classification graph. Readiness asks: **as this PR's developer, what should I do now?** It applies only to watched PRs.

## Classification contract

| Kind | Color | Meaning |
| --- | --- | --- |
| `skipped` | Cyan | Target is not `main` or `master`; no Jev request, regardless of watch membership. |
| `conflict` | Red | Provider merge conflicts; determined directly, excluded from Jev requests. |
| `attention` | Light red | Human inspection/action needed. Build failure belongs here; SignOff does not choose rerun versus code repair. |
| `warning` | Yellow | Observe a known issue with evidence of possible automatic recovery. |
| `running` | Blue | Work is progressing, or insufficient signal warrants waiting for more evidence. Active builds belong here; queued builds awaiting execution are Waiting. |
| `ready` | Green | Mergeable with passed, unexpired applicable checks; the configured PoP-only final-step convention is an explicit exception. Confirm provider requirements before merging. |
| `review_needed` | Purple | Builds passed and remain unexpired; only review requirements remain, such as minimum non-author approvals, required/path reviewers or review compliance. Includes reviews already requested. |
| `waiting` | Gray | Non-review work is queued or waiting for an automatic prerequisite. No human intervention is needed. |
| `unknown` | Gray | Operational pending/evaluating or not evaluated, not a model choice. |
| `error` | Red | Inference/configuration failure, not a failed CI build. |

Each watched, main-target, non-conflicted PR gets one Jev Choice: Attention, Review Needed, Warning, Running, Ready or Waiting. There is no separate action question, generated explanation, severity override or rule fallback. Displayed next actions are category templates. Build failures are model evidence; code does not replace valid judgments. The configured common rules instruct Jev to classify failures as Attention. PoP comes last, after valid successful builds and reviews. Whiteboard's default project rule states that expired builds do not automatically rerun and require Attention when no replacement is underway.

`readiness.status` is `not_watched`, `pending`, `running`, `complete` or `error`. Operational `running` means evaluating; business `kind=running` means the PR is progressing. Pending/evaluating/error may retain `previous`, explicitly historical; `current` contains only a completed current Jev result. Direct Skipped and Conflict have `status=complete` and `current=null`, with no invented model judgment. Unwatched main-target PRs are Not evaluated. Skipped takes precedence over conflicts and any historical Jev result. Branch matching is case-sensitive, accepts an optional `refs/heads/` prefix, and uses the names `main`/`master`, not the provider default-branch setting. Retargeting invalidates in-flight answers; returning to a main target resumes normal changed-state scheduling and cooldown. Lifecycle, draft and provider merge requirements remain independent.

Readiness column sorting follows the visible badge: a pending, running or failed reevaluation retains the ordering of its previous judgment. Ascending order is Conflict, Error, Attention, Review Needed, Warning, Unknown, Running, Waiting, Ready, Skipped, then Not evaluated; descending reverses the groups, with stable PR identity ordering within a group. Main-target merged/closed history belongs to Not evaluated, and non-main history to Skipped. The next-action template also follows the displayed judgment. This presentation rule does not promote historical evidence to current or change operational statuses.

API filters accept the ten kinds above. Counts use the same camel-free keys (`skipped`, `conflict`, `attention`, `review_needed`, `warning`, `running`, `ready`, `waiting`, `unknown`, `error`). The obsolete `on_track`, `onTrack`, action Choice fields and `readiness.ready` boolean are removed. Web and cached CLI read the same persisted result. No merge, approval, rerun or bypass is performed.

Results persist model `jev-1.13.0`, rubric `signoff-evidence-v7`, canonical input fingerprint, evaluation time, cache reuse time and Choice probabilities/confidence. Confidence measures distribution concentration, not accuracy. Old-rubric results are invalidated by the decision fingerprint without resetting collected data or watches.

## State and fixed policy numbers

Each independent PR request uses the compact `requirements → facts` model defined in [Evidence-driven readiness](21-readiness-architecture.md). Policy conclusions and overall build execution are distinct facts under one logical requirement. Names match exactly across projects; similar names are not merged. Approved C1–C13, W1–W12 and V1–V14 assignments never renumber. New policies get persistent P numbers. Project/gate/source aliases preserve numbers after rediscovery or rename. Priority remains separate from identity.
Non-main-target PRs, conflict PRs and the C1 definition are not sent to Jev. Shared numbering does not share project explanations: descriptions, priority and scopes remain project/repository specific. Distinct conclusions, expiry and required/enabled/applicable flags remain in decision evidence. Each underlying evaluation, provider message, scope and build association stays available in the cached verification API. Same-named policies can have conflicting conclusions without losing that evidence.

Other decision state includes lifecycle/draft/mergeability, exact approval counts/deficits, requested changes, concise build outcomes, commit match and collection coverage/validity. Stage details, reviewers' names, hashes, logs, generated actions and observation clocks stay outside the Jev request. Raw snapshots retain detail for UI and external verification. `isExpired` differs from `buildIsNotCurrent`; auto-complete is not assumed.

## Configuration and credentials

The API key is server-side AES-256-GCM ciphertext in D1. The encryption master is the separate `SIGNOFF_AI_ENCRYPTION_KEY` secret; local development loads the ignored `.dev.vars`. Neither secret appears in API reads, browser storage, URLs, model state or logs. Saving does not claim validity; Test connection makes one bounded synthetic request. It never reclassifies the watch list.

Local authorized endpoints:

- `GET/PUT /api/ai/settings`: metadata / `{revision,apiKey}`; null clears. Revision CAS.
- `POST /api/ai/test`: bounded explicit synthetic connection test.
- `GET /api/ai/rules`: common instructions and project-specific modules.
- `PUT /api/ai/rules`: `{scope,revision,text}`; `common` or a live project ID. Revision CAS, project validation. Only affected watched PRs are invalidated, including responses already in flight.
- `POST /api/ai/retry`: queue failed evaluations, respecting cooldown.
- `POST /api/ai/tick`: `{source}` invokes one bounded scheduler pass. The local collector daemon supplies `cli`; Sample evaluation requires an explicit `demo` tick.
- `GET/PUT /api/ai/schedule`: per-PR eligibility, project usage and `{revision,cooldownSeconds}` (60–3600 seconds).

Policy explanations and priorities retain existing project-wide revision CAS and repository scopes. New policies append after saved order. Editing rules or policy descriptions schedules new classification even when provider facts do not change.

## Background scheduling

The persistent collector daemon initiates inference independently of browser presence, including when the dashboard is hidden or closed. Keep `bun run dev:collector` running. Cached CLI queries remain read-only. Each PR independently waits 300 seconds after request completion by default; configure it in Connector details. Only changed watched PRs are included. The daemon checks for eligible work every 3 seconds after its previous tick completes, with a 10-second backoff after transport errors. Discovery remains 10 minutes/project; full watched detail collection remains 5 minutes/PR, both counted after completion.

Pending means decision evidence or instructions changed; it does not mean a Jev request started. Stage detail and observation clocks alone do not invalidate a judgment. Missing or invalidated checks return to collection first. Unchanged semantic inputs keep their saved result. Identical project-scoped states reuse a SQLite cache; cache hits bypass request cooldown.

The PR list keeps the last successful Jev badge visible while an update is pending, running or failed. A compact `Last result` line identifies it as historical and shows the estimated request delay, queued/running status or failure. Hover, keyboard focus or tapping that line reveals the previous evaluation time and scheduling details. ETA is the PR's earliest request time, subject to daemon availability and queued work, not a promised completion time. An initial evaluation without history still shows Pending. The API/CLI and detail inspector retain separate current/previous results; list presentation does not promote history to current evidence or change filters and inference scheduling.

The browser never sends inference ticks or presence heartbeats. The daemon uses an independent loop so slow inference does not block ADO collection. The scheduler runs at most three distinct single-PR requests concurrently and coalesces equal project/input keys. The shared state machine checks generation, input revision and lease tokens, then rechecks semantic evidence before attaching results. Transient failures retry at most three times under per-PR completion cooldown. No query initiates inference.

`POST https://api.typesafe.ai/v1/systemone` receives Bearer authentication and `{model,state,questions}` with one readiness Choice. Timeout is 30 seconds; redirects are refused. A 96,000-byte request ceiling rejects oversized input explicitly without truncation. Returned usage is actual token usage; bytes are not token estimates. Independent requests isolate malformed answers and provider failures. See [architecture and cache boundaries](21-readiness-architecture.md).

## Validation

Deterministic tests exercise credential masking/CAS, watched-only scheduling, identical-state dedupe, conflict exclusion, common/project rule changes, fixed numbers and rename aliases, expiry/failed/queued/advisory evidence, bounded retries and stale-response fences. Mocked Choice outputs verify application behavior, not model accuracy.

Cooldown regressions simulate a 12-second request: changed facts remain Pending through second 311, and the next request can start at second 312 (300 seconds after completion). Preparation time is also included in the completion clock. Repeated observation-only updates preserve both in-flight leases and completed results across multiple cooldowns without another model call. Equal project inputs coalesce into one single-PR request; a changed sibling evaluates independently while the unchanged judgment is preserved.

Browser tests use an isolated database and synthetic credentials. The browser test launches a real window with Playwright focus emulation disabled (`connectOverCDP` with `noDefaults`): foreground, background, return and reload send no inference or presence requests. Daemon tests verify independent scheduling and transport-error backoff; scheduler tests verify no-browser evaluation, source isolation, per-PR cooldowns and unchanged-state deduplication. Settings tests cover reload persistence and 390px layout. Current validation is recorded in [Evidence-driven readiness](21-readiness-architecture.md); the dated entries below describe earlier implementations.

Official references: [TypeSafe skill](https://docs.typesafe.ai/llms.txt), [Choice](https://docs.typesafe.ai/primitives/choice), [state](https://docs.typesafe.ai/concepts/state), [HTTP API](https://docs.typesafe.ai/api). The offline [Jev Input Lab](../apps/web/public/learn/jev-input.html) demonstrates state efficiency and makes no model calls.

Historical validation on 2026-09-21 (superseded project-batch implementation): lint, typecheck, build, all seven coverage tasks and all eight isolated browser tests passed. The local configured credential passed the explicit synthetic connection test. A real project request classified 13 non-conflicted watched PRs together (28,721 input tokens, 695 output tokens); one provider-conflicted PR was excluded. The sampled expired-build and failed-build PRs returned Attention. This validates integration and those cases, not general accuracy. Another review-pending example returned Running and remains a calibration case. Desktop/mobile reloads and a real background tab check were verified; no new ticks occurred during the measured background interval. Runtime observation snapshots and provider responses remain outside Git.

## Compact PR list

Repository, author, readiness, checks/stages, next action and freshness columns are sortable. The full target branch appears below the title after the colored lifecycle badge. Columns size to unwrapped content; checks/stages fills the remaining width with a readable minimum. Repository and author hide when width is insufficient; remaining content stays complete in an internally scrolling table. Headers, titles and readiness labels use 12px; auxiliary text uses 11px. Jev evaluated shows the age of the current or historical successful answer and its exact time on hover. Skipped and never-evaluated PRs show a dash. Loading placeholders mirror the configured shared list columns, shapes and 64px row minimum. API `sort` also supports target branch; timestamp sorts use actual times, with missing checks before collected checks in ascending order. Collection lists reuse these controls and rows.

Skipped is a direct classification with no model identity or previous-result badge. API status filtering and PR/repository counts include it. Deterministic tests cover exclusion from mixed watched batches, retargeting during inference, resuming a main target, and consistent query output. No provider write is involved.

Historical validation for the compact-list/Skipped change: lint, typecheck, build, all seven coverage tasks and all ten isolated E2E cases passed. Desktop and mobile reloads, full target text, all five new sortable columns, cyan styling, retained history and then-active foreground restrictions were verified. A read-only local cache check returned identical Web/CLI readiness for 14 watches, including one Skipped PR. Scheduler exclusion and retarget races used mocked inference; the live UI verification intercepted inference ticks and spent no Jev credits. Foreground restrictions have since been removed.

## Background scheduler validation

The background-scheduling change passes all seven repository coverage tasks, lint, typecheck, build and all 11 isolated browser E2E cases. Mocked Jev tests cover evaluation without browser presence, unchanged-state deduplication, independent completion cooldowns, source isolation and late-response fencing. Daemon tests cover concurrent ADO progress, inference transport backoff and prompt shutdown during idle waits. Desktop and 390px local-browser reloads show the updated Connector settings without sending inference/presence requests. Local migration 0035 preserves credentials, watches and cached judgments; the restarted daemon polls successfully. The 13 live watched PRs retained current cached judgments without forced reclassification. These runtime checks do not claim a new live-model classification or model accuracy.


## State machine workspace

The graph workspace restores the React Flow canvas and ELK automatic layout. It supports project/repository scope, a paginated searchable cached PR picker (watched by default), model and observed-transition views, gate filtering, zoom/pan, minimap navigation, fullscreen, node inspection, double-click focus, and focus on the selected PR judgment. Dragged node positions persist per source, project, repository and graph mode in localStorage; Auto layout clears that scope's saved positions. Polling facts updates node colors without resetting an unchanged graph layout.

The model displays provider lifecycle, prioritized policy evidence, Jev, and current readiness categories. Direct Conflict and Skipped checks have separate edges. Previous judgments remain explicitly marked while evaluation is pending; not-watched PRs have no active classification. Evidence inspection includes freshness, coverage, raw policy evaluations, builds/stages, votes and persisted inference metadata. The Rules inspector edits the existing common/project Jev instructions with their existing revision protections; old deterministic mappings and readiness overrides are not reinstated.

History reads `/api/state-machines/:projectId/history?source=live&pullId=...` from the local cache, validates source/project ownership and returns up to 30 accepted evidence changes from the last 12 hours. Transition edges describe observed lifecycle/check changes only. There is no invented historical Jev replay. Opening the workspace, switching tabs or reloading never initiates provider requests or inference.

Policy instructions have moved into System with project/repository URLs. The existing policy API, saved descriptions, priority ordering, inheritance, revision checks and inference invalidation remain unchanged. PR list “Readiness order” links now lead there.

Restoration validation (2026-09-22): all 13 isolated Playwright scenarios passed, including policy save/reload, shared PR URLs, graph controls, inspector/history and mobile containment. The full coverage gates, lint, typecheck and production build passed. A separate browser check against `https://signoff.dev.hexly.ai` verified a watched PR's persisted judgment, node inspection, drag-position persistence across reload, scoped history, policy reload and no console errors. The local verification did not modify live policies, watch membership or credentials.

Review Needed is a Jev Choice, never a code-derived override. Review approval deficits alone are not Attention, even when the associated policy has a negative conclusion. A rejected review-policy evaluation alone is not a reviewer rejection: absent explicit requests for author changes or another non-review action, it remains a review deficit. Actual requested code changes, failed builds or explicit expiry needing intervention remain Attention. PoP remains the final step after reviews. Exact approval counts and deficits exclude ineligible author/group votes; individual review policy evaluations remain in the state. `buildIsNotCurrent` alone is not explicit expiry. Saving editable rules schedules affected watched PRs under the per-PR cooldown; prior results remain visibly historical while pending.

Review Needed validation (2026-09-22): mocked scheduler coverage verifies that eligible individual approvals and deficits reach Jev alongside every policy evaluation, including rejected review compliance and explicit build expiry flags. The saved Choice remains authoritative, unchanged evidence deduplicates, and a new approval triggers reevaluation. Query tests cover filtering/counting/sorting and `request_review` advice with current/historical consistency. Graph and browser tests cover the new label, retained previous result, purple styling, filter persistence and compact layout. A bounded live Jev run classified two watched PRs with successful unexpired builds and outstanding review policies as Review Needed, kept a failed-build PR as Attention and active builds as Running. Web and cached CLI returned the same saved classifications. This smoke test is evidence for these cases, not an accuracy guarantee.

Required checks passed: workspace coverage gates, lint, typecheck, build and 13 isolated browser tests. Two initial browser runs exhausted the collection CRUD test's 60-second total workflow budget at different steps; its per-test budget is now 120 seconds with all assertions retained. The final run passed all 13 cases. Live desktop/mobile checks verified the Review Needed filter, persisted selection, reload and shared Web/CLI results.
