import { Badge } from "@nocoo/basalt";
import { SlotBarChart } from "@nocoo/basalt/charts/slot-bar";
import {
	type Build,
	type CheckState,
	type Project,
	type PullReadiness,
	type ReadinessColor,
	readinessColor,
} from "@signoff/domain/workbench";
import {
	Ban,
	Check,
	Circle,
	CircleDashed,
	CircleHelp,
	Clock3,
	GitMerge,
	GitPullRequest,
	GitPullRequestDraft,
	LoaderCircle,
	ShieldAlert,
	UserRoundCheck,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { heatmapColor } from "@/lib/palette";
import { cn } from "@/lib/utils";

const READINESS_ICONS = {
	blocked: ShieldAlert,
	approval: UserRoundCheck,
	review: GitPullRequest,
	running: LoaderCircle,
	unknown: CircleHelp,
	ready: Check,
	draft: GitPullRequestDraft,
	merged: GitMerge,
	closed: Ban,
} as const;

export function ReadinessBadge({
	readiness,
	project,
}: {
	readiness: Pick<PullReadiness, "kind" | "label" | "policy">;
	project: Project;
}) {
	const Icon = READINESS_ICONS[readiness.kind];
	return (
		<ReadinessSwatch color={readinessColor(readiness, project)}>
			<Icon className="h-3.5 w-3.5 shrink-0" aria-hidden strokeWidth={1.8} />
			<span className="truncate" title={readiness.label}>
				{readiness.label}
			</span>
		</ReadinessSwatch>
	);
}

const COLOR_VARIANTS = {
	green: "success",
	yellow: "secondary",
	orange: "warning",
	blue: "info",
	red: "error",
	purple: "purple",
	gray: "secondary",
} as const;
export function ReadinessSwatch({
	color,
	children,
}: {
	color: ReadinessColor;
	children: ReactNode;
}) {
	return (
		<Badge
			variant={COLOR_VARIANTS[color]}
			className={cn(
				"max-w-full gap-1.5 whitespace-nowrap font-medium",
				(color === "green" || color === "purple") && "text-black",
				color === "yellow" && "bg-basalt-chart-7/30 text-basalt-foreground",
			)}
		>
			{children}
		</Badge>
	);
}

export const CHECK_LABELS: Record<CheckState, string> = {
	passed: "Passed",
	failed: "Failed",
	running: "Running",
	queued: "Queued",
	waiting: "Awaiting approval",
	skipped: "Skipped",
	canceled: "Canceled",
	unknown: "Unavailable",
};
const CHECK_ICONS = {
	passed: Check,
	failed: X,
	running: LoaderCircle,
	queued: Clock3,
	waiting: UserRoundCheck,
	skipped: CircleDashed,
	canceled: Ban,
	unknown: CircleHelp,
};

export function checkColor(state: CheckState): string {
	if (state === "passed") return heatmapColor(3, "green");
	if (state === "failed" || state === "canceled") return heatmapColor(4, "red");
	if (state === "running") return heatmapColor(3, "blue");
	if (state === "waiting") return heatmapColor(3, "orange");
	return "var(--color-basalt-muted-foreground)";
}

export function CheckIcon({
	state,
	className,
}: {
	state: CheckState;
	className?: string;
}) {
	const Icon = CHECK_ICONS[state];
	return (
		<Icon
			aria-hidden
			strokeWidth={1.8}
			className={cn(
				"h-4 w-4 shrink-0",
				state === "running" && "motion-safe:animate-spin",
				className,
			)}
			style={{ color: checkColor(state) }}
		/>
	);
}

export function StageBar({ builds }: { builds: Build[] }) {
	const stages = builds.flatMap((build) =>
		build.stages.map((stage) => ({
			color: ["queued", "skipped", "unknown"].includes(stage.state)
				? "bg-basalt-muted-foreground/20"
				: checkColor(stage.state),
			label: `${build.name} / ${stage.name}: ${CHECK_LABELS[stage.state]}`,
		})),
	);
	return (
		<SlotBarChart
			items={stages}
			ariaLabel={stages.map((stage) => stage.label).join("; ")}
			heightClass="h-1.5"
			gapClass={stages.length > 24 ? "gap-0" : "gap-1"}
		/>
	);
}

export function StageLegend() {
	return (
		<section
			className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-basalt-muted-foreground"
			aria-label="Stage colors"
		>
			{(["passed", "failed", "running", "waiting", "queued"] as const).map(
				(state) => (
					<span key={state} className="inline-flex items-center gap-1.5">
						<Circle
							aria-hidden
							className="h-2 w-2 fill-current"
							style={{ color: checkColor(state) }}
						/>
						{CHECK_LABELS[state]}
					</span>
				),
			)}
		</section>
	);
}
