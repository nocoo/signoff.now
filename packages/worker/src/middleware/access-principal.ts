export type AccessPrincipal = {
	email: string | null;
	name: string | null;
};

export function principalFromPayload(payload: {
	email?: unknown;
	name?: unknown;
	sub?: unknown;
}): AccessPrincipal {
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
	return { email, name };
}
