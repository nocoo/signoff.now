/**
 * GitHub URL builder — origin-aware URL generation for GitHub links.
 *
 * All URLs use `ctx.origin` as the base (extracted from the PR url field),
 * so GitHub Enterprise instances are supported out of the box.
 */

// ─── Types ───────────────────────────────────────────────────────────

export interface GitHubUrlContext {
	/** GitHub origin including protocol, e.g. "https://github.com" or
	 *  "https://github.example.com" for Enterprise. */
	origin: string;
	owner: string;
	repo: string;
	/** Head commit SHA (for linking files on the PR branch). */
	headRefOid?: string;
	/** Base commit SHA (for linking deleted files on the base branch). */
	baseRefOid?: string;
}

export type GitHubUrlTarget =
	| { type: "pr"; number: number }
	| { type: "user"; login: string }
	| { type: "branch"; name: string }
	| { type: "commit"; sha: string }
	| { type: "file"; path: string; line?: number | null; ref?: string }
	| { type: "label"; name: string }
	| { type: "milestones" };

// ─── URL Builder ─────────────────────────────────────────────────────

/**
 * Build a fully-qualified GitHub URL from context + target.
 * Never hardcodes a domain — always uses `ctx.origin`.
 */
export function buildGitHubUrl(
	ctx: GitHubUrlContext,
	target: GitHubUrlTarget,
): string {
	const base = ctx.origin.replace(/\/+$/, "");
	const repoBase = `${base}/${encodeURIComponent(ctx.owner)}/${encodeURIComponent(ctx.repo)}`;

	switch (target.type) {
		case "pr":
			return `${repoBase}/pull/${target.number}`;

		case "user":
			return `${base}/${encodeURIComponent(target.login)}`;

		case "branch":
			return `${repoBase}/tree/${encodeURIComponent(target.name)}`;

		case "commit":
			return `${repoBase}/commit/${target.sha}`;

		case "file": {
			const ref = target.ref ?? ctx.headRefOid ?? "HEAD";
			const encodedPath = target.path
				.split("/")
				.map(encodeURIComponent)
				.join("/");
			const url = `${repoBase}/blob/${ref}/${encodedPath}`;
			if (target.line !== null && target.line !== undefined) {
				return `${url}#L${target.line}`;
			}
			return url;
		}

		case "label":
			return `${repoBase}/labels/${encodeURIComponent(target.name)}`;

		case "milestones":
			return `${repoBase}/milestones`;
	}
}

// ─── URL Parser ──────────────────────────────────────────────────────

/**
 * Parse a GitHub PR HTML URL into origin, owner, and repo.
 * Supports both github.com and GitHub Enterprise URLs.
 *
 * Returns null for malformed or non-PR URLs.
 */
export function parseGitHubPrUrl(
	url: string,
): { origin: string; owner: string; repo: string } | null {
	try {
		const parsed = new URL(url);
		const parts = parsed.pathname.split("/").filter(Boolean);
		// Expected: ["owner", "repo", "pull", "number"]
		if (parts.length < 4 || parts[2] !== "pull") {
			return null;
		}
		return {
			origin: parsed.origin,
			owner: parts[0],
			repo: parts[1],
		};
	} catch {
		return null;
	}
}
