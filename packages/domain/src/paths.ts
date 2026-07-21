/**
 * Local filesystem path helpers for the collect CLI (01 §7.2).
 * Pure path joiners — no fs I/O.
 */

function join(...parts: string[]): string {
	return parts
		.map((p) => p.replace(/^\/+|\/+$/g, ""))
		.filter((p) => p.length > 0)
		.join("/");
}

/**
 * Raw ADO payload path under .data/raw/.
 * Example: rawPath("ado", "acme", "Alpha", "repos/foo", "prs/1234")
 * → "ado/acme/Alpha/repos/foo/prs/1234"
 */
export function rawPath(
	provider: string,
	org: string,
	project: string,
	...rest: string[]
): string {
	return join(provider, org, project, ...rest);
}

/**
 * Normalized activity JSON path under .data/normalized/.
 */
export function normalizedPath(
	provider: string,
	org: string,
	project: string,
	...rest: string[]
): string {
	return join(provider, org, project, ...rest);
}

/**
 * Bootstrap / settings cache relative path (under .data/cache/).
 */
export function cachePath(...rest: string[]): string {
	if (rest.length === 0) {
		return "bootstrap.json";
	}
	return join(...rest);
}

/** Absolute-style relative roots used by the collect CLI. */
export const DATA_ROOTS = {
	raw: ".data/raw",
	normalized: ".data/normalized",
	cache: ".data/cache",
} as const;
