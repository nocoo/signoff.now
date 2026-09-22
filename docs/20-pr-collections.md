# PR collections

Collections group cached PRs around a release, testing effort, or another purpose. Open **Workspace → Collections** to create a collection, choose its icon and color, edit its name and purpose, add PRs, remove members, or delete the collection. Names are unique within Live or Sample, ignoring case.

The collection detail starts with **all states**, including drafts, merged PRs and closed PRs. The entire matching membership loads automatically, without a page selector. Cached cursor reads use batches of 200 and restart up to twice if the snapshot changes; a failed load never publishes a partial list. The progress bar reports **merged / total members**; closed PRs remain visible and do not count as merged. This is lifecycle progress, not readiness or permission to merge. Open PR rows reuse the persisted Jev readiness presentation, including the distinction between the last judgment and an evaluation for current evidence. Checks and build stages come from the existing cache.

A PR can belong to multiple collections. The small collection icon below its title in the PR list shows memberships on hover; click to change them. Collection membership does not start a watch, request collection, invoke Jev, or modify anything in the provider. Deleting a collection removes its memberships while retaining cached PRs, watches, and other collections. Membership survives ordinary rediscovery, refresh, title changes, and lifecycle transitions.

Live and Sample collections are isolated. Switching the data source changes the catalog and membership choices. On narrow screens, controls wrap and the member table scrolls horizontally while retaining its contents.

The main PR list and collection detail use the same `PullList` and `PullFilters` components: 12px primary text, 11px metadata, 64px rows and matching loading skeletons, lifecycle badges, target branches, checks/stages, readiness, next actions, and freshness columns. Columns can be enabled by key; selection and trailing row actions are optional. Collection details add a removal action and reuse the existing shared-watch commands, including optimistic state, duplicate-request protection, source checks, and watch-generation fencing. Individual Watch controls and the explicit **Add to watch list** bulk action change watch membership; adding/removing a collection member still does not. Collection sorting is performed against its full cached membership. Search, draft, author, lifecycle, watch, and readiness filters use the same controls and semantics as the main list. Selecting all includes completed PRs so they can be removed from a collection; bulk Watch only adds open PRs and skips existing watches. Changing filters clears selection. Watch writes are batched at 100 IDs; membership reads/writes at 200 IDs, advancing the CAS revision after each successful write. A failed batch stops later writes; earlier successful batches remain committed. Fixed action cells use the current Basalt surface, zebra, hover, and selection colors.

## Cached API

All routes use the existing API authorization. Reads use cached D1 data and perform no provider requests. Responses are not browser-cached. `source=live|sample` defaults to `live`.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/pr-collections?source=live` | Catalog, metadata, revision, and lifecycle counts |
| POST | `/api/pr-collections?source=live` | Create with `name`, `description`, `color`, `icon` |
| GET | `/api/pr-collections/:id?source=live` | Read one collection |
| PATCH | `/api/pr-collections/:id?source=live` | Save metadata with the current `revision` |
| DELETE | `/api/pr-collections/:id?source=live&revision=N` | Delete with revision protection |
| PUT | `/api/pr-collections/:id/members?source=live` | Add/remove with `{revision, action: "add"\|"remove", pullIds: [...]}` |
| GET | `/api/pr-collections/memberships?source=live&pullId=ID&pullId=ID` | Batch membership lookup for up to 200 visible PR IDs |
| GET | `/api/query/v1/prs?source=live&collectionId=ID&state=all&draft=include` | Existing paginated PR contract, restricted to collection members |

Writes validate names (1–80 characters), descriptions (up to 1,000 characters), six supported colors, and six icons. IDs are SignOff cache IDs, not provider PR numbers. A member write accepts up to 200 IDs, deduplicates them, and atomically rejects a batch containing missing PRs or PRs from another source. Add/remove operations preserve unrelated membership. Stale revisions return HTTP 409; reload before retrying. The member primary key also prevents duplicate membership. Changes invalidate query cursor revisions so pagination cannot silently mix membership snapshots.

The schema is defined in `@signoff/domain/pr-collections`. Storage is introduced by migration `0038_pr_collections.sql`. Collection `updatedAt` describes metadata/membership edits; individual PR timestamps describe cached PR facts and remain separate. Lifecycle counts are mutually exclusive (`open` excludes drafts), and sum to `total`.

## Initial collection

The local `wb-unittest` collection was populated from all Live cached PRs whose titles began exactly with `[UT]`, including merged and draft PRs. This was an explicit one-time membership operation, not a continuously evaluated title rule. Future members can be added through the UI or API. No live PR snapshots or private provider payloads are checked into the repository.

## Verification

Worker integration tests exercise CRUD, validation, revision conflicts, source isolation, multi-collection membership, all lifecycle counts, pagination, idempotent adds, atomic rejection, and membership persistence through lifecycle updates. Client and ViewModel tests cover HTTP contracts, source switching, batched lookups, debounced search, duplicate-click prevention, errors, and late completion after unmount.

The disposable browser suite provisions synthetic provider results and checks collection CRUD, multi-page candidate selection, unpaginated membership display, shared state filters, bulk Watch and membership removal, reload persistence, multi-collection tooltips, removal/deletion, source isolation, and mobile containment. It verifies membership edits do not change watches or issue provider requests, and explicit Watch controls persist through reload and can stop a watch without removing collection membership. Local acceptance also exercises the actual HTTPS application and its cached PRs.
