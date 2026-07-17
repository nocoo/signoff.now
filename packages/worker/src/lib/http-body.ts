/** Shared JSON body guards for routes. */

export function asObjectBody(body: unknown): Record<string, unknown> | null {
	if (body === null || typeof body !== "object" || Array.isArray(body)) {
		return null;
	}
	return body as Record<string, unknown>;
}

export async function readJsonBody(c: {
	req: { json: () => Promise<unknown> };
}): Promise<
	{ ok: true; value: unknown } | { ok: false; error: "invalid_json" }
> {
	try {
		return { ok: true, value: await c.req.json() };
	} catch {
		return { ok: false, error: "invalid_json" };
	}
}
