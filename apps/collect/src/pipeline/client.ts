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

/** Shared request helper (module-level for coverage). */
export async function pipelineRequest(
	opts: {
		apiBase: string;
		writeToken?: string | null;
		fetchImpl: FetchLike;
		timeoutMs: number;
	},
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
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
	try {
		const res = await opts.fetchImpl(`${opts.apiBase}${path}`, {
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

export function createPipelineClient(opts: {
	apiBase: string;
	writeToken?: string | null;
	fetchImpl?: FetchLike;
	timeoutMs?: number;
}): PipelineClient {
	const cfg = {
		apiBase: opts.apiBase,
		writeToken: opts.writeToken,
		fetchImpl: opts.fetchImpl ?? globalThis.fetch.bind(globalThis),
		timeoutMs: opts.timeoutMs ?? 15_000,
	};

	return {
		bootstrap: () =>
			pipelineRequest(
				cfg,
				"GET",
				"/api/pipeline/bootstrap",
			) as Promise<BootstrapSnapshot>,
		ingest: (body) =>
			pipelineRequest(cfg, "POST", "/api/pipeline/ingest", body),
		recomputeComplete: (body) =>
			pipelineRequest(cfg, "POST", "/api/pipeline/recompute/complete", body),
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
