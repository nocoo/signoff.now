// Host-based entry control (aligned with bat entry-control.ts).
// - localhost / 127.0.0.1 / *.dev.hexly.ai: bypass path whitelist
// - signoff-ingest.*: machine whitelist only
// - else: browser endpoint (Access)

import type { Context, Next } from "hono";
import type { AppEnv } from "../types.js";

const MACHINE_ROUTES: Array<{
	method: string;
	path: string;
	prefix?: boolean;
}> = [
	{ method: "GET", path: "/api/pipeline/bootstrap" },
	{ method: "POST", path: "/api/pipeline/ingest" },
	{ method: "POST", path: "/api/pipeline/recompute/complete" },
	{ method: "GET", path: "/api/live" },
	{ method: "GET", path: "/api/me" },
];

export function isLocalhost(host: string): boolean {
	// Strip :port (careful with IPv6 [::1]:port)
	const h = host.startsWith("[")
		? (/^(\[[^\]]+\])/.exec(host)?.[1] ?? host)
		: (host.split(":")[0] ?? host);
	return (
		h === "localhost" ||
		h === "127.0.0.1" ||
		h === "[::1]" ||
		h === "::1" ||
		h.endsWith(".dev.hexly.ai")
	);
}

/**
 * Hosts allowed to authenticate with a pipeline token instead of Access.
 *
 * The FIRST LABEL must be exactly `signoff-ingest`. A substring test also
 * accepted `evil-signoff-ingest.attacker.com` and `attacker.com/signoff-ingest`
 * — measured, not hypothetical.
 *
 * Cloudflare routes by SNI and answers 403 for a mismatched Host before the
 * Worker runs, so the loose form was not exploitable today. But an auth
 * boundary should not rest on someone else's routing behaviour.
 */
export function isMachineEndpoint(host: string): boolean {
	const name = (host.split(":")[0] ?? "").toLowerCase();
	return name.split(".")[0] === "signoff-ingest";
}

function isAllowedMachineRoute(method: string, path: string): boolean {
	return MACHINE_ROUTES.some((route) => {
		if (route.method !== method) {
			return false;
		}
		if (route.prefix) {
			return path === route.path || path.startsWith(`${route.path}/`);
		}
		return path === route.path;
	});
}

export async function entryControl(c: Context<AppEnv>, next: Next) {
	const host = c.req.header("host") || "";
	const path = c.req.path;
	const method = c.req.method;

	if (isLocalhost(host)) {
		return next();
	}

	if (isMachineEndpoint(host)) {
		if (!isAllowedMachineRoute(method, path)) {
			return c.json({ error: "Route not allowed on machine endpoint" }, 403);
		}
		return next();
	}

	return next();
}
