export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body?: unknown,
	) {
		super(message);
		this.name = "ApiError";
	}
}

export async function apiFetch<T>(
	path: string,
	init?: RequestInit,
): Promise<T> {
	const res = await fetch(path, {
		...init,
		headers: {
			"content-type": "application/json",
			...(init?.headers ?? {}),
		},
	});
	const text = await res.text();
	let data: unknown = null;
	if (text) {
		try {
			data = JSON.parse(text) as unknown;
		} catch {
			// Non-JSON error bodies still surface as HTTP status text
			data = { error: text };
		}
	}
	if (!res.ok) {
		const msg =
			data &&
			typeof data === "object" &&
			"error" in data &&
			typeof (data as { error: unknown }).error === "string"
				? (data as { error: string }).error
				: `HTTP ${res.status}`;
		throw new ApiError(msg, res.status, data);
	}
	return data as T;
}
