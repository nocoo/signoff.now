/**
 * PrStateIcon — visual state indicator for a pull request.
 *
 * Matches the CLI's pretty format:
 * - Open: green circle
 * - Draft: grey outline circle
 * - Merged: purple hexagon
 * - Closed: red circle
 */

import type { PullRequestInfo } from "@signoff/pulse";
import { cn } from "@signoff/ui/utils";
import {
	Circle,
	GitMerge,
	GitPullRequest,
	GitPullRequestDraft,
} from "lucide-react";

interface PrStateIconProps {
	state: PullRequestInfo["state"];
	isDraft: boolean;
	merged: boolean;
	className?: string;
}

export function PrStateIcon({
	state,
	isDraft,
	merged,
	className,
}: PrStateIconProps) {
	if (merged) {
		return (
			<GitMerge className={cn("size-4 shrink-0 text-purple-400", className)} />
		);
	}

	if (isDraft) {
		return (
			<GitPullRequestDraft
				className={cn("size-4 shrink-0 text-muted-foreground", className)}
			/>
		);
	}

	if (state === "CLOSED") {
		return <Circle className={cn("size-4 shrink-0 text-red-400", className)} />;
	}

	// Open
	return (
		<GitPullRequest
			className={cn("size-4 shrink-0 text-green-400", className)}
		/>
	);
}
