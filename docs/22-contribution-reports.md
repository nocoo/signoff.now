# Contribution reports and repository discovery

Insights reads cached PR facts as soon as it opens. `GET /api/insights/report`
performs a consistent, read-only D1 batch; it does not schedule collection, call
ADO, or run inference. It returns both perspectives from the same contributor ×
repository aggregation.

## Scope and identity

The page shows the last 90 UTC calendar days, including today, by PR creation
time. Open, merged, closed and draft are mutually exclusive counts. Drafts are
excluded unless enabled. Date changes from older saved page preferences do not
replace this rolling window. Project, repository, state and draft filters apply
to both perspectives.

Contributor filters select people for the contributor report and overview.
Repository totals and author rankings retain every visible author in the repository;
person, team and tag filters mark selected contributors without reducing the
comparison denominator. Share is authored PR count divided by the corresponding
repository count. Rank is one plus the number of authors with a strictly larger
count; equal counts share a rank. A followed person with zero matching PRs stays
selectable.

Accounts link through exact source/provider/organization/actor identity. Names
and email guesses never merge people. Explicitly linked accounts aggregate into
one followed member across repositories. Repository identity includes its local
project registration. Live and Sample statistics and active calculations remain
separate.

PR detail offers Follow author, Followed, or Restore follow beside the author.
It reuses Directory revision-checked writes and refuses unavailable identities.

## Global Calculate

One page-level Calculate command schedules deep discovery for the enabled
projects/repositories in the selected scope. Person filters do not constrain
collection, since repository comparisons need all authors. Receipts are returned
immediately and progress is tracked through cached job queries. A repository
catalogue task can fan out into repository child tasks; the page follows those
children too. Individual failures preserve collected results and remain visible.
Task IDs are retained in session storage across page navigation. Cached reports
stay visible while jobs run and are reread after completion.

`POST /api/commands/v1/discover` accepts either a repository URL or a project ID
with optional `repositoryIds`, plus `depth: "smart" | "deep"`. Routine callers
omit depth and receive smart discovery. Queue identity, coalescing and cooldown
include project revision, repository and depth. Each repository is published
independently. Discovery is serial within one project; a sibling repository does
not inherit another repository's completion cooldown.

## Discovery depth

- Initial discovery and deep discovery enumerate every PR state in the last
  90 days, refreshing summary and lifecycle facts from the provider list.
- Smart discovery always reads the first page, refreshes the returned summaries,
  and reuses older cached history. It follows additional pages only while they
  may contain new PRs beyond the last successfully covered creation-time boundary.
  The entire boundary page is published before paging stops. Timestamp ties are
  drained; observed non-descending page order disables this optimization.
- The cursor records the successful job's start time, not its completion time or
  the newest independently watched PR. Failed or partial publication cannot
  advance it. Initial discovery, deep discovery and caches without a successful
  cursor enumerate the complete 90-day window. Smart provider queries overlap
  30 days before the last successful completion, capped at 90 days, so downtime
  cannot truncate newly created PRs. Old lifecycle updates beyond the fetched
  pages are left for explicit deep calculation.
- Older cached PRs remain available. Routine discovery does not promise to
  refresh every historical PR's state.
- Build, policy and detailed review collection remains attached to watched PRs.
  Deep report discovery does not fan out checks requests for third-party PRs.

The collector passes explicit provider creation-time bounds and validates the
returned records. Lease, revision and snapshot-version fences continue to prevent
stale discovery from overwriting newer watched evidence. A successful repository
receipt means its requested discovery window completed, not that all repository
history was enumerated. Connector groups identify repository and depth.

## Storage and validation

Migration 0041 adds discovery depth, catalogue tasks and child relationships,
rebuilds queue/coalescing indexes and cancels active tasks with the superseded
scope contract. Migration 0042 adds author/repository observation indexes;
reports reuse the existing project/creation-time cohort index. The aggregation
reads bounded facts and uses indexed latest-metadata probes rather than scanning
historical snapshot payloads.

SQLite tests cover exact identities, source isolation, denominator preservation,
zero-contribution members, date boundaries, indexes and read-only behavior.
Collector tests cover bounded paging, summaries without checks, repository
fanout, cooldown isolation, offline gaps, partial results and stale publication.
Web tests cover calculation progress, child tasks, navigation/source races,
partial failures, cache reads and the two report perspectives.

## Contributor profiles and hiding

Members, discovered authors and report contributors open a shared profile by
hover or click. Keyboard activation opens the same accessible popover. It shows
cached 90-day totals including drafts, with Contributions, Follow/Unfollow and
Hide/Unhide actions in one row. Long names and accounts wrap to at most two lines within the card.
`GET /api/insights/contributor` reads cached statistics, including those for hidden
people. No profile is queried until opened.

Migration 0043 persists source-scoped contributor exclusions. A hide action covers the
member and its linked identities; subsequently linked identities inherit it.
Unlinking preserves the detached identity's hidden status. Hiding preserves follow
membership and PR snapshots but excludes the person from report counts and
repository denominators. The Hidden directory tab supports recovery, including
members without linked accounts. All actions use revision-checked writes.

## Avatar cache

Migration 0044 stores avatar image bytes in local D1. Existing PR author and
reviewer URLs and linked ADO identities register background work; later changes
register through database triggers. Collector claims at most four images per
batch and refreshes successful images every seven days. Failures retain old
bytes and defer another attempt for one hour. Image retrieval reuses the existing
Azure CLI session, permits only organization-scoped ADO identity-image URLs, and
bounds each raster image to 256 KiB without following redirects.

`GET /api/avatars` only reads stored bytes, with ETag and private browser caching.
A cold miss displays initials and visible pages retry the local read after one
minute. No page request starts provider work. The shared avatar component is
used by Directory, Insights, PR lists, PR details and existing dashboards.
A valid Azure CLI session is required for initial population and refresh.
