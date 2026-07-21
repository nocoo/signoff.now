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
 * Read raw body with hard byte cap (§5.2).
 * Streams chunks until limit; aborts early so oversized payloads never parse.
 * Note: Workers still buffer under the hood for `req.arrayBuffer`/`text`; this
 * rejects before JSON parse / Settings load when Content-Length or streamed
 * bytes exceed the cap.
 */
export async function readJsonBodyWithSize(
	c: {
		req: {
			raw: Request;
			header: (name: string) => string | undefined;
		};
	},
	maxBytes: number,
): Promise<
	| { ok: true; value: unknown; byteLength: number }
	| { ok: false; error: "invalid_json"; byteLength: number }
	| { ok: false; error: "payload_too_large"; byteLength: number }
> {
	const cl = c.req.header("content-length");
	if (cl) {
		const n = Number(cl);
		if (Number.isFinite(n) && n > maxBytes) {
			return { ok: false, error: "payload_too_large", byteLength: n };
		}
	}

	const reader = c.req.raw.body?.getReader();
	if (!reader) {
		// Empty body
		return { ok: false, error: "invalid_json", byteLength: 0 };
	}

	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			if (value) {
				total += value.byteLength;
				if (total > maxBytes) {
					await reader.cancel();
					return {
						ok: false,
						error: "payload_too_large",
						byteLength: total,
					};
				}
				chunks.push(value);
			}
		}
	} catch {
		return { ok: false, error: "invalid_json", byteLength: total };
	}

	const merged = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	const text = new TextDecoder().decode(merged);
	try {
		return { ok: true, value: JSON.parse(text) as unknown, byteLength: total };
	} catch {
		return { ok: false, error: "invalid_json", byteLength: total };
	}
}
