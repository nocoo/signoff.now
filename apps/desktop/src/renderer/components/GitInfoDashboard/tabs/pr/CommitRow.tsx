/**
 * CommitRow — renders a single commit with optional check run details.
 */

import type { PullRequestDetail } from "@signoff/pulse";
import { cn } from "@signoff/ui/utils";
import { ExternalLink } from "lucide-react";
import { trpc } from "../../../../lib/trpc";
import { relativeDate } from "../../StatNumber";
import { GhLink } from "./GhLink";

type PrCommit = PullRequestDetail["commits"][number];
type CheckRun = NonNullable<PrCommit["statusCheckRollup"]>["checkRuns"][number];

interface CommitRowProps {
	commit: PrCommit;
}

export function CommitRow({ commit }: CommitRowProps) {
	const openUrlMutation = trpc.external.openUrl.useMutation();

	return (
		<div className="flex flex-col gap-1">
			{/* Commit line */}
			<div className="flex items-start gap-2 text-xs">
				<GhLink
					target={{ type: "commit", sha: commit.abbreviatedOid }}
					className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[10px]"
				>
					{commit.abbreviatedOid}
				</GhLink>
				<span className="flex-1 text-muted-foreground">
					{commit.message.split("\n")[0]}
				</span>
				{commit.author ? (
					<GhLink
						target={{ type: "user", login: commit.author }}
						className="shrink-0 text-[10px] text-muted-foreground"
					>
						{commit.author}
					</GhLink>
				) : null}
				{commit.authoredDate ? (
					<span className="shrink-0 text-[10px] text-muted-foreground">
						{relativeDate(commit.authoredDate)}
					</span>
				) : null}
				{commit.statusCheckRollup ? (
					<span
						className={cn(
							"shrink-0 text-[10px]",
							commit.statusCheckRollup.state === "SUCCESS" && "text-green-400",
							commit.statusCheckRollup.state === "FAILURE" && "text-red-400",
							commit.statusCheckRollup.state === "PENDING" && "text-yellow-400",
						)}
					>
						{commit.statusCheckRollup.state}
					</span>
				) : null}
			</div>

			{/* Check runs */}
			{commit.statusCheckRollup !== null &&
			commit.statusCheckRollup.checkRuns.length > 0 ? (
				<div className="ml-6 flex flex-col gap-0.5">
					{commit.statusCheckRollup.checkRuns.map((cr) => (
						<CheckRunItem
							key={cr.name}
							checkRun={cr}
							onOpenUrl={(url) => openUrlMutation.mutate({ url })}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}

function CheckRunItem({
	checkRun,
	onOpenUrl,
}: {
	checkRun: CheckRun;
	onOpenUrl: (url: string) => void;
}) {
	const icon = getCheckRunIcon(checkRun.conclusion);
	const label = checkRun.conclusion
		? checkRun.conclusion.toLowerCase()
		: checkRun.status.toLowerCase();

	const content = (
		<div
			className={cn(
				"flex items-center gap-1.5 text-[10px]",
				checkRun.conclusion === "SUCCESS" && "text-green-400",
				(checkRun.conclusion === "FAILURE" ||
					checkRun.conclusion === "TIMED_OUT") &&
					"text-red-400",
				(checkRun.conclusion === "CANCELLED" ||
					checkRun.conclusion === "SKIPPED" ||
					checkRun.conclusion === "NEUTRAL") &&
					"text-muted-foreground",
				checkRun.conclusion === null && "text-yellow-400",
			)}
		>
			<span>{icon}</span>
			<span>{checkRun.name}</span>
			<span className="text-muted-foreground">[{label}]</span>
			{checkRun.detailsUrl ? (
				<ExternalLink className="size-2.5 shrink-0" />
			) : null}
		</div>
	);

	if (checkRun.detailsUrl) {
		return (
			<button
				type="button"
				className="w-fit hover:opacity-80"
				onClick={() => onOpenUrl(checkRun.detailsUrl as string)}
			>
				{content}
			</button>
		);
	}

	return content;
}

function getCheckRunIcon(conclusion: string | null): string {
	switch (conclusion) {
		case "SUCCESS":
			return "✓";
		case "FAILURE":
		case "TIMED_OUT":
			return "✗";
		case "CANCELLED":
		case "SKIPPED":
		case "NEUTRAL":
			return "○";
		default:
			return "⏳";
	}
}
