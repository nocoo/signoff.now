import type {
	GitBranches,
	GitConfig,
	GitContributors,
	GitFiles,
	GitLogs,
	GitMeta,
	GitStatus,
	GitTags,
} from "./types.ts";

/**
 * Default empty values for each report section.
 * Used as fallback when a collector fails, so the report
 * structure remains valid and downstream formatters don't crash.
 */
export const EMPTY_META: GitMeta = {
	gitVersion: "unknown",
	repoRoot: "",
	repoName: "",
	head: null,
	headShort: null,
	currentBranch: null,
	defaultBranch: null,
	remotes: [],
	isShallow: false,
	firstCommitAuthorDate: null,
};

export const EMPTY_STATUS: GitStatus = {
	staged: [],
	modified: [],
	untracked: [],
	conflicted: [],
	stashCount: 0,
	repoState: "clean",
};

export const EMPTY_BRANCHES: GitBranches = {
	current: null,
	local: [],
	remote: [],
	totalLocal: 0,
	totalRemote: 0,
};

export const EMPTY_LOGS: GitLogs = {
	totalCommits: 0,
	totalMerges: 0,
	firstCommitDate: null,
	lastCommit: null,
};

export const EMPTY_CONTRIBUTORS: GitContributors = {
	authors: [],
	totalAuthors: 0,
	activeRecent: 0,
};

export const EMPTY_TAGS: GitTags = {
	count: 0,
	tags: [],
	latestReachableTag: null,
	commitsSinceTag: null,
};

export const EMPTY_FILES: GitFiles = {
	trackedCount: 0,
	typeDistribution: {},
	totalLines: 0,
	largestTracked: [],
};

export const EMPTY_CONFIG: GitConfig = {
	gitDirSizeKiB: 0,
	objectStats: {
		count: 0,
		size: 0,
		inPack: 0,
		packs: 0,
		sizePackKiB: 0,
		prunePackable: 0,
		garbage: 0,
		sizeGarbageKiB: 0,
	},
	worktreeCount: 0,
	hooks: [],
	localConfig: {},
};
