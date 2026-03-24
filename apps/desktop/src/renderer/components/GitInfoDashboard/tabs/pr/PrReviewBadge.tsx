/**
 * PrReviewBadge — review decision badge for a pull request.
 *
 * Uses the project's standard semantic badge pattern:
 * `rounded bg-{color}-500/15 px-2 py-0.5 text-xs font-medium text-{color}-400`
 */

import { cn } from "@signoff/ui/utils";

interface PrReviewBadgeProps {
	reviewDecision: string | null;
	className?: string;
}

const REVIEW_CONFIG: Record<string, { label: string; className: string }> = {
	APPROVED: {
		label: "Approved",
		className: "bg-green-500/15 text-green-400",
	},
	CHANGES_REQUESTED: {
		label: "Changes Requested",
		className: "bg-red-500/15 text-red-400",
	},
	REVIEW_REQUIRED: {
		label: "Review Required",
		className: "bg-yellow-500/15 text-yellow-400",
	},
};

export function PrReviewBadge({
	reviewDecision,
	className,
}: PrReviewBadgeProps) {
	if (!reviewDecision) return null;

	const config = REVIEW_CONFIG[reviewDecision];
	if (!config) return null;

	return (
		<span
			className={cn(
				"rounded px-2 py-0.5 text-xs font-medium",
				config.className,
				className,
			)}
		>
			{config.label}
		</span>
	);
}
