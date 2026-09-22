# Local Development

- When starting local development or opening this project's frontend in a browser, use the Caddy HTTPS URL: `https://signoff.dev.hexly.ai`.
- Do not use direct `localhost` or `127.0.0.1` URLs for browser access. If the Caddy URL is unavailable, diagnose the proxy instead of switching to a direct URL.
- Start the frontend with `bun run dev` and the local API with `bun run dev:worker` when needed; reuse healthy running instances.
- Internal upstreams remain unchanged: Caddy forwards to Vite on port `7042`, and Vite proxies `/api` to the local Worker on port `37042`.
