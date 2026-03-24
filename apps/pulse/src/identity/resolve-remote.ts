import type { RemoteInfo } from "./types.ts";

/**
 * Known non-GitHub SSH hosts. These will be returned as "unknown" platform
 * instead of being assumed to be GitHub or a GitHub SSH alias.
 */
const NON_GITHUB_SSH_HOSTS = [
	"gitlab.com",
	"bitbucket.org",
	"codeberg.org",
	"gitea.com",
	"sourcehut.org",
	"sr.ht",
];

/**
 * Check if an SSH host looks like it belongs to GitHub.
 *
 * Positive matches:
 *   - "github.com" (exact)
 *   - "*.github.com" (GHES pattern, e.g. "github.acme.com")
 *   - Any host NOT in the known non-GitHub list (assumed to be an SSH alias
 *     configured in ~/.ssh/config that tunnels to a GitHub host)
 *
 * Negative matches:
 *   - Hosts in the NON_GITHUB_SSH_HOSTS list
 */
function isGitHubSshHost(host: string): boolean {
	const lower = host.toLowerCase();

	// Explicit non-GitHub hosts
	for (const blocked of NON_GITHUB_SSH_HOSTS) {
		if (lower === blocked || lower.endsWith(`.${blocked}`)) {
			return false;
		}
	}

	return true;
}

/**
 * Parse a git remote URL into {platform, host, owner, repo}.
 *
 * Supported formats:
 * - HTTPS: https://github.com/{owner}/{repo}.git
 * - HTTPS GHES: https://{ghes-host}/{owner}/{repo}.git (only if host contains "github")
 * - SSH standard: git@github.com:{owner}/{repo}.git
 * - SSH host alias: git@gh-work:{owner}/{repo}.git (assumes GitHub unless known non-GitHub host)
 * - Azure DevOps: https://{org}.visualstudio.com/... or https://dev.azure.com/...
 */
export function parseRemoteUrl(url: string): RemoteInfo {
	// Azure DevOps detection (must come first — some Azure URLs contain "azure.com")
	if (
		url.includes("visualstudio.com") ||
		url.includes("dev.azure.com") ||
		url.includes("azure.com")
	) {
		return { platform: "azure-devops", host: "", owner: "", repo: "" };
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

		// Resolve to the canonical GitHub host for this SSH connection.
		// For aliases (gh-work, gh-personal) we can't know the real host,
		// so we use "github.com" as the default — identity resolution will
		// scope lookups to this host.
		const canonicalHost = host.includes("github")
			? host.toLowerCase()
			: "github.com";
		return { platform: "github", host: canonicalHost, owner, repo };
	}

	// HTTPS GitHub: https://github.com/{owner}/{repo}.git
	// Also matches GHES: https://github.acme.com/{owner}/{repo}.git
	const httpsMatch =
		/^https?:\/\/([^/]*github[^/]*)\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
	if (httpsMatch) {
		return {
			platform: "github",
			host: (httpsMatch[1] as string).toLowerCase(),
			owner: httpsMatch[2] as string,
			repo: httpsMatch[3] as string,
		};
	}

	return { platform: "unknown", host: "", owner: "", repo: "" };
}
