# CLI Tools

Documentation for CLI tools in the signoff.now monorepo.

| # | Document | Description |
|:--|:---------|:------------|
| 01 | [gitinfo CLI](./01-gitinfo.md) | Comprehensive git repository information tool (metadata, branches, logs, contributors, files, status, tags, config) |
| 02 | [pulse CLI](./02-pulse.md) | **Current implementation** — Remote collaboration data fetcher (PRs, reviews, CI checks) with automatic multi-account GitHub identity resolution. Uses legacy naming (`pr-detail`, `draft`, `headBranch`) |
| 03 | [PR Cache](./03-pulse-pr-cache.md) | **Current implementation** — SQLite persistence for PR data with MVVM merge logic and instant first paint. Uses legacy naming |
| 04 | [Pulse CLI Spec](./04-pulse-cli-spec.md) | **Target spec** — Canonical command structure, output data model (aligned with GitHub GraphQL naming), API client interface, legacy parity matrix, and migration plan from current → target naming |
| 05 | [PR UI Enhancement](./05-pr-ui-enhancement.md) | Close the data-display gap — surface all CLI fields in the desktop UI, add clickable GitHub links, render PR body as Markdown |
