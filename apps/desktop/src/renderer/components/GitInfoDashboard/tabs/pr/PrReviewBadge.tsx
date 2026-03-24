/**
 * PrReviewBadge — review decision badge for a pull request.
 *
 * Displays the review state as a colored badge:
 * - APPROVED: green
 * - CHANGES_REQUESTED: red
 * - REVIEW_REQUIRED: yellow/muted
 * - null: not shown
 */

import { Badge } from "@signoff/ui/badge";
import { cn } from "@signoff/ui/utils";
import { Check, MessageSquareWarning, ShieldAlert } from "lucide-react";

interface PrReviewBadgeProps {
	reviewDecision: string | null;
	className?: string;
}

const REVIEW_CONFIG: Record<
	string,
	{
		label: string;
		icon: React.ComponentType<{ className?: string }>;
		className: string;
	}
> = {
	APPROVED: {
		label: "Approved",
		icon: Check,
		className: "border-green-500/30 bg-green-500/10 text-green-400",
	},
	CHANGES_REQUESTED: {
		label: "Changes",
		icon: ShieldAlert,
		className: "border-red-500/30 bg-red-500/10 text-red-400",
	},
	REVIEW_REQUIRED: {
		label: "Review",
		icon: MessageSquareWarning,
		className: "border-yellow-500/30 bg-yellow-500/10 text-yellow-400",
	},
};

export function PrReviewBadge({
	reviewDecision,
	className,
}: PrReviewBadgeProps) {
	if (!reviewDecision) return null;

	const config = REVIEW_CONFIG[reviewDecision];
	if (!config) return null;

	const Icon = config.icon;

	return (
		<Badge
			variant="outline"
			className={cn(
				"gap-1 text-[10px] font-normal",
				config.className,
				className,
			)}
		>
			<Icon className="size-3" />
			{config.label}
		</Badge>
	);
}
