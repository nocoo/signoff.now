# Jev readiness and policy instructions

AI Settings (`/ai-settings`, directly above Settings) configures Jev. State machines (`/sm`) now edits project policy explanations and priority, with optional repository overrides. Deterministic state mappings, custom classification labels/colors, previews and replay endpoints have been removed.

## Meaning and contract

Readiness answers whether a person needs to act now. Only active watched PRs are evaluated. Classification comes exclusively from TypeSafe Jev Choice; no severity, first-gate or rule fallback remains.

| Kind | Meaning |
| --- | --- |
| `on_track` | Normal automatic progress or expected waiting; no human intervention currently indicated. Never permission to merge. |
| `attention` | Human intervention is needed. A separate bounded Choice selects the next action. |
| `unknown` | Jev cannot usefully classify insufficient, ambiguous or conflicting evidence. |
| `error` | Configuration, transport, request-budget or response validation failure; not a failed CI build. |

`readiness.status` distinguishes `not_watched`, `pending`, `running`, `complete` and `error`. Only `complete` has `current`; pending/running/error can retain `previous`, explicitly historical. Unwatched PRs display Not evaluated. Lifecycle, draft, raw checks, expiry and merge requirements remain separate facts. The old `ready` boolean, issue list, rule rank, owner and primary blocker fields are removed. API, web and cached CLI return the same stored judgment. Filters accept `on_track`, `attention`, `unknown`, `error`; counts use `onTrack`, `attention`, `unknown`, `error`.

A result records model `jev-1.13.0`, rubric `signoff-intervention-v3`, input fingerprint, evaluation time, observation provenance, Choice probabilities/confidence and the selected action with its distribution. Confidence is distribution concentration, not measured accuracy. Next actions are fixed templates for conflict resolution, build investigation, rerun, review, approval, merge, project instructions or evidence investigation; Jev does not generate prose. Consult the raw provider evidence before acting. SignOff performs no merge, approval, rerun or bypass.

## Credentials and requests

The key is saved server-side, encrypted with AES-256-GCM in D1. `SIGNOFF_AI_ENCRYPTION_KEY` is a separate base64-encoded 32-byte Worker secret. Local development loads it from ignored `.dev.vars` with mode 0600. Retain this encryption secret to decrypt the saved key; replacing it requires re-entering the Jev key. Do not put either secret in Git, frontend storage, API reads, logs, URLs or model state.

Local authorized endpoints:

- `GET /api/ai/settings`: configured/storage/test metadata only.
- `PUT /api/ai/settings`: `{revision, apiKey}`; null clears, nonempty replaces; revision CAS protects concurrent changes.
- `POST /api/ai/test`: one bounded synthetic connection request, no PR reclassification. Saving alone does not claim validity.
- `POST /api/ai/retry`: explicitly retries operational errors.
- `POST /api/ai/presence`: ordered, source-specific foreground tab heartbeat.
- `GET /api/ai/schedule?source=cli|demo`: cooldown and per-project timing/token usage.
- `PUT /api/ai/schedule`: `{revision,cooldownSeconds}` (60–3600 seconds), revision CAS.
- `POST /api/ai/tick`: foreground browser request `{id,sequence,source}`, gated by that exact tab presence revision and cooldown. Empty/unscoped daemon requests are rejected.

The integration posts `{model,state,questions}` to `https://api.typesafe.ai/v1/systemone` with Bearer authentication. It uses a 30-second timeout and refuses redirects; project batches are bounded to 28,000 UTF-8 state bytes and 56,000 complete request bytes, conservative bounds below the official 32k state-plus-question / 64k total token limits. A large project is split across cooldown intervals; an individually oversized PR fails explicitly. Bytes are not measured tokens; returned usage reports actual input/output tokens. Official references: [API](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice), [state](https://docs.typesafe.ai/concepts/state), [models](https://docs.typesafe.ai/models).

## Input and policy scope

English rubrics consume structured evidence: lifecycle, draft/mergeability, branch/head/target identities and exact hash comparisons; exact approval counts and requirements; reviewer votes and required reviewers; all policy evaluations, flags, scope, explicit expiry, descriptions and build associations; all builds and stage attempts, raw status/results and available provider messages; coverage, missing checks and validity.

The v2 input shares a deduplicated `scopes` array across the catalog and raw evaluations. Each `scopeRefs` array contains zero-based indices into it; absent scope remains uncollected and an empty array remains explicitly empty. Catalog entries appear directly in priority order, highest first. Provider descriptions occur only in raw evidence, and the stage required provenance is stated once for all stages. No descriptions, evaluations, scopes, attempts or lower-priority evidence are truncated. The shorter rubric retains the same intervention semantics and changes the fingerprint version so old-format judgments are not reused.

A local comparison of the same 15 watched snapshots measured complete request bodies at approximately 30.9 KB before and 22.1 KB after, a 28.6% reduction in UTF-8 bytes. This is a payload measurement, not a provider token or billing estimate; measurement and regression tests require no Jev calls. Tests verify scope reconstruction, missing/empty/false/zero distinctions, deduplication and fingerprint stability under reordered observations.

Project instructions include the full user priority order, highest first. Order supplies context, never a coded blocker selection. Policy meanings are not inferred from names. Generated collector action summaries are omitted from model state. `isExpired` and `buildIsNotCurrent` remain distinct. ADO target identity is `lastMergeTargetCommit`, not an independent target-ref read. Stage required flags are identified as collector-derived, not provider guarantees. Auto-complete is not collected and is explicitly unknown.

Project and repository instructions are saved through the existing project-wide revision CAS. Scope defaults inherit from the project; clearing an override restores inheritance. Logical policy catalogs preserve underlying source identities, scopes and evaluations. New gates append after saved priorities; existing descriptions are not copied across projects.

## Background consistency

Jev evaluates changed watched PRs together by project only while at least one same-source SignOff tab is visible and focused. Each project has an independent cooldown, default 300 seconds after batch completion (or a start reservation after interruption). Connector details configures the interval. Background time counts; returning foreground immediately requests eligible work. A 5-second heartbeat renews a 15-second presence lease; blur, hide and normal close retire presence immediately. An in-flight request may finish after backgrounding. A crash is bounded by the lease expiry. Only the foreground browser initiates inference; the collector daemon has no inference loop. Each tick is bound to its initiating tab ID, source and exact presence sequence, and this is rechecked immediately before the Jev request. Other visible tabs cannot authorize a revoked tab. Blur/hide aborts pending browser ticks, and losing foreground during preparation releases claims without consuming cooldown. Closing all browsers stops new inference; the presence expiry remains a defensive check. Cached CLI queries do not register presence or invoke inference. The explicit synthetic connection test is exempt from scheduling. Discovery retains its 10-minute per-project completion cooldown. Full watched detail collection retains its 5-minute per-PR completion cooldown. Jev adds no provider collection lane.

Watch activation, provider evidence changes, policy explanation/order changes and key revisions schedule evaluation. A canonical fingerprint covers decision state, project instructions, model and rubric. Poll clocks, request IDs, avatar URLs and ticking stage durations are excluded. Freshness becomes a decision fact when the summary/check age exceeds max(20 minutes, 3 detail cooldowns); crossing that boundary reevaluates. Observation timestamps remain result provenance.

One database runner lease bounds inference concurrency to one. An already-dispatched Jev request may complete after a focus change; backgrounding cannot undo a provider request already sent. Identical inputs reuse completed judgments, including after a normal collection poll. Transient transport/429/5xx errors get at most three attempts with backoff and bounded Retry-After; retries and manual retry also respect the project cooldown. Shared exact-equal project/repository contexts are included once, with per-PR questions explicitly referencing their context. A malformed sibling answer does not discard valid results for other PRs. Exhausted or nontransient failures persist as Error until facts/config change or explicit retry. Generation, input revision and lease token fence late responses after changes, unwatch or rewatch. Removed watches never receive a late current result.

## Verification

Deterministic SQLite and API tests cover encryption/masking/removal, CAS/scope, all policy evidence, canonical dedupe, retries and late facts/instructions/key/unwatch/rewatch races. Browser verification covers AI Settings placement and reload, desktop/mobile layouts, policy editing and cached result parity. A real user-supplied key was configured through the local UI; the bounded connection request and classifications of the existing 15 watched PRs succeeded on 2026-09-21. These requests demonstrate the real integration, not an accuracy benchmark.

Before foreground batching, local validation passed: repository lint, typecheck, all seven coverage tasks, the web production build, and all seven isolated Playwright E2E tests. That earlier browser-independent inference behavior is superseded by the foreground requirement. Web/API and cached CLI share persisted judgments. Desktop and 390-pixel mobile layouts were checked for horizontal overflow.

The standalone [Jev Input Lab](../apps/web/public/learn/jev-input.html), served locally at `/learn/jev-input.html`, explains the official skill's input-efficiency guidance in Chinese. It includes an independent-question batching calculator, source-linked lessons, reversible synthetic state compression, and evidence-retention questions. It works offline and makes no model requests; simulated token counts and measured JSON bytes are explicitly distinguished.


Foreground batching validation (2026-09-21): repository lint and typecheck, all seven coverage tasks, production build, and all seven isolated Playwright tests passed. Tests cover watched-only batch membership, shared contexts, source-specific foreground leases, per-project cooldowns, return after background, dedupe, partial answer failure and late-response fences. Desktop and 390px mobile checks at the local HTTPS URL showed no horizontal overflow or page errors. Connector cooldown changes persisted across reloads. Browser verification intercepted inference triggers to avoid spending credits on the old rubric while the replacement policy definitions are being clarified; no new live-model batching claim is made.
