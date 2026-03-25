# 05 — PR UI Enhancement: Close the Data-Display Gap

> Ensure every field returned by the Pulse CLI is surfaced in the desktop UI
> with professional presentation, clear hierarchy, and clickable GitHub links.

---

## 1. Context

The `@signoff/pulse` CLI returns rich PR data through `PullRequestInfo` (19 fields),
`PullRequestDetail` (35 fields), and `RepositoryInfo` (17 fields). The desktop UI
already displays most fields, but a gap analysis reveals **hidden data, missing links,
and presentation issues**.

This document covers three concerns:
1. **Existing fields** whose position or styling needs adjustment.
2. **Available-but-undisplayed fields** that should be surfaced.
3. **Clickable GitHub links** — a unified helper that turns usernames, branches,
   files, labels, milestones, and commits into clickable URLs.

---

## 2. Gap Analysis

### 2.1 PR List View (`PrListPanel` → `PrRow`)

`PullRequestInfo` has 19 fields. The list row currently displays 11 (state, isDraft,
merged, title, number, author, createdAt, labels, reviewDecision, additions, deletions).

| Field | Status | Issue / Action |
|:------|:-------|:---------------|
| `state` | ✅ displayed | OK — color-coded icon |
| `isDraft` | ✅ displayed | OK — affects icon |
| `merged` | ✅ displayed | OK — affects icon |
| `title` | ✅ displayed | OK — truncated |
| `number` | ✅ displayed | ⚠️ **Add link** — clickable → opens PR URL |
| `author` | ✅ displayed | ⚠️ **Add link** — clickable → `{origin}/{author}` |
| `createdAt` | ✅ displayed | OK — relative date |
| `labels` | ✅ displayed | OK — first 3 + overflow |
| `reviewDecision` | ✅ displayed | OK — color badge |
| `additions` | ✅ displayed | OK — green mono |
| `deletions` | ✅ displayed | OK — red mono |
| `updatedAt` | ❌ hidden | **Add** — show in row 2, e.g. "updated 2h ago" when differs from createdAt |
| `headRefName` | ❌ hidden | **Add** — show as mono badge in row 2: `feature-x → main` |
| `baseRefName` | ❌ hidden | (shown together with headRefName) |
| `changedFiles` | ❌ hidden | **Add** — append to diff stats: `+42 / -7 · 3 files` |
| `url` | ❌ hidden | Used for number link (no separate display needed) |
| `closedAt` | ❌ hidden | Skip in list — too dense, shown in detail |
| `mergedAt` | ❌ hidden | Skip in list — too dense, shown in detail |

**Summary of list view changes:**
- 4 fields to add to display (updatedAt, headRefName→baseRefName, changedFiles)
- 2 fields to make clickable (number → PR URL, author → profile URL)

---

### 2.2 PR Detail View (`PrDetailPanel`)

`PullRequestDetail` extends `PullRequestInfo` with 16 additional fields. All top-level
fields are rendered. The gaps are in **sub-item fields** and **link support**.

#### 2.2.1 Header & Summary

| Field | Status | Issue / Action |
|:------|:-------|:---------------|
| `title` | ✅ | OK |
| `number` | ✅ | ⚠️ **Add link** — clickable → PR URL |
| State badge | ✅ | OK |
| `reviewDecision` | ✅ | OK |
| `isCrossRepository` | ✅ | OK — Fork badge |
| `url` | ✅ | OK — "Open on GitHub" button |
| `author` | ✅ | ⚠️ **Add link** — clickable → `{origin}/{author}` |
| `createdAt` | ✅ | OK |
| `updatedAt` | ✅ | OK |
| `mergedAt` | ✅ | OK (conditional) |
| `closedAt` | ✅ | OK (conditional) |
| `changedFiles` | ✅ | OK |
| `totalCommentsCount` | ✅ | OK (conditional) |

#### 2.2.2 Merge Status Card

| Field | Status | Issue / Action |
|:------|:-------|:---------------|
| `mergeable` | ✅ | OK — color badge |
| `mergeStateStatus` | ✅ | ⚠️ **Improve** — raw enum like "CLEAN" shown; humanize to "Clean" |
| `mergedBy` | ✅ | ⚠️ **Add link** — clickable → `{origin}/{mergedBy}` |

#### 2.2.3 Branch & Changes Card

| Field | Status | Issue / Action |
|:------|:-------|:---------------|
| `headRefName` | ✅ | ⚠️ **Add link** — clickable → `{origin}/{owner}/{repo}/tree/{branch}` |
| `baseRefName` | ✅ | ⚠️ **Add link** — same pattern |
| `headRefOid` | ✅ | ⚠️ **Add link** — clickable → `{origin}/{owner}/{repo}/commit/{sha}` |
| `baseRefOid` | ✅ | ⚠️ **Add link** — same pattern |
| `additions` | ✅ | OK |
| `deletions` | ✅ | OK |

#### 2.2.4 Description Card

| Field | Status | Issue / Action |
|:------|:-------|:---------------|
| `body` | ✅ | ⚠️ **Improve** — currently `<pre>` raw text; should render as Markdown |

#### 2.2.5 Participants Card

| Field | Status | Issue / Action |
|:------|:-------|:---------------|
| `assignees[]` | ✅ | ⚠️ **Add links** — each login clickable → profile |
| `reviewRequests[]` | ✅ | **No link** — `string[]` mixes user logins and team slugs, can't distinguish (see §3.4). Plain text only |
| `participants[]` | ✅ | ⚠️ **Add links** — each login clickable → profile |

#### 2.2.6 Reviews Card

| Field | Status | Issue / Action |
|:------|:-------|:---------------|
| `review.author` | ✅ | ⚠️ **Add link** → profile |
| `review.state` | ✅ | OK — color badge |
| `review.submittedAt` | ✅ | OK |
| `review.body` | ✅ | OK — truncated 200 chars |
| `review.comments[].path` | ✅ | ⚠️ **Add link** → `{origin}/{owner}/{repo}/blob/{headRefOid}/{path}` |
| `review.comments[].line` | ✅ | ⚠️ Included in file link: `#L{line}` |
| `review.comments[].body` | ✅ | OK — truncated 200 chars |
| `review.comments[].author` | ❌ hidden | **Add** — show author before comment body |
| `review.comments[].createdAt` | ❌ hidden | **Add** — show relative date |
| `review.comments[].originalLine` | ❌ hidden | Skip — `line` is sufficient for linking |
| `review.comments[].diffHunk` | ❌ hidden | Skip — too noisy for summary view |
| `review.comments[].updatedAt` | ❌ hidden | Skip — createdAt is sufficient |

#### 2.2.7 Comments Card

| Field | Status | Issue / Action |
|:------|:-------|:---------------|
| `comment.author` | ✅ | ⚠️ **Add link** → profile |
| `comment.createdAt` | ✅ | OK |
| `comment.body` | ✅ | OK — truncated 300 chars |
| `comment.updatedAt` | ❌ hidden | **Add** — show "(edited)" indicator when differs from createdAt |

#### 2.2.8 Commits Card

| Field | Status | Issue / Action |
|:------|:-------|:---------------|
| `commit.abbreviatedOid` | ✅ | ⚠️ **Add link** → `{origin}/{owner}/{repo}/commit/{oid}` |
| `commit.message` | ✅ | OK — first line |
| `commit.statusCheckRollup.state` | ✅ | OK |
| `commit.statusCheckRollup.checkRuns[]` | ✅ | OK — icon + name + conclusion + detailsUrl link |
| `commit.author` | ❌ hidden | **Add** — show author login after message |
| `commit.authoredDate` | ❌ hidden | **Add** — show relative date |

#### 2.2.9 Files Card

| Field | Status | Issue / Action |
|:------|:-------|:---------------|
| `file.changeType` | ✅ | OK — color badge |
| `file.path` | ✅ | ⚠️ **Add link** → `{origin}/{owner}/{repo}/blob/{headRefOid}/{path}` (ADDED/MODIFIED) or `baseRefOid` (DELETED) |
| `file.additions` | ✅ | OK |
| `file.deletions` | ✅ | OK |

#### 2.2.10 Labels Card

| Field | Status | Issue / Action |
|:------|:-------|:---------------|
| `labels[]` | ✅ | ⚠️ **Add link** → `{origin}/{owner}/{repo}/labels/{encoded_label}` |

#### 2.2.11 Milestone Card

| Field | Status | Issue / Action |
|:------|:-------|:---------------|
| `milestone` | ✅ | ⚠️ **Add link** → `{origin}/{owner}/{repo}/milestones` (list page — need milestone number for deep link, see §3.3) |

---

### 2.3 Repository Info (not yet integrated)

`RepositoryInfo` is available in the pulse package but has **no corresponding UI view
or tRPC router in the desktop app**. This is a separate feature (not in scope for
this document) — the existing OverviewTab uses local `@signoff/gitinfo` data instead.

---

## 3. Design

### 3.1 GitHub Link Helper — `buildGitHubUrl()`

A single utility function that generates clickable GitHub URLs. Lives in a shared
location accessible by all PR components.

**File:** `apps/desktop/src/renderer/components/GitInfoDashboard/tabs/pr/github-urls.ts`

```typescript
interface GitHubUrlContext {
  /** GitHub origin including protocol, e.g. "https://github.com" or
   *  "https://github.example.com" for Enterprise. Extracted from the PR
   *  url field — never hardcoded. */
  origin: string;
  owner: string;
  repo: string;
  /** Head commit SHA (for linking files on the PR branch). */
  headRefOid?: string;
  /** Base commit SHA (for linking deleted files on the base branch). */
  baseRefOid?: string;
}

type GitHubUrlTarget =
  | { type: "pr"; number: number }
  | { type: "user"; login: string }
  | { type: "branch"; name: string }
  | { type: "commit"; sha: string }
  | { type: "file"; path: string; line?: number | null; ref?: string }
  | { type: "label"; name: string }
  | { type: "milestones" }  // list page only — see §3.3

function buildGitHubUrl(ctx: GitHubUrlContext, target: GitHubUrlTarget): string;
```

All generated URLs use `ctx.origin` as the base — no hardcoded domain.

**URL patterns:**

| Target | URL Pattern |
|:-------|:-----------|
| PR | `{origin}/{owner}/{repo}/pull/{number}` |
| User | `{origin}/{login}` |
| Branch | `{origin}/{owner}/{repo}/tree/{encoded_branch}` |
| Commit | `{origin}/{owner}/{repo}/commit/{sha}` |
| File | `{origin}/{owner}/{repo}/blob/{ref}/{path}#L{line}` |
| Label | `{origin}/{owner}/{repo}/labels/{encoded_name}` |
| Milestones | `{origin}/{owner}/{repo}/milestones` (list page — see §3.3) |

**Clickable link component:**

```typescript
// GhLink — wraps children in a clickable element that opens the URL externally.
// Uses trpc.external.openUrl mutation (same pattern as "Open on GitHub" button).
function GhLink({ ctx, target, children, className }: {
  ctx: GitHubUrlContext;
  target: GitHubUrlTarget;
  children: React.ReactNode;
  className?: string;
}): JSX.Element;
```

**Rendering strategy:**

`GhLink` always renders as a native `<button>` — consistent with Electron convention
and the existing "Open on GitHub" pattern. No dual-mode logic needed.

To make this work inside `PrRow`, the row container must **not** be a `<button>`.
Currently `PrRow` is a `<button>` element; it must be refactored to:

```tsx
<div
  role="button"
  tabIndex={0}
  onClick={onSelect}
  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect(); }}
  className={cn("...", isSelected ? "bg-accent" : "hover:bg-accent/50")}
>
  {/* GhLink <button> children are now legal — no nested interactive violation */}
</div>
```

This gives identical semantics and keyboard behavior to the current `<button>` row,
while allowing real `<button>` children inside. `GhLink` buttons call
`e.stopPropagation()` on `onClick` to prevent the row's `onClick` from firing.

- Calls `trpc.external.openUrl.useMutation()` on click
- Adds subtle hover underline + external link icon (optional, only on hover)
- Inherits parent text color, no separate link color

### 3.2 PR URL Context Propagation

The `GhLink` component needs `origin`, `owner`, and `repo` to build URLs. Two approaches:

**Option A — Props drilling:** Pass `origin`/`owner`/`repo`/`headRefOid`/`baseRefOid`
down from `PrDetailPanel` to all child components. Verbose but explicit.

**Option B — React Context:** Create `GitHubUrlContext` context at `PrDetailPanel` level.
All child components read from context. Cleaner, but adds a provider layer.

**Decision: Option B (Context)** — the URL context doesn't change within a detail view
and many children need it. A single provider at `PrDetailPanel` top level keeps the
component signatures clean.

However, this requires `origin`, `owner`, and `repo` to be available in the detail view.
Currently, `PullRequestDetail` doesn't carry these directly. We extract them from the
`url` field: `https://github.com/{owner}/{repo}/pull/{number}` (or an Enterprise URL
like `https://github.example.com/{owner}/{repo}/pull/{number}`).

```typescript
function parseGitHubPrUrl(url: string): {
  origin: string;   // e.g. "https://github.com" or "https://github.example.com"
  owner: string;
  repo: string;
} | null;
```

This naturally supports GitHub Enterprise: `new URL(url)` gives us `origin`, then the
pathname gives `/{owner}/{repo}/pull/{number}`. All subsequent `buildGitHubUrl()` calls
use the extracted `origin`, so Enterprise links are generated correctly end-to-end.

### 3.3 Milestone Linking Limitation

GitHub milestone URLs use a numeric ID (`/milestone/3`), but the Pulse data only
stores the milestone **title** string. Without the milestone number, we can only
link to the milestones list page. Accept this limitation for now:

- Link to: `{origin}/{owner}/{repo}/milestones` (list page, plural)
- Future: add `milestone.number` to the GraphQL query if deep linking is needed

### 3.4 Team Review Request Linking

Review requests can be either users (login) or teams (slug). The URL patterns differ:

- User: `{origin}/{login}`
- Team: `{origin}/orgs/{owner}/teams/{slug}`

**Problem:** The current data model collapses both into `string[]` — we can't distinguish
user logins from team slugs after mapping. Two options:

- **Option A:** Link all as `{origin}/{name}`. Team slugs won't resolve — this
  **actively manufactures broken links**, which is worse UX than plain text.
- **Option B:** Leave `reviewRequests` as plain text (no links). Upgrade the data
  model to `Array<{name: string, type: "user" | "team"}>` later, then add correct
  links in a follow-up.

**Decision: Option B** — `reviewRequests` items remain plain text without links.
`assignees` and `participants` are always users and get links normally. When the
data model is upgraded to carry type information, team items will link to
`{origin}/orgs/{owner}/teams/{slug}` and user items to `{origin}/{login}`.

---

## 4. Component Changes

### 4.1 New Files

| File | Purpose |
|:-----|:--------|
| `tabs/pr/github-urls.ts` | `buildGitHubUrl()` + `parseGitHubPrUrl()` — origin-aware URL builder |
| `tabs/pr/GhLink.tsx` | Clickable external link component — always renders `<button>`, calls `openUrl` on click with `stopPropagation` |
| `tabs/pr/GitHubUrlProvider.tsx` | React Context provider for `origin`/`owner`/`repo`/`headRefOid`/`baseRefOid` |

### 4.2 Modified Files

| File | Changes |
|:-----|:--------|
| **`PrDetailPanel.tsx`** | Wrap content in `GitHubUrlProvider`; use `GhLink` for author, mergedBy, branch names, SHA links; humanize `mergeStateStatus` |
| **`PrListPanel.tsx`** | Refactor `PrRow` from `<button>` to `<div role="button">` so child `GhLink` `<button>` elements are legal; add branch badges, updatedAt, changedFiles; GhLink for author + number |
| **`ReviewCard.tsx`** | Use `GhLink` for review author; add author + createdAt to review comments; use `GhLink` for file paths |
| **`CommitRow.tsx`** | Use `GhLink` for abbreviatedOid; add commit author + authoredDate |
| **`StatNumber.tsx`** | No changes needed |

### 4.3 Description Markdown Rendering

The PR `body` is currently rendered as `<pre>` raw text. This should be rendered as
Markdown for a professional appearance.

**Renderer choice:** `react-markdown` with `remarkGfm` plugin (GitHub Flavored
Markdown — tables, strikethrough, task lists, autolinks).

**Styling approach:** Tailwind's `prose` utility classes require `@tailwindcss/typography`.
The project uses **Tailwind v4 CSS-first** configuration (no `tailwind.config.*` file;
entry point is `apps/desktop/src/renderer/globals.css` with `@import "tailwindcss"`).

Full dependency and integration steps:

1. `bun add react-markdown remark-gfm` — renderer + GFM plugin
2. `bun add -d @tailwindcss/typography` — prose class support
3. Add `@plugin "@tailwindcss/typography";` in `globals.css` (Tailwind v4 CSS-first
   plugin registration — no JS config file involved)
4. Apply `prose prose-sm prose-invert max-w-none` to the markdown container

**Alternative (if typography plugin is unwanted):** Write a small set of scoped CSS
rules targeting `.gh-markdown h1, .gh-markdown p, .gh-markdown ul, …` etc. This avoids
adding a plugin but requires manual styling maintenance.

**Decision:** Use `@tailwindcss/typography`. It's the standard solution, we have
full control over the build, and it provides correct heading/list/table/code-block
styles out of the box. The plugin is <10 KB compressed and only generates CSS for
elements actually present.

**Scope limitation:** Only apply to `body` field. Review/comment bodies remain truncated
plain text (they're already short snippets).

---

## 5. Detailed Field Changes Per Component

### 5.1 `PrRow` (List Item)

**Before:**
```
● Fix login bug                                     #123
  alice · 3d ago · [bug] [urgent]
  ✓ Approved   +42 / -7
```

**After:**
```
● Fix login bug                                     #123  ← clickable
  alice · 3d ago · feature-x → main · [bug] [urgent]
  ↑ clickable     ↑ new branch info
  ✓ Approved   +42 / -7 · 3 files
                          ↑ new file count
  (if updatedAt ≠ createdAt: "updated 2h ago" appended)
```

Layout detail:
- **Row 2:** `{author}` · `{relativeDate(createdAt)}` · `{headRefName} → {baseRefName}` · `[labels]`
- **Row 2 overflow:** if updatedAt differs by >1h from createdAt, append ` · updated {relativeDate(updatedAt)}`
- **Row 3:** `{reviewBadge}` · `+{additions} / -{deletions} · {changedFiles} files`
- `author` is a `GhLink` `<button>` (legal — row container is `<div role="button">`, not a native `<button>`)
- `#number` is a `GhLink` `<button>` (same — `onClick` calls `stopPropagation` to prevent row selection)
- Branch names are styled as mono badges (display only, no link in list view — too noisy)

### 5.2 `PrDetailPanel` — Merge Status Card

**Before:**
```
[Mergeable]  CLEAN  Merged by deployer
```

**After:**
```
[Mergeable]  Clean  Merged by deployer  ← "deployer" clickable
                ↑ humanized (lowercase first letter)
```

`mergeStateStatus` humanization map:
| Raw | Display |
|:----|:--------|
| `BEHIND` | Behind |
| `BLOCKED` | Blocked |
| `CLEAN` | Clean |
| `DIRTY` | Dirty |
| `DRAFT` | Draft |
| `HAS_HOOKS` | Has hooks |
| `UNKNOWN` | Unknown |
| `UNSTABLE` | Unstable |

### 5.3 `PrDetailPanel` — Participants Card

**Before:**
```
Assignees: alice, bob
Reviewers: charlie, core-team
Participants: alice, bob, charlie
```

**After:** `assignees` and `participants` names are `GhLink` — clickable to profile page.
`reviewRequests` items remain **plain text** (no links) because the current `string[]`
model can't distinguish user logins from team slugs (see §3.4).

### 5.4 `ReviewCard`

**Before:**
```
bob  [APPROVED]  2d ago
  LGTM
  ─── src/index.ts:42
       This needs a null check
```

**After:**
```
bob  [APPROVED]  2d ago        ← "bob" clickable
  LGTM
  ─── src/index.ts:42          ← file path clickable → blob URL
       charlie · 2d ago        ← NEW: comment author + time
       This needs a null check
```

- `review.author` → `GhLink` to profile
- `review.comments[].path:line` → `GhLink` to blob file with line anchor
- **New:** `review.comments[].author` displayed before body (with `GhLink`)
- **New:** `review.comments[].createdAt` displayed as relative date

### 5.5 `CommitRow`

**Before:**
```
[abc1234]  feat: add feature X                SUCCESS
  ✓ build [success]
  ✗ test [failure] ↗
```

**After:**
```
[abc1234]  feat: add feature X   alice · 2d ago   SUCCESS
  ↑ clickable to commit          ↑ NEW            ↑ keep
  ✓ build [success]
  ✗ test [failure] ↗
```

- `abbreviatedOid` → `GhLink` to commit page
- **New:** `commit.author` displayed after message (with `GhLink`)
- **New:** `commit.authoredDate` displayed as relative date

### 5.6 Files Card

**Before:**
```
[MODIFIED]  src/feature.ts          +50 / -10
```

**After:**
```
[MODIFIED]  src/feature.ts          +50 / -10
            ↑ clickable → blob URL
```

- `file.path` → `GhLink` to blob file at `headRefOid` (for ADDED/MODIFIED) or
  `baseRefOid` (for DELETED)

### 5.7 Labels Card

**Before:** Plain text badges.
**After:** Each label is a `GhLink` → `/{owner}/{repo}/labels/{name}`.

### 5.8 Comments Card

**Before:**
```
bob  3d ago
  Looks good
```

**After:**
```
bob  3d ago (edited)    ← "bob" clickable, "(edited)" when updatedAt ≠ createdAt
  Looks good
```

### 5.9 Description Card

**Before:** `<pre>` raw markdown text.
**After:** Rendered markdown with `react-markdown` + `remarkGfm` + `@tailwindcss/typography`
prose styles. Requires installing both runtime and dev dependencies (see §4.3).

---

## 6. Atomic Commits

| # | Commit | Files | Description |
|:--|:-------|:------|:------------|
| 1 | `feat(desktop): add GitHub URL builder and GhLink component` | `github-urls.ts`, `GhLink.tsx`, `GitHubUrlProvider.tsx`, tests | Origin-aware URL builder + `parseGitHubPrUrl()` + `<button>` component with `stopPropagation` + context provider |
| 2 | `feat(desktop): add clickable GitHub links to PrDetailPanel` | `PrDetailPanel.tsx`, `StatNumber.tsx` | Wrap in provider; GhLink for author, mergedBy, branches, SHAs, #number, assignees, participants, comment authors; humanize mergeStateStatus; widen StatNumber.value to ReactNode |
| 3 | `feat(desktop): add clickable links to ReviewCard` | `ReviewCard.tsx` | GhLink for author and file paths; show comment author + createdAt |
| 4 | `feat(desktop): add clickable links to CommitRow` | `CommitRow.tsx` | GhLink for OID; show commit author + authoredDate |
| 5 | `feat(desktop): add file and label links in detail view` | `PrDetailPanel.tsx` | GhLink for file paths, labels, milestones (list page) |
| 6 | `feat(desktop): enrich PrRow with branches, file count, updated time` | `PrListPanel.tsx` | Refactor PrRow from `<button>` to `<div role="button">`; add branch badges, changedFiles, updatedAt; GhLink for author + number |
| 7 | `feat(desktop): render PR body as Markdown` | `PrDetailPanel.tsx`, `package.json`, `globals.css` | Install `react-markdown` + `remark-gfm` + `@tailwindcss/typography`; add `@plugin` directive in globals.css; replace `<pre>` with rendered markdown using prose classes |
| 8 | `feat(desktop): add edited indicator to comments` | `PrDetailPanel.tsx` | Show "(edited)" when comment.updatedAt differs from createdAt |

---

## 7. Testing

| Layer | Content | Trigger |
|:------|:--------|:--------|
| L1 — Unit | `buildGitHubUrl()` — all target types, edge cases (special chars in branch/label names, origin with/without trailing slash) | pre-commit |
| L1 — Unit | `parseGitHubPrUrl()` — github.com URLs, GitHub Enterprise URLs (`https://github.example.com/owner/repo/pull/1`), malformed URLs | pre-commit |
| L2 — Lint | Biome check passes | pre-commit |
| L2 — Typecheck | `tsc --noEmit` passes | pre-commit |

**GhLink component testing note:** The desktop app currently has no React component
testing infrastructure (`@testing-library/react`, `jsdom`, `happy-dom`, etc.) — only
`bun:test` for pure logic. `GhLink` is a thin wrapper (calls `buildGitHubUrl` +
`openUrl` mutation), so the testing strategy is:

- **Pure logic** (`buildGitHubUrl`, `parseGitHubPrUrl`) — full unit test coverage
  with `bun:test`, no DOM needed.
- **GhLink component** — verified manually in the running app. Adding a component
  test framework (e.g. `@testing-library/react` + `happy-dom`) is out of scope for
  this change. If the project later adds component testing, GhLink should be covered
  then (renders children, calls openUrl on click, stopPropagation works).

Component-level visual testing is manual — verify by opening the app and inspecting
each card.

---

## 8. Out of Scope

- **Repository Info view** — `RepositoryInfo` data exists in the pulse package but is
  not integrated into the desktop app. This is a separate feature.
- **PR diff view** — Desktop doesn't have a diff viewer for PRs (it has one for local
  git changes). The pulse `pr diff` command returns diff data but there's no UI for it.
- **PR search** — No desktop UI for PR search. The pulse `pr search` command exists
  but isn't exposed through tRPC.
- **Markdown rendering for review/comment bodies** — Only `body` (PR description) gets
  full markdown rendering. Review and comment snippets remain truncated plain text.
- **Milestone deep linking** — Requires adding `milestone.number` to the GraphQL query.
  Accept milestones list-page linking for now.
- **Team review request linking** — Requires upgrading `reviewRequests` from `string[]`
  to `Array<{name: string, type: "user" | "team"}>` in the pulse data model.
  Until then, `reviewRequests` items are plain text without links (see §3.4).
