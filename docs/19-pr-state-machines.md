# PR state machines

System → State machines owns classification, requirement priority, labels, colors and mappings. The daemon collects provider facts. The shared domain evaluator interprets those facts for both the cached CLI queries and the web. Filters only select rows; they never update facts, rules or watches.

## Model

Lifecycle (open, draft, completed, abandoned) is independent of concurrent review, build, status and policy gates. Requirement priority selects the primary next action; it does not prescribe pipeline execution. All blocking issues remain in the result.

Projects have a default machine; stable repository IDs can override it. Existing readiness settings supply the initial defaults. Newly discovered requirements are appended without deleting saved mappings. Policy repository/branch scope and underlying evaluation IDs remain available alongside logical grouped gates.

Each mapping has an ordered position, an enabled flag, an output state and typed AND/OR conditions. Conditions can inspect lifecycle, draft, mergeability, coverage, check validity, the baseline classification, a gate state, provider policy status, explicit build expiry and target currency. The first eligible mapping wins. There is no executable user code. The evaluator returns the match results and protection reason for every mapping.

Provider terminal states and draft cannot be manufactured or overridden. A mapping cannot declare ready while any required gate, incomplete collection, unknown mergeability or invalidated check prevents readiness. `buildIsNotCurrent` is independent of `isExpired`; being behind the target alone does not expire an accepted ADO build. Raw evidence is retained so interpretations can be replayed after rule changes.

## Persistence and replay

Machine revisions are independent of collection revisions and leases. Configuration updates use project-wide compare-and-swap, so concurrent repository/default edits cannot silently overwrite one another. Saves invalidate the shared query revision but never rewrite PR snapshots or create collection work. Old readiness writes are rejected once a machine is configured, with a link to the new editor.

The API provides read-only preview against cached PRs, version history and version loading for a previewable rollback. Replay is bounded to the most recent 2,000 cached PRs in the selected scope, with open PRs first; responses expose total/evaluated counts and truncation. Configuration bodies and combined saved settings are bounded to 256 KiB. The latest 30 configuration versions are listed; earlier versions remain addressable by revision.

Snapshot mutations atomically record observed evidence changes using D1 triggers. A rejected publication or rolled-back transaction creates no event. Polling clocks and content-only changes do not create state events. Each event retains the before/after facts and the rule context used at observation time. Rule saves are version events, separate from provider observations. The latest 30 observations per PR are retained. History starts when the migration is applied; polling may skip intermediate provider states.

All `/api/state-machines/:projectId` routes require the same browser/Access boundary as other project management APIs. Pipeline credentials cannot manage machines. Live and Sample scopes are explicit.

| Method / suffix | Behavior |
|---|---|
| GET | Effective machine, gate catalog, cached classifications and selected PR history |
| POST `/preview` | Evaluate a draft without writes or provider calls |
| PATCH | Save a validated configuration at the expected revision |
| GET `/versions/:revision` | Load the selected scope from an earlier version into a draft |

Graph layout is a local view preference. Moving graph nodes changes no mapping or priority; edits in the inspector and priority editor are previewed and explicitly saved.
