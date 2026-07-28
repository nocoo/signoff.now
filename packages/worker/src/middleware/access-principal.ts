export type AccessPrincipal = {
	email: string | null;
	name: string | null;
	/** True when the caller is a service token rather than a person. */
	service: boolean;
};

/**
 * Identify the caller behind a verified Access JWT.
 *
 * Cloudflare issues two payload shapes. A person carries `email`; a SERVICE
 * TOKEN carries neither — `sub` is an empty string and the only identifier is
 * `common_name` (the token's Client ID). Reading only `email`/`sub` resolved a
 * service token to `{email: "", name: ""}`: it authenticated fine, but every
 * audit line said nothing about who acted.
 */
export function principalFromPayload(payload: {
	email?: unknown;
	name?: unknown;
	sub?: unknown;
	common_name?: unknown;
}): AccessPrincipal {
	const commonName =
		typeof payload.common_name === "string" && payload.common_name
			? payload.common_name
			: null;
	if (commonName) {
		return { email: null, name: commonName, service: true };
	}

	const email =
		typeof payload.email === "string" && payload.email
			? payload.email
			: typeof payload.sub === "string" && payload.sub
				? payload.sub
				: null;
	const name =
		typeof payload.name === "string" && payload.name
			? payload.name
			: (email?.split("@")[0] ?? null);
	return { email, name, service: false };
}
