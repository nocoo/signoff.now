/**
 * ReviewCard — renders a single PR review with optional inline comments.
 */

import type { PullRequestDetail } from "@signoff/pulse";
import { cn } from "@signoff/ui/utils";
import { relativeDate } from "../../StatNumber";
import { GhLink } from "./GhLink";

type PrReview = PullRequestDetail["reviews"][number];

interface ReviewCardProps {
	review: PrReview;
}

export function ReviewCard({ review }: ReviewCardProps) {
	return (
		<div className="flex flex-col gap-0.5 rounded bg-muted/50 p-2">
			{/* Review header */}
			<div className="flex items-center gap-2">
				<GhLink
					target={{ type: "user", login: review.author }}
					className="text-xs font-medium"
				>
					{review.author}
				</GhLink>
				<span
					className={cn(
						"rounded px-1.5 py-0.5 text-[10px] font-medium",
						review.state === "APPROVED" && "bg-green-500/15 text-green-400",
						review.state === "CHANGES_REQUESTED" &&
							"bg-red-500/15 text-red-400",
						review.state === "COMMENTED" && "bg-blue-500/15 text-blue-400",
						review.state === "DISMISSED" && "bg-yellow-500/15 text-yellow-400",
						review.state === "PENDING" && "bg-muted text-muted-foreground",
					)}
				>
					{review.state}
				</span>
				{review.submittedAt ? (
					<span className="text-[10px] text-muted-foreground">
						{relativeDate(review.submittedAt)}
					</span>
				) : null}
			</div>

			{/* Review body */}
			{review.body ? (
				<p className="text-xs text-muted-foreground">
					{review.body.slice(0, 200)}
					{review.body.length > 200 ? "…" : null}
				</p>
			) : null}

			{/* Inline review comments */}
			{review.comments?.length > 0 ? (
				<div className="mt-1 flex flex-col gap-1 border-l-2 border-border pl-2">
					{review.comments.map((rc, j) => {
						const loc = rc.line ? `${rc.path}:${rc.line}` : rc.path;
						return (
							<div
								key={`${rc.path}-${rc.line ?? j}`}
								className="flex flex-col gap-0.5"
							>
								<GhLink
									target={{
										type: "file",
										path: rc.path,
										line: rc.line,
									}}
									className="truncate font-mono text-[10px] text-muted-foreground"
								>
									{loc}
								</GhLink>
								<div className="flex items-center gap-1.5">
									<GhLink
										target={{ type: "user", login: rc.author }}
										className="text-[10px] font-medium"
									>
										{rc.author}
									</GhLink>
									<span className="text-[10px] text-muted-foreground">
										{relativeDate(rc.createdAt)}
									</span>
								</div>
								<p className="text-xs text-muted-foreground">
									{rc.body.slice(0, 200)}
									{rc.body.length > 200 ? "…" : null}
								</p>
							</div>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
