// Default-deny authorization. Every registered API route must appear here;
// route-policy.test.ts fails when one is missing.

import type { Context, Next } from "hono";
import { matchedRoutes } from "hono/route";
import type { Caller } from "./middleware/principal.js";
import type { AppEnv } from "./types.js";

/**
 * - public: anyone (liveness and the caller's own session)
 * - member: a person/service with a selected tenant, or local trust
 * - admin: an admin person/service, or local trust
 * - collector: local trust only until remote connectors exist
 * - pipeline: machine host; pipelineAuth checks the token
 */
export type RoutePolicy =
	| "public"
	| "member"
	| "admin"
	| "collector"
	| "pipeline";

const POLICIES: Record<string, RoutePolicy> = {
	"GET /api/live": "public",
	"GET /api/me": "public",

	"GET /api/pipeline/bootstrap": "pipeline",
	"POST /api/pipeline/ingest": "pipeline",
	"POST /api/pipeline/recompute/complete": "pipeline",

	"GET /api/query/v1/collector": "member",
	"GET /api/query/v1/collector/groups": "member",
	"GET /api/query/v1/jobs": "member",
	"GET /api/query/v1/jobs/:id": "member",
	"GET /api/query/v1/network": "member",
	"GET /api/query/v1/observations": "member",
	"GET /api/query/v1/observations/lookup": "member",
	"GET /api/query/v1/prs": "member",
	"GET /api/query/v1/prs/:id": "member",
	"GET /api/query/v1/prs/lookup": "member",
	"GET /api/query/v1/repos": "member",

	"POST /api/commands/v1/observations": "member",
	"DELETE /api/commands/v1/observations/:id": "member",
	"POST /api/commands/v1/observations/remove": "member",
	"POST /api/commands/v1/refresh": "member",
	"POST /api/commands/v1/discover": "admin",

	"GET /api/workbench": "member",
	"POST /api/projects": "admin",
	"PATCH /api/projects/:id": "admin",
	"DELETE /api/projects/:id": "admin",
	"POST /api/projects/:id/scan": "admin",
	"GET /api/state-machines/:id": "member",
	"GET /api/state-machines/:id/history": "member",
	"PUT /api/state-machines/:id": "admin",

	"GET /api/pr-collections": "member",
	"POST /api/pr-collections": "member",
	"GET /api/pr-collections/memberships": "member",
	"GET /api/pr-collections/:id": "member",
	"PATCH /api/pr-collections/:id": "member",
	"DELETE /api/pr-collections/:id": "member",
	"PUT /api/pr-collections/:id/members": "member",

	"GET /api/directory": "member",
	"POST /api/directory/blocks": "member",
	"POST /api/directory/:kind": "member",
	"PUT /api/directory/:kind/:id": "member",
	"POST /api/directory/:kind/:id/:action": "member",
	"GET /api/avatars": "member",

	"GET /api/insights/contributor": "member",
	"GET /api/insights/report": "member",
	"GET /api/insights/:module": "member",
	"POST /api/insights/:module": "member",

	"GET /api/ai/settings": "admin",
	"PUT /api/ai/settings": "admin",
	"POST /api/ai/test": "admin",
	"POST /api/ai/retry": "admin",
	"GET /api/ai/rules": "admin",
	"PUT /api/ai/rules": "admin",
	"GET /api/ai/schedule": "member",
	"PUT /api/ai/schedule": "admin",
	"POST /api/ai/tick": "collector",

	"GET /api/collection/refresh": "admin",
	"PATCH /api/collection/settings": "admin",
	"POST /api/collection/view": "member",

	"POST /api/collector/schedule": "collector",
	"GET /api/collector/jobs/:id": "collector",
	"POST /api/collector/network": "collector",
	"POST /api/collector/heartbeat": "collector",
	"POST /api/collector/claim": "collector",
	"POST /api/collector/jobs/:id/progress": "collector",
	"POST /api/collector/jobs/:id/batch": "collector",
	"POST /api/collector/jobs/:id/repositories": "collector",
	"POST /api/collector/jobs/:id/publish": "collector",
	"POST /api/collector/jobs/:id/repository-fail": "collector",
	"POST /api/collector/jobs/:id/complete": "collector",
	"POST /api/collector/jobs/:id/fail": "collector",
	"POST /api/collector/avatars/claim": "collector",
	"POST /api/collector/avatars/publish": "collector",
	"POST /api/collector/avatars/fail": "collector",

	"GET /api/settings": "admin",
	"PUT /api/settings": "admin",
	"GET /api/stats/summary": "admin",
	"GET /api/activity/heatmap": "admin",
	"GET /api/activity/timeline": "admin",
	"GET /api/developers": "admin",
	"POST /api/developers": "admin",
	"PATCH /api/developers/:id": "admin",
	"POST /api/developers/:id/archive": "admin",
	"POST /api/developers/:id/restore": "admin",
	"GET /api/teams": "admin",
	"POST /api/teams": "admin",
	"PATCH /api/teams/:id": "admin",
	"POST /api/teams/:id/archive": "admin",
	"POST /api/teams/:id/restore": "admin",
	"GET /api/tags": "admin",
	"POST /api/tags": "admin",
	"PATCH /api/tags/:id": "admin",
	"POST /api/tags/:id/archive": "admin",
	"POST /api/tags/:id/restore": "admin",
	"GET /api/repos": "admin",
	"POST /api/repos": "admin",
	"PATCH /api/repos/:id": "admin",
	"POST /api/repos/:id/archive": "admin",
	"POST /api/repos/:id/restore": "admin",
};

export const routePolicies: Readonly<Record<string, RoutePolicy>> = POLICIES;

/** The concrete handler route (method + pattern) a request resolved to. */
export function resolvedRoute(c: Context<AppEnv>): string | null {
	// Middleware is registered with ALL; sub-app handlers are wrapped, so the
	// arity of a handler cannot distinguish it from middleware.
	const handler = matchedRoutes(c)
		.filter((route) => route.method !== "ALL")
		.at(-1);
	return handler ? `${handler.method} ${handler.path}` : null;
}

export function policyFor(route: string | null): RoutePolicy | null {
	return route ? (POLICIES[route] ?? null) : null;
}

type Decision = "allow" | { status: 401 | 403 | 404; error: string };

export function decide(policy: RoutePolicy | null, caller: Caller): Decision {
	if (policy === null) return { status: 404, error: "Not found" };
	if (policy === "public" || policy === "pipeline") return "allow";
	if (caller.kind === "local") return "allow";
	if (caller.kind === "anonymous")
		return { status: 401, error: "Sign in to continue" };
	if (caller.kind === "machine")
		return { status: 403, error: "Route not allowed on machine endpoint" };
	if (policy === "collector")
		return {
			status: 403,
			error: "Collector routes require a registered connector",
		};
	if (policy === "admin")
		return caller.admin
			? "allow"
			: { status: 403, error: "Administrator access required" };
	return caller.tenantId
		? "allow"
		: {
				status: 403,
				error: caller.tenants.length
					? "Choose an available tenant"
					: "Ask an administrator to add you to a tenant",
			};
}

export async function authorize(c: Context<AppEnv>, next: Next) {
	if (!c.req.path.startsWith("/api/")) return next();
	const decision = decide(
		policyFor(resolvedRoute(c)),
		c.get("caller") ?? { kind: "anonymous" },
	);
	if (decision === "allow") return next();
	c.header("Cache-Control", "no-store");
	return c.json({ error: decision.error }, decision.status);
}

/** Browser writes must originate from this site (Access cookies are ambient). */
export async function sameOriginWrites(c: Context<AppEnv>, next: Next) {
	const caller = c.get("caller");
	if (
		caller &&
		(caller.kind === "person" || caller.kind === "service") &&
		!["GET", "HEAD", "OPTIONS"].includes(c.req.method)
	) {
		const origin = c.req.header("origin");
		if (
			origin &&
			(!URL.canParse(origin) || new URL(origin).host !== c.req.header("host"))
		)
			return c.json({ error: "Cross-origin requests are not allowed" }, 403);
	}
	return next();
}
