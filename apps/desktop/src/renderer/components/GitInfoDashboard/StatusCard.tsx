/**
 * StatusCard — working tree status: staged, modified, untracked, conflicted, stash count.
 */

import type { GitStatus } from "@signoff/gitinfo";
import { cn } from "@signoff/ui/utils";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { DashboardCard } from "./DashboardCard";
import { StatNumber } from "./StatNumber";

const REPO_STATE_LABELS: Record<string, { label: string; color: string }> = {
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

interface StatusCardProps {
	status: GitStatus;
}

export function StatusCard({ status }: StatusCardProps) {
	const stateInfo = REPO_STATE_LABELS[status.repoState] ?? {
		label: status.repoState,
		color: "bg-muted text-muted-foreground",
	};

	return (
		<DashboardCard title="Status" icon={<AlertCircle className="h-4 w-4" />}>
			<div className="mb-3">
				<span
					className={cn(
						"rounded px-2 py-0.5 text-xs font-medium",
						stateInfo.color,
					)}
				>
					{stateInfo.label}
				</span>
			</div>

			<div className="mb-3 grid grid-cols-3 gap-3">
				<StatNumber label="Staged" value={status.staged.length} />
				<StatNumber label="Modified" value={status.modified.length} />
				<StatNumber label="Untracked" value={status.untracked.length} />
				<StatNumber label="Conflicted" value={status.conflicted.length} />
				<StatNumber label="Stashes" value={status.stashCount} />
			</div>

			{/* Expandable file lists */}
			{status.conflicted.length > 0 && (
				<FileList
					label="Conflicted"
					files={status.conflicted}
					className="text-red-400"
				/>
			)}
			{status.staged.length > 0 && (
				<FileList
					label="Staged"
					files={status.staged.map((s) => s.path)}
					className="text-green-400"
				/>
			)}
			{status.modified.length > 0 && (
				<FileList
					label="Modified"
					files={status.modified.map((s) => s.path)}
					className="text-yellow-400"
				/>
			)}
			{status.untracked.length > 0 && (
				<FileList
					label="Untracked"
					files={status.untracked}
					className="text-muted-foreground"
				/>
			)}
		</DashboardCard>
	);
}

function FileList({
	label,
	files,
	className,
}: {
	label: string;
	files: string[];
	className?: string;
}) {
	const [expanded, setExpanded] = useState(false);

	if (files.length === 0) return null;

	return (
		<div className="mt-2">
			<button
				type="button"
				onClick={() => setExpanded(!expanded)}
				className="text-xs text-muted-foreground hover:text-foreground"
			>
				{expanded ? "▼" : "▶"} {label} ({files.length})
			</button>
			{expanded && (
				<div className="mt-1 max-h-32 overflow-y-auto pl-3">
					{files.map((f) => (
						<div
							key={f}
							className={cn("truncate font-mono text-xs", className)}
						>
							{f}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
