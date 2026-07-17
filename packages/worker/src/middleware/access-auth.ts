// Access JWT verification for browser hosts (aligned with bat access-auth.ts).

import type { Context, Next } from "hono";
import type { AppEnv } from "../types.js";
import {
	resetJwksCacheForTests,
	verifyAccessJwtWithJose,
} from "./access-jose.js";
import {
	type AccessPrincipal,
	principalFromPayload,
} from "./access-principal.js";
import { isLocalhost, isMachineEndpoint } from "./entry-control.js";

export type { AccessPrincipal };
export { principalFromPayload, resetJwksCacheForTests };

/** Injectable verifier for tests (production uses jose JWKS). */
export type AccessJwtVerifier = (
	jwt: string,
	teamDomain: string,
	aud: string,
) => Promise<AccessPrincipal>;

let testVerifier: AccessJwtVerifier | null = null;

export function setAccessJwtVerifierForTests(
	verifier: AccessJwtVerifier | null,
): void {
	testVerifier = verifier;
}

export async function accessAuth(c: Context<AppEnv>, next: Next) {
	const host = c.req.header("host") || "";

	if (isLocalhost(host) || isMachineEndpoint(host)) {
		return next();
	}

	if (c.req.path === "/api/live") {
		return next();
	}

	const teamDomain = c.env.CF_ACCESS_TEAM_DOMAIN;
	const aud = c.env.CF_ACCESS_AUD;

	if (!(teamDomain && aud)) {
		return c.json(
			{
				error:
					"Access authentication not configured. Set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD.",
			},
			500,
		);
	}

	const jwt = c.req.header("Cf-Access-Jwt-Assertion");
	if (!jwt) {
		return c.json({ error: "Missing Access JWT" }, 401);
	}

	try {
		const verifier = testVerifier ?? verifyAccessJwtWithJose;
		const principal = await verifier(jwt, teamDomain, aud);
		c.set("accessAuthenticated", true);
		c.set("accessEmail", principal.email);
		c.set("accessName", principal.name);
	} catch {
		return c.json({ error: "Invalid Access JWT" }, 403);
	}

	return next();
}
