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

/**
 * Read raw body text + parse JSON, reporting actual byte length for 413 checks.
 * Prefer this for pipeline ingest (§5.2).
 */
export async function readJsonBodyWithSize(c: {
	req: {
		text: () => Promise<string>;
	};
}): Promise<
	| { ok: true; value: unknown; byteLength: number }
	| { ok: false; error: "invalid_json"; byteLength: number }
> {
	const text = await c.req.text();
	const byteLength = new TextEncoder().encode(text).length;
	try {
		return { ok: true, value: JSON.parse(text) as unknown, byteLength };
	} catch {
		return { ok: false, error: "invalid_json", byteLength };
	}
}
