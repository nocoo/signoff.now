/**
 * Shared constants for the GitInfoDashboard.
 */

/** Repo state badge labels and colors. */
export const REPO_STATE_LABELS: Record<
	string,
	{ label: string; color: string }
> = {
	clean: { label: "Clean", color: "bg-green-500/15 text-green-400" },
	merge: { label: "Merging", color: "bg-yellow-500/15 text-yellow-400" },
	"rebase-interactive": {
		label: "Interactive Rebase",
		color: "bg-yellow-500/15 text-yellow-400",
	},
	rebase: { label: "Rebasing", color: "bg-yellow-500/15 text-yellow-400" },
	"cherry-pick": {
		label: "Cherry-picking",
		color: "bg-yellow-500/15 text-yellow-400",
	},
	bisect: { label: "Bisecting", color: "bg-yellow-500/15 text-yellow-400" },
	revert: { label: "Reverting", color: "bg-yellow-500/15 text-yellow-400" },
};

/** Config keys displayed in the overview. */
export const INTERESTING_CONFIG_KEYS = [
	"user.name",
	"user.email",
	"core.autocrlf",
	"core.editor",
	"merge.tool",
	"diff.tool",
	"pull.rebase",
	"push.default",
	"init.defaultBranch",
	"fetch.prune",
];
