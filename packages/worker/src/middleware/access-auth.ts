// Access JWT verification for browser hosts (aligned with bat access-auth.ts).

import type { Context, Next } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AppEnv } from "../types.js";
import { isLocalhost, isMachineEndpoint } from "./entry-control.js";

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksCacheTeamDomain: string | null = null;

function getJWKS(teamDomain: string) {
	if (jwksCache && jwksCacheTeamDomain === teamDomain) {
		return jwksCache;
	}
	jwksCache = createRemoteJWKSet(
		new URL(`https://${teamDomain}/cdn-cgi/access/certs`),
	);
	jwksCacheTeamDomain = teamDomain;
	return jwksCache;
}

/** Reset JWKS cache (tests only). */
export function resetJwksCacheForTests(): void {
	jwksCache = null;
	jwksCacheTeamDomain = null;
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
		const jwks = getJWKS(teamDomain);
		const { payload } = await jwtVerify(jwt, jwks, {
			issuer: `https://${teamDomain}`,
			audience: aud,
		});
		c.set("accessAuthenticated", true);
		const email =
			typeof payload.email === "string"
				? payload.email
				: typeof payload.sub === "string"
					? payload.sub
					: null;
		const name =
			typeof payload.name === "string"
				? payload.name
				: (email?.split("@")[0] ?? null);
		c.set("accessEmail", email);
		c.set("accessName", name);
	} catch {
		return c.json({ error: "Invalid Access JWT" }, 403);
	}

	return next();
}
