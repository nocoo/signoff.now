/** Stable JSON stringify for digest (sorted object keys). */

export function stableStringify(value: unknown): string {
	return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
	if (value === null || typeof value !== "object") {
		return value;
	}
	if (Array.isArray(value)) {
		return value.map(sortKeys);
	}
	const obj = value as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const k of Object.keys(obj).sort()) {
		out[k] = sortKeys(obj[k]);
	}
	return out;
}

export async function sha256Hex(text: string): Promise<string> {
	const data = new TextEncoder().encode(text);
	const hash = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(hash)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
