/**
 * Azure DevOps REST client (07 §2, §7.3, §8).
 *
 * Auth goes through `az account get-access-token` rather than a stored PAT
 * (01 §7.3). Every call pins `api-version=7.1` — the parameters this project
 * depends on (`searchCriteria.minTime` + `queryTimeRangeType`) exist there but
 * not in older SDK surfaces, so version drift would silently change behaviour.
 */

import type { ExecFn } from "../doctor/az.ts";

/** Azure DevOps' fixed resource id for token acquisition. */
export const ADO_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";
export const ADO_API_VERSION = "7.1";

export type AdoErrorKind =
	| "unauthenticated" // 401 — token missing/expired
	| "forbidden" // 403 — authenticated but no access to this org/project
	| "rate_limited" // 429 after retries
	| "server" // 5xx after retries, or network failure
	| "not_found"
	| "result_too_large" // WIQL exceeded its result cap — caller must narrow
	| "bad_request" // 4xx the caller cannot retry its way out of
	| "bad_response"; // unparseable body

export class AdoError extends Error {
	readonly kind: AdoErrorKind;
	readonly status: number | undefined;
	/** Azure DevOps' own error code, e.g. `VS402337`, when the body carries one. */
	readonly adoCode: string | undefined;

	constructor(
		kind: AdoErrorKind,
		message: string,
		status?: number,
		adoCode?: string,
	) {
		super(message);
		this.name = "AdoError";
		this.kind = kind;
		this.status = status;
		this.adoCode = adoCode;
	}
}

/**
 * ADO reports failures as a 400 with a typed body. Reading it is what lets a
 * caller tell "your query is too broad, split the window" apart from "this
 * request is malformed" — without it, WIQL result-cap recovery is impossible.
 */
function classifyErrorBody(body: string): {
	kind: AdoErrorKind;
	code?: string;
	message?: string;
} {
	let parsed: { typeKey?: string; message?: string; errorCode?: number };
	try {
		parsed = JSON.parse(body) as typeof parsed;
	} catch {
		return { kind: "bad_request" };
	}
	const message =
		typeof parsed.message === "string" ? parsed.message : undefined;
	const code = /\bVS\d{6}\b/.exec(message ?? "")?.[0];
	// VS402337: "the result exceeds the size limit of 20000".
	if (code === "VS402337" || /exceeds the size limit/i.test(message ?? "")) {
		return { kind: "result_too_large", code, message };
	}
	return { kind: "bad_request", code, message };
}

export type FetchFn = (
	url: string,
	init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<AdoResponse>;

export type AdoResponse = {
	status: number;
	headers: { get(name: string): string | null };
	text(): Promise<string>;
};

export type SleepFn = (ms: number) => Promise<void>;

export type AdoClientOptions = {
	exec: ExecFn;
	fetchFn: FetchFn;
	sleep?: SleepFn;
	/** Retry budget for 429/5xx. Default 3. */
	maxRetries?: number;
	/** Deterministic jitter hook; default adds 0–250ms. */
	jitterMs?: () => number;
};

type TokenState = { token: string; expiresAtMs: number } | null;

/** Refresh a minute before expiry so an in-flight page never straddles it. */
const REFRESH_MARGIN_MS = 60_000;

export type AdoClient = {
	/** GET a JSON resource, retrying transient failures. */
	get(url: string): Promise<unknown>;
	/** POST a JSON body (used for WIQL). */
	post(url: string, body: unknown): Promise<unknown>;
	/** Force the next call to re-acquire a token (tests / 401 recovery). */
	invalidateToken(): void;
};

export function createAdoClient(opts: AdoClientOptions): AdoClient {
	const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	const maxRetries = opts.maxRetries ?? 3;
	const jitter = opts.jitterMs ?? (() => Math.floor(Math.random() * 250));
	let token: TokenState = null;

	async function acquireToken(nowMs: number): Promise<string> {
		if (token && token.expiresAtMs - REFRESH_MARGIN_MS > nowMs) {
			return token.token;
		}
		const r = await opts.exec("az", [
			"account",
			"get-access-token",
			"--resource",
			ADO_RESOURCE,
			"-o",
			"json",
		]);
		if (r.exitCode !== 0) {
			throw new AdoError(
				"unauthenticated",
				r.stderr.trim() || "az account get-access-token failed; run `az login`",
			);
		}
		let parsed: { accessToken?: string; expires_on?: string | number };
		try {
			parsed = JSON.parse(r.stdout) as typeof parsed;
		} catch {
			throw new AdoError("bad_response", "az returned unparseable token JSON");
		}
		if (!parsed.accessToken) {
			throw new AdoError("unauthenticated", "az returned no accessToken");
		}
		// `expires_on` is unix seconds; fall back to a short lease if absent.
		const expSec = Number(parsed.expires_on);
		token = {
			token: parsed.accessToken,
			expiresAtMs: Number.isFinite(expSec)
				? expSec * 1000
				: nowMs + 10 * 60_000,
		};
		return token.token;
	}

	/**
	 * Honour `Retry-After` when present; ADO also sends `X-RateLimit-Delay`.
	 * Falling back to a blind exponential ramp when the server told us exactly
	 * how long to wait is how a client turns throttling into an outage.
	 */
	function retryDelayMs(
		headers: { get(name: string): string | null },
		attempt: number,
	): number {
		const retryAfter = headers.get("retry-after");
		const rateDelay = headers.get("x-ratelimit-delay");
		const hinted = Number(retryAfter ?? rateDelay);
		if (Number.isFinite(hinted) && hinted > 0) {
			return hinted * 1000 + jitter();
		}
		return 2 ** attempt * 1000 + jitter();
	}

	/**
	 * One HTTP round trip; a dropped connection comes back as `{ failure }`
	 * rather than throwing.
	 *
	 * Extracted so the retry loop stays readable: a transport failure and a 5xx
	 * are the same situation from the caller's side, and both deserve the same
	 * budget rather than two parallel error paths.
	 */
	async function attemptFetch(
		method: string,
		url: string,
		bearer: string,
		body?: unknown,
	): Promise<{ res: AdoResponse } | { failure: string }> {
		try {
			return {
				res: await opts.fetchFn(url, {
					method,
					headers: {
						authorization: `Bearer ${bearer}`,
						accept: "application/json",
						...(body === undefined
							? {}
							: { "content-type": "application/json" }),
					},
					...(body === undefined ? {} : { body: JSON.stringify(body) }),
				}),
			};
		} catch (e) {
			return { failure: e instanceof Error ? e.message : "unknown" };
		}
	}

	/** How a response is reported once the retry budget is spent. */
	async function exhaustedError(
		res: AdoResponse,
		url: string,
	): Promise<AdoError> {
		if (res.status === 429) {
			return new AdoError(
				"rate_limited",
				`Azure DevOps rate limit persisted for ${url}`,
				429,
			);
		}
		if (res.status < 500) {
			const info = classifyErrorBody(await res.text());
			return new AdoError(
				info.kind,
				info.message ?? `Azure DevOps returned ${res.status} for ${url}`,
				res.status,
				info.code,
			);
		}
		return new AdoError(
			"server",
			`Azure DevOps returned ${res.status} for ${url}`,
			res.status,
		);
	}

	async function request(
		method: "GET" | "POST",
		url: string,
		body?: unknown,
	): Promise<unknown> {
		let refreshedOn401 = false;

		for (let attempt = 0; ; attempt++) {
			const bearer = await acquireToken(Date.now());
			const attempted = await attemptFetch(method, url, bearer, body);
			if ("failure" in attempted) {
				// Letting a transport error escape as a bare Error would exit
				// RUNTIME and tell automation a flaky network is a code defect.
				if (attempt < maxRetries) {
					await sleep(retryDelayMs({ get: () => null }, attempt));
					continue;
				}
				throw new AdoError(
					"server",
					`network failure for ${url}: ${attempted.failure}`,
				);
			}
			const res = attempted.res;

			if (res.status === 200) {
				const text = await res.text();
				try {
					return JSON.parse(text);
				} catch {
					throw new AdoError(
						"bad_response",
						`non-JSON body from ${url} (${text.slice(0, 120)})`,
						200,
					);
				}
			}

			if (res.status === 401 && !refreshedOn401) {
				// The token may have been revoked mid-run; try once with a fresh one.
				refreshedOn401 = true;
				token = null;
				continue;
			}

			if (res.status === 401) {
				throw new AdoError(
					"unauthenticated",
					"Azure DevOps rejected the token; run `az login`",
					401,
				);
			}

			if (res.status === 403) {
				// Distinct from 401 on purpose: the user IS signed in. Telling them
				// to log in again sends them in circles.
				throw new AdoError(
					"forbidden",
					"Authenticated but not authorized for this org/project; check access",
					403,
				);
			}

			if (res.status === 404) {
				throw new AdoError("not_found", `not found: ${url}`, 404);
			}

			const transient = res.status === 429 || res.status >= 500;
			if (transient && attempt < maxRetries) {
				await sleep(retryDelayMs(res.headers, attempt));
				continue;
			}

			throw await exhaustedError(res, url);
		}
	}

	return {
		get: (url) => request("GET", url),
		post: (url, body) => request("POST", url, body),
		invalidateToken: () => {
			token = null;
		},
	};
}

/** Build a URL with `api-version` pinned and params properly encoded. */
export function adoUrl(
	base: string,
	path: string,
	params: Record<string, string | number | undefined> = {},
): string {
	const url = new URL(
		path.replace(/^\/+/, ""),
		base.endsWith("/") ? base : `${base}/`,
	);
	for (const [k, v] of Object.entries(params)) {
		if (v !== undefined) {
			url.searchParams.set(k, String(v));
		}
	}
	url.searchParams.set("api-version", ADO_API_VERSION);
	return url.toString();
}
