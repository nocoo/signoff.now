import type { RemoteInfo } from "./types.ts";

/**
 * Check if an SSH host is a GitHub host.
 *
 * Allowlist logic (not denylist):
 *   - "github.com" → true (exact)
 *   - Hostname containing "github" → true (GHES, e.g. "github.acme.com")
 *   - Short name without dots → true (SSH alias like "gh-work", "gh-personal")
 *   - Fully qualified domain NOT containing "github" → false
 */
function isGitHubSshHost(host: string): boolean {
	const lower = host.toLowerCase();

	// Exact match or contains "github" anywhere in the host
	if (lower.includes("github")) {
		return true;
	}

	// No dots → SSH alias (e.g. "gh-work", "my-alias")
	// These are explicitly configured in ~/.ssh/config by the user
	// to point to a GitHub host, so we trust them.
	if (!lower.includes(".")) {
		return true;
	}

	// Fully qualified domain that doesn't contain "github" → reject
	return false;
}

/**
 * Check if a hostname belongs to Azure DevOps.
 */
function isAzureDevOpsHost(host: string): boolean {
	const lower = host.toLowerCase();
	return (
		lower === "dev.azure.com" ||
		lower.endsWith(".visualstudio.com") ||
		lower === "visualstudio.com" ||
		lower === "ssh.dev.azure.com"
	);
}

/**
 * Parse a git remote URL into {platform, host, owner, repo}.
 *
 * Supported formats:
 * - HTTPS: https://github.com/{owner}/{repo}.git
 * - HTTPS GHES: https://{ghes-host}/{owner}/{repo}.git (host must contain "github")
 * - SSH standard: git@github.com:{owner}/{repo}.git
 * - SSH GHES: git@github.acme.com:{owner}/{repo}.git
 * - SSH alias: git@gh-work:{owner}/{repo}.git (short name without dots → trusted alias)
 * - Azure DevOps: https://dev.azure.com/... or https://{org}.visualstudio.com/...
 */
export function parseRemoteUrl(url: string): RemoteInfo {
	// SSH Azure DevOps detection (must come first — their paths have 3+ segments
	// which won't match the standard git@host:owner/repo pattern)
	const sshHostMatch = /^git@([^:]+):/.exec(url);
	if (sshHostMatch && isAzureDevOpsHost(sshHostMatch[1] as string)) {
		return {
			platform: "azure-devops",
			host: (sshHostMatch[1] as string).toLowerCase(),
			owner: "",
			repo: "",
		};
	}

	// SSH format: git@{host}:{owner}/{repo}.git
	const sshMatch = /^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
	if (sshMatch) {
		const host = sshMatch[1] as string;
		const owner = sshMatch[2] as string;
		const repo = sshMatch[3] as string;

		if (!isGitHubSshHost(host)) {
			return { platform: "unknown", host, owner: "", repo: "" };
		}

		// Resolve canonical host:
		// - Hosts containing "github" keep their name (e.g. "github.acme.com")
		// - Short aliases without dots default to "github.com"
		const canonicalHost = host.includes("github")
			? host.toLowerCase()
			: "github.com";
		return { platform: "github", host: canonicalHost, owner, repo };
	}

	// HTTPS format: extract host first, then classify.
	// Azure DevOps URLs can have 3+ path segments, so check host before
	// requiring the {owner}/{repo} two-segment pattern.
	const httpsHostMatch = /^https?:\/\/([^/]+)\//.exec(url);
	if (httpsHostMatch) {
		const host = (httpsHostMatch[1] as string).toLowerCase();

		if (isAzureDevOpsHost(host)) {
			return { platform: "azure-devops", host, owner: "", repo: "" };
		}
	}

	// HTTPS GitHub: require exactly {host}/{owner}/{repo} pattern
	const httpsMatch = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(
		url,
	);
	if (httpsMatch) {
		const host = (httpsMatch[1] as string).toLowerCase();
		const owner = httpsMatch[2] as string;
		const repo = httpsMatch[3] as string;

		if (host.includes("github")) {
			return { platform: "github", host, owner, repo };
		}

		// Non-GitHub HTTPS host (gitlab.com, bitbucket.org, etc.)
		return { platform: "unknown", host, owner: "", repo: "" };
	}

	return { platform: "unknown", host: "", owner: "", repo: "" };
}
