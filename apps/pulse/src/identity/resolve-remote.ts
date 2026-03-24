import type { RemoteInfo } from "./types.ts";

/**
 * Parse a git remote URL into {platform, owner, repo}.
 *
 * Supported formats:
 * - HTTPS: https://github.com/{owner}/{repo}.git
 * - SSH standard: git@github.com:{owner}/{repo}.git
 * - SSH host alias: git@gh-work:{owner}/{repo}.git
 * - Azure DevOps: https://{org}.visualstudio.com/... or https://dev.azure.com/...
 */
export function parseRemoteUrl(url: string): RemoteInfo {
	// Azure DevOps detection
	if (
		url.includes("visualstudio.com") ||
		url.includes("dev.azure.com") ||
		url.includes("azure.com")
	) {
		return { platform: "azure-devops", owner: "", repo: "" };
	}

	// SSH format: git@{host}:{owner}/{repo}.git
	const sshMatch = /^git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
	if (sshMatch) {
		return {
			platform: "github",
			owner: sshMatch[1] as string,
			repo: sshMatch[2] as string,
		};
	}

	// HTTPS format: https://github.com/{owner}/{repo}.git
	const httpsMatch =
		/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url);
	if (httpsMatch) {
		return {
			platform: "github",
			owner: httpsMatch[1] as string,
			repo: httpsMatch[2] as string,
		};
	}

	return { platform: "unknown", owner: "", repo: "" };
}
