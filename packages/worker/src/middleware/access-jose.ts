// Production jose/JWKS path (network). Covered by L2/manual Access checks.
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
	type AccessPrincipal,
	principalFromPayload,
} from "./access-principal.js";

let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksCacheTeamDomain: string | null = null;

export function resetJwksCacheForTests(): void {
	jwksCache = null;
	jwksCacheTeamDomain = null;
}

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

export async function verifyAccessJwtWithJose(
	jwt: string,
	teamDomain: string,
	aud: string,
): Promise<AccessPrincipal> {
	const jwks = getJWKS(teamDomain);
	const { payload } = await jwtVerify(jwt, jwks, {
		issuer: `https://${teamDomain}`,
		audience: aud,
	});
	return principalFromPayload(payload);
}
