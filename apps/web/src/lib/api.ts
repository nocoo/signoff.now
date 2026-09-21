export const SERVICE_UNAVAILABLE = "Cannot reach the SignOff service.";

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
	const timeout = AbortSignal.timeout(
		init?.method && init.method !== "GET" ? 45000 : 15000,
	);
	const signal = init?.signal
		? AbortSignal.any([init.signal, timeout])
		: timeout;
	let res: Response;
	let text: string;
	try {
		res = await fetch(path, {
			...init,
			signal,
			headers: {
				"content-type": "application/json",
				...(init?.headers ?? {}),
			},
		});
		text = await res.text();
	} catch (error) {
		if (init?.signal?.aborted && init.signal.reason?.name !== "TimeoutError")
			throw error;
		if (signal.aborted || error instanceof TypeError) {
			throw new ApiError(SERVICE_UNAVAILABLE, 0);
		}
		throw error;
	}
	let data: unknown = null;
	let isJson = true;
	if (text) {
		try {
			data = JSON.parse(text) as unknown;
		} catch {
			isJson = false;
			data = { error: text };
		}
	}
	if (!res.ok) {
		if (
			[502, 504].includes(res.status) ||
			(res.status >= 500 && (!text || !isJson))
		) {
			throw new ApiError(SERVICE_UNAVAILABLE, res.status);
		}
		const msg =
			data &&
			typeof data === "object" &&
			"error" in data &&
			typeof (data as { error: unknown }).error === "string"
				? (data as { error: string }).error
				: data &&
						typeof data === "object" &&
						"error" in data &&
						data.error &&
						typeof data.error === "object" &&
						"message" in data.error &&
						typeof data.error.message === "string"
					? data.error.message
					: `HTTP ${res.status}`;
		throw new ApiError(msg, res.status, data);
	}
	return data as T;
}
