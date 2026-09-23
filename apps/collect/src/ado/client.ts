/**
 * Azure DevOps REST client (07 §2, §7.3, §8).
 *
 * Auth goes through `az account get-access-token` rather than a stored PAT
 * (01 §7.3). Calls pin `api-version=7.1`; preview endpoints explicitly select
 * their documented version. The parameters this project
 * depends on (`searchCriteria.minTime` + `queryTimeRangeType`) exist there but
 * not in older SDK surfaces, so version drift would silently change behaviour.
 */

import {
	AVATAR_MAX_BYTES,
	avatarContentTypeSchema,
	type CachedAvatar,
	isAdoAvatarUrl,
} from "@signoff/domain/avatars";
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
	init?: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
		signal?: AbortSignal;
		redirect?: "manual" | "follow" | "error";
	},
) => Promise<AdoResponse>;

export type AdoResponse = {
	status: number;
	headers: { get(name: string): string | null };
	text(): Promise<string>;
	body?: ReadableStream<Uint8Array> | null;
	image?: CachedAvatar;
};

async function readAvatar(response: AdoResponse): Promise<CachedAvatar> {
	const contentType = avatarContentTypeSchema.safeParse(
		response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase(),
	);
	if (
		!contentType.success ||
		Number(response.headers.get("content-length")) > AVATAR_MAX_BYTES ||
		!response.body
	) {
		await response.body?.cancel();
		throw new AdoError("bad_response", "Invalid avatar response");
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let length = 0;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			length += part.value.byteLength;
			if (length > AVATAR_MAX_BYTES)
				throw new AdoError("bad_response", "Avatar exceeds size limit");
			chunks.push(part.value);
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
	if (!length) throw new AdoError("bad_response", "Avatar response is empty");
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { contentType: contentType.data, bytes };
}

export type SleepFn = (ms: number) => Promise<void>;

export type AdoClientOptions = {
	exec: ExecFn;
	fetchFn: FetchFn;
	sleep?: SleepFn;
	/** Retry budget for 429/5xx. Default 3. */
	maxRetries?: number;
	/** Deterministic jitter hook; default adds 0–250ms. */
	jitterMs?: () => number;
	/**
	 * Per-request ceiling. Without one a half-open connection hangs the whole
	 * collect forever — no error, no progress, nothing to act on.
	 */
	timeoutMs?: number;
};

type TokenState = { token: string; expiresAtMs: number } | null;

export const ADO_LOGIN_HINT = `Azure login expired or unavailable. Run az login --scope ${ADO_RESOURCE}/.default, then retry. Existing PR data is preserved.`;

/** Ask Azure CLI to renew its cached session. Never return diagnostics containing credentials. */
export async function readAzToken(
	exec: ExecFn,
	nowMs = Date.now(),
	tenantId?: string,
): Promise<NonNullable<TokenState>> {
	const loginHint = tenantId
		? `Azure login expired or unavailable. Run az login --tenant ${tenantId} --scope ${ADO_RESOURCE}/.default, then retry. Existing PR data is preserved.`
		: ADO_LOGIN_HINT;
	let result: Awaited<ReturnType<ExecFn>>;
	try {
		result = await exec("az", [
			"account",
			"get-access-token",
			"--resource",
			ADO_RESOURCE,
			...(tenantId ? ["--tenant", tenantId] : []),
			"-o",
			"json",
		]);
	} catch {
		throw new AdoError(
			"unauthenticated",
			"Azure CLI is unavailable. Check its installation and run az login.",
		);
	}
	if (result.exitCode !== 0) throw new AdoError("unauthenticated", loginHint);
	let parsed: { accessToken?: unknown; expires_on?: unknown };
	try {
		parsed = JSON.parse(result.stdout);
	} catch {
		throw new AdoError("bad_response", "az returned unparseable token JSON");
	}
	if (
		!parsed ||
		typeof parsed.accessToken !== "string" ||
		!parsed.accessToken.trim()
	)
		throw new AdoError("unauthenticated", loginHint);
	const expiry =
		parsed.expires_on === null || parsed.expires_on === undefined
			? Number.NaN
			: Number(parsed.expires_on);
	const expiresAtMs = Number.isFinite(expiry)
		? expiry * 1000
		: nowMs + 10 * 60_000;
	if (expiresAtMs <= nowMs) throw new AdoError("unauthenticated", loginHint);
	return { token: parsed.accessToken, expiresAtMs };
}

/** Refresh a minute before expiry so an in-flight page never straddles it. */
const REFRESH_MARGIN_MS = 60_000;

/** Generous: a large threads page is slow, but nothing legitimately hangs. */
const DEFAULT_TIMEOUT_MS = 60_000;

function isLoginResponse(status: number): boolean {
	return status === 401 || status === 203 || (status >= 300 && status < 400);
}

export type AdoClient = {
	/** GET a JSON resource, retrying transient failures. */
	get(url: string): Promise<unknown>;
	/** POST a JSON body (used for WIQL). */
	post(url: string, body: unknown): Promise<unknown>;
	/** Force the next call to re-acquire a token (tests / 401 recovery). */
	invalidateToken(): void;
};
export type AdoPage = { data: unknown; continuationToken: string | null };
export type AdoPagedClient = AdoClient & {
	getPage(url: string): Promise<AdoPage>;
	checkAuth(organization?: string): Promise<void>;
};

export type AdoAvatarClient = AdoPagedClient & {
	getAvatar(url: string, organization: string): Promise<CachedAvatar>;
};

export function createAdoClient(opts: AdoClientOptions): AdoAvatarClient {
	const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	const maxRetries = opts.maxRetries ?? 3;
	const jitter = opts.jitterMs ?? (() => Math.floor(Math.random() * 250));
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const tokens = new Map<string, NonNullable<TokenState>>();
	const acquiring = new Map<string, Promise<string>>();
	const organizationTenants = new Map<string, string>();

	async function acquireToken(nowMs: number, tenantId = ""): Promise<string> {
		const token = tokens.get(tenantId);
		if (token && token.expiresAtMs - REFRESH_MARGIN_MS > nowMs) {
			return token.token;
		}
		let pending = acquiring.get(tenantId);
		if (!pending) {
			pending = readAzToken(opts.exec, nowMs, tenantId || undefined)
				.then((next) => {
					tokens.set(tenantId, next);
					return next.token;
				})
				.finally(() => {
					acquiring.delete(tenantId);
				});
			acquiring.set(tenantId, pending);
		}
		return pending;
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
		bearer: string | undefined,
		body?: unknown,
		image = false,
	): Promise<{ res: AdoResponse } | { failure: string }> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await opts.fetchFn(url, {
				method,
				redirect: "manual",
				headers: {
					...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
					accept: image
						? "image/png,image/jpeg,image/gif,image/webp"
						: "application/json",
					...(body === undefined ? {} : { "content-type": "application/json" }),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				signal: controller.signal,
			});
			if (image && response.status === 200) {
				const avatar = await readAvatar(response);
				return {
					res: {
						status: response.status,
						headers: response.headers,
						text: async () => "",
						image: avatar,
					},
				};
			}
			const payload = await response.text();
			return {
				res: {
					status: response.status,
					headers: response.headers,
					text: async () => payload,
				},
			};
		} catch (e) {
			if (e instanceof AdoError) throw e;
			// Name the timeout: "aborted" alone reads like someone hit Ctrl-C.
			if (controller.signal.aborted) {
				return { failure: `timed out after ${timeoutMs}ms` };
			}
			return { failure: e instanceof Error ? e.message : "unknown" };
		} finally {
			clearTimeout(timer);
		}
	}

	async function discoverTenant(
		url: string,
		hint?: string | null,
	): Promise<string | null> {
		let candidate = hint;
		if (!candidate) {
			// ADO omits the tenant header on AadUserStateException (403). An
			// anonymous HEAD returns its authentication challenge without credentials.
			const probe = await attemptFetch("HEAD", url, undefined);
			candidate =
				"res" in probe ? probe.res.headers.get("x-vss-resourcetenant") : null;
		}
		return candidate &&
			/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(candidate)
			? candidate
			: null;
	}

	/** How a response is reported once the retry budget is spent. */
	async function exhaustedError(
		res: AdoResponse,
		url: string,
	): Promise<AdoError> {
		if (isLoginResponse(res.status))
			return new AdoError("unauthenticated", ADO_LOGIN_HINT, 401);
		if (res.status === 403)
			return new AdoError(
				"forbidden",
				"Authenticated but not authorized for this org/project; check access",
				403,
			);
		if (res.status === 404)
			return new AdoError("not_found", `not found: ${url}`, 404);
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

	async function correctTenant(
		res: AdoResponse,
		url: string,
		organization: string | undefined,
		tenantId: string,
	): Promise<boolean> {
		if (!organization || (res.status !== 401 && res.status !== 403))
			return false;
		const tenantHint = await discoverTenant(
			url,
			res.headers.get("x-vss-resourcetenant"),
		);
		if (!tenantHint || tenantHint === tenantId) return false;
		organizationTenants.set(organization, tenantHint);
		return true;
	}

	async function parsePage(res: AdoResponse, url: string): Promise<AdoPage> {
		const payload = await res.text();
		try {
			return {
				data: JSON.parse(payload),
				continuationToken: res.headers.get("x-ms-continuationtoken"),
			};
		} catch {
			throw new AdoError("bad_response", `non-JSON body from ${url}`, 200);
		}
	}

	async function request(
		method: "GET" | "POST",
		url: string,
		body?: unknown,
		image = false,
	): Promise<AdoResponse> {
		let refreshedOn401 = false;
		let correctedTenant = false;
		const target = new URL(url);
		const organization =
			target.protocol === "https:" && target.host === "dev.azure.com"
				? target.pathname.split("/")[1]?.toLowerCase()
				: undefined;

		for (let attempt = 0; ; attempt++) {
			const tenantId =
				(organization && organizationTenants.get(organization)) || "";
			const bearer = await acquireToken(Date.now(), tenantId);
			const attempted = await attemptFetch(method, url, bearer, body, image);
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
			if (
				!correctedTenant &&
				(await correctTenant(res, url, organization, tenantId))
			) {
				correctedTenant = true;
				attempt--;
				continue;
			}

			if (res.status === 200) return res;

			const rejectedToken = isLoginResponse(res.status);
			if (rejectedToken && !refreshedOn401) {
				// The token may have been revoked mid-run; try once with a fresh
				// one. This does NOT spend a retry: a token refresh is not a
				// transient remote failure, and letting it eat one would mean a
				// run that hits 401 gets fewer retries than the doc promises.
				refreshedOn401 = true;
				if (tokens.get(tenantId)?.token === bearer) tokens.delete(tenantId);
				attempt--;
				continue;
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
		get: async (url) => (await parsePage(await request("GET", url), url)).data,
		post: async (url, body) =>
			(await parsePage(await request("POST", url, body), url)).data,
		getPage: async (url) => parsePage(await request("GET", url), url),
		getAvatar: async (url, organization) => {
			if (!isAdoAvatarUrl(url, organization))
				throw new AdoError("bad_request", "Invalid avatar source");
			const response = await request("GET", url, undefined, true);
			if (!response.image)
				throw new AdoError("bad_response", "Missing avatar body");
			return response.image;
		},
		checkAuth: async (organization) => {
			const key = organization?.toLowerCase();
			if (key && !organizationTenants.has(key)) {
				const tenant = await discoverTenant(
					`https://dev.azure.com/${encodeURIComponent(key)}/_apis/connectionData`,
				);
				if (tenant) organizationTenants.set(key, tenant);
			}
			await acquireToken(
				Date.now(),
				key
					? organizationTenants.get(key)
					: organizationTenants.values().next().value,
			);
		},
		invalidateToken: () => {
			tokens.clear();
		},
	};
}

/** Build a URL with `api-version` pinned and params properly encoded. */
export function adoUrl(
	base: string,
	path: string,
	params: Record<string, string | number | undefined> = {},
	apiVersion: "7.1" | "7.1-preview.1" = ADO_API_VERSION,
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
	url.searchParams.set("api-version", apiVersion);
	return url.toString();
}
