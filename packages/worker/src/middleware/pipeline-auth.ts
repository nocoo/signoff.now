// Pipeline token auth (aligned with 05 §5.6).
// Browser + Access may use management APIs only — never pipeline routes.

import type { Context, Next } from "hono";
import type { AppEnv } from "../types.js";
import { isLocalhost, isMachineEndpoint } from "./entry-control.js";

const PUBLIC_ROUTES = new Set(["/api/live", "/api/me"]);

/** Routes that require write token on machine path. */
const WRITE_PREFIXES = ["/api/pipeline/ingest", "/api/pipeline/recompute"];

/** All pipeline routes (read + write) — browser Access is never enough. */
const PIPELINE_PREFIX = "/api/pipeline/";

function extractBearer(header: string | undefined): string | null {
	if (!header) {
		return null;
	}
	const parts = header.split(" ");
	if (parts.length !== 2 || parts[0] !== "Bearer" || !parts[1]) {
		return null;
	}
	return parts[1];
}

export function isPipelineWritePath(path: string): boolean {
	return WRITE_PREFIXES.some(
		(p) => path === p || path.startsWith(`${p}/`) || path.startsWith(p),
	);
}

export function isPipelinePath(path: string): boolean {
	return path === "/api/pipeline" || path.startsWith(PIPELINE_PREFIX);
}

export async function pipelineAuth(c: Context<AppEnv>, next: Next) {
	const path = c.req.path;
	const host = c.req.header("host") || "";

	if (PUBLIC_ROUTES.has(path)) {
		return next();
	}

	// loopback / *.dev.hexly.ai — always skip token (§5.6)
	if (isLocalhost(host)) {
		return next();
	}

	const accessAuthenticated = c.get("accessAuthenticated") === true;
	const browser = !isMachineEndpoint(host);

	// Browser + Access: management APIs only. Pipeline routes always 403.
	if (browser && accessAuthenticated) {
		if (isPipelinePath(path)) {
			return c.json(
				{
					error: "Forbidden",
					message:
						"Browser Access cannot call pipeline routes; use machine host + Pipeline Token or local loopback",
				},
				403,
			);
		}
		return next();
	}

	const token = extractBearer(c.req.header("Authorization"));
	if (!token) {
		return c.json({ error: "Missing or invalid Authorization header" }, 401);
	}

	const writeKey = c.env.SIGNOFF_PIPELINE_WRITE_TOKEN ?? "";
	const readKey = c.env.SIGNOFF_PIPELINE_READ_TOKEN ?? writeKey;

	if (isPipelineWritePath(path) || c.req.method !== "GET") {
		if (writeKey && token === writeKey) {
			return next();
		}
		if (readKey && token === readKey && token !== writeKey) {
			return c.json(
				{ error: "Read token cannot be used on write routes" },
				403,
			);
		}
		return c.json({ error: "Invalid API key" }, 403);
	}

	// GET bootstrap etc.
	if ((readKey && token === readKey) || (writeKey && token === writeKey)) {
		return next();
	}

	return c.json({ error: "Invalid API key" }, 403);
}
