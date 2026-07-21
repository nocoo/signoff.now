/** HTTP client for pipeline routes (bootstrap / ingest / recompute). */

export type BootstrapSnapshot = {
	fetchedAt: string;
	settings: {
		timezone: string;
		emailSuffixes: string[];
		activityWeights: Record<string, number>;
		pipelineConfigVersion: number;
		scoresStale: boolean;
		scoresStaleReason: string | null;
	};
	developers: Array<{ id: string; name: string; alias: string }>;
	repos: Array<{
		id: string;
		provider: string;
		org: string;
		project: string;
		name: string;
		externalId: string | null;
		projectExternalId: string | null;
		enabled: boolean;
	}>;
};

export type PipelineClientError = {
	status: number;
	body: unknown;
	message: string;
};

export type PipelineClient = {
	bootstrap: () => Promise<BootstrapSnapshot>;
	ingest: (body: unknown) => Promise<unknown>;
	recomputeComplete: (body: unknown) => Promise<unknown>;
};

export type FetchLike = (
	input: string,
	init?: RequestInit,
) => Promise<Response>;

export function createPipelineClient(opts: {
	apiBase: string;
	writeToken?: string | null;
	fetchImpl?: FetchLike;
	timeoutMs?: number;
}): PipelineClient {
	const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
	const timeoutMs = opts.timeoutMs ?? 15_000;

	async function request(
		method: string,
		path: string,
		body?: unknown,
	): Promise<unknown> {
		const headers: Record<string, string> = {
			accept: "application/json",
		};
		if (opts.writeToken) {
			headers.authorization = `Bearer ${opts.writeToken}`;
		}
		if (body !== undefined) {
			headers["content-type"] = "application/json";
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const res = await fetchImpl(`${opts.apiBase}${path}`, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: controller.signal,
			});
			let parsed: unknown = null;
			const text = await res.text();
			if (text) {
				try {
					parsed = JSON.parse(text) as unknown;
				} catch {
					parsed = text;
				}
			}
			if (!res.ok) {
				const err: PipelineClientError = {
					status: res.status,
					body: parsed,
					message: `HTTP ${res.status} ${path}`,
				};
				throw err;
			}
			return parsed;
		} finally {
			clearTimeout(timer);
		}
	}

	return {
		bootstrap: () =>
			request("GET", "/api/pipeline/bootstrap") as Promise<BootstrapSnapshot>,
		ingest: (body) => request("POST", "/api/pipeline/ingest", body),
		recomputeComplete: (body) =>
			request("POST", "/api/pipeline/recompute/complete", body),
	};
}

export function isPipelineClientError(e: unknown): e is PipelineClientError {
	return (
		typeof e === "object" &&
		e !== null &&
		"status" in e &&
		typeof (e as PipelineClientError).status === "number"
	);
}
