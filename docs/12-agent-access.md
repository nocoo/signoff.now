# Agent access and identity contract

Detailed project constraints and procedures. The root [CLAUDE.md](../CLAUDE.md) defines the quality contract and records current enforcement gaps.

## Production access

Two hosts, one Worker, two auth paths — see README「运维手册」for the full setup.

| Host | Caller | Auth |
|:-----|:-------|:-----|
| `signoff.hexly.ai` | people, and automation needing **CRUD** | Cloudflare Access |
| `signoff-ingest.hexly.ai` | CLI ingest | `SIGNOFF_PIPELINE_WRITE_TOKEN` |

`GET /api/live` is public in the Worker on both hosts. It checks D1, returns
`status: "ok"` and the root package version on success, or HTTP 503 with bounded
failure data. Every response uses `Cache-Control: no-store`. Keep the root,
Worker, and web package versions aligned when releasing this service. The human
hostname also needs an Access application scoped to `signoff.hexly.ai/api/live`
with a Bypass / Everyone policy; business paths retain Access and JWT checks.

**The pipeline token cannot create entities.** `MACHINE_ROUTES`
(`middleware/entry-control.ts`) whitelists only bootstrap / ingest /
recompute / live / me; every CRUD route answers 403. That is deliberate — a
leaked ingest token should be able to write activity data, never to add an
identity to the roster and start scoring it.

So automation that needs CRUD authenticates as an Access **service token**:

```bash
curl -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" \
     -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" \
     https://signoff.hexly.ai/api/repos
```

Service-token automation requires the protecting Access application to include a Service Auth policy. Identify service JWTs via `common_name`, not an assumed email/sub.

Credentials live in `.env` (gitignored, chmod 600). `.env.example` documents
the shape and is tracked — `.gitignore` has an explicit `!.env.example` after
the `.env.*` rule, or the template would be ignored too.
