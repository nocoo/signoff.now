# Local Development

- When starting local development or opening this project's frontend in a browser, use the Caddy HTTPS URL: `https://signoff.dev.hexly.ai`.
- Do not use direct `localhost` or `127.0.0.1` URLs for browser access. If the Caddy URL is unavailable, diagnose the proxy instead of switching to a direct URL.
- Start the frontend with `bun run dev` and the local API with `bun run dev:worker` when needed; reuse healthy running instances.
- Internal upstreams remain unchanged: Caddy forwards to Vite on port `7042`, and Vite proxies `/api` to the local Worker on port `37042`.

# Cached Reports and Discovery

- Insights uses the last 90 UTC creation dates. Query routes only read cached facts; provider work belongs to explicit commands or collector scheduling.
- Keep all visible repository authors in the comparison denominator when filtering followed contributors. Link accounts only by exact source/provider/organization/actor identity.
- Discovery tasks are scoped by repository and depth (`smart` or `deep`). Deep report discovery refreshes summary/lifecycle data; detailed checks belong to watched PRs.
- See `docs/22-contribution-reports.md` for the report and collection contract.

- Contributor hiding is source-scoped and preserves PR cache and follow membership. Use Hide, Unhide and Hidden in the UI. Avatar reads use local D1; collector refreshes images every seven days.

# Modal Pickers

- Set `modal` on Basalt `MultiSelect` inside a dialog so its portaled list participates in the active scroll/focus lock. The Bun patch for Basalt 2.1.8 exposes Radix Popover's existing option; retain this behavior when upgrading Basalt.
- Verify overflowing pickers with real browser wheel and touch input. DOM-only selection tests do not exercise modal scroll locks; see `tests/e2e/directory-scroll.spec.ts`.
