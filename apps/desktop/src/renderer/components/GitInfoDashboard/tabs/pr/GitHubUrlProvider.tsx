/**
 * GitHubUrlProvider — React Context for GitHub URL generation.
 *
 * Placed at the PrDetailPanel level so all child components
 * (ReviewCard, CommitRow, etc.) can build GitHub links without
 * prop drilling.
 */

import { createContext, useContext } from "react";
import type { GitHubUrlContext } from "./github-urls";

const GitHubUrlCtx = createContext<GitHubUrlContext | null>(null);

export function GitHubUrlProvider({
	value,
	children,
}: {
	value: GitHubUrlContext;
	children: React.ReactNode;
}) {
	return (
		<GitHubUrlCtx.Provider value={value}>{children}</GitHubUrlCtx.Provider>
	);
}

/**
 * Read the GitHub URL context. Returns null when no provider is present
 * (e.g. in the list view where links fall back to the PR url field).
 */
export function useGitHubUrlContext(): GitHubUrlContext | null {
	return useContext(GitHubUrlCtx);
}
