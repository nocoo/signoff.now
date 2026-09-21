import { Badge } from "@nocoo/basalt";
import { SlotBarChart } from "@nocoo/basalt/charts/slot-bar";
import type { AiReadiness } from "@signoff/domain/ai-readiness";
import type {
	Build,
	CheckState,
	Project,
	PullRequest,
	ReadinessColor,
} from "@signoff/domain/workbench";
import {
	Ban,
	Check,
	Circle,
	CircleDashed,
	CircleHelp,
	Clock3,
	LoaderCircle,
	ShieldAlert,
	UserRoundCheck,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { heatmapColor } from "@/lib/palette";
import { cn } from "@/lib/utils";

export function LifecycleBadge({
	pull,
}: {
	pull: Pick<PullRequest, "state" | "draft">;
}) {
	const [label, variant] = (
		{
			open: ["Open", "success"],
			draft: ["Draft", "secondary"],
			merged: ["Merged", "purple"],
			closed: ["Closed", "red"],
		} as const
	)[pull.state === "open" && pull.draft ? "draft" : pull.state];
	return (
		<Badge
			variant={variant}
			className="px-1.5 py-0 text-[11px]"
			title="Provider PR lifecycle"
		>
			{label}
		</Badge>
	);
}
const READINESS_ICONS = {
	skipped: CircleDashed,
	conflict: X,
	warning: ShieldAlert,
	running: LoaderCircle,
	ready: Check,
	waiting: UserRoundCheck,
	attention: ShieldAlert,
	unknown: CircleHelp,
	error: Ban,
};
export function ReadinessBadge({
	readiness,
}: {
	readiness: AiReadiness;
	project?: Project;
}) {
	const Icon =
		readiness.status === "running"
			? LoaderCircle
			: READINESS_ICONS[readiness.kind];
	const color = (
		{
			skipped: "cyan",
			conflict: "red",
			warning: "yellow",
			running: "blue",
			ready: "green",
			waiting: "purple",
			attention: "red",
			unknown: "gray",
			error: "red",
		} as const
	)[readiness.kind];
	return (
		<ReadinessSwatch color={color} subtle={readiness.kind === "attention"}>
			<Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
			<span className="truncate" title={readiness.nextAction}>
				{readiness.label}
			</span>
		</ReadinessSwatch>
	);
}

const COLOR_VARIANTS = {
	cyan: "teal",
	green: "success",
	yellow: "orange",
	orange: "orange",
	blue: "blue",
	red: "red",
	purple: "purple",
	gray: "secondary",
} as const;
export function ReadinessSwatch({
	color,
	children,
	subtle = false,
}: {
	color: ReadinessColor | "cyan";
	subtle?: boolean;
	children: ReactNode;
}) {
	return (
		<Badge
			variant={COLOR_VARIANTS[color]}
			className={cn(
				"max-w-full gap-1.5 whitespace-nowrap font-medium",
				color === "yellow" &&
					"bg-[hsl(var(--basalt-chart-yellow))] text-basalt-foreground",
				subtle && "bg-basalt-destructive/10 text-basalt-destructive",
				color === "gray" && "bg-basalt-muted-foreground text-white",
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
