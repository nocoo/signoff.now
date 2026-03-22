// --- Report ---

export interface GitInfoReport {
	generatedAt: string;
	tiers: CollectorTier[];
	durationMs: number;
	meta: GitMeta;
	status: GitStatus;
	branches: GitBranches;
	logs: GitLogs;
	contributors: GitContributors;
	tags: GitTags;
	files: GitFiles;
	config: GitConfig;
	errors: CollectorError[];
}

// --- Meta ---

export interface GitMeta {
	gitVersion: string;
	repoRoot: string;
	repoName: string;
	head: string | null;
	headShort: string | null;
	currentBranch: string | null;
	defaultBranch: string | null;
	remotes: GitRemote[];
	isShallow: boolean;
	firstCommitAuthorDate: string | null;
}

export interface GitRemote {
	name: string;
	fetchUrl: string;
	pushUrls: string[];
}

// --- Status ---

export interface GitStatus {
	staged: GitStatusEntry[];
	modified: GitStatusEntry[];
	untracked: string[];
	conflicted: string[];
	stashCount: number;
	repoState: RepoState;
}

export interface GitStatusEntry {
	path: string;
	indexStatus: string;
	workTreeStatus: string;
	sourcePath?: string;
	renameScore?: number;
}

export type RepoState =
	| "clean"
	| "merge"
	| "rebase-interactive"
	| "rebase"
	| "cherry-pick"
	| "bisect"
	| "revert";

// --- Branches ---

export interface GitBranches {
	current: string | null;
	local: GitBranchInfo[];
	remote: string[];
	totalLocal: number;
	totalRemote: number;
}

export interface GitBranchInfo {
	name: string;
	upstream: string | null;
	aheadBehind: { ahead: number; behind: number } | null;
	lastCommitDate: string;
	isMerged: boolean;
}

// --- Logs ---

export interface GitLogs {
	totalCommits: number;
	totalMerges: number;
	firstCommitDate: string | null;
	lastCommit: GitCommitSummary | null;
	commitFrequency?: CommitFrequency;
	conventionalTypes?: Record<string, number>;
}

export interface GitCommitSummary {
	sha: string;
	shaShort: string;
	author: string;
	date: string;
	subject: string;
}

export interface CommitFrequency {
	byDayOfWeek: Record<string, number>;
	byHour: Record<string, number>;
	byMonth: Record<string, number>;
}

// --- Contributors ---

export interface GitContributors {
	authors: GitAuthorSummary[];
	totalAuthors: number;
	activeRecent: number;
	authorStats?: GitAuthorStats[];
}

export interface GitAuthorSummary {
	name: string;
	email: string;
	commits: number;
}

export interface GitAuthorStats {
	name: string;
	email: string;
	linesAdded: number;
	linesDeleted: number;
}

// --- Tags ---

export interface GitTags {
	count: number;
	tags: GitTagInfo[];
	latestReachableTag: string | null;
	commitsSinceTag: number | null;
}

export interface GitTagInfo {
	name: string;
	type: "annotated" | "lightweight";
	sha: string;
	date: string | null;
	message: string | null;
}

// --- Files ---

export interface GitFiles {
	trackedCount: number;
	typeDistribution: Record<string, number>;
	totalLines: number;
	largestTracked: FileSizeInfo[];
	largestBlobs?: GitBlobInfo[];
	mostChanged?: GitFileChurn[];
	binaryFiles?: string[];
}

export interface FileSizeInfo {
	path: string;
	sizeBytes: number;
}

export interface GitBlobInfo {
	sha: string;
	path: string;
	sizeBytes: number;
}

export interface GitFileChurn {
	path: string;
	count: number;
}

// --- Config ---

export interface GitConfig {
	gitDirSizeKiB: number;
	objectStats: GitObjectStats;
	worktreeCount: number;
	hooks: string[];
	localConfig: Record<string, string[]>;
}

export interface GitObjectStats {
	count: number;
	size: number;
	inPack: number;
	packs: number;
	sizePackKiB: number;
	prunePackable: number;
	garbage: number;
	sizeGarbageKiB: number;
}

// --- Report-level ---

export interface CollectorError {
	collector: string;
	message: string;
	stack?: string;
}

export type CollectorTier = "instant" | "moderate" | "slow";
